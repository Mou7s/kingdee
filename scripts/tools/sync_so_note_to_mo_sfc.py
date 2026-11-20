# -*- coding: utf-8 -*-
"""
销售订单明细备注修改后跨单同步至生产订单与工序计划（BOSIDE 服务插件候选脚本）

挂载位置：
  BOSIDE -> 供应链 > 销售管理 > 销售订单（现有扩展）
  -> 批量编辑字段属性 -> 表单属性 -> 操作列表 -> Save(保存) -> 服务插件 -> 新增 Python 脚本

前置条件（须先在对应扩展及数据库完成）：
  1. PRD_MO 分录 F_UNW_Text_qtr1 已在单据状态(B/C)与分录业务状态(2/3/4/5)取消字段锁定；
  2. SFC_OperationPlanning 表头 F_UNW_Text_qtr 已在单据状态(B/C)取消字段锁定；
  3. 物理列 T_SFC_OPERPLANNING.F_UNW_TEXT_QTR 建议由 nvarchar(250) 扩充至 nvarchar(2000)（未扩前超 250 字会拦截提示）。

状态：2026-11-17 已在正式环境挂载至 SAL_SaleOrder (69908226-8196-4f5a-b1a5-5b135f6c1172) Save 操作，并完成「无变更保存 / 改备注实时同步至 MO(状态4/5)+TX / 二次修改覆盖同步 / 未改行隔离」受控端到端验证。
"""

import clr

clr.AddReference("System")
clr.AddReference("System.Data")
clr.AddReference("Kingdee.BOS")
clr.AddReference("Kingdee.BOS.Core")
clr.AddReference("Kingdee.BOS.DataEntity")

from System import *
from System.Data import *
from System.Threading import Thread
from Kingdee.BOS import *
from Kingdee.BOS.Core import *
from Kingdee.BOS.Core.DynamicForm import *
from Kingdee.BOS.Orm.DataEntity import *
from System.Collections.Generic import List

try:
    clr.AddReference("Kingdee.BOS.App")
    clr.AddReference("Kingdee.BOS.Contracts")
    clr.AddReference("Kingdee.BOS.ServiceHelper")
    from Kingdee.BOS.App.Data import *
    from Kingdee.BOS.ServiceHelper import *
except:
    pass


# --- 可调业务口径（2026-11-16 按业务确认） ---
# False: 仅同步状态 1(计划)/2(计划确认)/3(下达)/4(开工) 的 MO；True: 连同 5(完工但未结案) 一起同步
INCLUDE_FINISHED_MO = True
# True: 顺带同步下游未作废且未挂起的工序计划(FDescription 与 F_UNW_Text_qtr)
SYNC_TO_SFC_PLAN = True
# 防覆盖模式: "SKIP" = 目标与旧值不一致时跳过; "OVERWRITE" = 以销售订单为准直接覆盖
CONFLICT_MODE = "OVERWRITE"

# 按托管线程 ID 隔离保存事务前读取的旧备注，并在 EndOperationTransaction / Rollback 清理
_OLD_NOTES_BY_THREAD = {}
_SYNCING_THREADS = set()


def _tid():
    return Thread.CurrentThread.ManagedThreadId


def _raw_text(val):
    if val is None or val == DBNull.Value:
        return u""
    return unicode(val)


def _norm(val):
    return _raw_text(val).strip()


def _chunks(items, size=200):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _extract_save_error(res):
    errs = []
    if res is None:
        return u"未知保存失败"
    try:
        for vr in res.ValidationErrors:
            errs.append(_raw_text(vr.Message))
    except:
        pass
    try:
        for op_r in res.OperateResult:
            if not op_r.SuccessStatus:
                errs.append(_raw_text(op_r.Message))
    except:
        pass
    return u"；".join([x for x in errs if x]) or u"保存未返回成功状态"


