# 成本核算只读探针：配置 / 期间 / 结果（K3 Cloud / 本账套）

## 目录

- §1–§4：关账、核算执行、结果表与字段陷阱
- §5–§6：在产、作业量与按封装汇总
- §7–§8：配置启用与当期金额路径
- §9：分配标准检查与 2026-10-12 验证证据
- §10：设备备件与维修费归集到部门/成本中心路径（2026-10-31）
- §11：成本不准整体筛查（2026-11-03）
- §12：新旧分配标准导致利润变化的核查（2026-11-07）

只读，全部经 `mssql` 直连 `<K3_MAIN_DB>` 验证。

## 1. 最后关账期

```sql
SELECT TOP 10 * FROM T_CB_ACCTGINFO ORDER BY FYEAR DESC, FPERIOD DESC;
-- 列：FID, FACCTGSYSNAME, FACCTGORGNAME, FACCTGPOLICYNAME, FYEAR, FPERIOD, FCLOSEDATE
```

`FCLOSEDATE` 即该期关账时间；“上次”= 最大的 `FYEAR/FPERIOD`。

## 2. 各期核算次数与成败

```sql
SELECT FYEAR, FPERIOD, COUNT(*) AS n
FROM T_CB_ACCTGPERFORMANCE
GROUP BY FYEAR, FPERIOD ORDER BY FYEAR DESC, FPERIOD DESC;

SELECT * FROM T_CB_ACCTGPERFORMANCE
WHERE FYEAR=<年> AND FPERIOD IN (<上期>,<本期>)
ORDER BY FPERIOD, FSTARTTIME;
-- 关键列：FSTARTTIME/FENDTIME/FACCTGSTATUS/FEXECPTIONMEMO
-- + 规模列：FCMATERIALRANGE/FCSTOCKSEQ/FCINVBALANCEENTRY/FCEXPALLORESULTREC/FCCOSTALLORESULTREC/FCPROORDERINFO
```

`FACCTGSTATUS=1` + `FEXECPTIONMEMO` 为空即成功。`FACCTGTYPE=1` 的行是轻量试算（各计数多为 0），`3` 才是完整核算，不要把两者混在一起计数。

## 3. 哪张表真有当期数

```sql
-- 含 FYEAR 的 CB 表逐个计数取最大期
SELECT DISTINCT t.name FROM sys.columns c
JOIN sys.tables t ON c.object_id = t.object_id
WHERE t.name LIKE 'T_CB%' AND c.name = 'FYEAR' ORDER BY t.name;
-- 对每表：SELECT COUNT(*) AS n, MAX(FYEAR*100+FPERIOD) AS yp FROM <表>
```

已知形态：`T_CB_COSTMATMERGE` 为空是常态；`T_CB_WIPDATA/T_CB_SFCINOUTPUT/T_CB_EXPENSECOLLECTION/T_CB_WORKACTIVEDATA` 持有最新在算期。

## 4. 坑

- `T_CB_COSTALLORESULTREC` 与 `_H` 均无 `FYEAR/FPERIOD/FENDDATE`，只有 `FRECID/FSENDID/FCOSTCENTERID/FAMOUNT/FQTY/FPRODUCTDIMEID`；按期间过滤必报列不存在，需经单据/ID关联而非直查。
- `T_CB_COSTMATTERIAL(_H)` 的明细行 `FMATERIALID=0` 是费用型行（`FEXPTYPE` 区分），不是脏数据；看金额用 `FCURRINPUTAMOUNT/FQUALIFIEDINAMOUNT`，看数量用对应 `QTY`。
- `T_BAS_CLOSEACCTOPERINFO` 无 `FCLOSEDATE`，`T_CR_CLOSEACCOUNT` 无 `FENDDATE`，`T_BD_ACCOUNTPERIOD` 无 `FNUMBER`——照抄通用关账脚本必错，先查列再写 SQL。
- 临时探针放 `scripts/scratch/YYYY-MM/cost-*.js`，用 `C:/Users/...` 原生路径跑 `bun`，不要堆仓库根目录。
- `T_CB_COSTMATTERIAL` 的 `FEXPTYPE='0'` 即料行，带真实 `FMATERIALID+FPRICE`；恒等式 `FCURRINPUTAMOUNT = FQUALIFIEDINAMOUNT + FENDAMOUNT`（数量列同理），先验算再讲数。单价为 0 的料号只报数量、不硬合金额总数。

## 6. 按封装汇总与是否上分类法的决策

- 汇总路径：`WIPDATAENTRY.FPRODUCTID` → `T_BD_MATERIAL.FMATERIALID` → `T_BD_MATERIALGROUP_L`（`FID = m.FMATERIALGROUP AND FLOCALEID = 2052`，`FNAME` 即封装如 `PDFN5X6-8L/SOT23-6L`）；料单价取同 `FMATERIALID`、`FEXPTYPE='0'`、`MAX(FID)` 行的 `FPRICE`。
- 料号级领料/工时准时，直接按料号算完再按封装加总，不上分类法；只有共用费用落不到料号时，才先归集到封装大类再二次分配——先拿两个封装试点汇总对比，差得离谱或分不下去再设分类。
- 汇总必带在产负数清单（`FWIPQTY<0` 即完工大于期初+投入），关账前核对，不下根因结论。

