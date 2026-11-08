# 生产订单结案日期校验（MO Close vs FinishDate）

## 工序完工但生产订单仍开工：分别核对两套下限（2026-10-10）

- 工序状态与生产订单分录状态不是同一状态机。先用工序计划 View 核对 `FinishLowerLimit/ReportQty/QualifiedQty`，再用生产订单 View 核对 `StockInLimitL/StockInQuaQty/Status/FinishDate`，不得以末工序完工推定生产订单已完工。
- 实证：`MO260730038` 第10行 `FEntryID=259343`，关联 `TX085119`（FID=238326）；末工序110数量13.44K、完工下限10.752K（80%）、汇报/合格12.5K，达到工序下限。订单入库下限12.768K（95%）、合格入库12.5K，少0.268K；损失0.94K占订单数量约6.99%，超过订单5%的短收范围。
- 入库单 `SCRK260906027`（FID=136540）已审核，2026-09-06、该订单分录实收12.5K。同订单第1行也有类似差异：数量8.72K、订单下限8.284K、实收7.5K。
- 实时单据类型 `SCDD05_SYS` 的 `FPARASETTINGXML`：`IsAutoFinish=True`、`MainStkInQtyToLL=True`、`IsReportToFinish=True`；`MoBillTypeParaSetting` 元数据确认后者名称为“关联汇报点工序已完工”。不能把该参数误解为仅有汇报完工就足够，入库下限仍需核对。
- 此案例截图为历史状态。2026-10-10 View 回查第10行已为状态6（结案），完工/结案日期均2026-09-30 09:26:30，完工确认人蔡美娜；第1行亦同。不能将当前已结案说成仍开工，也不能把这个日期当成9月6日的实际包装完成时间；本次未查操作日志，不断言具体由哪个操作补入日期。
- 正常对照：同订单第12行入库15K，超过12.768K下限，有完工日期2026-09-03 09:24:50。此对照支持数量门槛差异，不能推广为所有异常唯一原因。
- 官方依据：生产订单自动完工在生产入库单审核时判断累计入库是否达到订单分录入库下限；工序汇报按工序累计汇报与工序完工下限判断。参见 https://open.kingdee.com/K3Cloud/help/PRD_MO.html 和 https://open.kingdee.com/K3Cloud/help/SFC_OPERATIONREPORT.html 。已达入库下限仍未完工时，进一步查入库审核当时前道必须汇报工序是否完工，不能只看事后状态。
- 处理建议以实际数量为准：真实已全部做完但短收超限，可按业务权限手工执行完工；批量调整短收率/工序下限需要业务确认，不能为让状态好看补造入库或直接SQL改状态、日期。本次仅只读调查。

## 2.5K盘物料默认下限批改与中断恢复（2026-10-10）

- 用户最终要求：未禁用、规格明确标注2.5K盘的物料，订单默认入库下限统一90%，对应 `MaterialProduce.FinishReceiptShortRate=10`。先前80%的要求被撤回，不得继续以20%的短收率执行。
- 工具：`scripts/cases/set_2p5k_short_rate.js` 默认dry-run，`--apply`执行；实时SQL只读确定范围，WebAPI最小保存 `SubHeadEntity5.FEntryId/FFinishReceiptShortRate`，View逐项比对其他生产属性、SQL独立验证目标值。已审核物料反审核、保存、提交、审核；原为D的物料仅保存并保持D，不能擅自将原重新审核状态审核通过。
- 本次815个物料中原有两条D状态：NBM0130008、NBM0130017；其余C。中断后不能把D一律当成本次造成，须回看操作前日志。
- 90%批次已验证313个后，在NBM0130043保存时报“运维员A”正在使用物料、修改冲突，停止未扩大写入。该条本次已反审核至D，短收率仍5%；待编辑占用释放后须恢复完成至10%和原C状态。剩余范围须实时扫描，不从旧清单直接写入。证据文件 `output/2p5k-short-rate-1791603335597.jsonl`，此处为当时部分进度，不是完成证明。
- 续跑前对本次遗留D状态补上恢复原审核状态的明确记录/处理；当前工具对原D保持D，不能直接续跑后误把本次反审核遗留项也永久保留D。遇相同写冲突不盲重试，不通过SQL解锁或改业务字段。
- 本操作修改物料默认属性，不代表已有订单的入库下限已同步；历史订单变更需另核对具体范围和实际字段。
- 完成复查（2026-10-10）：用户要求继续后，实时确认NBM0130043仍D/5%，使用 `--resume-log output/2p5k-short-rate-1791603335597.jsonl` 从本次操作前记录恢复其原C状态。续批502个全部完成，记录 `output/2p5k-short-rate-1791603663250.jsonl`；全范围扫描815个均为短收10%，非目标值0个。原D的NBM0130008、NBM0130017保持D，其余应为C；下次复用必须重新查询，不能沿用此数量或内码。

## 规则（MO260720022 实证 2026-09-03）

- 生产订单列表「结案/正常结案」时填的结案日期，金蝶按**分录行级 `FinishDate`（完工日期）**校验：`结案日期 >= FinishDate`，否则报`第N行分录不能结案，原因是：结案日期小于完工日期！`。
- 不要用工序汇报日期（`SFC_OperationReport.FDate`）或生产入库单日期（`PRD_INSTOCK.FDate`）推断可结案日期——两者都早也可能被拦。
- 本案：`MO260720022 Seq=1 FinishDate=2026-09-02T17:05:56`（完工确认人：管理员A），汇报 `GXHB526407=2026-08-28`、入库 `SCRK260828036=2026-08-28` 均为8月，但8/31结案仍被拦；结案日期改到9/2或之后即可。

## 诊断步骤

1. `executeBillQuery('PRD_MO','FID,...', "FBillNo='MO...'",...)` 拿 FID（注意：`FCloseStatus` 不是合法查询字段，会报"元数据中标识为FCloseStatus的字段不存在"）。
2. `viewBill('PRD_MO', fid)`（签名是 `(formId, billId)`，billId 为 FID 数字/字符串，不要传 `{Number:...}` 对象）读 `TreeEntity[seq].FinishDate / Status / StockInQuaQty / NoStockInQty`。
3. 按 Seq 逐行列出 `Qty / FinishDate / Status / StockInQua / NoStockIn`，再查 `PRD_INSTOCK`（`FMoBillNo='MO...'`）对照入库日期。
4. `SFC_OperationReport` 的 MO 关联字段不是 `FMoBillNo/FMOBillNo`（分别报列名无效），按已知汇报单号 `FBillNo='GXHB...'` 反查存在性即可；不要在这上面纠缠。
5. 结论只给可执行项：结案日期改到 `max(各待结行 FinishDate)` 或之后；想硬结到早于 FinishDate 的月份不可能，只能算完工月份。
