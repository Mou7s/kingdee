# 按工序计划号追踪生产、外发结算与应付

## 目录

- 1. 计划台账：先用已验证字段
- 2. 工序汇报：按计划号查，但按单号去重
- 3. 外发工序：追 `SFC_OPERATIONTRANSFER`
- 4. 工序结算：用 `FOPNo`，保留两套单位
- 5. 应付单：不要只按 TX 号查
- 6. 供应商与金额异常判定
- 7. 回复结构
- 8. 下推选单缺行：用同单邻单逐字段对照
- 9. 已结案生产订单阻挡工序反关闭（2026-10-22）
- 10. 批量汇报改单的关闭与关账双重阻挡（2026-10-22）


用于用户说“看下工序计划号 TX...”或需要核对某个外发工序时。目标是从计划台账一路追到汇报、转移、结算和应付，先给事实摘要，不做写操作。

## 1. 计划台账：先用已验证字段

表单：`SFC_OperationPlanning`

```js
const rows = await api.executeBillQuery(
  "SFC_OperationPlanning",
  "FID,FBillNo,FProcessId.FName,FBaseQty,FReportQty,FQualifiedQty,FDocumentStatus,FOperStatus",
  `FBillNo='${planNo}'`,
  100
);
```

带工序明细时返回“一行一工序”，同一计划的 `FID` 会重复；统计计划单数按 `FBillNo`，写操作按 `FID` 去重。不要臆测在该表单上可用 `FMaterialId` 等字段；产品、客户、计划日期和完整工艺从 `viewBill("SFC_OperationPlanning", fid)` 读取。

`viewBill` 重点位置：

- 表头：`BillNo`、`SourceBillNo`、`MONumber`、`ProductId.Number/Name/Specification`、`MOQty`、`BaseQty`、`PlanStartTime`、`PlanFinishTime`、`DocumentStatus`、`ApproveDate`、`FCustId`
- 工序：`Entity[].SubEntity[]`
- 工序字段：`Seq`、`OperNumber`、`ProcessId`、`OperQty`、`ReportQty`、`QualifiedQty`、`UnqualifiedQty`、`ReportBaseQty`、`QualifiedBaseQty`、`TransOutQty`、`TransInQty`、`IsOutSrc`、`Supplier`、`OutSrcTaxPrice`、`RealProcessFinishTime`、`BarCode`

状态码不在本地参考表时只报告原始码，不强行翻译。例如工序 `FOperStatus=6` 可以与数量和实际完成时间并列展示，但不能未经验证写成“已完工”。

## 2. 工序汇报：按计划号查，但按单号去重

表单：`SFC_OperationReport`

```js
const reports = await api.executeBillQuery(
  "SFC_OperationReport",
  "FID,FBillNo,FSourceBillNo,FProcessId.FName,FQuaQty,FDocumentStatus",
  `FSourceBillNo='${planNo}'`,
  200
);
```

把汇报单数量和工序数量分开：汇报单可能跨多行，不能直接把行数当单据数。将 `FBillNo` 去重后统计单据数，并按 `FProcessId.FName` 对照计划中的每道工序。查不到汇报不等于工序没有流转；外发工序可能只通过转移和结算回写。

## 3. 外发工序：追 `SFC_OPERATIONTRANSFER`

先按源计划号列出转移单：

```js
const transfers = await api.executeBillQuery(
  "SFC_OPERATIONTRANSFER",
  "FID,FBillNo,FSourceBillNo,FMOBillNo,FBILLDATE,FDocumentStatus",
  `FSourceBillNo='${planNo}'`,
  200
);
```

对外发工序对应的转移单再调用 `viewBill("SFC_OPERATIONTRANSFER", fid)`，核对这些字段：

- `OutOPBillNo`、`OutOperNumber`、`OutProcessId`、`OutSupplier`、`OutIsOutSrc`
- `InOPBillNo`、`InOperNumber`、`InProcessId`
- `TransferQty`、`QualifiedQty`、`QualifiedBaseQty`
- `QuaSettleQty`、`QuaSettleBaseQty`、`SettleStatus`
- `SourceBillNo`、`MOBillNo`、`DocumentStatus`

计划行的 `Supplier` 不能单独作为实际结算供应商；外发时必须与转移单 `OutSupplier` 对照。

## 4. 工序结算：用 `FOPNo`，保留两套单位

表单：`SFC_OPERPROCBALANCE`。常用字段可参考 `k3_outsourcing.js` 的 `SFC_FIELDS`：

