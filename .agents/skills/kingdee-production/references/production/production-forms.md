# 生产相关表单（本账套 K3）

## 目录

- FormId 速查
- 仓别与实物流（已核实，勿说反）
- 生产领料 `PRD_PickMtrl`
- 直接调拨 `STK_TransferDirect`
- PPBOM / MRP
- 用料清单与领退对账（单张 PPBOM vs 全 MO 口径）
- 回复用户时


仓库权威列表：`.agents/skills/kingdee-k3cloud/references/system/k3cloud-form-ids.md`、`.agents/skills/kingdee-k3cloud/references/system/k3cloud-fields-reference.md`。
本页补会话里验证过的 **领料 / 调拨 / 仓别 / MRP 现状**。

## FormId 速查

| FormId | 中文 | 备注 |
|--------|------|------|
| `PRD_MO` | 生产订单 | 单号如 `MO260709029` |
| `PRD_PPBOM` | 生产用料清单 | 应发/已领；关联字段常 `FMOBillNo` |
| `PRD_PickMtrl` | 生产领料单 | 单号常 `SOUT…`；关联 MO 字段 `FMoBillNo` |
| `PRD_ReturnMtrl` | 生产退料单 | |
| `PRD_INSTOCK` | 生产入库单 | |
| `STK_TransferDirect` | 直接调拨单 | 单号常 `ZJDB…`；**备货移库**，不是生产发料 |
| `STK_MisDelivery` | 其他出库单 | |
| `PLN_PLANORDER` | 计划订单 | 本账套常为 **0** → 未跑 MRP |
| `SFC_OperationPlanning` | 工序计划 | |
| `SFC_OperationReport` | 工序汇报 | 分录 Save 键名 `FEntity` |

历史探测脚本：`scripts/bun_test/check_pick*.js`、`probe_pickmtrl*.js`。  
scratch 示例：`scripts/scratch/2026-08/_probe_pickmtrl_today.js`。

## 仓别与实物流（已核实，勿说反）

| 编码 | 角色（本账套常见） |
|------|------------------|
| `CTK01` | 原材料仓 |
| `CTK08` | 现场仓（生产领料几乎全从此出） |
| `CTK19` | 外贸仓 (853636) — 待取消，调拨目标 CK13，见 `warehouse-transfer.md` |
| `CTK13` | CK成品仓 (111219) |
| `CTK10` | 塑封成品仓 (111217) |
| `CTK12` | 玻封成品仓 (111218) |

```
CTK01  ──STK_TransferDirect──→  CTK08  ──PRD_PickMtrl(+MO)──→  工单消耗
         （调拨=搬家/备货）              （领料=真正发料）
```

**硬事实（会话抽样）**：

- 当日 `PRD_PickMtrl` 分录出库仓可全为 `CTK08`，且 `FMoBillNo` 无空
- 黑胶等：先有 `ZJDB…` `CTK01→CTK08`，再有 `SOUT…` 从 CTK08 按 MO 领
- 因此 **不能** 把现状概括成「调拨代替生产领料」；用户会明确纠正

解释管理反馈「卡住调拨 / 从 MRP 领料」时的准确说法：

| 说法 | 是否符合现状 |
|------|----------------|
| 你们没走生产领料 | ❌ 假 |
| 调拨后还走生产领料挂 MO | ✅ 真 |
| 已全面启用 MRP 运算驱动备料 | ❌ 假（计划订单空） |
| 对方可能想改：少调拨 / 原料仓直领 / 严控调入量 / 未来上 MRP | ✅ 需问清 |

## 生产领料 `PRD_PickMtrl`

### 流程单张数卡控：业务源单关联（2026-10-09）

