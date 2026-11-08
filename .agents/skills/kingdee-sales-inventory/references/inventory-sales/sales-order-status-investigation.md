# 销售订单状况排查（一张单的“情况”）

用户说「查看销售订单 XXX 情况」「这张单为什么删不掉」「这张单发过货吗」时按本流程只读取证，输出分四段：表头 → 状态与时间线 → 下游链路 → 差异/异常。不要只回一句状态，也不要把作废单的空剩余量读成已交货。

## 1. 表头与分录

- `executeBillQuery("SAL_SaleOrder", "FID,FBillNo,FDocumentStatus,FDate,FCreateDate,FApproveDate,FCreatorId.FName,FCustId.FNumber,FCustId.FName", "FBillNo='XSDD…'")` 取 FID；FID 必须来自本次查询，不要用旧输出或相邻单号。
- `viewBill("SAL_SaleOrder", fid)`：表头键 `DocumentStatus/CancelStatus/CloseStatus/CreateDate/ApproveDate/CreatorId/ModifierId/SalerId/Note`；分录 `SaleOrderEntry[]`（`Id/Seq/MaterialId/Qty/LeftQty/DeliveryStatus/IsFree/LockFlag/LockQty/Note`）。
- **价格不在分录主体上**：含税单价、金额、税率在 `T_SAL_ORDERENTRY_F`（`FTAXPRICE/FPRICE/FAMOUNT/FALLAMOUNT/FTAXRATE`）。`T_SAL_ORDERENTRY` 没有 `FTAXPRICE` 列，SQL 里直接选会报列名无效。`FPRICEUNITQTY` 是计价单位数量，用来核对「单价 × 数量 = 金额」。

## 2. 状态判读

- `FDOCUMENTSTATUS` 与 `FCANCELSTATUS` 是独立两列：`FCANCELSTATUS='B'` 即已作废，此时 `FDOCUMENTSTATUS` 也显示为 `D`。
- 「建档后从未审核即作废」的识别：`FAPPROVEDATE` 为空 + `FAPPROVERID=0`，另看 `FCANCELDATE/FCANCELLERID` 取作废时间与作废人。
- **作废单的 `FLEFTQTY` 会被清零**：`FQTY>0` 而 `FLEFTQTY=0`、`FDELIVERYSTATUS='A'` 是作废单的常态，不能读成“已交完货”。真要判断发过货没有，只能看下游发货通知/出库。
- 作废单不能删除：删除会被拒并返回「不允许对作废状态的单据进行操作」。要清理必须先反作废（`FCANCELSTATUS B→A`）再删除；反作废/删除都是写操作，先说明路径并取得授权再执行，不要因为“业务上作废了”就当成可以直接删。

## 3. 下游链路（SQL 只读）

按 销售订单 → 发货通知 → 销售出库 → 应收 → 生产订单 逐层查。任一层 0 行时先自检（同表不带筛选 `COUNT(*)`，或拿一张已知有下游的单反查），再下“没有下游”的结论。

| 目标 | 关联键与坑 |
|---|---|
| 发货通知 | `T_SAL_DELIVERYNOTICEENTRY_LK`：源单是 `FSBILLID`/`FSID`，**目标分录是 `FENTRYID`，没有 `FBILLID`**；join `T_SAL_DELIVERYNOTICEENTRY e ON e.FENTRYID=l.FENTRYID` → `e.FID` → `T_SAL_DELIVERYNOTICE`。也可直接用 `T_SAL_DELIVERYNOTICEENTRY.FSRCBILLNO/FORDERNO + FORDERSEQ` 过滤，并看 `FQTY/FSUMOUTQTY/FREMAINOUTQTY/FCLOSESTATUS` |
| 销售出库 | `T_SAL_OUTSTOCKENTRY_LK` 的 `FENTRYID` 是出库分录、`FSBILLID` 是上游单；`T_SAL_OUTSTOCKENTRY` **没有 `FSRCBILLNO`**，来源要用 LK 或 `FSRCENTRYID` 反查 |
| 应收 | 出库分录 → `T_AR_RECEIVABLEENTRY_LK.FSBILLID` → `T_AR_RECEIVABLE`，可再用 `FCUSTOMERID` 辅助 |
| 生产订单 | `T_PRD_MOENTRY_LK` 的 `FENTRYID` 是 MO 分录、`FSBILLID` 是源销售订单 FID（该表没有 `FSBILLNO`/`FID`）；`T_PRD_MOENTRY.FQTY` 分行、合计应等于订单数量；`T_PRD_MO` 没有 `FCLOSESTATUS`/`FQTY` |
| 订单变更 | `T_SAL_ORDERCHANGE` 源单字段是 `FSOURCEBILLNO`/`FSOURCEBILLID`，**没有 `FSOURCEFID`** |

## 4. 操作日志：谁在什么时候做了什么、为什么失败

- `T_BAS_OPERATELOG`：用户列是 `FUSERID`（join `T_SEC_USER.FUSERID → FNAME`），**没有 `FCURRENTUSERID`**；`FDATETIME` 为 UTC，+8h 才是北京时间。
- 失败的删除/反审核会留下一条 `FDESCRIPTION` 含单号和失败原因的记录（如「…不允许对作废状态的单据进行操作」）。先看这条，再去核对单据状态，不要凭单据状态反推操作。
- **`FINTERID` 是 int 列**：不带 `FOBJECTTYPEID` 的全表检索会因其他对象类型存字符串而报 `Conversion failed when converting the varchar value … to data type int`。查询要么同时限定 `FOBJECTTYPEID`，要么改用 `FDESCRIPTION LIKE '%单号%'`。`T_BAS_OPERATELOGBK` 同列名、同样的坑。

## 5. 单号模糊匹配

单号一律带前缀做精确/半精确匹配（`FBillNo='XSDD034943'` 或 `LIKE '%XSDD034943%'`）。只写流水段（`LIKE '%03494%'`）会同时命中 `XSDD003494/XSDD034940/034941` 等，据此会得出错误的下游关系；必要时先 `SELECT DISTINCT 单号列` 确认命中的到底是哪几张单。

## 6. 重复单/替代单与单价异常

- 同一客户单号（如表头自定义文本字段 `F_UNW_TEXT_SWB`）、同物料同数量、创建时间相邻的两张单，通常是录错后重开。把两张单的**单价、数量、金额、备注**并排比对：差异项就是重开的原因，或重开时新引入的错误。作废单只是被替代，清理与否不影响业务，先确认替代单是否正常。
- **单价异常用同客户同系列历史单横比**：按 `FCUSTID` + `FMATERIALID`（必要时放到同一物料分组）拉历史订单的 `FTAXPRICE/FALLAMOUNT`，看目标单是否整体偏离。含税单价**恰好等于该行数量**是“把数量填进了单价栏”的典型特征。
- 报差异时给全：正确单价、异常单价、倍数、含税差额、未税差额，并指出改价窗口——下游未出库、未开应收前代价最小；已出库/已开应收要走销售链重整流程。**不要自行改价**：单价属业务口径，必须由用户/业务确认后再按标准反审核→保存→提交→审核处理。