```text
FID,FBillNo,FEntity_FEntryID,FDocumentStatus,FBalDate,FOPNo,
FSourceBillNo,FMONumber,FSUPPLIERID.FName,
FMaterialId.FNumber,FMaterialId.FName,
FQualifiedQty,FQualifiedPrice,FQualifiedTaxPrice,
FBalanceQty,FBalancePrice,FBalanceTaxPrice,
FAmount,FTaxAmount,FTaxAllAmount,FTaxRate
```

过滤：`FOPNo='TX...'`。如果外发结算使用“片(外发)”等辅助单位，`FBalanceQty` 可能是 80，而 `FQualifiedBaseQty`/`FBalanceBaseQty` 是 13.44 K；核对时不能直接把两个数量相减。应同时展示外发单位数量、基本单位数量、含税单价和含税金额。

需要精确确认时用 `viewBill("SFC_OPERPROCBALANCE", fid)` 查看：`SupplierId`、`Entity[].OperNumber`、`Entity[].QualifiedQty`、`QualifiedBaseQty`、`BalanceQty`、`BalanceTaxPrice`、`TaxAllAmount`、`FSourceBillNo`、`SourceBillType`、`PushPayableNum`。

改价时区分「合格含税单价」`FQualifiedTaxPrice` 与「结算含税单价」`FBalanceTaxPrice`。用户点名合格含税单价时，要保存 `FQualifiedTaxPrice`；只保存 `FBalanceTaxPrice` 可能只改了结算含税价，而合格单价、未税价和总额仍保留旧值。2026-09-29 实测，保存 `FQualifiedTaxPrice` 后，View 回读的 `QualifiedPrice`、`BalancePrice` 与两个含税单价均按金蝶计算更新，结算金额也随之变化；所以改价后必须用 `executeBillQuery` + `viewBill` 同时复核单价、税额、价税合计和单据状态。

另一个实测边界：目标结算单反审核后调用 Save，回查状态可能重新显示为 `C`，并且计划号下可能出现新的草稿应付单。不能假定 Save 后仍为 `D`，也不能假定删除旧 AP 后 AP 一定保持为空；保存后须重新查结算状态及 `FORDERNUMBER` 对应的 AP，并核对两边金额。该操作没有调用结算单 Submit/Audit；AP 草稿也不得提交或审核。

## 5. 应付单：不要只按 TX 号查

外发应付单通常以结算单号作为 `FSourceBillNo`，同时把工序计划号放在 `FORDERNUMBER`。因此先拿到结算单 `FBillNo`，再查：

```js
const aps = await api.executeBillQuery(
  "AP_PAYABLE",
  "FID,FBillNo,FDocumentStatus,FDATE,FORDERNUMBER,FSourceBillNo,
   FSUPPLIERID.FNumber,FSUPPLIERID.FName,FPRICEQTY,FPRICE,FTAXPRICE,
   FNOTAXAMOUNTFOR,FTAXAMOUNTFOR,FALLAMOUNTFOR",
  `FSourceBillNo='${settlementBillNo}' and FORDERNUMBER='${planNo}'`,
  200
);
```

也可分别按两个条件查以避免字段组合限制。查询应付不触发安全限制；本流程绝不调用 `Submit`、`Audit` 或修改。若已有 AP 返回 `C`，只如实报告现状，不试图纠正。

## 6. 供应商与金额异常判定

### 同物料不同计价单位（2026-10-13 只读验证）

- 先比计划外发工序的 `ValuationUnitId`、`RateOperQty/RateValQty`、`ValuationQty`，再比转移单 `ReceiveValuationUnitId/ValQualifiedQty/ReceiveQualifiedTaxPrice`，最后比结算 `BalanceUnitID` 与 AP `PRICEUNITID`。物料基本单位相同不保证工序计价单位相同；同一个数字单价也不保证每 K 费用相同。
- NBM0760144 的 TX075320（MO260710047）上锡工序按片，比例 0.48K:1片；TX087483（MO260710048）按 K、1:1。两张接收转移单含税价均 1.8，单位差异在计划已存在，不能归因于 AP 列表显示。哪种合同价格正确仍须业务依据，不自动统一单位或单价。
- AP00148698 实时为 40片、基本量19.1K、72元；来源 GXJGJSD096285 当前合格量39.7916666666片、结算量40片，但价税合计71.62元。必须单独标记结算与 AP 金额不一致，不能拿结算数量乘单价代替当前金额。AP00151335 为19.2K、34.56元，来源 GXJGJSD098631 同额。
- 比较每K费用先注明含税/未税及分母（加工合格量或最终入库量）；截图总成本差不能仅凭外发金额直接全额归因。证据为 `scripts/scratch/2026-10/unit-cost-*.json` 的当日 WebAPI View 快照，复用前重新查询。