## 5. 最近一期三张结构表（只读样例口径）

- **在产 WIP**：头 `T_CB_WIPDATA(FYEAR/FPERIOD)` + 行 `T_CB_WIPDATAENTRY(FPRODUCTID, FINITQTY, FINPUTQTY, FFINISHQTY, FWIPQTY)`；每行即 `期初 + 本月投 - 本月完工 = 在产`。产品名经 `T_BD_MATERIAL(FMATERIALID,FNUMBER)` 左连 `T_BD_MATERIAL_L(FMATERIALID, FLOCALEID=2052)` 取 `FNAME/FSPECIFICATION`——连 `FID` 必错，该表无 `FID`。`FWIPQTY<0`（完工大于投入）只报“异常待查、关账前核对”，不得直接断言口径或根因。
- **作业量**：头 `T_CB_WORKACTIVEDATA(FYEAR/FPERIOD, 单号 ZYSL*)` + 行 `T_CB_WORKACTIVEDATAENTRY(FPROORDERNO, FPRODUCTID, FQTY)`；`FQTY` 即分摊费用的作业量，`FPROORDERNO`形如 `MO…/FG…`可直接追单。
- **费用明细**：`T_CB_COSTCALEXPENSEDETAIL_H(FEXPENSESITEMID, FCURRINPUTAMOUNT, FQUALIFIEDINAMOUNT, FDYSINAMOUNT, FWASTEINAMOUNT)`；看钱只看 `AMOUNT` 列族，当前形态多为全额进合格品。
- **给新手讲结构时**：先用其自家封装真实例子讲三句话（在产=做完没，作业量=谁干得多谁多分钱，费用=钱全给了合格品），再贴样例行；术语（分类法/分步法）后置。样例 xlsx 用 exceljs 兼容格式（无 Table/无筛选）、扁平放 `output/`、写后回读验 sheet 行数，会话内同时贴关键行，不只给路径。

## 7. 配置与启用状态探针（回答「用什么方法核算 / 启用了什么 / 费用从哪来」）

判断顺序固定：**先用数据行数判启用 → 再读参数表 → 最后才看元数据表单名**（标准产品的表单在元数据里永远存在，存在≠启用）。

| 问题 | 查什么 | 基线（实测，复述前重新 GROUP BY） |
| --- | --- | --- |
| 标准成本用没用 | `T_CA_COSTROLLUP*`、`T_CA_STDCOSTVERSION` 行数 | 全 0 → 未用，实际成本法 |
| 即时成本用没用 | `T_HS_TIMELYACCTG/LOG/BALANCE/PROCESS` 行数 | 全 0 → 未用，仍是月末批量卷算 |
| 目标成本/约当系数 | `T_HS_TARGETCOST`、`T_CB_EQUIVALCOEFFICIENT` | `T_HS_TARGETCOST`=0（未用）；**`T_CB_EQUIVALCOEFFICIENT` 已于 2026-11-06 启用**（塑封 4 部门 + 玻封 6 部门，详见 `../finance/cost-allocation-equival-coefficient.md`） |
| 计价方法 | `SELECT FVALUATIONMETHOD, COUNT(*) FROM T_HS_STOCKDIMENSION GROUP BY FVALUATIONMETHOD`；插件枚举在 `T_HS_VALUATIONCONFIG`（0=加权平均/1=移动加权/2=FIFO，`FMETHODENABLED` 只说明插件可用，不代表有物料在用） | 全部方法 0（加权平均） |
| 核算流水线步骤 | `T_HS_CALPROCESSCONFIG` 按 `FSEQ` 读 `FCALTYPE`+`FCALPLUGIN` | 合法性检查(0)穿插：出库成本核算(1)→费用分配(2)→产品成本计算(4)→材料分层(8) |
| 在产成本规则 | `T_HS_WIPCALCONFIG`（7 种在产插件全启用）、`T_CB_WIPSTANDARDSET`、`T_CB_WIPCALRULE` | 标准设置仅 2 条且状态 A（未审核），`T_CB_WIPCALRULE` 为 11 条系统预置 SYS_00x；实际在用哪种未验证，报告标推断 |
| 成本对象来源 | `T_CB_PROORDERTYPE` 按 `FFORMID`/`FPROORDERTYPE` GROUP BY | PRD_MO 13.8万、SAL_OUTSTOCK 11.5万、SUB_SUBREQORDER 5千、SAL_RETURNSTOCK、SP_InStock；最新行=业务当天 |
| 成本中心 | `T_CB_COSTCENTER`（主键 `FCOSTCENTERID`，`_L` 同名列 join，连 FID 必错）按 `FBUSINESSTYPE` 分组 | 32 个：车间工序型=4、部门型=5、委外成本=6（枚举↔「基本/辅助/委外」官方映射未验证，标推断） |
| 成本项目 | `T_HS_COSTITEM(+_L)`，join 键 `FCOSTITEMID` | 9 个：直接材料/间接材料/采购附加费/委外加工费/直接人工/折旧费用/水电费/其他费用/制造费用；`FCOSTITEMTYPE`+`FISMATERIAL` 区分 |
| 费用归集来源 | `T_CB_EXPENSECOLLCFG` 每行一个来源：`FBILLFORMID`、`FDATAFROMCLASS`、`FDEFFILTER` | 总账凭证、薪酬分配、FA_ADJUST 折旧、费用报销/差旅、采购收料费(FYCG)、期初在产调整；**含 `FSOURCETYPE='SFC_OperProcBalance'` 过滤的 AP_Payable 行 = 工序结算单→应付单→委外加工费落点**，答外发加工费进成本必引这条 |

