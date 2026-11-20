# 应收单「已结算/未结算金额」来源追溯（应收核销）

## 目录

- 草稿应收按 Excel 改价（2026-10-26 验证）
- 什么时候用
- 字段与表（实测，AIS 生产库）
- 已验证案例：AR00038677（2026-09-16）
- 输出与后续
- 两种核销路径
- 只读脚本
- 逾期应收与待审核财务单交叉核对（2026-10-23）
- 暂估应收选单缺失与反审核前的下游核对（2026-10-24）
- 财务应收保存超额：当前草稿与失败页面分开核对（2026-10-26）
- 跨期误推暂估应收的核查与对冲销账路径（2026-11-10）
- 款到发货客户未结算应收的放货追责与预收挪用溯源（2026-11-11）

## 草稿应收按 Excel 改价（2026-10-26 验证）

- 用户指定应收单并要求按附件改单价时，先查当前草稿、客户及全量分录；按发货单号、物料名称、客户订单号、数量和计价单位匹配，不按行序覆盖。价格采用有明确表头的明细列；其他无标题辅助列或价格表不能静默替代。
- 本次 AR00045320（180493）与 `222222.xlsx` 明细336行全部匹配，以J列「含税单价」为准，18行差异。最小 Save 模型 `{FID,FEntityDetail:[{FEntryID,FTaxPrice}]}`，`NeedUpDateFields=['FTaxPrice']`、`IsDeleteEntry=false`。使用 `['FEntityDetail.FTaxPrice']` 曾返回成功但18行价格均未落地；纠正为字段键后回查才生效。
- 回查必须核对全部行的目标价、未改行价格、数量、物料、计价单位、来源单号和Link源主键，以及表头金额和状态。本次336行回查通过，金额2186085.73→2187025.83元，增加940.10元，仍为草稿A；未提交审核。历史金额与行数仅为当日证据，复用需重查。
- Excel存在非法筛选范围时，可只读解压OOXML提取共享字符串与单元格，不修改原文件；不得因读取失败改用猜测价格。证据：`output/ar45320-{xlsx,before,comparison,save-model,save-response,after,verification}.json`；脚本 `scripts/scratch/2026-10/ar45320-*.js`、`ar45320-xlsx.py`。

## 什么时候用

用户指着应收单列表说「这张单应该是全部未结算的，这一千多是怎么结算进去的？」——即**已结算金额 > 0 但业务预期为 0**。先按本文只读回溯，不要先猜收款单或 SQL 改数。

## 字段与表（实测，AIS 生产库）

| 列表列 | 表.字段 |
| --- | --- |
| 已结算金额 | `T_AR_RECEIVABLEENTRY.FRECEIVEAMOUNT`（分录级，汇总=列表行/合计值） |
| 未结算金额 | `T_AR_RECEIVABLEENTRY.FNORECEIVEAMOUNT` |
| 价税合计 | `T_AR_RECEIVABLE.FALLAMOUNTFOR` / 分录 `FALLAMOUNTFOR` |
| 核销状态（表头） | `FWRITTENOFFSTATUS`（与 FRECEIVEAMOUNT 不是同一个口径，别互相代替） |
| 已核销金额（分录） | `FWRITTENOFFAMOUNTFOR`（应收核销走的是它；本案为 0 而 FRECEIVEAMOUNT 非 0） |
| 对账/开票匹配 | `FHADMATCHAMOUNTFOR`、`T_AR_BILLINGMATCHLOG(ENTRY)`（本表单 1179 条分录各 1 行属正常） |
| 暂估/财务口径 | `T_AR_RECEIVABLE.FSETACCOUNTTYPE`：`2`=暂估应收，`3`=财务应收 |

核销记录（应收↔应收、应收↔收款单都在这里）：