- 实时 WebAPI `View` 样本 `SOUT261007001`（FID 263851）明细确认：`SRCBIZBILLTYPE_Id=SFC_OperationPlanning`、`SRCBIZBILLNO=TX0907829`、`SRCBIZINTERID=251674`；这些是 View 动态属性名，BOS 字段键与插件加载字段仍须查元数据，不得直接猜写。
- 限制一张领料单关联的流程单张数，应按工序计划业务源单内码去重；同一流程单多材料、多工序分录不重复计数。不得按材料行数、生产订单号或 PPBOM 子项分录数替代。
- 已实现（2026-10-09）：生产领料单 Save 服务插件注册 Python `FlowBillLimitValidator`，`OnPreparePropertys` 加载 `FSRCBIZBILLTYPE/FSRCBIZINTERID`，表头校验器读取 `Entity`，只对 `SRCBIZBILLTYPE.Id=SFC_OperationPlanning` 的 `SRCBIZINTERID` 去重，超过20张报错。BOS 用户截图确认字段标识及动态属性；缺内码报错。提交/审核未另行挂载，历史已审单适用范围及其他绕过路径尚未验证。
- 实时只读查询确认扩展 `8bc15357-a2c6-403c-a8ac-095aa97b60e1` 中已存脚本。用户通过工序领料入口生成后，在新增生产领料单保存时截图验证“本张生产领料单关联了21张流程单，最多允许20张，请分批领料。”，错误ID `7100F78AC3017335693BCAB2F5C602A0`。这证明21张保存拦截已执行，不代表20张边界或全部调用路径已测试。
- 对照 `SOUT261009075`（FID 264123）实时 View：24行材料来自 `TX1001460–TX1001465` 六张流程单，各4行，因此允许保存符合去重规则；当时状态D。不能以24行未拦截判定插件失效。
- 实际入口为工序计划列表→工序领料→工序领料平台→生成领料单，平台插件 `OperationPickMtrlWork`，空操作代码 `GenPickMtrl`。平台明细 `FPickMatEntity/PickMatEntity`，流程单内码 `FPmOptPlanID/PmOptPlanID`，勾选 `FIsSelectPickMat/IsSelectPickMat`；这些平台字段不得搬进生产领料单保存脚本。入口计数不能替代每张生成结果的计数。
- BOS树显示不能单独判定是否已有扩展；用户确认已有扩展时沿用，橙色只读提示用于核实是否签出。元数据检测发现工具栏标识重复和Audit转换状态空，不应自动修复或归因于本次脚本；保存和签入成功也不能替代实际业务拦截验证。
- 验收至少覆盖20张通过、21张拒绝、同流程单多材料仍算1张，以及批量生成和接口保存路径。自动拆单属于额外行为，需要保留原分组条件和完整来源关联。

### 常用 FieldKeys（分录级）

2026-10-09 当前页误全选保护实际验收：用户截图显示“已选中当前页全部工序，合计选中1500行……本次操作已阻止”，并明确反馈取消一行后1499行可以进入。证实平台表单 PreOpenForm + ParentView.CurrentPageRowsInfo + FSubEntity/optIds 集合包含判断在此列表入口有效，符合整页全选且至少1000行的用户约定。正式候选脚本见 `scripts/tools/operation_pick_page_guard.py`。真实1000行整页边界、少于1000行整页、跨页选中及其他入口尚未实测；1499放行是规则允许的部分选中，不应表述为全面阻止大批领料。服务器原DLL未改；不得把本地安全测试当业务验收。

2026-10-09 当前页计数纠正：用户底栏截图为第1页/每页1500/当前选中34，排除把 GetData 返回25当界面全部工序行的做法。服务器 Core DLL `IListView` 确认有 `CurrentPageRowsInfo`，与 SelectedRowsInfo 同为 ListSelectedRowCollection。候选脚本 `scripts/tools/operation_pick_page_guard.py` 在目标平台 PreOpenForm 中，少于1000直接放行；达到1000后，取父页 CurrentPageRowsInfo 的 FieldValues.FSubEntity 工序内码集合，检查是否为 optIds 集合子集；整页覆盖才取消，父页/工序内码缺失则报技术错误并取消。9项本地模拟覆盖999/1000边界、1500整页、部分选中、同数量不同内码、跨页部分、父页缺失和其他表单；这些不代替 IronPython/真实当前页接口运行验证。CurrentPageRowsInfo 实际数量与集合尚待用户测试。

2026-10-09 父页探针实测：用户截图 PreOpenForm 显示 optIds.Count=34，e.ParentView.Model.GetData(StartRow,Limit,false).Count=25，证明本入口实际提供 ParentView，但该 GetData 计数不可直接断定为界面当前页全部工序行数。须核实 Limit/StartRow、模型类型、数据字段及分页/跨页选择口径，再按工序内码集合比较；不能用 selected_count>=page_count 判整页，也不能因 ParentView 读成功就宣布规则完成。

2026-10-09 用户改到平台表单插件后截图验证 PreOpenForm 已触发，CancelMessage 显示“传入工序行数：12。本次暂时禁止打开领料平台。”，背景仍为工序计划列表。这是目标事件与 optIds.Count 的实际验证，临时脚本无条件取消平台打开；不得当作正式1000行/整页规则完成。下一步须验证 ParentView 或其他父页访问方式，获得当前页工序集合后才能判定整页，单凭选中数不能替代。

2026-10-09 用户反馈平台 PreOpenForm 脚本仍无提示后，实时元数据定位注册位置错误：`工序领料打开前验证` 的 PreOpenForm 源码实际上存于工序计划扩展 `b6654973-2e98-4dbd-a33d-623f0b693614` 的 `ListPlugins`；目标 `SFC_OperationPickMtrlWork` 查询仅返回标准对象，未发现直接扩展及该脚本。此轮失败不能当作目标平台 PreOpenForm 不支持的证据。指导切换注册位置后必须立即按目标 FormId 复查 FormPlugins，而不是只检查脚本名与保存成功；用用户截图明确指出动态表单工序领料平台与单据工序计划列表的区别。