枚举值没有官方映射的一律标「推断」；通用只读 SQL 坑（`T_META_OBJECTTYPE_L` 取中文名、`sql_variant` 先 CONVERT、上亿行表用 `sys.dm_db_partition_stats` 计行、`_L` join 键=主表业务主键）见 `../kingdee-k3cloud/references/system/bill-operations-and-metadata.md` §4。

## 8. 当期金额取数与按维度报表（存货核算行金额路径）

- **单据行金额的真源是 `T_HS_OUTSTOCKACCTGDATA`**（存货核算按单据分录行的核算结果）：`FBILLFROMID`（PRD_INSTOCK/SAL_OUTSTOCK/PRD_PickMtrl…）、`FMATERIALID`、`FPRODUCTID`（生产领料行挂**成品**，材料费直接按成品归集）、`FINOUTINDEX`（1入/0出）、`FQTY/FPRICE/FAMOUNT`、`FACCTGID`（期间）、`FACCTGSTARTDATE`（核算运行时间）、`FBILLDATEFIELD`（业务日期）。与 §6 的在产台账路径互补：台账口径看在产平衡，行金额口径看本期实花的钱。
- **期间 id 永不硬编码、不拿别表的 id 顺推**：先 `SELECT FACCTGID, MIN(FBILLDATEFIELD), MAX(FBILLDATEFIELD), COUNT(*) … GROUP BY FACCTGID`，再看该组 `FACCTGSTARTDATE` 是否等于期末关账后那次运行的时间，确认期后才取数。
- **坑**：CB 成本计算当前表的 `FCURR*`（本期投入）列关账结转后清零，全 0 ≠ 当期没发生；`_H` 归档的 `FOUTACCTGID`↔期间映射与 `T_CB_WIPDATA.FID↔FYEAR/FPERIOD` 实测冲突，不要拿快照取“某期本期数”。
- **坑**：`T_CB_SFCINOUTPUTENTRY.FINSTOCKQTY` 按工序行重复，跨行合计 ≈ 生产入库数 × 工序数；完工数以 `FBILLFROMID='PRD_INSTOCK'` 行的 `FQTY` 为准，两套数相除≈工序数可当交叉验证。
- **封装维度结构**：`T_BD_MATERIAL.FMATERIALGROUP` → 末级分组（=封装，AM075=PDFN3X3-8L、DD003=SOD-123）；字母开头分组=成品/半成品、数字开头=框架/晶圆等原材料类；父级推导：码含数字→前 2 位（AM075→AM），全字母→自身（A、BCP），非 ASCII→自身；父名回分组表查（约 364 末级 / 322 字母分组）。
- **按维度报表 recipe（已验证）**：完工=PRD_INSTOCK；销售净额=SAL_OUTSTOCK+SAL_RETURNSTOCK（仅指此处存货核算 SQL 行金额的退货负数口径；WebAPI 退货单金额本次实测为正，须扣除，见 `../finance/company-profile-readonly.md`）；直接材料=PRD_PickMtrl/PRD_FeedMtrl/PRD_ReturnMtrl/SP_PickMtrl 按 `FPRODUCTID`；委外 SUB_PickMtrl 另列（其 FPRODUCTID 常挂数字分组半成品、不落成品行，须在对账差额里说明）。流程：只读 SQL 出 JSON → 三 Sheet（汇总/料号明细/口径说明；口径说明的勾稽数字从数据动态算，不手写常数；无 native Table/透视，autofilter+冻结可正常打开）→ 扁平放 `output/` → 回读验行列 + `bun run test:safety` + `git diff --check`，会话内贴 TOP N 关键汇总不只给路径。
- **口径待确认项要写明不硬断**：单位成本按基本单位（多为千只）注明；“入库金额含不含费用分摊”留财务确认——金额>直接领料只是线索不是结论。

## 9. 分配标准检查与 2026-10-12 证据

- 查询 `T_CB_ALLOCSTANDARDSET` 表头及 `T_CB_ALLOCSTANDARDSETENTRY` 成本中心条目，再用 `T_CB_COSTALLOCCRITERIA_L.FSTANDARDID`（中文 locale=2052）解读 `FALLSETSTANDARDID/FSTANDARDID`；分类设置查 `T_CB_CLASSALLOCSTDSET`。配置存在不证明实际金额已按其正确分摊，仍需追结果。
- 本次实时只读证据见 `scripts/scratch/2026-10/cost-status-1012.js` 及同名 JSON：当前金额结果为 2026-09，日期范围 9月1日至30日，`FACCTGID=100025`，66430 行；期间编号复用前重新查。
- 分配设置 154881/154882 的统一标准为 20174（完工入库数量），460646 为 20178（固定比例）；分类分配设置无行。上述是当日配置事实，尚未逐笔验证执行效果。
- 生产入库 8687 行，基本单位均 K，可沿物料分组得到 55 个分组结果；相同封装名称跨不同产品类别，不可无核对合并。生产领料/补料/退料及简单生产领料均有产品关联；委外领料亦有产品关联但不代表关联成品。
- 9月在产台账 24533 行，其中 2022 行期末在产为负；仅标异常待查，不据此猜测原因。核算日志成功不等于业务口径准确。

