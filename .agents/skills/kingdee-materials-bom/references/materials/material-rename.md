# 物料改名/改规格（Save 最小字段）

## 禁用被未完成物料清单拦截（2026-10-13）

物料禁用前除库存、销售订单外，还须检查生产用料清单的子项引用。库存为零、无未关闭销售订单不等于允许禁用。实证：`N102012136 SPQ13RP30WP-L` 的 Forbid 返回“存在未完成的物料清单”；失败后 WebAPI 回查仍为 C/A，未禁用。只读 SQL 查到 33 张 `T_PRD_PPBOM` 引用该子项，关联 `MO260725032`，关联生产订单分录 `T_PRD_MOENTRY_A.FSTATUS=7`。接口未给出具体清单，不能将全部引用或状态7直接解释为未完成，也不能断言关闭该工单即可解除拦截。按 `T_PRD_PPBOMENTRY.FID=T_PRD_PPBOM.FID` 查子项，再用表头 `FMOENTRYID` 关联订单分录状态；先查元数据定位清单完成判据。禁用授权不包含关闭工单、修改清单或 SQL 绕过校验；失败后停止写入，保留原始错误与回查。证据：`scripts/scratch/2026-10/forbid-spq13-bluefilm.js`、`probe-spq13-block.js`。复用前重新查询。

## 截图名称纠正的取值边界（2026-10-10）

用户明确指出正确物料名称时，以用户给出的完整字符串为准，不因截图列标题自行改成另一列的产品编号。本次 `NBM0090078` 原名 `TPM20V9NS6`，用户明确纠正为 `TPM20V9NES6`（补 E），不得改为产品编号 `D44A-SOT23-6`。当前名称与状态仍须实时查询，精确查重后仅保存名称；最终列表与 View 双通道回查。历史编号不授予其他任务写权限。

## 可采购属性修改（2026-10-08 实证）

适用：用户明确要求指定料号「可以采购／允许采购」，只将 `BD_MATERIAL.FIsPurchase` 改为 `true`，不改变物料的 ERP 分类、存货类别或其他业务属性。历史案例不授予新的写入权限，复用前须实时查询。

案例范围：`NAT0270228`（`TKMMBTA06`），当次物料内码 `596890`、基本资料分录内码 `129649`。改前列表及 View 均为可采购否、已审核 `C`、启用 `A`；最终两路均为可采购是、已审核 `C`、启用 `A`。这些内码和状态仅为当次证据，不得用于其他物料或代替新查询。

已验证现象：第一次 Save 使用 `NeedUpDateFields: ["FIsPurchase"]` 与 `SubHeadEntity: { FIsPurchase: true }`，没有基本资料分录内码；反审核、保存、提交、审核均返回成功，但最终 View 和列表仍为 `false`。第二次同时改为 `NeedUpDateFields: []` 并补上 `SubHeadEntity.FEntryId` 后生效。**本案例未做单变量隔离，不能断言仅缺少分录内码、或仅更新清单就是根因。** 可以复用的是已验证的完整组合，不能仅依据 `IsSuccess` 宣告完成。

操作步骤：

1. 用精确编码查询 `FMATERIALID,FNumber,FName,FDocumentStatus,FForbidStatus,FIsPurchase`，再 View 取 `Id`、`MaterialBase[0].Id` 和 `MaterialBase[0].IsPurchase`，核对两路一致。已为 `true` 时无需写入。
2. 默认 dry-run 展示当前值和目标值；执行分支须显式 `--apply`。已审核物料按授权范围反审核，回查 `D` 后使用下列最小模型。其他状态须先判定恢复路径，不套用已审核流程。
3. Save 后立即 View 核对目标属性为 `true`，再 Submit → Audit 恢复 `C`；任何失败或属性未生效时停止，记录实际状态，不盲目重复整条流程。
4. 最终用 View 和独立列表查询确认 `IsPurchase/FIsPurchase=true`、原审核状态恢复、禁用状态未变；比对其他基本资料属性，避免扩大修改范围。

已验证保存组合（内码必须来自本次实时 View）：

```js
const data = {
  NeedUpDateFields: [],
  IsDeleteEntry: false,
  Model: {
    FMATERIALID: String(current.Id),
    SubHeadEntity: {
      FEntryId: current.MaterialBase[0].Id,
      FIsPurchase: true,
    },
  },
};
```

证据来源：2026-10-08 本次 WebAPI 操作输出及双通道回查；执行脚本 `scripts/scratch/2026-10/enable_material_purchase.js` 默认 dry-run。此次未隔离验证失败报文中的两个差异，不将推断升级为字段机制结论。

实证：2026-09-03 `N101041731/732 JYXS→JXW`、`NBM0760191` 规格截断，均成功。