- 表头 `T_AR_RECMACTHLOG`：`FID`（即前端「核销记录」单号）、`FVERIFYDATE`、`FVERIFIERID`、`FMATCHMETHODID`、`FCOMPUTEID`（同一次自动核销共享同一 GUID）、`FMATCHFIELDNAME`。
- 分录 `T_AR_RECMACTHLOGENTRY`：**没有 `FVERIFYDATE`/`FID` 之外的时间列**，取核销时间/人必须 join 表头（写成 `WHERE FVERIFYDATE=` 会报 Invalid column name）。
- 分录字段：`FSRCBILLNO`/`FSRCBILLID`、`FTARGETBILLNO`/`FTARGETBILLID`、`FSRCSEQ`、`FCURWRITTENOFFAMOUNTFOR`（本次核销额）、`FPLANAMOUNTFOR`（该单总额）、`FNOTWRITTENOFFAMOUNTFOR`（核销后余额）、`FPLANAMOUNT`/`FWRITTENOFFAMOUNT`/`FCURWRITTENOFFAMOUNT`（本位币）、`FMatchFag`。
- 核销方式码（`T_AR_MATCHMETHODMESS_L`，全表 23 条，只读）：`1` 核销生成、`10` **自动核销**、`20` 匹配核销、`25` 匹配（自动核销）、`30` 特殊核销、`60` 手工核销、`71/72/73` 自动/手工/特殊核销（数量口径）、`81` 坏账核销、`82` 坏账收回核销、`50` 清理、`40` 转销。
- 核销方案 `T_AR_MATCHSCHEME(+_L)`：本账套只有 1 条 `YSSKHXFA01_SYS`「预置方案」，`FDESCRIPTION='往来单位、币别相等，按到期日从前往后核销'`。
- 结算方式 `T_BD_SETTLETYPE`：主键列是 `FID`（不是 `FSETTLETYPEID`），名称在 `_L.FNAME`；分录里的 `FSETTLETYPEID=4` = `JSFS04_SYS 电汇`。
- 操作日志：`FOBJECTTYPEID='AR_MatchRecord'`，`FOPERATENAME` 为「保存/删除」，`FDESCRIPTION` 含核销记录号；应收单审核触发的核销写成 `AR_receivable` 的「审核」，描述以「核销成功」开头，列出 `单据A,单据B核销成功,产生核销记录，序号为NNN`（描述超 2000 字会被界面/驱动截断，别把它当完整清单）。
- 归档：现表查不到更早日志必须补查 `T_BAS_OPERATELOGBK`（本案 8/19 的核销日志只在 BK 表）。

## 已验证案例：AR00038677（2026-09-16）

现象：深圳市客户Y 的 `AR00038677`（FID 167356，财务应收类型3，2026-06-26，2,982,367.27，已审核，1179 条分录）列表显示已结算 `1,473.17`、未结算 `2,980,894.10`，且每行只有 0.47/0.59/1.17 这类零星“已结算”。

回溯结果：

1. 分录汇总 `FRECEIVEAMOUNT=1,473.17` 与列表完全一致；`FWRITTENOFFAMOUNTFOR=0`、`T_AR_RECEIVEBILLSRCENTRY` 0 行 → **不是收款单核销，是应收单对核销（红字扣款）**。
2. 核销记录 `142012`（`FMATCHMETHODID=10` 自动核销，`FVERIFIERID=111764` 会计A，2026-08-19 17:03:11 保存）：源 `AR00038677` ↔ 目标 `AR00041899`，本次核销 `1,473.17`（`FSRCSEQ=1`，整单级别挂账）。
3. 对手单 `AR00041899`：**红字财务应收**（`FREDBLUE=1`，-3,019,730.27，2026-08-19 17:02:55 制单/17:03:02 审核，备注「芯片崩边，良率不达标扣款」）。
4. 同一批核销记录 `142011`：该红字单先全额抵掉 `AR00040555`（3,018,257.10，同客户、备注同为扣款），余额 `-1,473.17` 才转到 142012 落到 AR00038677 上（3,018,257.10 + 1,473.17 = 3,019,730.27 = 红字单总额，红字单因此 `FWRITTENOFFSTATUS=C` 全部核销）。
5. 落库方式：核销挂在整单（`FSRCSEQ=1`），金额**按分录金额比例分摊**到 1179 条分录（比例 = 1473.17/2982367.27 ≈ 0.0494%；实测 1178 条与「分录金额×比例、四舍五入到分」吻合，剩 1 条吃尾差），所以每行出现几分几毛的“已结算”。