按四层记录并排比较：

1. 计划工序行 `Supplier`
2. 外发转移 `OutSupplier`
3. 工序结算 `FSUPPLIERID.FName` / `SupplierId`
4. 应付单 `FSUPPLIERID.FName`

任何不一致都标为“需业务确认”，不要自动替换供应商或改单。金额核对优先使用结算/AP 的不含税单价、含税单价、税率、未税金额、税额、价税合计，并以实际结算分录为准；计划行的外发单价只能作为对照。

## 7. 回复结构

简短任务建议按以下顺序输出：

1. 计划、生产订单、产品、计划量、审核状态、计划/实际完成日期
2. 工序表：计划量 / 汇报量 / 合格量 / 外发标记
3. 汇报、转移、结算、应付的单号与状态
4. 明确列出供应商、单位换算、数量或金额差异
5. 区分“已验证事实”“需要确认的异常”；说明本次仅查询、未写入

外发对账场景的关键结论是：不能因为计划行有供应商就跳过转移、结算和 AP 链路，也不能因为没有标准汇报单就断言外发工序未完成。

## 8. 下推选单缺行：用同单邻单逐字段对照

集中发出行能选出但数量为零，也要核对转入腿的审核状态及集中发出引用。2026-10-14 只读实证：TX0903823 工序60转入量/可委外量均0；GXZYD01086428 为30→60、13.44K，状态B（审核中），仍引用 WWFC3188（Id103355/EId352086）。按发出单号查询为空，View(103355)明确报数据不存在，属于已不存在发出单的残留引用。应区分“未审核转入尚未回写”与“发出单引用悬空”两项事实；不能据此直接审核转移单或套用C状态历史清理流程。处理前重新核对实时状态、实物流向和明确授权。

同日后续只读查证：当前操作日志记载 WWFC3188 保存/审核后生成并提交转移单，随后反审核、删除发出单成功；GXZYD01086428 的审核和反审核失败原文均为“单据日期小于成本关账日期2026-09-30”。View 确认单据日期2026-09-21、状态B、接收关联0、结算与结算选单量0；数据库按发出Id103355查残留仅这一张，按转入/转出计划号查仅原有三张转移单。审核受阻的已验证原因是关账日期，不把残留引用单独认定为本次审核失败原因。正常撤回/日期调整能否处理尚未验证；日期必须依据实际业务和允许期间确认，不擅自改成今天。旧日志归档表查询超时，不影响当前日志已有证据，但不可声称历史日志全量已查。

同日用户要求恢复带量后，实时预检B/13.44K/旧发出Id103355一致，对该单仅尝试一次 WebAPI UnAudit，仍报上述关账错误，立即停止。独立View复查状态B、日期、数量与关联不变；工序30 `TransSelQty=13.44`、工序60 `TransInQty=0/OUTSENDQTY=0`。恢复带量还须考虑来源工序的选单占用释放，不能只修目标转入量；实际选单重新带量未验证。未执行SQL、Delete、改日期或审核。

集中发出/下推类选单只列满足条件的工序行，单据存在但目标行被滤掉时搜单号恒为 0 行。此时不逐个猜原因，用一条同生产订单、可正常搜到的相邻计划做对照，差异字段即过滤嫌疑：

