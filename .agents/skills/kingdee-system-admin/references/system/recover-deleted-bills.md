# 误删单据：只读还原（本账套已核实）

用户说「误删 / 找回 / 删除成功」某单号时走这条，**不要先讲回收站或 SQL 写回**。

## 先定性

本账套 **没有** 可用的回收站 FormId（`BOS_RecycleBin` / `BAS_RecycleBin` / `BOS_Restore` 均不存在）。删除是 **物理删** 业务表（表头+分录+级联 PPBOM），WebAPI / `T_PRD_MO` 查不到 ≠ 信息没了。

草稿（`FDocumentStatus=A`）可直接删，通常无领料/入库/工序残留。已审单另查下游是否还在。

**禁止** 用 SQL INSERT 把删掉的正式单据写回去；还原路径是 **从源单重新下推**（须用户点明哪一行、写操作仍 dry-run + `--apply`）。

## 调查顺序

1. **WebAPI** 先查本体和下游（`PRD_MO` / `PRD_PPBOM` / `PRD_PickMtrl` / `PRD_INSTOCK` / `SFC_OperationPlanning`）。有数就停。
2. **操作日志**（只读 SQL）——信息密度最高：

```sql
-- 现表 + 备份都查
SELECT FDATETIME, FUSERID, FOBJECTTYPEID, FOPERATENAME, FDESCRIPTION
FROM T_BAS_OPERATELOG
WHERE FDESCRIPTION LIKE N'%“MO260810046”%'
   OR FDESCRIPTION LIKE N'%编号：MO260810046%'
ORDER BY FDATETIME;

SELECT FNAME, FUSERACCOUNT FROM T_SEC_USER WHERE FUSERID=@id;
-- 显示名在 T_SEC_USER.FNAME；T_SEC_USER_L 用 l.FID=u.FUSERID（不是 FUSERID）
```

| 日志动作 | 能拿到 |
|----------|--------|
| 打开单据 | `pkValue：<FID>` |
| 保存 / 删除 | 单号 + 成功/失败 |
| 下推 | 「编号为“XSDD…”的销售订单，生成生产订单」 |
| 删除过程 | `关联的单据内码:124297,124048`（可一次删多张） |
| 级联 | 随后 `PRD_PPBOM` 删除成功（例：`PPBOM00156428`） |

**过滤陷阱**：`LIKE '%260813049%'` 会误中同日流水 `SOUT260813049` / `SCRK260813049`。用带书名号/「编号：」的精确串。

`T_BAS_BILLCODERULELOG(.FData)` 对本账套这些 MO **经常是空的**，别当主路径。

3. **用 FID 对业务表**：`T_PRD_MO` / `T_PRD_MOENTRY` / `T_PRD_PPBOM.FMOID` / 领料入库工序 `FMOID` 通常已空。空了就转重建。

4. **重建内容**（按命中停）：

| 线索 | 做法 |
|------|------|
| FID 空号 | `T_PRD_MO` 按 FID 排序，`124047=MO…045` 与 `124049=MO…047` 中间即被删单 |
| 同批下推 | 同一 `FCREATORID` + 同一 `FCREATEDATE` 的兄弟 MO → `T_PRD_MOENTRY.FSALEORDERNO` / `FSALEORDERENTRYID` 连续，**缺的分录内码**就是被删行 |
| 销售订单行 | `T_SAL_ORDERENTRY` 按 `FENTRYID` 排，无对应现存 MO 的行 = 可还原行 |
| 变更后再下推 | `T_SAL_XORDER` / `T_SAL_XORDERENTRY`：`FCHANGEFLAG='C'` 改旧行，**空格 = 新增行**；对照操作日志「生成生产订单」时间 |
| 下推痕迹 | `T_BF_INSTANCE` / `T_BF_INSTANCEENTRY` 有时残留（不可靠；有则能对上 `FFIRSTBILLNO` / `FTID`） |

`T_PRD_MOENTRY` 关键列：`FMATERIALID, FQTY, FSALEORDERNO, FSALEORDERENTRYID, FSRCBILLNO`。

5. **回复用户**：单号、FID、操作人/时间、源销售订单+行号、物料编码/名称/数量、是否已审、下游是否空、**建议从哪张源单哪一行重下推**。新单号会按当天重编，不会变回旧号。先问清下推哪一行，再写。

## 2026-08-14 / 2026-07-10 实例（形态备查）