结论口径：这 1,473.17 **不是客户付款**，是客户扣款红字单自动核销时的**余额溢出**，落到本单并平摊到全部分录。

## 输出与后续

- 回复按「已结算金额从哪里来 → 哪张对手单 → 谁在什么时候核销 → 为什么分摊成这样」四段写，给出核销记录号、对手单号、金额、操作人、时间。
- 若业务确认不该落在本单：标准处置是**取消/删除核销记录 142012**（前端「核销记录」有删除先例：2026-08-19 16:44 会计A删除过 141918/141919），撤销后 `AR00038677` 回到未结算 2,982,367.27，同时红字单 `AR00041899` 会退回未核销 `-1,473.17`，需一并安排。属于写操作，必须取得针对该核销记录的授权后再做，禁止 SQL 改 `FRECEIVEAMOUNT`。
- 注意连带影响：单据被核销后从该单下推收款单只能带出未结算部分（本案 2,980,894.10），财务容易以为“少了钱”。

## 两种核销路径（回答“用什么去核销的”先分清）

`T_AR_RECMACTHLOGENTRY` 的 `FSRCBILLNO` 前缀就能看出载体：

| 路径 | 源单 | 目标单 | 什么时候用 |
| --- | --- | --- | --- |
| 收款核销（常规） | `SKD…` 收款单 | `AR…` 应收单 | 应收单**下推生成收款单**，收款单审核时按源单核销；金额通常全额结清 |
| 应收冲应收 | `AR…` 应收单（多为红字/扣款、退货） | `AR…` 应收单 | 客户扣款、退货、暂估冲回等**没有收款单**的抵账 |

两条路径的 `FMATCHMETHODID` 都可能是 `10`（自动核销），**不能按核销方式判断有没有收款单**，要看源单前缀：源单是 `SKD` 才有真金白银进来。

实测（客户Y，2026 年）每月一笔收款正好等于一张财务应收单金额，核销记录成对出现、源单为收款单：

| 应收单（类型3） | 金额 | 收款单 | 核销日 |
| --- | --- | --- | --- |
| AR00031086（2/25） | 467,985.88 | SKD00007843 | 5/16 |
| AR00032869（3/26） | 969,437.61 | SKD00008266 | 6/18 |
| AR00034835（4/27） | 1,770,313.00 | SKD00008689 | 7/23 |
| AR00036704（5/27） | 2,553,009.03 | SKD00009013 | 8/17 |

注释：核销记录里 `FSRCSEQ` 可能有 1、2 两行作用于同一目标单（收款单分两段核销），两行合计仍等于该收款单金额；`FMATCHMETHODID=71`（自动核销、`FMATCHFIELDNAME=FMatchQty`）的大批 AR↔AR 行是暂估/财务对账回写，净额成对抵消为 0，与收款无关，别混入收款口径。

## 只读脚本

`scripts/scratch/2026-09/ar-settlement-match-trace.js`（参数为应收单号，默认 AR00038677）：表头/分录汇总、核销日志两侧、对手单概况、核销人、操作日志（现表+BK）、收款单来源分录计数。

## 逾期应收与待审核财务单交叉核对（2026-10-23）

- WebAPI `AR_receivable` 列表已验证 `FRECEIVEAMOUNT,FNORECEIVEAMOUNT` 为分录已结算/未结算金额；View 分录键保留 F 前缀。列表返回多行须按真实分录主键去重，或 View 后逐分录汇总，不能累加重复表头金额。
- View 的表头 `NOTWRITTENOFFAMOUNTFOR` 不能代替分录未结算金额；待审核单表头及计划余额可能为0，但分录 `FNORECEIVEAMOUNT` 仍非0。View 属性名不能机械加 F 作为列表查询键，`FNOTWRITTENOFFAMOUNTFOR` 本次列表查询不存在。
- 暂估应收已被待审核财务应收引用时，分别列明源单余额、源单到期日、财务单状态及到期日，不能重复累计，也不能只查已审核财务单后断言无逾期。收款来源分录 `SRCBILLNO` 用于核实实际收的是哪张应收。
- 当日新名悦 CTK000396：AR00042250 3600元、AR00042454 10552.50元，均已审核暂估、未结算、2026-09-30到期；两者被审核中 AR00043716 引用（整单17507.50元，2026-11-30到期）。SKD00009725 的32272.50元收的是 AR00041974，不是前述两笔。此为当日快照，复用必须重查。未读取用户所见逾期报表或监控条件，不能断言其精确命中原因。
- 证据：`output/2026-10-23/xinmingyue-ar.json`、`xinmingyue-outstanding.log`；收款与来源核验日志 `output/xinmingyue-receipts.log`。