2026-10-09 平台与框架打开前补证（仅本地 DLL 副本反编译）：`OperationPickMtrlWork.OnInitialize` 调 `InitCustomParameters`；`BeforeBindData` 取 `OpenParameter.GetCustomParameter("optIds")`，转 `List<long>` 后调用 `LoadByBizBill`。服务器 `Kingdee.BOS.Core.dll` 的 `PreOpenFormEventArgs` 确认有 `Cancel`、`CancelMessage`、`OpenParameter`、`ParentView`；`Kingdee.BOS.Business.DynamicForm.dll` 的打开流程先创建目标 FormPlugins、逐个 `PreOpenForm(e)`，之后检查 `e.Cancel` 返回错误并停止打开。该已读分支使用双参数构造，`ParentView` 不保证存在；不能仅用 optIds.Count 实现“整页全选”口径。目标平台表单插件的 PreOpenForm 是可验证取消的候选，非工序计划列表菜单事件；目前尚无实际注册与运行验证。

2026-10-09 服务器只读反编译补证：通过 SSH `administrator@<K3_INTRA_HOST>` 连接成功，从 `D:/Program Files (x86)/Kingdee/K3Cloud/WebSite/Bin/Kingdee.K3.MFG.SFC.Business.PlugIn.dll` 复制本地副本（1870384字节），使用本地 ILSpyCmd 9.1.0.7988 查看 `Bill.OperationPlanningList`。`BarItemClick` 的 `tbOptPickMtrl` 分支直接调用私有 `CallOperationPickMtrlWork()`，该分支未检查 `e.Cancel`。此方法从 `SelectedRowsInfo[].FieldValues["FSubEntity"]` 取工序内码，构造 `SFC_OperationPickMtrlWork` ShowForm 参数并以 `CustomComplexParams["optIds"]` 传递集合。因此菜单实际仍用 BarItemClick，不能根据自定义脚本没有提示断言此菜单不走该事件；自定义插件未提示的调度原因尚未定位。用户反馈 BeforeMenuClick 筛选诊断也未提示，已表示取消该插件，实时停用状态未复查。平台入口使用 optIds 或打开前事件是下一步候选，整页识别与取消行为均未验证，不写为已实现。服务器 DLL 未修改。

2026-10-09 工序计划列表误全选保护仍未完成：用户约定仅拦截“整页全选且选中至少1000工序行”，不能替换为20张或单纯1000行限制。扩展 `b6654973-2e98-4dbd-a33d-623f0b693614` 实时元数据已存列表 Python 脚本，但 `BarItemClick` 筛选 `tbOptPickMtrl` 未出现提示，1500行仍打开平台；移除筛选后搜索 `btnSearch` 出现提示，而用户点击工序领料仍进入平台。这证实脚本已加载，不能继续归因于未重开列表；也不能据此确定标准插件执行顺序。全工具栏取消的诊断影响搜索，须及时替换。官方 SDK 有 `BeforeMenuClick(MenuArgs)`，其文档列出小写 `key`，未列出取消属性；须先验证该入口事件及实际参数，不能猜 `Cancel` 可用或声称保护已经生效。SDK：<https://open.kingdee.com/k3cloud/SDK/Kingdee.BOS.Core~Kingdee.BOS.Core.List.PlugIn.AbstractListPlugIn~BeforeMenuClick.html>。

2026-10-09 已删除大批领料追踪：截图2026-10-07固晶一部对应 `SOUT261007071`（FID263931）。`T_BAS_OPERATELOGBK` 日志：18:37:23列表当前页1500行；18:37:32工序领料打开平台共选1500行；18:38:08生成开始选3145行材料；18:38:36新增领料单；18:39:00保存/提交成功；18:39:27审核成功。现日志2026-10-09 13:54:14反审核、13:55:48删除成功。截图2495材料序号与入口1500工序行、平台3145材料行是不同口径；删后明细无法直接逐行复核，不能推断3145→2495差额原因。日志证明通过工序领料平台批量生成；其中是否包含MO自定义工序号为空须按源单关联另查。日期参数使用字符串在SQL中显式CONVERT(datetime,@s,126)，输出用CONVERT(varchar,FDATETIME,121)保留数据库本地时间，避免JS Date时区偏移误查窗口。

2026-10-09 用户取消按20张硬限的业务方案：正常批次可能超过20张，不能继续作为当前推荐规则。此前21张拦截仍是历史验证事实；是否已停用须实时查配置。用户改问未拆单领料，并说明判断口径是生产订单“工序计划号”空。实时反例：`SOUT261009060`（FID264106，C）存在来源 `TX1000581`，关联 `MO260907030` 第1行（MO FID125305、分录267402、Qty2.9），该行 `F_gongxuhao` 空且 `SrcSplitEntryId=0`；实际工序计划 TX（已审核，2026-10-06创建）关联同一分录。必须区分 MO 自定义号空与真实 SFC 单据不存在；缺失拆单记录不应直接定性为业务错误，需查拆单功能是否回写此字段。2026-10-07起现存领料查询3170行，`FSRCBIZBILLNO` 空0行；被删除2495行单据未在此范围证明原因。