## 10. 设备备件与维修费归集到部门/成本中心路径（2026-10-31 实测）

账套将机台维修耗材与外修服务拆为两条业务路径归集部门成本（实时只读证据：`scripts/scratch/2026-10/probe-machine-repair-step3.json`、`probe-machine-repair-step4.json`、`probe-machine-repair-step5.json`、`probe-machine-repair-step6.json`、`probe-machine-repair-step8.json`、`probe-machine-repair-step9.json`）：

1. **存货类设备备件及委外维修配件（`FISINVENTORY='1'`，存货类别=`设备配件`，物料分组 `301*` 如 `30101` 委外维修配件、`30103` 固晶、`30104` 焊线、`30105` 模压、`30107` 冲切、`30108` 测试分选等）**：
   - **入库**：标准采购（`CG`）入 `设备配件仓`/`费用仓`，借记 `1410 设备配件`（无部门核算维度），采购订单与应付单上的部门仅为 `采购部`。
   - **领用归集部门**：车间通过**其他出库单**（`STK_MisDelivery` / `T_STK_MISDELIVERY`）领用，单据头必填领料部门 `FDEPTID`（如 `测试分选`、`模压部`、`固晶部`、`焊线部`、`工程部`、`品质部`）。
   - **总账凭证与成本结转**：其他出库单生成总账凭证时，贷记 `1410 设备配件`，借记 **`5001.06 生产成本-间接材料`**（非生产部门借记 `6602.03`/`5301.02.19` 等），并自动将 `STK_MisDelivery.FDEPTID` 写入凭证核算维度 `T_BD_FLEXITEMDETAILV.FFLEX5`（部门），月末由成本模块按部门/成本中心结转。
2. **非存货类外修服务与直接费用（`FISINVENTORY='0'`，存货类别=`维修费`，物料分组 `303` 设备维修费用、`40799` 维修费用、`407` 纯费用、`40101` 模具维修）**：
   - **费用采购与应付单**：走费用采购订单（`FBUSINESSTYPE='FYCG'`）→ 收料通知单 → 财务应付单（`AP_Payable`，`FSETACCOUNTTYPE='3'`）。单据明细行的费用项目 `FCOSTID` 填 `CI019 制造费用_维修费`（或 `CI001 制造费用`、`CI020 制造费用_配件费`），但**业务单据上的费用承担部门字段（`T_PUR_POORDERENTRY.FRECEIVEDEPTID`、`T_AP_PAYABLEENTRY.FFPRODEPARTMENTID`）全部为空（`NULL`）**，单据头采购部门统一为 `采购部`。
   - **总账凭证手工补部门**：应付单生成或手工录入总账凭证（借记 `5101.10 制造费用-维修费` 或 `5101.11 制造费用-配件费`）时，因 `5101.*` 科目强制启用了「部门」核算维度（`FFLEX5`），由财务人员根据物料名称/规格（如 `下模型腔条维修` 归 `模压部`/`测试分选`、`KS焊线机` 归 `焊线部`、`空压机/变压器保养` 归 `工程部`）在凭证分录上指定具体部门。
   - **费用引入成本中心**：成本模块的费用引入方案 `SCFYYRFA0002`（`T_CB_EXPENSEIMPSLUENTRY.FENTRYID=100003`）配置为 `FDATAFROMTYPE='4'`（总账凭证 `GL_VOUCHER`），月末通过**费用归集单**（`T_CB_EXPENSECOLLECTION`）按凭证上的部门维度（映射为 `CBZX*` 成本中心）将 `5101.*` 汇总引入各车间成本中心，再按完工入库数量（`20174`）等标准分摊至产品。
   - **管理盲区/限制**：`engineering`（`BM000044 工程部`）和 `BM000019 制造中心` 在 `5101.10 维修费` 和 `5001.06 间接材料` 中归集了较多公共设备维修及备件费，但 `SCFYYRFA0002` 的成本中心映射（`T_CB_EXPENSEIMPSLUCC`）仅包含 16 个基本生产车间成本中心，未包含 `工程部`/`制造中心`；且费用采购单据前端未填费用承担部门，完全依赖财务制证时人工判断。

### 2026-10-31 WebAPI回查补充：归集不等于产品分配完成