def OnPreparePropertys(e):
    e.FieldKeys.Add("FBillNo")
    e.FieldKeys.Add("FDocumentStatus")
    e.FieldKeys.Add("FEntryNote")


def BeginOperationTransaction(e):
    tid = _tid()
    _OLD_NOTES_BY_THREAD.pop(tid, None)
    if tid in _SYNCING_THREADS:
        return
    if e.DataEntitys is None or len(e.DataEntitys) == 0:
        return

    entry_ids = []
    for bill_obj in e.DataEntitys:
        entries = bill_obj["SaleOrderEntry"]
        if entries is None:
            continue
        for row in entries:
            eid = int(row["Id"] or 0)
            if eid > 0:
                entry_ids.append(eid)

    if len(entry_ids) == 0:
        return

    old_map = {}
    unique_ids = list(set(entry_ids))
    for batch in _chunks(unique_ids, 200):
        id_str = ",".join([str(x) for x in batch])
        sql = u"/*dialect*/ SELECT FENTRYID, ISNULL(FNOTE, N'') AS FNOTE FROM T_SAL_ORDERENTRY WHERE FENTRYID IN ({0})".format(id_str)
        ds = DBUtils.ExecuteDataSet(this.Context, sql)
        if ds is not None and ds.Tables.Count > 0:
            for r in ds.Tables[0].Rows:
                old_map[int(r["FENTRYID"])] = _raw_text(r["FNOTE"])

    _OLD_NOTES_BY_THREAD[tid] = old_map


def RollbackOperation(e):
    tid = _tid()
    _OLD_NOTES_BY_THREAD.pop(tid, None)
    _SYNCING_THREADS.discard(tid)


def AfterExecuteOperationTransaction(e):
    tid = _tid()
    _OLD_NOTES_BY_THREAD.pop(tid, None)
    _SYNCING_THREADS.discard(tid)