```
FID,FBillNo,FDocumentStatus,FDate,FMoBillNo,
FMaterialId.FNumber,FMaterialId.FName,
FAppQty,FActualQty,FStockId.FNumber,FStockId.FName,FUnitID.FName
```

| 字段 | 含义 |
|------|------|
| `FAppQty` | 申请数量 |
| `FActualQty` | 实发数量 |
| `FMoBillNo` | 生产订单号 |
| `FStockId.*` | 仓库（本账套领料常见 `CTK08`） |

### 今日领料（务必带日期 + 排序）

`executeBillQuery` 无 `OrderString` 时容易拿到 **2024 最旧单**。用 `post`：

```js
import { K3CloudWebAPI } from "./k3cloud.js"; // 或 lib/k3

const c = new K3CloudWebAPI();
await c.login();

const data = await c.post("DynamicFormService.ExecuteBillQuery", {
  data: {
    FormId: "PRD_PickMtrl",
    FieldKeys:
      "FID,FBillNo,FDocumentStatus,FDate,FMoBillNo,FMaterialId.FNumber,FMaterialId.FName,FAppQty,FActualQty,FStockId.FNumber,FUnitID.FName",
    FilterString: "FDate>='YYYY-MM-DD' and FDate<'YYYY-MM-DD+1'",
    OrderString: "FDate DESC,FBillNo DESC",
    TopRowCount: 2000,
    StartRow: 0,
    Limit: 2000,
  },
});
c.raiseIfError(data);
const rows = Array.isArray(data) ? data : data?.Result?.Rows ?? [];
// 单据数：按 FBillNo(index 1) 去重；分录数：rows.length
```

按 MO：

```text
FMoBillNo='MO260709029'
```

按物料前缀（如黑胶）：

```text
FMaterialId.FNumber like 'N103%' and FDate>='YYYY-MM-DD'
```

未审/草稿（示例）：

```text
FDocumentStatus in ('A','B','D','Z') and FDate>='YYYY-MM-01'
```

### 汇总口径

- **单据数**：`Set(FBillNo)`
- **涉及 MO**：`Set(FMoBillNo)`
- **按物料 TOP**：按 `FMaterialId.FNumber` 累加 `FActualQty`（单位不同要分组）
- 本账套常见：申请≈实发、出库仓 `CTK08`、当日单多为已审 `C`

### viewBill 分录

```js
const det = await c.viewBill("PRD_PickMtrl", fid);
const tree = det.Entity || det.TreeEntity || det.FEntity || [];
// 分录上 MO / 数量键名可能是 MoBillNo、AppQty、ActualQty、MaterialId.Number
```

## 直接调拨 `STK_TransferDirect`

### 常用 FieldKeys

```
FBillNo,FDate,FDocumentStatus,
FMaterialId.FNumber,FMaterialId.FName,FQty,
FSrcStockId.FNumber,FDestStockId.FNumber
```

今日调入现场仓：

```text
FDate>='YYYY-MM-DD' and FDate<'YYYY-MM-DD+1' and FDestStockId.FNumber='CTK08'
```

**对照领料时**：同一物料「调入 CTK08 数量」与「当日 PickMtrl 从 CTK08 实发」常不等（现场会留库存）；不要把调拨 qty 当成已发给工单。

**调拨超发（账面>实物）后果**：入库多记（账面100/实物80）后调拨90，账面够、实物不够。`T_BD_STOCK.FAllowMinusQty=0` 时 `STK_TransferDirect` 审核报 `库存不足` 卡在 B；`=1` 时通过但源仓 `CTK01` 变负库存（`FBaseQty<0`），`CTK08` 虚增，后续 `PRD_PickMtrl` 跟着错。本账套 `CTK08` 自 2026-07-08 已设 `0`（案例 `ZJDB2026070128` -518.4K），其余仓 `CTK11/13/14` 仍为 1。验证：2026-08-31 当天 23 单 66 分录全 `CTK01→CTK08`（21C/2B），即此链路的日常例证。修复按 `.agents/skills/kingdee-sales-inventory/references/inventory-sales/negative-stock-sop.md` 改原单或盘亏，严禁凭空盘盈。

## PPBOM / MRP

- 应发 vs 实发：`PRD_PPBOM` 的 `FMustQty` / `FPickedQty`（以 `../kingdee-k3cloud/references/system/k3cloud-fields-reference.md` 为准）；按 `FMOBillNo` 与领料 `FMoBillNo` 比对
- **MRP**：`PLN_PLANORDER` 为空只证明当前无计划订单，不能单独证明从未运算或未配置审批；审批须独立查流程配置与定义。勿仅凭空表声称已用或未用 MRP。
- 无 MRP 时的正规数量依据 = **MO + BOM/PPBOM**，不是调拨单

## 用料清单与领退对账（单张 PPBOM vs 全 MO 口径）

### 混合订单领料单：只删除目标订单分录（2026-10-10）