### MO260710048（2026-07-10，500复盘）

用户称被删后已恢复。`2026-09-01` 实测：`MO260710048` FID 122457 状态 `C`，物料 `NBM0760144 AP50H06NF 双芯 (PDFN5X6/5K盘)`，创建 `2026-07-10 16:44 李银兰 TK03570`，审核 `2026-07-17 20:49 工程师A TK7773`，数量 19.2K，批号 `E660165`。工序计划 14 张 `TX087471-484`，创建 `2026-08-20 15:45 管理员A TK2869 (API)`、同日工程师A审核，批注 `AP50H06NF RN6 2628 APM标准包装 双芯合封 铜线工艺`。教训：`search_bill` 默认 10 行截断曾只显示 10 张，放大 `TopRowCount` 才见全量；恢复后需按 `FMONumber` 全量拉工序并 `viewBill` 抽检台账。

### MO260810046/049（2026-08-14）

`MO260810046`（FID 124048）与 `MO260813049`（FID 124297）被财务员A TK03556 16:58 一并删除。

- 源单都是 `XSDD034291`（江苏海德）。
- 046 = 8/10 林思萍整批下推第 16 行 `NAT0060215` 2SD1781 × 90（6R）。
- 049 = 8/13 陈秋伶 `XSDD034291_V002` **新增**第 38 行后再下推 `NAT0270241` 2SD1781 × 90（27R）。
- 用料清单 `PPBOM00156428` / `PPBOM00157942` 级联删掉。草稿，无领料入库。
- 还原：对上述两行重新下推，不必 SQL 写回。


### ZCPFP0000004（2026-11-04，在产品分配标准设置 `CB_WIPSTANDARDSET` 误删取证与恢复）

蔡美娜于 `2026-11-04 08:22:57` 反审核成本中心 `CBZX000035 固晶二部` 并尝试删除，因被 `CB_WIPSTANDARDSET` 引用受阻，遂于 `08:24:36` 在 `CB_WIPSTANDARDSETREPORT` 误将整单 `ZCPFP0000004`（`FID=100004`，非委外 `FISWW='0'`）物理删除，表内仅剩委外单 `ZCPFP0000003`（`FID=100003`，`FISWW='1'`）。

- **双路径只读取证**（SIMPLE 模式 checkpoint 后 `fn_dblog` 已清空时适用）：
  1. **数据页残余字节提取**：小参数表仅占单张 8KB 数据页，通过 `sys.dm_db_database_page_allocations` 定位 `T_CB_WIPSTANDARDSET`（`1:4122744`）、`T_CB_WIPSTANDARDSETENTRY`（`1:4122896`）、`T_CB_WIPSTANDARDSETDETAIL`（`1:4122840`），结合 `sys.system_internals_partition_columns` 偏移与 `DBCC PAGE(..., 2) WITH TABLERESULTS` 只读提取出全部 **27 条成本中心分录（`FENTRYID 100035..100062`）和 81 条成本项目子分录（`FDETAILID 100059..100139`）**。
  2. **成本计算结果表交叉核验**：`T_CB_PROORDERINFO` 关联 `T_CB_PROORDERDIME`、`T_CB_COSTCALEXPENSE`、`T_CB_COSTCALEXPENSEDETAIL` 按 `(FCOSTCENTERID, FCOSTITEMID, FALLOSTD)` 核验完全一致（综合分配标准均为 `2=完工数量`；各成本中心下 `CBXM00002_SYS 间接材料`、`CBXM00001 制造费用`、`CBXM00005_SYS 直接人工` 分项分配标准均为 `1=不留存，全部由完工产品负担`），另有当日 `00:01` 完整备份兜底。
- **重建与验证（2026-11-04 用户授权执行）**：经用户确认剔除已禁用的 `CBZX000015 测试`（`D/B`）及待删除的 `CBZX000035 固晶二部`（`D/A`），通过个案脚本 `scripts/cases/restore_zcpfp0000004_20261104.js` 调用 WebAPI `CB_WIPSTANDARDSET` `Save` 恢复其余 **25 个正常启用成本中心分录及 75 条子分录**，生成新单 `ZCPFP0000005`（`FID=100006`，`FDOCUMENTSTATUS='A'`，`FISWW='0'`）。WebAPI `View` 与数据库三表独立回查完全一致，证据存档于 `output/recover-zcpfp0000004-20261104/`。