1. `executeBillQuery` 确认缺行单存在与 `FDocumentStatus`；`viewBill` 取 `Entity[0].SubEntity` 目标工序行，邻单同样处理后逐字段对照（状态、控制码、汇报数、转入/转出数）。
2. 行级真值以 `T_SFC_OPERPLANNINGDETAIL`（`FDETAILID` 主键，`FOPERSTATUS/FOPERQTY/FWIPQTY/FPICKINGQTY`）+ `_B` 表（`FTRANSINQTY` 转入、`FTRANSOUTQTY` 转出、`FTRANSSELQTY` 已选、`FREPORTQTY/FQUALIFIEDQTY`）为准；`View` 的 `TransInQty/TransOutQty` 与之对应。
3. 差异若是转入量，用转移单反查来源：`T_SFC_OPERATIONTRANSFER` 头表只存单号与状态，`FINOPBILLNO/FOUTOPBILLNO` 在 `_A` 表（直接查头表报列名无效），转出/转入工序是 `_C` 表的 `FOUTPROCESSID/FINPROCESSID`；下游占用查 `T_SFC_OPERPLANNING_LK`（`FSID` = 分录 `FDETAILID`），空即无下游。
4. 动 `T_SFC_*` 前先 `INFORMATION_SCHEMA.COLUMNS` 探列：计划头表无 `FCloseStatus`、`FWIPQTY` 只在 DETAIL 不在 `_B`、`_D` 表无 `FENTRYID`，猜列名直查必报 207。
5. 未完全验证的假设单独标注：集中发出选单的可发口径可能已扣减转入量，转入后在制行不再出现；用户用邻单搜出结果确认前，只报"转入量是唯一差异"，不下"必须反审转移单"的结论。
6. 转移单反审核报“工序委外集中发出不为空”时，先 `viewBill("SFC_OPERATIONTRANSFER", fid)` 取 `OperOutGroupSendNo/OperOutGroupSendId/OperOutGroupSendEId`，再 `viewBill("SFC_OperOutGroupSend", sendId)` 核对 `TreeEntity[].Id` 是否还包含该 `EId`（2026-09-29 实证 GXZYD01059050→WWFC3091.EId 344756 已不存在：发出单审核 6 秒后下推转移，之后发出单被改、TX 行被删，引用悬空）。`executeBillQuery` 查不到 `OperOutGroupSendNo/Id`（报元数据字段不存在），只能走 `View`；`FOplanInfo LIKE 'TX...%'` 返空 + 转移单侧引用非空，即“WWFC 搜不到、转移单还在”。此时停手：反审核上游会扩大到整张发出单，需用户另行授权。
7. 发出单整单被删后悬空引用仍在（2026-09-29 实证：WWFC3091 物理删除后，`executeBillQuery SFC_OperOutGroupSend FBillNo='WWFC3091'` 返空、`View(103239)` 报“数据在系统中不存在”；但 GXZYD01059050 的 `View` 仍带 `OperOutGroupSendNo=WWFC3091/Id=103239/EId=344756`，且 `FOperTransferId=1189397` / `FOperTransferNumber='GXZYD01059050'` 反查全空，即正向悬空、反向已净）。此时 `UnAudit` 仍报“集中发出不为空”（按转移单自身字段校验，不查发出单是否存在），`Delete` 报“只能删除创建/暂存/重新审核状态的数据”（C 状态不可直删），WebAPI 无路可走；直连 DB 若同时不可达（如本机 `mssql` 持续 `ESOCKET/socket hang up`，而 `test_db_join.js` 同错），SQL 清理也无法在本机会话执行，只能走 DB 主机或原厂。物理列名绝不猜：动 `T_SFC_*` 前必须在 DB 主机上先 `INFORMATION_SCHEMA.COLUMNS` 探列并取得用户对具体表/记录/字段/目标值的明确授权（见 AGENTS.md 第二节）。
8. 整批误删发出单的恢复（2026-09-29 实证 WWFC3091：90 行发出单被删，90 张转移单 `T_SFC_OPERATIONTRANSFER_C.FOPEROUTGROUPSENDID=103239` 悬空、全为 C、无结算无接收、无下一腿转移）。恢复路径：① 只读探针确认“空”约定（未发出的转移单该三字段为 `' '/0/0`，以 GXZYD01053138 为样板）、影响行数（`COUNT(*)=90`）与下游（`_B.FQUASETTLEQTY`、`_D.FSETTLESTATUS`、接收字段、自连接查下一腿）；② 事务内 `UPDATE _C SET FOPEROUTGROUPSENDNO=' ',FOPEROUTGROUPSENDID=0,FOPEROUTGROUPSENDEID=0 WHERE FOPEROUTGROUPSENDID=103239`，`@@ROWCOUNT` 必须等于预检数否则回滚——只碰该三字段，不碰计划/LK/结算表；③ 每单 WebAPI `UnAudit`（验 D）→`Delete`（验查无），逐单先读实时状态，首错即停；④ 复查：DB 侧残留引用/表头计数归零 + WebAPI 侧单号查无 + 抽查计划行 `TransIn/TransOut` 回滚。另：本机 `K3_DB_HOST` 的 `mssql` 持续 `ESOCKET` 时，改用配置内另一主机（`K3_SQLCMD_HOST`）直连成功，库 `<K3_MAIN_DB>`——DB 不通时先换主机重试再定论。