## 暂估应收选单缺失与反审核前的下游核对（2026-10-24）

- WebAPI `AR_Receivable` 可用 `FSOURCEBILLNO` 过滤来源应收单号，列表按 FID 去重后逐单 View；以 `AP_PAYABLEENTRY[].FEntityDetail_Link` 的 SBillId/SId 交叉核实真实源单和分录。草稿财务应收仍可能保留引用，不能因已删除某条分录就断言下游已清空。
- 客户Y退货 XSTHD011815（102032）已生成暂估 AR00044030（177770/494767），-4.131K/-495.72元；已审核财务 AR00043805（177545）分录494806仍以 `AP_HookRecToFinRec` 引用它。另有已审核暂估 AR00044030-000001（179510），+4.131K/+495.72元；仅据同额反向及来源号不能断言生成机制或核销记录，需进一步查证。选单缺失应先查已关联状态，不能重复推退货。
- 无锡商甲 AR00044917（180074，368600元）仍被草稿财务 AR00045118（180286，整单1104280.77元）14条分录引用；不能按整张财务单删除处理，以免影响其他来源。用户未提供正确目标数量，不修改数量。
- 本次只读，未调用反审核验证报错，所以上述为当前下游阻塞依据，不宣称已取得具体失败原文。证据：`output/2026-10-24/{102032,177770,177545,179510,180074,180286}.json`；复用前实时重查。

## 财务应收保存超额：当前草稿与失败页面分开核对（2026-10-26）

- 遇到截图「财务应收单保存反写暂估应收销售数量超额」，先按报错源 FID/FEntryID 核对数量及累计字段，再查财务草稿的真实 Link；日期命中不代表数量可再次引用。失败页面内容不等于数据库已保存内容；首次未查到单据后，用户继续操作期间应重新查询，不能沿用未命中结论。
- 海德 AR00044026（177766/494762），2026-09-28 退货 TKMP3401B，-30K/-1815元。首次读取累计数量为0，后续读取 BUYIVBASICQTY/BUYIVQTY/FSALFINBASEQTY 均-30；AR00045320（180493）随后已为草稿A，共346行，第293行508925唯一引用该源分录，数量-30K，Link AP_HookRecToFinRec，整单未发现重复源分录引用。9月以来另外两张海德财务应收也未发现引用此源分录。
- 截图报第347行，而已保存草稿在第293行已有该笔，支持「失败页面再次选入」的推断，但未读取当时未保存页面，不能确认历史重复行或宣称修复成功。当前草稿保存存在不等于审核成功，不为调查重放Save/Submit/Audit。
- 证据：output/hd-ar-177766.json、hd-ar-180493.json、hd-ar-177702.json、hd-ar-179326.json；本次仅WebAPI只读。易变状态复用前重新查询。

## 跨期误推暂估应收的核查与对冲销账路径（2026-11-10）

- **适用场景**：历史期间（已关账）有一笔暂估应收单（`FSetAccountType='2'`）因误操作直接从销售订单下推（`FSOURCETYPE='SAL_SaleOrder'`，转换规则 `AR_SailOrderToReceivableMap`），而后正常出库单又再次下推生成了正确的暂估应收并已完成对账开票，导致错误暂估单一直挂在「未对账数据（`FOPENSTATUS='A'`、未开票核销数≠0）」列表中。
- **先核查上下游与关账状态**：
  1. `viewBill("AR_receivable", fid)` 检查误推暂估单的 `FSetAccountType`（确认是否类型 `2`）、`FOPENSTATUS`/`FWRITTENOFFSTATUS`、分录 `FRECEIVEAMOUNT`/`FNORECEIVEAMOUNT`、`FOPENQTY`/`BUYIVQTY`/`FSALFINBASEQTY` 是否全为 `0`，以及 `FSOURCEBILLNO` 是否有下游财务应收单或总账凭证引用（类型 `2` 暂估本身不生成总账凭证）；数据库侧可同步核对 `T_AR_RECEIVABLEENTRY_LK`、`T_AR_RECMACTHLOGENTRY`、`T_AR_BILLINGMATCHLOGENTRY` 确认 0 行下游与 0 行核销记录。
  2. 检查源销售订单分录的 `StockBaseARJoinQty`/`SalBaseARJoinQty`（误推+出库正常推会使累计应收关联数量翻倍，如订单 5K 显示已关联 10K），并核实正常销售出库单→正常暂估应收→财务应收→自动冲回单（`-000001`）及收款单链路是否已完整闭环。