- 按 MO 查询只返回匹配分录，不代表整单仅属于该 MO。必须实时 View 全部 `Entity`，按 `MoBillNo` 定位目标，检查其他订单行；汇报对应 `OptRptEntry[].MoNumber`，同样不能直接整单 Delete。
- 用户明确授权反审核、删除目标行、重新审核时：保存整单快照 → 实时状态/明细前值守卫 → UnAudit → View 验 D → Save `{FID,FEntity:[{FEntryID:保留行内码},...]}`，`IsDeleteEntry=true`、`NeedUpDateFields=[]` → View 验目标行消失、保留行内码及业务字段一致 → Submit → Audit → View + 列表验 C。失败先回查已完成阶段，不重跑整批、不扩散其他单据。
- 反审核后 `StockFlag` 从 true 变 false 是本次已验证的阶段变化，保存后比较暂排除该字段和自动重排的 `Seq`；审核后须把 `StockFlag` 纳回比较，除 `Seq` 外所有保留行字段应一致。不能把阶段标记变化误判成其他订单业务内容被改，也不能因此跳过审核后完整比较。
- 实测 `MO260928017` 的 `SOUT261006032`：200行中删除目标8行，恢复 C 后保留192行除 Seq 外全部字段与快照一致。工具和证据：`scripts/scratch/2026-10/remove_mo260928017_rows.js`、`output/mo260928017-row-removal/1791602322215/`。
- 同次后续完成 `SOUT261009060/063/111`：分别删14/7/3行、保留508/47/6行，均恢复 C，保留行除 Seq 外全部字段一致。后续证据 `output/mo260928017-row-removal/1791602393315/`；合计删除32行领料。
- 删除汇报前按 MO 查 `SFC_OPERATIONTRANSFER` 并 View 核对转出/转入计划、工序、数量。此次发现7张 C 转移，从固晶10转到焊线20，合计137.6K；汇报部分未写入。不得为删汇报擅自扩大范围反审核或删除这些下游单据，先报告具体关联并取得该范围授权。
- 2026-10-10 后续：用户明确授权删除上述7张转移。重新查全部7张、限定已授权 FID、同 MO/同计划10→20、无结算/入库/检验选单数量和集中发出/接收关联，逐张 UnAudit 验 D → Delete → 列表验不存在；之后7张混合汇报仅删本 MO 各1行，保留其他订单共54行，Save 使用全部保留 `FEntryID` 的最小 `FEntity` 模型，无需重填数量或基础资料。重新审核后所有保留行除 Seq 外全部字段一致、7张均 C。最终目标 MO 的领料/汇报/转移查询均为空，8张计划全部工序 ReportQty/QualifiedQty/TransInQty/TransOutQty 为0。证据 `output/mo260928017-row-removal/1791602745350/`，执行入口 `--reports-and-transfers --apply`。这是已完成的历史案例，复用须实时核对且重新取得具体下游范围授权。

- 先定口径再比数：一张 `PRD_PPBOM` 只对应 MO 的一个分录行（`MOEntrySeq`），一个 MO 可有多张 PPBOM，一张 `SOUT` 可有多分录行分别挂不同 `PPBomBillNo` —— 拿单张 PPBOM 的已领/实领去比全 MO 的领退合计数必然对不上。
- 对账顺序：`viewBill("PRD_PickMtrl", fid)` 按分录读 `MoBillNo + PPBomBillNo + ActualQty` 定归属 → `PRD_PickMtrl` 按 `FMoBillNo + FMaterialId` 分单汇总 → `PRD_ReturnMtrl` 同口径汇总（数量字段是 `FQty`，不是 `FActualQty`）→ 净领 = 领 - 退 → 再回到单张 PPBOM 的 `PPBomEntry` 看 `MustQty / PickedQty / GoodReturnQty`（净领 = Picked - GoodReturn）。
- `PRD_PPBOM` 的 `executeBillQuery` 行里 `FMaterialId` 是父项成品，不是子项物料 —— 子项数量必须 `viewBill` 读 `PPBomEntry[]`（`MaterialID.Number / MustQty / PickedQty / GoodReturnQty / ConsumeQty / WipQty`），`executeBillQuery` 头字段注意大小写是 `FMOBillNo`。
- **改 PPBOM 子项物料的 Save 键是 `FMaterialID2`**（元数据名「子项物料编码」；`FMaterialId`/`FMaterialID` 会被静默忽略，Save 返回成功但值不变）。名称/规格是属性字段 `FMaterialName1`/`FMaterialModel1`。验证方法：查 `T_META_OBJECTTYPE.FKERNELXML WHERE FID='PRD_PPBOM'`（该表无 FNUMBER 列，FID 直接存 FormId 字符串，名称走 `_L` 表）。
- **PPBOM 货主改客户（返工/客供场景）实测写法**：表头 `FParentOwnerTypeId:"BD_Customer"` + `FParentOwnerId:{FNumber:客户编码}`，分录 `FOwnerTypeId`+`FOwnerId` 同值；NeedUpDateFields 全部显式列出。链路 `unAudit → Save → Submit → Audit → View 回查`，C 状态直接可反审（无领料时）。改子项物料后仓库会自动带出该物料默认仓，如需指定仓要在同一 Save 里加 `FStockID:{FNumber}`。案例 FG260730003（9张返工PPBOM 子项改 NCE0050001 + 货主 CTK000290 + 仓 CTK08，2026-09-08 全量验证）。
- Excel 领退成对求和为 0 时，先查是否漏了最新一张 `SOUT` 整单 —— 退料单退的通常是此前的老领料，新领单未被圈进筛选就会造成“用料清单有实领、报表没领”的假象。