步骤：按物料编码查询 `FMasterId` 作为唯一锚点，再 `View` 读取当前值；若 `C` 则 `UnAudit` → `Save {FMATERIALID: FMasterId, FName 或 FSpecification（仅改的字段）}` → `Submit` → `Audit` → 用同一锚点 `View` 核对 `Name/Specification` 与 `DocumentStatus=C`。`UnAudit` 后状态为 `D`（重新审核），`Save` 后仍是 `D`；此时直接 `Audit` 必被驳回（“请先提交后再审核”），必须先 `Submit`（`D→B`）再 `Audit`（`B→C`），不得跳过 `Submit`。`View` 的多语言 `Name`、`Specification` 是 `{Key: 2052, Value}` 数组，取中文项时用宽松比较 `String(x.Key)==="2052"` 后取 `Value`（`Key` 可能是数字也可能是字符串，严格 `===` 会间歇取到 `undefined`），取不到时回退到数组首项；不能把数组当字符串。最终回查必须双通道：`View` 核对 `DocumentStatus=C` 后，再用独立 `executeBillQuery FNumber='编码'` 确认 `FName/FSpecification` 已落地，不只信单次 `View` 解析。

注意：不要回传整个 View 模型；分组/类别/仓库字段不传就不变。改名后重码预检对象是新名（如 `JXW`），旧名不再存在。

实证（2026-09-04 封装批量 7 连改）：`NBM0750066 GMT078P03F3` PDFN3X3→PDFN3030、`NBM0750065 GN319B-R` PDFN3X3→PDFN3333、`NBM0760183 GN319A-R` PDFN5X6→PDFN5060、`NBM0750007 GMT200P03F` PDFN3X3→PDFN3030、`NBM0760066 SEM30GN45D5` PDFN5X6→PDFN5*6-8、`NBM0750005 SEM30GN45D3` PDFN3X3→PDFN3.3*3.3-8，均一次成功；`NBM0750008` 名称 `SEM30GH60D3 单芯`→`SEM30GN60D3` 去单芯纠错（规格未动）。

批量规则：先把截图/工单中的重复生产订单按最终物料编码去重；同一主数据只维护一次，再逐条回查。只改用户指定的封装段并保留其余文本逐字不变（含 `GSBJAH +客户周期码` 这类空格）；例如在首段封装后增加结构标识时，`PDFN5X6/5K盘/...` 变为 `PDFN5X6/Clip/5K盘/...`，不改丝印、型号或周期码。用户给的封装写法原样写入，不归一化（`PDFN5*6-8`、`PDFN3.3*3.3-8` 中的 `*`、`.`、`-8` 照抄）。

工艺后缀追加（如减薄）：先 `FSpecification like '%关键词%'` 查现行分隔与大小写，再按原规格 + 空格 + 后缀提案并经确认后写入——直接塞进括号或自创大小写会造出异形规格，后续查重对不上。

晶圆 `#T` 版本后缀是名称本体（如 `AK100SG45D6#T3`），改名时原样保留，不得截断或归一化——与 `指定丝印` 后缀截断规则相反。

执行前必须精确查重：改规格查 `FSpecification='新规格'` exact，改名查 `FName='新名'` exact，有即停。`NBM0750008` 想改 `SEM30GN60D3 单芯` 时已存在 `NBM0760129` 同名，停下让用户定；用户明确无后缀名后，无精确重名才执行。名称与规格分开授权：只让改名就不碰规格（本次规格里仍是 GH 旧型号，留待用户再定），不扩大范围。

改名目标已存在且同规格时按错号收敛，不改名：先并排 `View` 两个料号的名称、规格、分组、存货类别、ERP 分类、默认仓库，确认是同物重复（同组同仓同规格）而非同名异物；再五向查错号引用——`T_STK_INVENTORY` 库存、`T_ENG_BOMCHILD` 子项占用（子表以 `FBOMID` 关联 `T_ENG_BOM`，表头单号字段是 `FNUMBER`、没有 `FBILLNO`）、`T_ENG_BOM` 顶层占用、采购分录、销售分录（`T_SAL_ORDERENTRY` 按 `FMATERIALID` 命中后必须再读表头 `FDOCUMENTSTATUS/FCLOSESTATUS/FLEFTQTY`，未关闭订单的引用行会挡禁用）。结论口径：正确 N 料复用、错号禁用；错号被未关闭销售订单引用时，换订单行料号属于改客户订单，必须单独取得授权，不得随改名默认执行——用户选保持现状就停手不写。

新旧双轨遇同型号先定编码再改名：同一型号可能同时存在旧非N料（如 `NAS0130025 MURD1660CT`）与新N料（如 `NBS0130016 HD-MURD1660CT`），用户只说型号时必须先按编码澄清改哪一条，默认只改用户指定的那一条，不顺手把另一条一起改。

单/双芯后缀以同组姐妹料为模板：`TO-252 MURD__CT` 系为双芯共阴极，改名前先查同组已审核姐妹料（如 `NBS0130015 HD-MURD1040CT双芯`），新名照其后缀取 `HD-MURD1660CT双芯`；改名前后分别 `View` 核对名称与 `DocumentStatus`（`C→D→D→B→C`），编码与规格不动。