## 10. 批量汇报改单的关闭与关账双重阻挡（2026-10-22）

- 改汇报前明确目标是合格量还是汇报总量，并读取 `OptRptEntry`，以计划号、工序号、分录Id共同定位；汇报单可能包含其他计划，不能只核对目标行。保留不合格量时须明确总量联动口径。
- 当日用户确认 TX089506 焊线合格量改为45.824K，保留不合格0.480K，总量目标46.304K。GXHB537012（FID671956）第2行1043080实时为合格56.520K、总量57K，整单共6行；下游模压已汇报56.520K，高于目标焊线合格量，不能据改单授权自动修改下游。
- 默认dry-run预检后，仅尝试一次 WebAPI UnAudit。金蝶同时返回各行工序计划关闭，以及“单据日期小于成本关账日期2026-09-30”。失败即停，未Save/Submit/Audit，未改日期、解除关闭或使用SQL。不能推断仅解除目标工序关闭即可处理：还涉及其他5行及成本期间。
- 独立View回查整张汇报仍为C，6行数量均未改变；目标仍56.520/57/0.480K。证据：`output/tx089506-wire-report-1792651573195/`；脚本：`scripts/scratch/2026-10/change-tx089506-wire-report.js`，默认dry-run。重用前刷新状态，历史失败不授权扩大处理范围。

## 9. 已结案生产订单阻挡工序反关闭（2026-10-22）

- 适用：工序计划全部或部分工序处于关闭状态，用户要求反关闭。先用实时 `View` 将计划 `MOId/MOEntryId` 精确关联生产订单 `TreeEntity[].Id`，核对分录 `Status`，不能只看生产订单表头审核状态。
- 当前账套 `QueryBusinessInfo` 确认工序计划反关闭对应 `UnDoToFinish`（反执行至完工）。用户授权尝试后，TX0810349（FID243585）的11道工序执行该操作全部失败，错误均为“工序计划[TX0810349]序列[0]工序[...]，生产订单分录已经结案”。对应 MO260831058（FID125033）第1行264618实时为6，关闭日期2026-09-30 08:41。
- 请求仅 `SFC_OperationPlanning / UnDoToFinish / {Ids:'243585'}`；未反审核、未处理上游。新会话完整View对比计划与生产订单均未变，11工序仍为6；失败即停，不扩大到订单其他两行。
- 下一步若需继续，应另行核对该生产订单分录的反结案条件与成本结算状态，并取得明确范围授权；本案例未验证反结案可行，不能保证解除上游结案后工序一定能反关闭。
- 证据：`output/tx0810349-reopen-1792631290164/` 的before、response、after和verified；脚本 `scripts/scratch/2026-10/reopen-tx0810349.js` 默认dry-run。


### 2026-10-29 TX085434 外发未完成（只读）

- 纸单照片须先转正读条码，并用生产订单与产品交叉核对；本次正确TX085434 / MO260815030 / NAZ0040129 TKMMSZ5226BS，初读TX086434对应其他产品，已排除，禁止将其状态套入结论。
- 实时WebAPI：模压30合格11.34K、TransSelQty11.34、TransOutQty0；上锡60为IsOutSrc=true，但TransInQty/OUTSENDQTY均0。转移GXZYD01118844（1249191）为B审核中、30→60、11.34K，日期2026-08-21，仍带WWFC3278/103449/360194引用。
- WWFC3278仍存在，状态D重新审核，供应商GYS200外协厂X；其当前明细包含来源行360194与目标行360193，但OperTransferId均0，按FOperTransferId=1249191查为空。此为转移正向引用仍在、发出当前反向未关联，不能按已删除发出单案例直接清理。
- 当前操作日志显示2026-10-29 13:36:08发出审核成功并生成、提交上述转移，随后13:36:09发出反审核成功；13:36:23再次发出审核成功，13:36:24再次反审核成功。日志未见该转移审核成功或明确失败原文，不能断言因成本关账、权限或供应商禁用导致。未尝试Audit/UnAudit/改日期来取得报错。
- 结论：现有11.34K已选占用、转移未审核、目标上锡未转入；实际审核失败原因仍需前端报错。证据output/tx085434-*.json、scripts/scratch/2026-10/probe-tx085434*.js。未改业务数据；状态是当次快照。