## 回复用户时

### 返工领料的货主维度核对（2026-10-13）

- 领料有应发量但无法完成时，除仓库、批号外，必须比较用料清单、领料单与即时库存的货主编码；相似客户名称不能当成同一货主。
- 实时案例 TX1002714 / FG261013001：PPBOM00175526 子项 NC00000010 应发5K、已领0，货主 CTK000103；查询期间生成 SOUT261013063（B），现场仓 CTK08、批号1、实领5K、货主仍为 CTK000103。即时库存同料同仓同批的5K属于 CTK000947，而 CTK000103 数量为0。两个客户名分别为“客户S”和“客户S1”。这是库存维度不匹配的证据；未取得前端审核错误原文，不把它表述为已验证的唯一审核失败原因。
- 查询期间单据可能由业务人员更新，结论前重新查领料单，并用 View 核对业务源单与货主；首次查无不能当成最终无单。货主变更须确认实际物料所有权，不自动替换或迁移库存。

1. 直接给：**日期范围、单据数、分录数、状态分布、出库仓、是否挂 MO、物料 TOP、样例 SOUT/MO/ZJDB**
2. 涉及「调拨 vs 领料」争议 → **先查两侧单据再下结论**，默认相信「调拨后仍领料」除非数据反证
3. 问清是否要：某 MO 明细 / 某物料 / PPBOM 差异 / 调拨与领料对账 / 导出 Excel
4. 不要先展开「新脚本推荐写法」 unless 用户要写代码

### 返工货主调整回查补证（2026-10-28）

- `PRD_PPBOM` 保存子项仍用 `FEntity`，但 `NeedUpDateFields` 中使用裸字段 `FOwnerTypeId`、`FOwnerId`；本次使用 `FEntity.FOwnerTypeId/FEntity.FOwnerId` 时 Save 返回成功，实际仅表头货主改变、子项未改变。必须在提交前 View 同时核对表头与子项，不能只看 Save 成功。
- 本次 MO260929018、MO261009006/007/008 对应 PPBOM00172491、PPBOM00174061/062/063，经用户授权，将表头和唯一子项货主由组织100改为客户CTK000400；全部恢复C，子项内码、物料、应发/已领/消耗、仓库/仓位和批号未变。现场仓 NC00000006 库存335.172K、四单应发296.174K是当时快照，复用前重查。未生成领料单，也未验证前端领料平台刷新结果。
- 首张保存后回查不符即停止后续；查明仅表头已改、子项仍为原值、状态D后，按精确前值恢复执行，禁止直接从头盲重跑。证据 `output/rework-owner-20261028/1793158024373/`，脚本 `scripts/scratch/2026-10/fix_rework_owner_20261028.js` 默认dry-run。

### LL-41 客供加工货主来源追查（2026-10-28）

- 原四单来源：MO260929018←XSDD036245第1行；MO261009006/007/008←XSDD036410第1/2/3行。销售客户均CTK000400，但销售分录成品货主为组织100；生产订单表头及入库货主同为组织100、Trustteed=false，单据类型为工序汇报入库-普通生产。销售客户不等于成品货主，不能仅据此判定销售货主错误或直接改成客户。
- 实时转换规则 `PRD_SALEORDER2MO` 映射销售分录 FOwnerTypeId/FOwnerId→生产表头与入库货主；启用扩展 `88af8564-9c86-4698-b853-85dcd78f3745` 另映射 FCustId→FDCustId。客户字段已传入，不等于客户作为子项货主传入。
- 共用 BOM `NC00000007_V1.0`（684221）子项175456为NC00000006、1:1，OWNERTYPEID=BD_OwnerOrg、OWNERID为空、供应组织100。这与原PPBOM子项组织100一致，是需检查的子项货主配置；此前“不是BOM问题”只适用于物料与数量，不可排除货主配置。尚未通过新建/下推实验或标准插件代码证明生成器具体优先级；只读追查不自动授权更改BOM或转换规则，更不能全局把所有材料货主设客户。
- 同型号筛查发现 MO261021005/006/007（来源XSDD036912、客户CTK000400），PPBOM00178167/168/169子项仍组织100，应发50.592/94.860/50.592K，已领均0；仅报告未修改。历史同型号也存在子项客户货主且已领的对照，不能把全部旧单都认定为新错误或批改。状态和数量为当日快照，操作前再查。
- 用户在原四单货主调整后明确反馈“可以领了”，构成本次前端成功验证；不代表新三单或后续建单规则已修复。原四单中MO261009006实时已领126.480K，其他三单查询时仍0，是业务人员并发操作的快照。
- 证据：`output/rework-origin-20261028/` 的销售/生产/BOM View、同型号查询和转换元数据XML；探针 `scripts/scratch/2026-10/probe_rework_origin*.js`、`probe_rework_conversion.js`。业务查询通过WebAPI，元数据仅SQL只读。