- 已验证表单 `CB_ExpenseCollection`，查询键 `FID,FBillNo,FYear,FPeriod,FCostCenterID.FName,FExpenseItemID.FName,FAmount,FSrcBillFormId`；View分录为 `ExpenseCollEntry`。2026年9月归集单 SCFYGJ000421（100424）从GL_VOUCHER归集制造费用：模压部279551.46元、测试分选505878.55元；这是合并制造费用，不能单凭金额证明其中每笔维修费已分配到产品。
- 9月记1057（GL_VOUCHER 276722）含贷5101.10、借5001.03的制造费用结转分录。测试分选维修费贷方27610.62元，模压部14108.86元。当前DocumentStatus=A，同时FPostDate非空（2026-10-15），属于状态需核实的组合；不能只看过账日期或存在结转分录就称已正常审核完成。
- 本次WebAPI未取得产品费用分配结果；CB_ExpenseAllocResult、CB_ExpenseAllocation、CB_CostCalExpenseDetail、CB_ExpenseAllocResultRec均报业务对象不存在，GetFormMetaData接口未返回可解析JSON。查询失败不等于未分配，不能因此断言没有产品成本。需取得正确分配结果表单或报表并核对期间、成本中心、费用项目、产品/工单、分配金额后再下最终结论。
- 证据：output/machine-repair-20261031/collection-100424.json、closing-voucher.json。全程WebAPI只读，无重新引入、分配或核算。

### 2026-11-02补查：9月维修费已参与成本对象费用分配

- 更新上一节未确认结论：WebAPI回查凭证与归集单后，以只读SQL验证实际历史分配结果。记348（273870）五条维修费分录由T_CB_EXPENSECOLLDETAIL.FSRCBILLID/FSRCENTRYID精确追到归集单100424分录808447（模压部，维修费13008.86元）及808448（测试分选，27610.62元）。
- T_CB_EXPALLORESULTSEND_H以FBILLID+FBILLENTRYID关联归集分录，发送1905408/1905409；两个制造费用池FAMOUNT=FALLOCATEDAMOUNT，分别279551.46元/505878.55元。以FSENDID+FOUTACCTGID关联T_CB_EXPALLORESULTREC_H，接收8193/8214行，金额各与费用池完全相等。FOUTACCTGID=100025由来源归集单2026年9月确认，不靠编号推期。
- 接收FPRODUCTDIMEID连接T_CB_PROORDERDIME，已核实落到PRD_MO生产订单/分录/产品；如测试分选MO260724068第1行接受制造费用239.37元。此金额是制造费用总额，不是单独维修费。维修费合并费用池分配，系统结果不再单列每个产品分得的维修费。
- 因此已证实这五笔维修费参与产品/工单成本对象分配；不以总账记1057的A状态否定成本模块已执行结果。总账凭证审核/过账状态与成本模块执行分开报告；不据此宣称最终完工存货或销售成本已逐笔结转。
- 证据：output/machine-repair-20261031/allocation-verified-20261102.json。所有SQL为SELECT，无修改生产数据。

### 2026-11-02实际分配权重验证

- T_CB_EXPALLOPROCESSREC_H由FSENDID关联上述发送记录；实际FSTDSETID=20174，中文名完工入库数量。模压部8193行权重合计486083.904、测试分选8214行合计488214.888，均等于FWEIGHTTOTAL，权重全部大于0。
- 测试分选MO260724068第1行权重231，505878.55×231÷488214.888四舍五入为239.37元，与分配结果一致。公式为部门费用池×该成本对象完工入库数量÷同部门参与对象数量合计，并处理分币尾差。
- 不能称历史所有做过的产品都分摊：范围为当期、对应成本中心、实际参与且有分配权重的成本对象；跨期老工单若本期存在完工数量亦可参与。不是按维修机台实际使用对象追踪，也不是所有产品平均分；工单成本对象数不等于不同产品型号数。
- 证据output/machine-repair-20261031/allocation-basis-20261102.json；单独维修费在合并费用池后不再单列各工单结果。


## 11. 成本不准整体筛查（2026-11-03，只读）

- 先用 WebAPI 验证真实业务可读，再以核算执行、存货核算业务日期和关账记录交叉确定期间。此次最新金额结果为2026年9月，不能把11月查询时间当作11月成本结果。
- 对每个来源表单统计有数量零金额行；零金额先追同物料入库、调拨及领料链，核实是否无偿来料/委外计价/漏价，不直接认定漏计。此次PRD_PickMtrl三条零金额：SOUT260904030第1行、SOUT260906037第20行、SOUT260930080第4行；最后一条物料N102012297的采购入库CGRK18722同为零金额。证据output/cost-diagnosis-20261103/details.json、source-check.json。
- 在产负数按成本中心及工单/行定位，先验算期初+投入-完工=期末；此次9月24533条中2022条负数（塑封1996、玻封26），当期等式差异为0。负数只是待查异常，不足以证明成本错误，需继续核对生产入库、投入来源、跨期和单位。
- 费用分配总额与分配依据分开检查：历史发送表按FSRCBIILLFORMID+FBILLID关联当期费用归集单；先验FAMOUNT与FALLOCATEDAMOUNT，再核实际过程表FSTDSETID。此次9月8654条发送记录3887872.21元全部分配；过程记录3346421.98元标准20174（完工入库数量），另541450.23元标准0（本次未解读，不能称其未分配）。分完不等于产品间分配合理。证据output/cost-diagnosis-20261103/details.json。


