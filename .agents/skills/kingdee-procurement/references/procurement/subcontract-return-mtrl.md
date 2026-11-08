# 委外领料退料 SUB_PickMtrl → SUB_ReturnMtrl

> 2026-09-02 WWLL260725001 实测复盘（本账套）

## 已验证事实

| 项 | 值 |
|---|---|
| 领料单 | `SUB_PickMtrl` (`WWLL…`, 表 `T_SUB_PICKMTRLDATA` / `T_SUB_PPBOMENTRY`) FID 101207 `WWLL260725001` |
| 状态 | `C` 已审核，审核人 采购员A 2026-07-25 08:52，供应商 `GYS080002` 供应商Q，仓库 `CTK01` 塑封原材料仓（ID 111210）仓位 100001 批号 1 |
| 明细 | FEntry 104894 `N101041678` 802.8K / 104895 `N101041497` 3618.3K，字段为 `AppQty/ActualQty/BaseActualQty/BaseStockActualQty/StockActualQty`（非 `FQty`） |
| 上游 | `SUB_SUBREQORDER` `SUB00000874` FID 110878 → `SUB_PPBOM` `SUBBOM00004908` FID 114899 Entry 114916 / `00004909` 114900；`TreeEntity` 2行，`ScheduledEntity` 0 |
| 退料单 | `SUB_ReturnMtrl` (`WWTL…`, `WWTLD01_SYS` 普通委外退料，表 `T_SUB_RETURNMTRL` / `T_SUB_RETURNMTRLENTRY`) FID如 `WWTL00000063` 100067 |
| 退料明细 | `FQty/FAPPQty/FBASEQTY/FSTOCKQTY/FRETURNREASONID`，关联 `FSrcBillNo/SrcBillId/SrcEntryId/PPBOMEntryId/SUBReqBillNo/SubReqId/SubReqEntryId`，仓库 `FSTOCKID/FSTOCKLOCID`，货主 `FOWNERID/FKEEPERID/FOWNERTYPEID=BD_OwnerOrg` |
| 转换规则 | `T_META_CONVERTRULE` 实测：`SUB_Pick_Return` / `SUB_Pick_Return_BackFlush` (`SUB_PickMtrl→SUB_RETURNMTRL`)，`SUB_PPBOM2RETURNMTRL` 不存在于 SUB 域，前端无默认 Push |

## 正确流程（已审核领料禁止改量）

```
1. viewBill SUB_PickMtrl 取 FEntryID=104894/104895、SrcInterId=114899、SrcEntryId=114916、SubReqId=110878
2. 与用户确认退哪一行（本例 N101041678）及数量 20.975K、批号/仓库
3. 校验上游：SUB_SUBREQORDER 行状态必须 下达/完工，且 SUB_PPBOM 在制数>0，否则 Push/Save 同步被插件拦截
4. 新建 SUB_ReturnMtrl：SupplierId=GYS080002, StockOrgId=1, SubOrgId=1, BillType=WWTLD01_SYS, FDate=当日, Entity[FMATERIALID, FQTY/FAPPQty/FBASEQTY/FSTOCKQTY=20.975, FSTOCKID2=CTK01, FSTOCKLOCID, FOWNERTYPEID/ FOWNERID/ FKEEPERTYPEID/FKEEPERID, FLOT, FSrcBillNo/SrcBillId/SrcEntryId/PPBOMEntryId, FSUBReqBillNo/SubReqId/SubReqEntryId]
5. Save 草稿 → Submit → Audit → 回查 STK_Inventory FBaseQty 加回
```
前端：委外管理 → 委外退料单列表 → 新增 → 选单（WWLL260725001 或 SUBBOM…）→ 填量 → 保存/提交/审核。

## 实测坑位与报错原文（保留用于检索）

- `SUB_PickMtrl` executeBillQuery 带分录字段会按 FID 多行返回（101207 重复2行），需去重；数量字段非 `FQty`。
- `Push SUB_PPBOM 114899 → SUB_RETURNMTRL RuleId=SUB_PPBOM2RETURNMTRL`：
  > 未启用默认转换规则，RuleId必填 / 取数失败：委外订单下推委外退料单条件 1-10（含 在制材料数>0、有采购订单、发料方式倒冲等），受限于 OnInSelectedRow 插件
- `Push SUB_PickMtrl 101207 RuleId=SUB_Pick_Return`：
  > 下推不成功。委外领料单下推委外退料单条件为：1、领料需审核 2、实领>退选 3、对应委外订单需处于下达或完工 4、用料清单已审核 5、在制材料数>0 6、非倒冲领料单 … 有1行不满足筛选条件：受限于插件在事件(OnInSelectedRow)
- `Push SUB_PickMtrl RuleId=SUB_Pick_Return_BackFlush`：`参数缺失！`
- `Save SUB_ReturnMtrl` 缺字段：`单据体“明细”第1行字段“产品货主”是必填项; 字段“供应商”是必填项; 仓库启用了仓位管理，仓位必录！; 委外退料单第1行的产品编码为空或与其委外订单分录的物料编码不一致; 委外退料单对应的委外订单SUB00000874第1行的业务状态不为 下达或完工`
- 别名坑：`SUB_RetMtrl` / `SUB_ReturnMaterial` / `SUB_RETURNMTRLDATA` 不存在，正确为 `SUB_ReturnMtrl`；`FSubReqNo` / `FBillStatus` 在 executeBillQuery 中不存在，View 键为 `SUBReqBillNO` / `TreeEntity`。

## 处置建议

1. 先在委外订单列表查 `SUB00000874` 行状态，若为 `计划/未下达` 则先执行 `下达` 操作；若已下达但在制仍0，说明该料在制已被冲销或无采购订单，需改走手工杂项退料或先补单据链。
2. 订单下达后，用显式 RuleId `SUB_Pick_Return` 重新 Push，或手工 Save 携带完整关联字段（含 Lot、StockLocId、Owner/Keeper）。
3. 退料量 20.975K 需用户明确料号，不得自动分摊到两行。

## 关联表

`T_SUB_PICKMTRL / T_SUB_PICKMTRLDATA / T_SUB_PPBOM / T_SUB_PPBOMENTRY (FSTDQTY/FMUSTQTY) / T_SUB_REQORDER / T_SUB_RETURNMTRL / T_SUB_RETURNMTRLENTRY (FQTY/FRETURNREASONID/FLOT) / T_META_CONVERTRULE (FSOURCEFORMID/FTARGETFORMID/FID)`