- 2026-10-30 用户截图补证：集中发出处理结果前三项保存/提交/审核成功，第四项保存失败“转移数量超出可转移量(可转移量为0)”。同日WebAPI复查WWFC3278仍D、GXZYD01118844仍B/11.34K/30→60且引用该发出单；模压30合格11.34K、TransSelQty11.34、TransOutQty0，上锡60转入及OUTSENDQTY仍0。可据此解释本次重新生成转移被已有选单量占用阻挡；该截图不能证明原转移审核失败的原因。先核对并处理已有转移链，不反复提交生成，不擅自删除或改日期。复查证据 `output/tx085434-refresh-*.json`。
- 同日第二张前端截图明确报“工序转移单GXZYD01118844单据日期小于成本关账日期2026-09-30，工序转移单审核不成功”，原转移审核阻挡至此由截图确认。此前“原因未明”保留为当时证据边界。后续可评估财务批准的开放期间补录（正常撤回/日期维护及集中发出关联兼容性尚未验证）或历史期间反关账；不得直接改数据库日期/状态/占用量，也不能将改到10月即能审核写为已验证方案。

- 2026-10-30 用户称删除后新发出单带量0：WebAPI列表及View确认WWFC3278/103449、原转移GXZYD01118844/1249191均已不存在；但同计划已有另一张GXZYD01121425/1251774，B、日期2026-08-21、30→60、11.34K，仍引用已删除WWFC3278/103449/360194。模压TransSelQty仍11.34、TransOutQty0，上锡TransInQty/OUTSENDQTY0。不能沿用旧转移单号，也不能把删除发出单当成占用已释放；先定位当前残留转移，未验证其撤回/删除是否可行，不据此直接SQL清理。证据output/tx085434-after-delete-*.json。
- 2026-11-06 WWFC3309（103482）/ TX1005008（257366）外发提交生成报“转移数量超出可转移量(可转移量为0)”处理验证：
  - 成因：当日库存/成本已于 2026-11-05 关账至 `2026-10-31`（`T_STK_CLOSEPROFILE` 中 `STK/HS` 均为 `2026-10-31`），而 `WWFC3309` 表头 `FDate` 填为 `2026-10-29`。首次点击「提交生成」时，客户端插件 `OperOutGroupSendBillEdit` 依次保存、提交、审核 `WWFC3309`，并下推生成、提交 `SFC_OPERATIONTRANSFER` `GXZYD01130509`（`FID=1260858`，`30→60`，`13.44K`，`BillDate=2026-10-29`，状态 `B` 审核中，占用模压30 `TransSelQty=13.44`），但该转移单审核时被 `OptTransfer.CloseDate`（单据日期小于等于关账日期）拦截；用户随后仅反审核 `WWFC3309` 回 `D`（清空发出单行 `OperTransferId=0`），残留 `B` 状态的 `GXZYD01130509` 仍带 `OperOutGroupSendId=103482/EId=362472` 并锁死 `TransSelQty=13.44`。
  - 纯 WebAPI 解除方法（已验证，无需 SQL）：`QueryBusinessInfo` 与 `T_META_OBJECTTYPE` 证实 `SFC_OPERATIONTRANSFER` 的 `OptTransfer.CloseDate` 与 `OptTransfer.UnAudit`（校验集中发出非空及关账日期）仅挂载在 `Audit`/`UnAudit` 操作上，而 `CancelAssign`（撤销，`OperationId=26`）不触发关账日期与集中发出非空拦截。对 `B` 状态残留转移单先执行 `api.executeOperation('SFC_OPERATIONTRANSFER', 'CancelAssign', { Ids: '1260858' })` 撤回至 `D`（重新审核），再执行 `api.deleteBill('SFC_OPERATIONTRANSFER', 1260858)` 即可干净删除；WebAPI `View` 与 DB `T_SFC_OPERPLANNINGDETAIL_B` 独立复核确认模压30 `TransSelQty`（`FTRANSSELQTY`）从 `13.44` 归零，可转移量完全释放。注意：`WWFC3309` 重新点击「提交生成」前，须将其表头 `FDate` 从已关账的 10 月日期改为开放的 11 月日期，否则新生成的转移单仍会继承旧日期并在审核步受阻。另：`SFC_OperOutGroupSend` 物理表名为 `T_SFC_OPEROUTGS`（头）与 `T_SFC_OPEROUTGSENTRY`（体），`T_SFC_OPERPLANNINGDETAIL` 无物理列 `FOUTSENDQTY`（`OUTSENDQTY` 仅在 WebAPI `View` 中返回）。证据：`output/wwfc3309-fix-*.json`；脚本：`scripts/scratch/2026-11/fix-wwfc3309*.js`。