### 整体筛查补充：总经理仅反馈“不准”、无样本（2026-11-03）

- 不要求用户先定位错误；以最近完整期间筛查费用分配依据、同料号入库单价离散、负在产和零金额投入，再给出有单号的优先样本。只报候选异常，不将分配标准或价差直接当根因。
- 验证跨封装数量法时，应固定同一FSENDID费用池，避免多个费用项目重复权重。此次固晶池1905406（来源9月费用归集单）572203.43元，SOT-23/TO-252/PDFN5X6-8L单池费用约1.177元/K；这仅证明该池未按封装耗时差异分摊，合理性需生产工时/产能支持。证据output/cost-diagnosis-20261103/single-pool-packages.json。
- 同料号价差先比工单分录、数量、单位和跨期，再追成本构成；NBM0760144的51.153913至319.641944元/K来自不同订单分录，高价对应0.391K小批次，不直接认定错误。证据allocation-and-spread.json。
- 零金额采购入库先查FBUSINESSTYPE。此次CGRK18722为WW委外，不可直接按普通采购漏价处理；仍需拆委外材料及加工费。总体诊断与限制见output/cost-diagnosis-20261103/management-review.md。


### 分摊合理性判断：先验证工时是否可靠（2026-11-03）

- 固晶池1905406对应工单的工序计划，按计划头→SEQ→DETAIL→DETAIL_C查询共92577条工序明细，FPROCESSWORKTIME全部为0。仅指该关联范围，不宣称全库工时皆0。T_ENG_RESOURCECAPACITY、T_ENG_ROUTEPROC、T_ENG_ROUTECOSTRESINFO本次均0行；资源产能和两类路线工时路径均无可用记录，不推断其他外部系统不存在产能资料。
- 9月已审核且未作废的工序汇报60789条，机器工时非零条数0；固晶8297条人工/机器工时均0。52139条人工工时正数全部与开始结束时间的日历间隔吻合（分钟，误差<0.02分），52092条超过24小时、5740条超过30天。工时字段有数不等于可按其分摊；日历间隔不能直接当人员/设备实际占用工时。
- WebAPI独立回查SFC_OperationReport GXHB537203：OptRptEntry.ProcessStartTime=2024-10-06T16:14:50.673、ProcessEndTime=2026-09-09T11:26:41.887、OPTRPTHRWorkTime=1012031.854、TimeUnitID单位分、OPTRPTMACWorkTime=0。不能把这条当实际连续作业约703天的证据。
- 判断边界：当前数量法仅能证明按完工数量分配，无可靠工时/产能支持跨封装资源等价，不能认可为已验证的精确型号成本；也不足以证明某产品确定多计/少计多少。不得直接改用当前工时；先补测或核实标准产能/工时，按部门和费用性质离线对比，再决定调整范围。
- 证据output/cost-diagnosis-20261103/time-coverage.json、time-quality.json、time-quality-summary.json、report-time-webapi.json；SQL只读，WebAPI只读。


### 同型号价差实证修正（2026-11-03）

AP50H06NF的319.64与51.15元/K主要差异来自期初材料分配与完工数量，不能用这组价差证明数量法制造费用导致错误；两条制造费用约20.03/19.97元/K。本次已沿同MO第1/8行、相同BOM和路线，勾稽成本项目、领退料、报工和入库，发现待核实的高损耗/领料归属及测试数量增长；详见技能直接索引references/finance/cost-ap50h06nf-20261103.md及output/cost-diagnosis-20261103/production-data-checklist.md。

历史费用明细必须按FENTRYID关联头、头FID关联PROORDERINFO_H、FPRODUCTDIMEID关联PROORDERDIME，并同时限定FFORMID=PRD_MO；跨表单FID可能重复。选定快照后要用当期入库金额勾稽，避免期初快照与期末快照相加。SELECT别名须唯一，mssql遇重名FENDINITKEY会返回数组，筛选前核对输出类型，不能把数组当字符串导致静默漏行。


### 「成本结果是不是用了过期数据」三步排除法（2026-11-03 实测）

用户说“现在成本不准”时，先排除“结果按旧数据算”，再谈方法口径；三步都能用只读 SQL 快速证伪：

1. **锚定期末最后结果**：`T_CB_ACCTGINFO` 最大 `FYEAR/FPERIOD` 为关账期；`T_CB_ACCTGPERFORMANCE` 取 `FACCTGTYPE=3`（试算 1 不算）的最大 `FENDTIME` 即真实运算时点；`T_HS_OUTSTOCKACCTGDATA` 按 `FACCTGID` 的 `MIN/MAX(FACCTGSTARTDATE)` 必须与该时点一致。本次：9月，运算 2026-10-14T13:03:31，`FACCTGID=100025` 66452 行，业务日期全在 9/1–9/30 无跨月混入。
2. **查运算后是否还有本期单据被审核/作废**：审核列名是 `FAPPROVEDATE`（不是 `FAUDITDATE`），作废是 `FCANCELDATE`。逐表比对 `FDATE` 在本期、`FAPPROVEDATE > 运算时点` 的条数。本次 9月生产入库 1924 张、生产领料 4159 张、退料 74 张、应付 19562 张、其他出库 325 张全部为 0 条晚审晚作废，**说明 9 月结果所用数据在运算时已齐，不能用“后来补单”解释**。
3. **查本期订单晚审**：`T_PRD_MO` 9月 957 张中 45 张在运算后审核、其中 9 张在 9月关账（2026-10-26T14:25:11）之后审核（最晚 2026-10-30）。但其入库/领料单据均为 10 月日期，不改变 9 月金额；只作期间控制问题（关账后仍审核 9 月日期订单）单列，不当作成本差额来源。