- 2026-10-28 后续即时库存复查：NC00000006全仓6条库存记录（含零库存行）货主均CTK000400，非零仅现场仓三批12.648/145.452/50.592K，共208.692K；这只能证明当前该料号库存全部归金诚信，不能证明共用BOM专用。NC前缀非零库存还包含NCE0750001、客户CTK001025（瑶芯微），不可将全部加工材料概括为金诚信。不得依据当前唯一库存货主，将共用BOM固定为该客户。证据 `output/rework-inventory-owners-20261028/`；数量随业务领料变化，复用重查。

### 客供晶圆与蓝膜料号不一致的领料排查（2026-10-30）

- 先按截图精确料号查PPBOM子项 `FMaterialID2`；没有命中时，再查同型号及其 `-L` 配对料，不能将“精确料号无用料清单”解释为没有需求。
- 本次只读定位候选MO260730029（AP200N04NF 单芯，0.5K）：PPBOM00152787分录1145223要求N102012151（WG40N6K1LZGC12A-L）0.5K、已领0，备料源CTK01、组织货主100、可用状态；截图现存却为N102012152，CTK04、客户CTK000009、不参与核算，0.5K。MO已有其他三种辅料的已审核领料SOUT261029091，不能说整张订单未领料。
- 实时蓝膜BOM N102012151_V1.0（869139）父项N102012151、子项N102012152、1:1；两料不能仅靠调仓相互转换。应继续核对实际是否完成划片/蓝膜加工及对应业务单据，再决定补加工入库或纠正用料；不得直接替换物料或变更货主。未取得前端失败原文，候选订单与维度不匹配已验证，不能宣称唯一失败原因已实测。
- 证据：`output/n102012152-stock/order-trace.json`、`blue-film-bom.json`、`views.json`。全部为当日快照，复用前重新查；本次未写业务数据。

- 2026-10-30用户要求试领料：实时PPBOM00152787子项1145223仍N102012151、应发0.5K/已领0/选单0、货主组织100；实际库存CTK04客户CTK000009/KCZT001/批号C00SZA.001为0.5K。限定该子项调用PRD_PPBOM→PRD_PickMtrl的Push（EntryIds1145223、IsDraftWhenSaveFail=false）失败，系统条件6/10及OnInSelectedRow插件筛选拦截；未生成新领料单。不得把此错误当库存不足或货主错误已实测。
- 继续WebAPI核查，MO单据类型SCDD05_SYS，状态4；实际已领辅料SOUT261029091来源SFC_OperationPlanning/TX086750（239957），分录来源工序1641722/1641724。正确入口需按工序领料平台处理，本次未验证平台生成或审核。不得为试领料自动改PPBOM货主、调仓或补虚拟库存。证据`output/n102012152-stock/pick-precheck.json`、`pick-attempt.json`、`operation-pick-context.json`；脚本`try-pick-mo260730029.js`默认dry-run。现有货主/仓库不匹配依然存在，正常工序路径是否进一步拦截未验证。

- 2026-10-30用户纠正必须工序领料平台后，从服务器只读复制当前SFC插件并反编译OperationPickMtrlWork：BeforeBindData接optIds→CreateOptPickMtrlData；GenPickMtrl依赖平台FPickMatEntity勾选行，内部任务OperationPickMtrlService.GetPickMtrlData，生成结果经View.Session传给PRD_PickMtrl新增界面。此路径不等价PRD_PPBOM的Push；未找到现有WebAPI可驱动该平台会话的接口，不得用前次Push错误冒充平台试领结果，也不擅自改用浏览器。
- 目标TX086750为239957，芯片用料OperID10；固晶工序SubEntity.Id1641722（OperNumber10），N102012151应领0.5K。此轮只读调查，未在平台生成/保存/审核领料。证据`output/n102012152-stock/SFC.Plugin.dll`、`platform-code/Kingdee.K3.MFG.SFC.Business.PlugIn.DynamicForm.OperationPickMtrlWork.decompiled.cs`、`operation-pick-context.json`。手工核验精确入口：工序计划筛TX086750→选10固晶→工序领料→仅选N102012151→实发0.5K→生成领料单→核对仓库批号货主状态，保存/审核报错须保留原文。

### MRP 审批配置核查（2026-11-02）