- **两种标准销账方案（不动历史关账期）**：
  - **方案 A（本账套财务已有先例：当期正负暂估合并下推 0 金额财务应收对冲）**：
    - 先例与本次执行实证（2025-10-16 历史先例 `AR00001701` + `AR00023001` → `AR00023002`；2026-11-10 执行 `AR00040826` + `AR00045931` → `AR00045932`）：
      1. 先查询 `T_AP_CLOSEPROFILE`（`FCATEGORY='AR'`）确认应收模块最新关账日期，在当前开放期间手工新增一张**同客户、同收款条件、同销售部门/销售组/销售员、同物料、同单价、相反数量（负数）**的暂估应收单（`FSetAccountType='2'`，如 `AR00045931`，数量 `-5`、含税单价 `155`、价税合计 `-775`）并提交审核；
      2. 调用 `pushBill("AR_receivable", "AR_receivable", [negFid, posFid], { EntryIds: "${negEntryId},${posEntryId}", RuleId: "AP_HookRecToFinRec", IsEnableDefaultRule: "false", IsDraftWhenSaveFail: "true" })` 将两张正负暂估单合并下推为 1 张**2条分录（一正一负）、整单价税合计为 `0` 元**的财务应收单（`FSetAccountType='3'`，如 `AR00045932`，表头 `FALLAMOUNTFOR=0`）；注意：保存财务应收草稿时上游暂估单的 `FNOINVOICEQTY`（未开票核销数）仅更新 `FBUYIVQTY` 而不会清零，必须补齐本账套类型 3 财务应收必填二开字段 `F_UNW_Text_apv='无票'`（发票号）与 `F_KP_Date`（开票日期，View 属性名为 `F_UNW_Date_qtr`）；
      3. 审核该 `0` 元财务应收单后，系统自动对两张暂估单生成反向冲回单（`AR00040826-000001` 与 `AR00045931-000001`，`FByVerify='2'`）并完成开票核销（`T_AR_RECMACTHLOG` 产生 `FMATCHMETHODID=71`、`FMATCHFIELDNAME='FMatchQty'` 自动核销记录）：原暂估单的 `FOPENSTATUS` 与 `FWRITTENOFFSTATUS` 均变为 `C`（已全部核销/开票）、`FOPENQTY=5`、`FNOINVOICEQTY=0`（未开票核销数清零），彻底从「未对账数据」列表中消失；同时因财务应收单整单金额为 `0`，**不会多计当期主营业务收入或应收账款，也无需生成总账凭证**。
  - **方案 B（彻底删除原误推单）**：因原单业务日期在已关账历史期间（如 7 月），直接反审核会受应收模块已结账拦截；若确需物理删除原单，必须将应收系统反结账回对应历史月份才能反审核删除（仅删除类型 `2` 无凭证暂估单本身不影响总账科目余额，同时可使销售订单累计关联应收数量恢复正常，但跨多月反结账操作繁琐，一般优先推荐方案 A）。
