# SFC 工序计划/汇报 SQL 关联键

直连 `<K3_MAIN_DB>` 查工序计划、汇报、上下道工序时用。动任何 `T_SFC_*` 表前先 `INFORMATION_SCHEMA.COLUMNS` 探列，猜列名直查必报 207。

## 计划头→工序明细：必须经 `T_SFC_OPERPLANNINGSEQ`（2026-09-17 实测纠正）

**旧写法 `d.FENTRYID = h.FID` 是错的**，它会静默返回**别的工序计划**的工序行（不报错、行数也对），导致数量、台账、状态全部张冠李戴。正确链路是两跳：

```sql
FROM T_SFC_OPERPLANNING h
JOIN T_SFC_OPERPLANNINGSEQ s ON s.FID = h.FID          -- 序列表 FID 就是计划表头 FID
JOIN T_SFC_OPERPLANNINGDETAIL d ON d.FENTRYID = s.FENTRYID
```

- `T_SFC_OPERPLANNINGSEQ.FID` = 工序计划表头 FID（该表 `FENTRYID` 才是明细的归属键）；`T_SFC_OPERPLANNINGDETAIL.FENTRYID` = `SEQ.FENTRYID`，**既不等于表头 FID 也不等于 SEQ.FID**，三者来自同一个内码池（实测同一批计划按 +192 交错分配），所以按直觉 join 一定错。
- 自查法：`T_SFC_OPERPLANNINGDETAIL.FBARCODE` 形如 `TX0900134-0-10`，用它对上计划号即可判断 join 有没有错；也可用 WebAPI `viewBill('SFC_OperationPlanning', fid).Entity[0].SubEntity[].Id` 拿 `FDETAILID` 反查。
- 明细表没有 `FID` 列，按直觉写 `d.FID` 即报 `Invalid column name 'FID'`。
- 行主键是 `FDETAILID`；状态/数量在行上（`FOPERSTATUS/FOPERQTY/FWIPQTY/FPICKINGQTY`），转入/转出/汇报/合格在 `T_SFC_OPERPLANNINGDETAIL_B`（`FTRANSINQTY/FTRANSOUTQTY/FREPORTQTY/FQUALIFIEDQTY`），用 `b.FDETAILID = d.FDETAILID` 关联。

## 工序名：T_ENG_PROCESS + _L

- 编码在 `T_ENG_PROCESS.FNUMBER`，中文名在 `T_ENG_PROCESS_L.FNAME`（`FLOCALEID=2052`）。`_L` 表主键就是 `FID`，且没有 `FNUMBER` 列——编码和名称必须两表 join（`p.FID = d.FPROCESSID`，`pl.FID = p.FID`），不要只查 `_L` 取编码。

## 汇报分录→工序行：用 `FOPTPLANOPTID`

`T_SFC_OPTRPTENTRY.FOPTPLANOPTID` 就是 `T_SFC_OPERPLANNINGDETAIL.FDETAILID`（`FOPTPLANID`=计划表头 FID，`FOPTPLANSEQID`=序列 FID），可直接 join 取该工序的 `FOPERQTY`。数量在 `T_SFC_OPTRPTENTRY_A`（`FQUAQTY` 合格/`FFINISHQTY` 完工，**不在** `_B`/`_C`）。

## 报工数量超工序数量的控制口径（2026-09-17 实测）

- 开关只在**工序计划单据类型**上：`OptPlanBillTypeParaSetting`（工序计划单单据类型特性参数）的 ComboField `FRptQtyControl`「报工数量允许大于订单」，枚举 `fc8aeca8-90e2-4bcc-8ba4-d081f2911af6` 只有三档：`A 不控制 / B 警告 / C 严格控制`（**没有按比例的上限**）。
- 值存在 `T_BAS_BILLTYPE.FPARASETTINGXML`（`<RptQtyControl>`），本账套 `GXJH01_SYS 标准工序计划` 当前为 `A 不控制`，所以超报不会被拦。服务端校验插件为 `Kingdee.K3.MFG.SFC.App.ServicePlugIn.OptRpt.Save2StrictReportModeCanQty`（元数据里的错误提示不含该规则，别指望从 `FKERNELXML` 读到条件原文）。
- 要做「合格数量 ≤ 工序数量 × 1.9」这类**比例**上限，标准产品无此字段，只能二开（工序汇报 Save/Submit 插件或校验规则）。
- 判定基数取 `T_SFC_OPERPLANNINGDETAIL.FOPERQTY`（= UI「工序数量」），不是表头 `FMOQTY`。

## 汇报存在性：按计划号+工序号，不要只看台账合格数

- 台账 `_B.FQUALIFIEDQTY > 0` 不等于做过工序汇报（委外工序的合格数可来自集中接收）。“没有汇报”的判定以 `T_SFC_OPTRPTENTRY` 为准：`re.FOPTPLANNO = <计划单号> AND re.FOPERNUMBER = <工序号>`，再 join `T_SFC_OPTRPT`（`rh.FID = re.FID`）限定 `FDOCUMENTSTATUS = 'C'` 且 `ISNULL(FCANCELSTATUS,'A') <> 'B'`（作废的不算）计数。跨单合计（超报比例控制）的完整口径见 `references/production/operation-report-over-rate-control.md`。
- 二次固化是免汇报工序：下道为二次固化时合格为 0 是正常现象（状态多为 6），不能直接当异常；继续往下查再下一道才有意义。

## FOPLANINFO 解析与上下道工序

- 集中发出/接收分录的 `FOPLANINFO` 形如 `TX085185-0-60`（计划单号-固定0-工序号）。取计划单号用 `LEFT(c, CHARINDEX('-', c) - 1)`，取工序号用最末段，不要按 `-` split 取第 2 段。
- 同一张计划的下一道工序：对 `T_SFC_OPERPLANNINGDETAIL` 用 `OUTER APPLY (SELECT TOP 1 ... WHERE FENTRYID = <该计划的 SEQ.FENTRYID> AND FOPERNUMBER > <当前工序号> ORDER BY FOPERNUMBER)` 取最小更大者（**填表头 FID 会串到别的计划**，见本文第一节）；下下道再套一层同样的 `OUTER APPLY`。直接 `+10` 猜工序号会错过 60→70、80→90→100 这类不等步长。

## 简易工艺路线的工序台账异常（回写归并）

历史案例中，简易工艺路线可能因多个工序共享底层 SEQ/FENTRYID 关系而出现回写归并：首尾工序数量异常累加，中间工序为零，或下游已有数量而上游台账为零。这是需要验证的风险，不应直接当作每张单据的结论。

排查至少比较：已审核汇报单数量总和、计划步骤的 `FREPORTQTY/FQUALIFIEDQTY`、工序顺序、上下游转移数量以及实际物料流。发现不一致时先完整扫描该生产订单，再确定是展示问题、单据链问题还是台账污染。`T_SFC_OPTRPTENTRY*`、`T_SFC_OPERATIONTRANSFER` 和 `T_SFC_OPERPLANNINGDETAIL_B` 可作为只读取证对象；任何直接校准都必须单独走 SQL 授权流程，不能照抄历史修复脚本。