补充口径：

- `T_HIS_OUTSTOCKACCTGDATA` 不保历史：本次按 `FBILLFROMID='PRD_INSTOCK'` 只查到 `FACCTGID=100025` 一个期间，**不能拿它做 8 月 vs 9 月同比**，跨期比较要走 `_H` 归档或成本历史结果快照。
- 9月完工入库 8687 行、数量 522766.814、金额 11389074.29，`FQTY>0 且 FAMOUNT=0`、负金额、零数量行均为 0，可直接排除“完工成本整行漏计”。仍不能由此说成本准确，只能缩小范围到分摊口径、跨期小批次和期初结转。
- 同料号跨行单价离散是全账套常态：9月 `PRD_INSTOCK` 同料号 2–3 倍价差普遍（如 NBM0130079 100N03A 135 行 32.71–100.66 元/K），样本 NBM0760144 RATIO 6.25 只是最极端的一条，不能单凭价差断错价。
- 证据脚本 `scripts/scratch/2026-11/cost-current-state.js`、`cost-late-docs.js`、`cost-late-mo.js`、`cost-inststock-zero.js`、`cost-month-compare.js`，JSON 同名同目录；全部只读。


### 外部UPH来源核实（2026-11-03）

- 用户指出UPH在<CLIENT_LAN_IP>共享服务器。已通过授权Windows共享只读检索，在15.制造中心临时文件夹/物控部下命中6份文件；不是金蝶产能表为空就代表企业没有产能资料。搜索范围和拒绝访问项见output/cost-diagnosis-20261103/uph-search.json；不宣称全服务器搜尽。
- 已读测试分选-财务员A/测试分选资料-财务员A/各工序机台数量 型号UPH.xlsx（修改时间2026-09-16，仅文件时间，不证明审批及适用期）。含固晶机台资料、焊线机台资料、焊线设备目标产能、模压测试UPH、测试机台资料等。固晶按机型、工艺、单/双/四芯细分；焊线按产品和线数细分。不能只按封装映射统一UPH，也不能用固晶UPH分配其他工序费用。
- 原件只读，本地副本及来源元数据见uph-sources/、uph-inspection.json。部分xlsx通过普通ZIP解析失败，但Excel只读可正常打开；仅使用正常应用读取，不改扩展名、不猜密码、不修改原件。
- 投入成本前核实单位（只/H还是K/H）、单机还是多机口径、有效版本、实际机型对应关系、目标日产能与UPH乘工时的差异，以及停机/换线时间。日产能目标存在取整或口径差异时不能直接当严格恒等式。

## 12. 新旧分配标准导致利润变化的核查（2026-11-07）