中断恢复：Save 成功后中断会落在状态 `B`（审核中，如本次 `NBM0750008`），续跑只补 `Audit`，不要重跑 `UnAudit/Save`；续跑前先只读查现状定位置。

注意：只改 `FSpecification` 不改分组，改完分组仍是 `BM075 PDFN3X3-8L`，会出现组名（3X3）与规格（3030）写法不一致，改前必须向用户点明。另改物料主数据不自动重写已审核 `SAL_SaleOrder` 分录的规格快照（如 `XSDD034852`），历史单据如需一致要单独处理。答复口径：能/不能 + 料号现状 + 重名检查 + 分组不一致影响 + 历史单据快照影响，确认后再一次只给一步手工动作。

## TO-252 代工成品（BQ013/BI013/BM013）改规格：客户生产流转单 → 规格四段映射

客户「生产流转单／产品规格表」的列与账套规格四段可直接对应：`产品型号`→名称（也是印字段的印字）、`封装形式`→第1段、`包装要求`（如「编带2.5K/盘」）→第2段`2.5K盘`、`印章内容`（如「30N10 / 2639」，2639 是客户周期码，只留占位）→第4段`型号+客户周期码`、无等级/分档时第3段写`无`。实例：`NBQ0130251 30N10 单芯` 由 `TO-252/2.5K盘/无/白板` 改为 `TO-252/2.5K盘/无/30N10+客户周期码`（2026-09-16，C→D→B→C 全链 + View/SQL 双回查，非目标字段逐项比对未变）。

把「白板」改成「印字」前必须点明：BQ013 里白板与印字通常是**两条料号**（如 `NBQ0130048/0049` 同型号一白板一印字），改完本条就不再有白板变体，客户日后仍要白板需另建；拿到用户确认再动。

改规格不重写单据：`T_SAL_ORDERENTRY` 无规格列，单据按物料内码取主数据，改完未关闭销售订单/生产订单会立刻显示新规格——把活动单据清单（单号、日期、订单状态、未关闭/未完工）一并报给用户。

## 名称追加厂码/结构后缀：改名，不新建

已建料号要补厂码（`LT`/`KQ`/`YH`）或结构/版本后缀时走改名流程，不新建料号：目标名 = **原名 + 后缀原样拼接**（默认不加空格，与用户新给的写法一致；用户要求带空格时才加），`Save` 只传 `FMATERIALID` + `FName`，规格/分组/类别/单位/仓库一律不传不动。执行前精确查 `FName='新名'` 占用并逐条守卫旧名未漂移，每条的 dry-run 先打印「现值 → 目标名 + 目标名占用行数 + 旧名守卫」三行；改完双通道回查名称与 `C` 状态，并逐项比对非目标字段（规格、分组、ERP、存货类别、单位、批号规则、双仓位、计划策略、税率）与改前一致。改名前顺手查一次引用面（`T_STK_INVENTORY`/`T_ENG_BOMCHILD`/`T_PRD_PPBOMENTRY`/`T_PRD_PICKMTRLDATA`/`T_PUR_POORDERENTRY`/`T_SAL_ORDERENTRY`），零引用才可安心批量。

## 物料名称纠错与成对晶圆/蓝膜改名（2026-11-03 实证）

适用：用户明确要求去掉/修改物料名称前缀或纠正名称，且存在成对晶圆/蓝膜（不带 `-L` 与带 `-L`）关系。
通用工具：`scripts/tools/update_material_name.js`，用法：
```bash
bun scripts/tools/update_material_name.js --number <物料编码> --name <目标名称> [--expect <旧名称>] [--apply]
```
机制：
1. 默认 dry-run，查当前主数据详情、验证旧值守卫（`--expect`）、精确查重目标名称（`FName = '新名称'`）；
2. 显式 `--apply` 执行：状态守卫（必须已审核 `C`） → 反审核（`C→D`） → 保存最小模型（`NeedUpDateFields: ["FName"], Model: { FMATERIALID, FName }`） → 提交（`D→B`） → 审核（`B→C`）；
3. 最终通过 `DynamicFormService.View` 与独立 `ExecuteBillQuery` 双通道回查验证名称落地、状态恢复 `C` 及禁用状态未变。

实证记录（2026-11-03）：
- 晶圆 `N102011525`（内码 `703700`）：原名 `PNAPMT12K0N03N8MB`，修改为 `APMT12K0N03N8MB`；
- 成对蓝膜 `N102011524`（内码 `703699`）：原名 `PNAPMT12K0N03N8MB-L`，同步修改为 `APMT12K0N03N8MB-L`；
- 规格均为 `1.851*1.291` 保持不动，双通道回查均成功，状态已恢复 `C`。