def EndOperationTransaction(e):
    tid = _tid()
    old_map = _OLD_NOTES_BY_THREAD.pop(tid, {})
    if tid in _SYNCING_THREADS:
        return
    if not old_map or e.DataEntitys is None or len(e.DataEntitys) == 0:
        return

    _SYNCING_THREADS.add(tid)
    try:
        # 1. 仅筛出备注真正发生变化且库里原本已存在的销售分录
        changed = {}  # so_entry_id -> (old_norm, new_raw, new_norm)
        for bill_obj in e.DataEntitys:
            entries = bill_obj["SaleOrderEntry"]
            if entries is None:
                continue
            for row in entries:
                eid = int(row["Id"] or 0)
                if eid not in old_map:
                    continue
                old_raw = old_map[eid]
                new_raw = _raw_text(row["Note"])
                old_norm = _norm(old_raw)
                new_norm = _norm(new_raw)
                if old_norm != new_norm:
                    changed[eid] = (old_norm, new_raw, new_norm)

        if not changed:
            return

        # 2. 查询关联的未作废、未结案/未关闭生产订单分录
        exclude_statuses = "('6','7')" if INCLUDE_FINISHED_MO else "('5','6','7')"
        mo_rows = []
        for batch in _chunks(list(changed.keys()), 200):
            id_str = ",".join([str(x) for x in batch])
            sql = u"""/*dialect*/
            SELECT e.FID, e.FENTRYID, e.FSALEORDERENTRYID,
                   ISNULL(e.F_UNW_TEXT_QTR1, N'') AS MO_NOTE,
                   m.FBILLNO, ea.FSTATUS
            FROM T_PRD_MOENTRY e
            JOIN T_PRD_MO m ON e.FID = m.FID
            JOIN T_PRD_MOENTRY_A ea ON e.FENTRYID = ea.FENTRYID
            WHERE e.FSALEORDERENTRYID IN ({0})
              AND m.FCANCELSTATUS <> 'B'
              AND ea.FSTATUS NOT IN {1}
            """.format(id_str, exclude_statuses)
            ds = DBUtils.ExecuteDataSet(this.Context, sql)
            if ds is not None and ds.Tables.Count > 0:
                for r in ds.Tables[0].Rows:
                    mo_rows.append(r)

        if not mo_rows:
            return

        # 按生产订单 FID 分组，对比是否可安全覆盖
        mo_updates = {}  # mo_fid -> {"bill_no": str, "entries": {mo_entry_id: new_raw}}
        mo_entry_change_info = {}  # mo_entry_id -> (old_norm, new_raw, new_norm)
        skipped_mos = []

        for r in mo_rows:
            mo_fid = int(r["FID"])
            mo_eid = int(r["FENTRYID"])
            so_eid = int(r["FSALEORDERENTRYID"])
            mo_billno = _raw_text(r["FBILLNO"])
            mo_note_norm = _norm(r["MO_NOTE"])
            old_norm, new_raw, new_norm = changed[so_eid]

            if mo_note_norm == new_norm:
                mo_entry_change_info[mo_eid] = (old_norm, new_raw, new_norm)
                continue

            if CONFLICT_MODE == "SKIP" and mo_note_norm != old_norm:
                skipped_mos.append(mo_billno)
                continue

            if mo_fid not in mo_updates:
                mo_updates[mo_fid] = {"bill_no": mo_billno, "entries": {}}
            mo_updates[mo_fid]["entries"][mo_eid] = new_raw
            mo_entry_change_info[mo_eid] = (old_norm, new_raw, new_norm)

        # 3. 保存更新生产订单
        if mo_updates:
            mo_meta = MetaDataServiceHelper.Load(this.Context, "PRD_MO")
            mo_info = mo_meta.BusinessInfo
            mo_type = mo_info.GetDynamicObjectType()
            for mo_fid, pack in mo_updates.items():
                mo_obj = BusinessDataServiceHelper.LoadSingle(this.Context, mo_fid, mo_type)
                if mo_obj is None:
                    continue
                target_entries = pack["entries"]
                for m_row in mo_obj["TreeEntity"]:
                    meid = int(m_row["Id"] or 0)
                    if meid in target_entries:
                        m_row["F_UNW_Text_qtr1"] = target_entries[meid]
                save_res = BusinessDataServiceHelper.Save(this.Context, mo_info, mo_obj)
                if save_res is not None and not save_res.IsSuccess:
                    raise Exception(u"同步更新生产订单 {0} 失败：{1}".format(pack["bill_no"], _extract_save_error(save_res)))

        # 4. 同步下游未作废且未挂起的工序计划（FDescription 与 F_UNW_Text_qtr）
        synced_sfcs = []
        skipped_sfcs = []
        if SYNC_TO_SFC_PLAN and mo_entry_change_info:
            col_len_sql = u"""/*dialect*/
            SELECT TOP 1 CHARACTER_MAXIMUM_LENGTH AS MAX_LEN
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'T_SFC_OPERPLANNING' AND COLUMN_NAME = 'F_UNW_TEXT_QTR'
            """
            col_ds = DBUtils.ExecuteDataSet(this.Context, col_len_sql)
            sfc_qtr_limit = 250
            if col_ds is not None and col_ds.Tables.Count > 0 and col_ds.Tables[0].Rows.Count > 0:
                val_len = col_ds.Tables[0].Rows[0]["MAX_LEN"]
                if val_len is not None and val_len != DBNull.Value:
                    sfc_qtr_limit = int(val_len)

            sfc_rows = []
            for batch in _chunks(list(mo_entry_change_info.keys()), 200):
                id_str = ",".join([str(x) for x in batch])
                sql = u"""/*dialect*/
                SELECT p.FID, p.FBILLNO, p.FMOENTRYID,
                       ISNULL(p.F_UNW_TEXT_QTR, N'') AS SFC_QTR,
                       ISNULL(pl.FDESCRIPTION, N'') AS SFC_DESC
                FROM T_SFC_OPERPLANNING p
                LEFT JOIN T_SFC_OPERPLANNING_L pl ON p.FID = pl.FID AND pl.FLOCALEID = 2052
                WHERE p.FMOENTRYID IN ({0})
                  AND p.FCANCELSTATUS <> 'B'
                  AND ISNULL(p.FMOISSUSPEND, '0') <> '1'
                """.format(id_str)
                ds = DBUtils.ExecuteDataSet(this.Context, sql)
                if ds is not None and ds.Tables.Count > 0:
                    for r in ds.Tables[0].Rows:
                        sfc_rows.append(r)

            if sfc_rows:
                sfc_meta = MetaDataServiceHelper.Load(this.Context, "SFC_OperationPlanning")
                sfc_info = sfc_meta.BusinessInfo
                sfc_type = sfc_info.GetDynamicObjectType()
                for r in sfc_rows:
                    sfc_fid = int(r["FID"])
                    sfc_billno = _raw_text(r["FBILLNO"])
                    mo_eid = int(r["FMOENTRYID"])
                    old_norm, new_raw, new_norm = mo_entry_change_info[mo_eid]

                    if len(new_raw) > sfc_qtr_limit:
                        raise Exception(
                            u"同步工序计划 {0} 失败：新备注长度 {1} 超过库表 F_UNW_TEXT_QTR 当前上限 {2}，请先将表列扩宽至 2000。"
                            .format(sfc_billno, len(new_raw), sfc_qtr_limit)
                        )

                    cur_qtr_norm = _norm(r["SFC_QTR"])
                    cur_desc_norm = _norm(r["SFC_DESC"])
                    need_qtr = (cur_qtr_norm != new_norm) and (CONFLICT_MODE != "SKIP" or cur_qtr_norm == old_norm)
                    need_desc = (cur_desc_norm != new_norm) and (CONFLICT_MODE != "SKIP" or cur_desc_norm == old_norm)

                    if not need_qtr and not need_desc:
                        if (cur_qtr_norm != new_norm) or (cur_desc_norm != new_norm):
                            skipped_sfcs.append(sfc_billno)
                        continue

                    sfc_obj = BusinessDataServiceHelper.LoadSingle(this.Context, sfc_fid, sfc_type)
                    if sfc_obj is None:
                        continue
                    if need_qtr:
                        sfc_obj["F_UNW_Text_qtr"] = new_raw
                    if need_desc:
                        lv = sfc_obj["Description"]
                        if lv is None:
                            lv = LocaleValue()
                        lv[2052] = new_raw
                        sfc_obj["Description"] = lv

                    save_res = BusinessDataServiceHelper.Save(this.Context, sfc_info, sfc_obj)
                    if save_res is not None and not save_res.IsSuccess:
                        raise Exception(u"同步更新工序计划 {0} 失败：{1}".format(sfc_billno, _extract_save_error(save_res)))
                    synced_sfcs.append(sfc_billno)

        # 5. 返回同步汇总或冲突提醒
        try:
            msgs = []
            if mo_updates:
                mo_nos = sorted(list(set([v["bill_no"] for v in mo_updates.values()])))
                msgs.append(u"已同步生产订单：{0}".format(u",".join(mo_nos)))
            if synced_sfcs:
                msgs.append(u"已同步工序计划：{0}".format(u",".join(sorted(list(set(synced_sfcs))))))
            if skipped_mos or skipped_sfcs:
                skip_list = sorted(list(set(skipped_mos + skipped_sfcs)))
                msgs.append(u"以下单据因生产端曾手工修改备注而跳过覆盖，请通知计划员核对：{0}".format(u",".join(skip_list)))
            if msgs:
                op_msg = OperateResult()
                op_msg.SuccessStatus = True
                op_msg.Name = u"销售订单备注跨单同步"
                op_msg.Message = u"；".join(msgs)
                this.OperationResult.OperateResult.Add(op_msg)
        except:
            pass
    finally:
        _SYNCING_THREADS.discard(tid)