- 用户仅转述“财务说利润多了”，无需要求其先定位报表。先取该期总账完整凭证分录，按 `FEntity_FEntryID` 去重、剔除作废，核对收入、销售成本及本年利润结转；损益结转会清零损益科目，本期发生额与结转分录须分别统计。主营业务成本与销售出库净成本分别展示：本账套存在 `销售出库→1406发出商品→应收确认6401` 链路，不能将两者差额认作漏结转。
- 核实新旧标准、对应期间已审核系数、费用归集及实际发送/接收过程。归集金额相等、权重非零均不足以单独证明实际分配完整。总账制造费用可能含辅助部门二次分配；不可把总账部门金额当作原始费用池直接复算。
- 新标准只改变权重、其他条件相同时，费用在产品间重新分布；当期利润变化须追到库存商品、发出商品、在产及其他出库成本的增减。先查在产规则，若费用为“不留存，全部由完工产品负担”，不要直接将利润增长解释为制造费用留在在产品。
- 精确差额必须有重算前后同范围快照或可恢复的备份读数，包括收入/成本/期间费用、期初期末库存和发出商品，以及归集池和单据变化。当前系统已覆盖原结果时，明确缺少旧基线，不能按用户转述反推旧金额后声称已核实。
- 固定当前费用池及生产入库范围，以“数量”和“数量×系数”离线对照，只能标为**条件试算**；实际参与对象仍需过程表核实。不得用 `销量/本期产量`（含封顶比例）、`销售成本/入库金额` 推导精确销售成本变化，必须考虑期初库存加权、退货、组装拆卸、其他出入库和应收确认期间。
- **客户端分页防坑**：当前 `executeBillQuery(form,fields,filter,topRowCount)` 只有四参，传第五参 `startRow` 不生效。全量读取使用 `post('DynamicFormService.ExecuteBillQuery', {data:{FormId,FieldKeys,FilterString,OrderString,TopRowCount:0,StartRow,Limit}})`，每页 `raiseIfError`，按真实分录主键去重，并校验尾页；不可把错误响应解作空结果。View 返回属性名按真实 JSON 读取，`CB_STANDARDSET` 分录为 `FCOSTCENTERID/FSTANDARDID`，无 `F` 前缀的猜测会打印 undefined。
- **核对生产费用归集单（`CB_ExpenseCollection`）与总账 `5101 制造费用` 科目余额表差额（2026-11-07 实证）**：
  - 当重算后利润异常偏高时，必须核对当期 `CB_ExpenseCollection`（如 2026-08 的 `SCFYGJ000408`）中 `CI001 制造费用` 合计是否等于总账 `5101 制造费用` 借方发生额合计（以及 `记-1039` 结转进 `5001.03` 的总额）。
  - **2026-08 真实根因**：总账 `5101`（及 `记-1039` 结转至 `5001.03`）合计为 **`2,366,239.67` 元**，但生产费用归集单 `SCFYGJ000408` 中归集的 `CI001 制造费用` 仅为 **`1,937,747.79` 元**，**少归集了 `428,491.88` 元**！具体包括：
    1. 四大塑封车间（固晶部 `539,362.71` vs 总账 `634,063.16` 差 `94,700.45`、焊线部 `383,274.18` vs `477,974.63` 差 `94,700.45`、模压部 `281,407.70` vs `376,108.15` 差 `94,700.45`、测试分选 `508,819.59` vs `603,520.04` 差 `94,700.45`，每部门各差 **`94,700.45` 元**，合计 **`378,801.80` 元**——原单独拆出的制造费用行被删后未加回 `CI001 制造费用` 汇总行，扣除 `CBZX000001 塑封部` `3,329.87` 元后净差 `375,471.93` 元）；
    2. 5个辅助生产部门的 `5101 制造费用`（工程部 `25,384.61`、制造中心 `17,535.62`、品质部 `9,773.72`、物控部 `213.91`、仓库部 `112.09`，合计 **`53,019.95` 元**）未进入 `SCFYGJ000408`（两项合计恰好 `375,471.93 + 53,019.95 = 428,491.88` 元）。
  - **后果**：由于成本计算单（`PRD_INSTOCK`）按 `CB_ExpenseCollection` 分摊，少归集的 `428,491.88` 元制造费用未能分摊进入 8 月完工入库成本（留在了总账 `5001` 期末余额中），并顺着加权平均与当期出库/应收结转使 8 月账面主营业务成本少计、当期利润虚增约 16 万元。同理，2026-09 的 `SCFYGJ000421`（`CI001` = `1,950,450.67` 元）与总账 `5101`（`2,413,406.73` 元）也存在 **`462,956.06` 元** 的同类差额，重算 9 月前必须一并核对修正。
- **本次只读证据**：`output/aug-profit-review-20261107/live.json`、`summary.json`、`review.md`。2026-11-07 核得8月69,615条有效凭证分录，记1042结转本期利润5,052,313.22元，主营收入23,474,924.94元，主营成本15,632,004.74元；10部门当前归集的工资/制造费用池合计2,897,902.11元。当前金额只为有日期的调查证据，不作为以后期间默认值。
- **同日连接恢复后的续查（10:09起）**：经用户提供的 `<K3_ALT_HOST>:1433`，实查8月 `FOUTACCTGID=100024`：归集发送9,776条、3,756,400.13元，全部已分配；新标准过程72,776条、2,897,902.11元，0权重条数为0。记1042、1040、732、735、736均已审核且已过账。8月已于09:31结账，8月数据须读 `_H`，此时 `T_HS_OUTSTOCKACCTGDATA` 仍仅含10月数据，不能把它直接当本期8月结果。见 `db-third.json`、`db-fourth.json`。
- **固定实际参与对象的标准对照**：已验证公式为数量×系数时，可按每个真实 `FSENDID` 单独取过程行，将 `FWEIGHTQTY` 除以对应期间、部门、产品的已审核系数，归一化重分同一实际费用池；百分比公共比例在归一化时抵消。须验证系数唯一、全部大于0及分配总额守恒，注明过程权重/分币尾差影响。此次18池的离线条件复算显示TO-252约多分21.53万元、PDFN5X6多7.61万元、PDFN3X3多7.45万元，封装之间净转移约42.84万元；**不是利润增量，也不是重算前原结果**。实际销货还可能经组装拆卸换料号，原生产料号无直接销量不能认定全部结存。证据 `actual-allocation-comparison.json`、`db-current-quantify.json`。
- **旧基线与余额表防坑**：`T_GL_BALANCE_100087` 名称像备份，但本次含大额负发生额且本年利润行与当前相同，未验证其快照语义，不可当重算前余额。`T_GL_BALANCE` 的币别0汇总行与币别1等明细可重复本位币金额；按账簿、币别及核算维度区分汇总/明细，再与凭证交叉验证，不直接跨币别求和。已读取11月6日零点全备文件目录（仅 `RESTORE FILELISTONLY` 读元数据），用户明确**暂不恢复备份、只分析当前数据**，因此未创建核对库，16万元完整差额仍未验证。后续库存余额查询因新连接超时未完成，见 `review.md`。