- **防呆阻断（禁止销售订单直接下推应收单）**：在 BOS 单据转换（`T_META_CONVERTRULE`）中将 `SAL_SaleOrder` → `AR_receivable` 的 4 条预置转换规则（`AR_SailOrderToReceivableMap`、`AR_SailOrderToReceivableZT`、`AR_SailOrderToMinusReceivableMap`、`AR_InitSailOrderToInitReceivableMap`）逐一点击「扩展」（生成 `FDEVTYPE=2` 扩展行覆盖标准行 `FDEVTYPE=0`）并取消勾选「启动」保存（`FSTATUS='0'`），即可仅关闭销售订单直接下推应收单，而不影响 `SAL_OUTSTOCK` → `AR_receivable`（`AR_OutStockToReceivableMap`）正常下推。
- **安全边界**：硬规则禁止提交/审核仅针对 `AP_PAYABLE`（财务应付单）；对 `AR_receivable` 执行正负对冲写入仍须先取得用户明确方案选择与授权，脚本默认 dry-run、显式 `--apply` 执行并完成 WebAPI 与数据库双重独立复核。证据：`output/ar40826-investigation-20261110.json`、`output/ar40826-offset-result-20261110.json`。

## 款到发货客户未结算应收的放货追责与预收挪用溯源（2026-11-11）

- **典型误判风险**：收款条件为 `001 款到发货` 的客户在财务应收单列表出现若干行「未结算金额 > 0」，用户追问「这两笔货是谁放的」时，**绝不能只查表面这两张出库单/发货通知单的制单与审核人就下结论**。本账套财务做跨期收款核销时，存在将新销售订单已全额预收的 `SKD` 收款单通过手工核销（`FMATCHMETHODID=60`，生成 `YSHXD` 预收核销单）挪去冲抵历史旧财务应收单缺口（“拆新补旧”）的情况，导致新订单后续正常发货转入财务应收后反而显示未收款。
- **固定双层核查步骤（只读）**：
  1. **表层单据链与订单预收核实**：
     - 顺着财务应收分录 `FSOURCEBILLNO`（暂估应收）→ 暂估分录 `FSOURCEBILLNO`（`SAL_OUTSTOCK`）→ `T_SAL_OUTSTOCKENTRY_R.FSRCBILLNO`（`SAL_DeliveryNotice`）与 `FSOORDERNO`（`SAL_SaleOrder`），联合 `T_BAS_OPERATELOG(BK)` 查清表层订单、通知单、出库单、应收单的制单人、审核人及客户档案默认业务员/跟单员；
     - **必查订单级收款绑定**：查 `T_AR_RECEIVEBILL r JOIN T_AR_RECEIVEBILLENTRY e ON e.FID=r.FID`（按 `r.FCONTACTUNIT` + `e.FSALEORDERNO`），核实该销售订单在发货前是否已收到全款。
  2. **底层预收挪用链与真实缺口源头定位**：
     - 若表层订单在发货前已收齐预收款，继续查该 `SKD` 收款单在 `T_AR_RECMACTHLOG` / `T_AR_RECMACTHLOGENTRY` 的全部核销去向（注意 join 条件 `h.FID = e.FID`；核销目标 `AR` 单上的 `FSRCSEQ` 对应收款计划表 `T_AR_RECEIVABLEPLAN.FSEQ`，可由 `T_AR_RECEIVABLEPLAN.FORDERBILLNO` 直接读出被填补的旧销售订单号），逐跳向前追溯多米诺骨牌链，直到找到最早一张没有对应收款支撑的订单/出库单；
     - **全客户总账交叉闭合校验**：汇总该客户全历史已审核出库净额（`T_SAL_OUTSTOCKENTRY_F.FALLAMOUNT` 减 `T_SAL_RETURNSTOCKENTRY_F.FALLAMOUNT`）、未转财务应收的开放暂估额、期初特殊核销额（`FMATCHMETHODID=30`）与全部已审核 `T_AR_RECEIVEBILL` 实收总额，并按销售订单逐单比对 `净出库额 - 绑定收款额`（同时把 `FSALEORDERNO` 为空的收款单按核销日志或金额日期还原配对），确保全账套总差额与当前列表未结算总额分毫不差，锁定真正无款/少款放货的历史源头单据与经手人。
- **输出规范**：汇报时分清两层事实——① 截图所示两笔单据本身的发货经手链及「发货前其实已全额预收款」的证据；② 预收款被哪笔手工核销挪补了哪张旧单，以及真正造成资金缺口的历史无款/少款放货源头单号、时间与经手人。