- WebAPI-only：旧 `GetFormMetaData` 失败后，使用 `DynamicFormService.QueryBusinessInfo` 读取字段与枚举；从 `SEC_FuncPermissionInfo.FObjectTypeId` 的 LookUpObjectFormId 发现 `BOS_ObjectType`，按名称检索流程表单。
- 当前完整查询：`wf_Template` 与 `WF_Template_Simple` 均仅4项（收款、应收、应付、发货通知），没有 MRP/计划订单；`WF_ProcDefBill` 共17项，5项具体单据流程及12项通用模板，无 MRP 绑定。结论为当前未配置专门的 MRP 审批流程，不推断历史从未使用。
- `PLN_PLANORDER` 当前0条；其元数据有 FDocumentStatus/FApproverId/FApproveDate，说明具备单据审核字段，不等同已经配置多人审批。
- 同名状态字段枚举不同：模板 FEnableStatus 为0创建/1启用/2禁用；流程定义为0启用/1禁用/2创建，必须各查元数据，不复用状态码。
- 证据：`output/mrp-audit-20261102/`；只读脚本 `scripts/scratch/2026-11/read-mrp-config.js`。复用前重新查询，不把此日期快照写成永久现状。

### 手工演示计划订单（2026-11-02）

- 用户授权任意现有物料演示后，先查物料已审核/启用/允许生产及已审核 BOM，采用明确的数量单位；生产投放类型 Save 校验要求 BOM 必填。原候选 AD0010001 的 BOM 为 D，不得为演示顺手审核，改选已有 C 状态 BOM 的 AD0030001。首次失败后回查计划订单仍为空，再改模型。
- 已验证最小模型见 `output/mrp-demo-20261102/proposed-model.json`：FBillTypeID=JHDD02_SYS、FMaterialId/FBomId、需求/供应/入库组织、货主、单位、数量及计划/确认/需求日期、FReleaseType=1、FDataSource=2（手工录入）、FReleaseStatus=0。只 Save，不 Submit/Audit/投放，不表示真实运行 MRP。
- 默认 dry-run、显式 --apply；按演示备注检查重复，Save 后列表与 View 独立回查。结果 MRP00004602（FID102667），物料 AD0030001/TK1N4148W，数量1 K，状态A创建/未审核，业务状态0计划；备注标明非真实需求、禁止审核及投放。创建成功的历史号不能作为曾运行MRP或运算次数的证据。
- 证据 `output/mrp-demo-20261102/`；脚本 `scripts/scratch/2026-11/create-mrp-demo.js`。此为本次授权的演示记录，复用须重新核对对象、时间和数量。

### TX1003112 子项改为现存加工后物料被拒（2026-11-02）

- 用户明确要求仅将MO261009007的PPBOM00174062（274068）子项1219080由NC00000006改为现存NC00000007，随后自行领料。实时核对单行、应发131.75K、已领/选单0、客户货主CTK000400；现场仓NC00000007同货主批号1库存131.75K。
- 默认dry-run后执行UnAudit成功到D；Save使用FEntity/FEntryID/FMaterialID2.FNumber及FStockID.FNumber，NeedUpDateFields为FMaterialID2/FStockID，返回“子项明细第1行子项物料编码是必填项”。回查材料仍NC00000006，数量和货主未变。QueryBusinessInfo确认当前实体FEntity、子项字段FMaterialID2，故不能只据旧成功案例保证该模型当前可用；本次未证明拒绝由父子同料、物料属性或字段更新模型的哪一项导致。
- 未重试保存或扩大对象；确认原值后Submit/Audit恢复C，独立View确认材料仍NC00000006、应发131.75K、已领0、货主CTK000400。未生成领料单，目标修改未完成，不能通知用户直接领新物料。
- 证据：output/tx1003112-ppbom-before-change.json、after-unAudit.json（文件名前缀同tx1003112-ppbom-）、meta.json、restored.json；脚本scripts/scratch/2026-11/change-tx1003112-ppbom.js默认dry-run。复用前实时查询，不把本次失败定性为永久不支持。

- 2026-11-02用户要求搜索后重试：官方现行手册 https://open.kingdee.com/k3cloud/help/PRD_PPBOM.html 明确非返工类型子项不可与产品同编码，且BOM携带子项不允许手动修改。本单父项为NC00000007，须区分同料限制与通用API字段问题，不据历史异料修改成功推断同料可用。
- 使用实时确认的物料内码684219正常Save（未关闭校验）返回成功，但View子项仍NC00000006，仅FStockID变为CTK08；这证明成功响应不能替代字段回查，不能认定目标物料已写入。FStockID使用FId0及null清空均返回成功而回查仍CTK08，未继续试写。最终Submit/Audit到C，材料06、131.75K、已领0、货主CTK000400，仓库CTK08；仓库相对原空值发生变化，必须向用户披露，不能称完全恢复。证据output/tx1003112-ppbom-second-final.json、after-save.json；重试脚本change-tx1003112-ppbom-byid.js。未修改生产类型或共用BOM，未生成领料。
