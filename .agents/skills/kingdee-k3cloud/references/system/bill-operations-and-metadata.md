# 单据操作元数据（作废 / 反作废 / 反审核）与字段键查法

## 目录

- 1. 先取操作定义，不要猜 opNumber
- 2. 工序汇报单作废 / 反作废（SFC_OperationReport，元数据实测）
- 3. WebAPI 字段键：viewBill 不带 F 前缀，executeBillQuery 带
- 4. 单据类型参数与码值反查（参数在哪、`2` 是什么意思）
- 5. 只读取证助手
- 6. 交付形态
- 7. 已审核销售出库单修改编号


## 1. 先取操作定义，不要猜 opNumber

`executeOperation(formId, opNumber, {Ids})` 的 `opNumber` 必须是表单自己定义的操作编码。账号里每个表单的操作定义存在 `T_META_OBJECTTYPE.FKERNELXML`（xml 列，几十万字符），节点是 `<FormOperation>`：

```sql
-- 只读。FKERNELXML 是 xml 类型，必须先 CONVERT，否则报
-- "Disallowed implicit conversion from data type xml to data type varchar"
SELECT CHARINDEX('<Operation>UnCancel</Operation>', X) AS POS, LEN(X) AS L
FROM (SELECT CONVERT(nvarchar(max), FKERNELXML) AS X FROM T_META_OBJECTTYPE WHERE FID='<FormId>') t;
-- 拿到位置后再切片，别整列拉出来
SELECT SUBSTRING(CONVERT(nvarchar(max), FKERNELXML), <POS-300>, 2400) AS S
FROM T_META_OBJECTTYPE WHERE FID='<FormId>';
```

切出来的节点里有四样东西，都要读：

- `<Operation>` 操作编码（`Cancel` / `UnCancel` / `Audit` / `Push` / `Submit` …）与 `<OperationName>` 中文名；
- `<StatusConvertItem>`：本操作改哪个状态字段、改成什么值（例：作废 `FCancelStatus=B`，反作废 `=A`）；
- `<Validations><ConditionValidation>`：前置条件。`Express` 是判定式，`ErrorWhenExpressIsTrue=True` 表示「表达式为真就报错」，`ErrorMessage` 是界面原文——按它判断当前单据能不能做；
- `<ServicePlugIns><ClassName>`：真正的业务插件名，用来确认这个操作不是空壳。

目标表单自身的差量元数据未命中，不代表操作不存在：须按根 Form 的 `oid` 等继承关系检查基础模板，并考虑操作编码大小写、扩展与删除标记；`FormOperation` 可带属性，匹配应使用 `<FormOperation\b[^>]*>`。只有解析有效操作定义后才能判断配置是否存在。顺着插件类名（如 `OptRpt.Cancel`）也能反查合法操作。

已知坑：`DynamicFormService.GetFormMetaData`（`k3cloud.js` 的 `getFormMetadata`）在本账套返回 `response_error: Unknown Error` / 非 JSON，别在猜字段名或反复重试上耗时间，直接走上面的 SQL 路径。

## 2. 工序汇报单作废 / 反作废（SFC_OperationReport，元数据实测）

| 操作 | opNumber | 状态转换 | 校验 | 插件 |
| --- | --- | --- | --- | --- |
| 作废 | `Cancel` | `FCancelStatus` → `B` | 仅 `FDocumentStatus = 'A' 或 'D'` 允许；已是 `B` 报「已经作废，无需重复作废！」 | `Kingdee.K3.MFG.SFC.App.ServicePlugIn.OptRpt.Cancel` |
| 反作废 | `UnCancel` | `FCancelStatus` → `A` | 仅 `FCancelStatus = 'A'` 时报「未作废的数据不允许反作废！」 | `...ServicePlugIn.OptRpt.UnCancel` |

由此可解释一个常见困惑：作废要求单据处于 `A`/`D`，所以「已作废」的汇报单单据状态常是 `D 重新审核` 而不是 `C`。

反作废**只改 `FCancelStatus`，不动 `FDocumentStatus`**，也不会自动提交/审核。回查后必须明确告诉用户还差哪一步：「仍是 D，要重新计入工序计划台账（`T_SFC_OPERPLANNINGDETAIL_B` 只累计已审核单）需单独 submit + audit」，并问要不要继续，不要顺手替用户做。

稳定入口：`bun run uncancel-report -- <工序汇报单号>`（dry-run）/ `-- --apply`。写操作工具按三段输出：当前状态（逐条 ✔/✗ 并说明为什么跳过）→ 拟执行的调用与预期状态 → 执行后用**独立查询**回查（`executeBillQuery`，必要时补 DB 查询）。接口返回的 `SuccessEntitys` 不算回查证据。

## 3. WebAPI 字段键：viewBill 不带 F 前缀，executeBillQuery 带

删除 BOM 的引用与部分成功边界（2026-10-21 WebAPI 实证）：`ENG_BOM` 可按 `FNumber` 精确定位，生产订单引用可用 `PRD_MO` 的 `FBomId=<BOM FID>` 查询，再 View 核对 `TreeEntity[].BomId_Id/BomId.Number`。草稿生产订单同样可能阻止删除。NAZ0040903_V1.0 被草稿 MO261020005 引用时，UnAudit 成功使 BOM 从 C 变 D，随后 Delete 报被生产订单使用；不能声称操作失败即原状不变。须回查并报告 D，停止，不擅自删除引用订单或重新审核。证据 `output/delete-naz0040903-bom/apply.json`；案例状态复用前重查。

同一张单据两套键名：

- `viewBill(formId, fid)` 返回**业务对象属性名**（无 `F` 前缀）：`Id`、`BillNo`、`DocumentStatus`、`CancelStatus`、`CancelDate`、`CANCELER_Id`、`WorkShopID_Id`。
- `executeBillQuery(formId, "FID,FBillNo,FDocumentStatus,FCancelStatus,...")` 用**字段标识**（带 `F` 前缀），引用表头没有的字段会直接中断整条查询，报 `元数据中标识为 FCancellerId 的字段不存在` / `FMOBillNo 的字段不存在`（`T_SFC_OPTRPT` 表头确实没有生产订单号列）。

所以不要凭中文名直译字段键。要一份准确键名：先 `executeBillQuery` 取 `FID,FBillNo`，再 `viewBill` 打印 `Object.keys()`（表头、第一条分录各一次），确认后再写正式查询。

分录尤其不能照搬：`viewBill` 的分录属性名（如 `ProductEntity` / `STK_ASSEMBLYSUBITEM`）**不等于** `executeBillQuery` 的分录字段键——加不加 `F` 前缀都不是万能解，有的表单分录字段根本没有实体前缀，是平铺的（`FQty`、`FMaterialIDSETY`）。拿到 viewBill 的 keys 后仍要**逐个候选键单独跑一次** `executeBillQuery`：一个错键就中断整条查询，串在一起试会分不清是谁报的错。已实测走平铺键的表单见 `../kingdee-sales-inventory/references/inventory-sales/assembly-bill-audit.md`。

另外 `FMaterialID` / `FMaterialIDSETY` 这类外键列返回**内部 ID** 而不是编码，要按批 `FMaterialID in (...)` join `BD_MATERIAL` 解码（每批 ≤400 个 ID，编码/名称/分组一起取）。

查库同理：先 `INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='T_XXX'` 列清单，再拼 SELECT——列名猜错会打断整条语句，且 xml 列必须 CONVERT。

## 4. 单据类型参数与码值反查（参数在哪、`2` 是什么意思）

界面「单据类型 → 参数设置」里的开关（结案控制、自动结案、倒冲时机、审核控制…）存在 `T_BAS_BILLTYPE.FPARASETTINGXML`（nvarchar(max)，一段 `<BILLTYPEPARAMODEL>`），键名**不带 F 前缀**：

```sql
-- FBILLTYPEID 是 32 位 hex 字符串，SQL 里必须加引号
SELECT FBILLTYPEID, FNUMBER, FISDEFAULT, FPARASETTINGXML
FROM T_BAS_BILLTYPE WHERE FBILLFORMID='PRD_MO' ORDER BY FISDEFAULT DESC;
```

先整段 dump 到 scratch 文件再本地搜；**中文标签不在这个 XML 里**，在 SQL 里 `CHARINDEX` 中文是白费。

码值 → 中文去**参数设置表单自己的元数据**里反查，不在业务表单本体里：

1. 业务表单 FKERNELXML 里有 `<BillTypePara>MoBillTypeParaSetting</BillTypePara>` 与 `<ParameterObjectId>PRD_MO_BILLPARAM</ParameterObjectId>`——前者就是参数设置表单的 `FID`。
2. `SELECT CONVERT(nvarchar(max),FKERNELXML) FROM T_META_OBJECTTYPE WHERE FID='<那个 FID>'`，读三处成对信息：
   - `<EntityServiceRule>` 的 `PreCondition` + `PreConditionDesc`/`Description` → 直接给「码 → 中文」，如 `FControlStrength = '3'` 配 `控制强度为不控制`、`FControlScope = '1'` 配 `控制范围值为【所有物料】`；
   - `<ConditionValidation>` 的 `Express` + `ErrorMessage` → 校验语义，如 `FControlIntensity='2' AND FControlItem=0` 报 `控制强度为警告时,控制项必选`；
   - 字段定义的 `<Name>` → 参数键的界面中文名（`IsAutoClose` → `生产订单自动结案`）。
3. **不要按官方文档列出的选项顺序去猜枚举**——选项展示顺序不保证等于码值顺序，猜反会把「开着」说成「关着」。只有 `PreCondition` 这种成对证据才算定案，取不到就如实说「只确认了 ≠ 某码」。

## 5. 只读取证助手

一次性调查放 `scripts/scratch/YYYY-MM/`，SQL 助手固定成「只允许 SELECT」：

```js
const forbidden = /\b(insert|update|delete|drop|truncate|alter|create|merge|exec)\b/i;
if (forbidden.test(q)) { console.error("拒绝执行：本工具只允许 SELECT 只读查询。"); process.exit(2); }
```

连接参数从 `k3cloud.js` 导入 `K3_DB_HOST/K3_DB_USER/K3_DB_PASS/K3_DB_NAME`（`mssql`，`options: { trustServerCertificate: true, encrypt: false }`），用完 `pool.close()`。

只读探针的七个通用坑（每次都会撞上几个）：

- **`mssql` 连接配置的键是 `server:` 不是 `host:`**——传 `host` 会在 `new Connection` 抛 `TypeError: The "config.server" property is required`，连接根本没建起来，看起来却像「查询失败」。
- **别对 `FKERNELXML` 这类大 xml 列做全表 `LIKE`**——`WHERE CONVERT(nvarchar(max),FKERNELXML) LIKE '%关键词%'` 要扫上百行 × 几十万字符，直接 `ETIMEOUT: Request failed to complete in 15000ms`。先按 `FID`/主键等值取到那一行再切片；确实要扫就给 `options.requestTimeout`（如 `180000`）。
- **基础资料 ID 列是 32 位 hex 字符串，SQL 里必须加引号**——`WHERE FBILLTYPEID = 00232405fc58…` 报 `Incorrect syntax near '…'`；`FBILLTYPEID`/`FBILLFORMID` 这类不是数值主键。
- 表单中文名不在 `T_META_OBJECTTYPE`（它没有 `FNAME` 列），在 `T_META_OBJECTTYPE_L`：`JOIN ... ON l.FID = t.FID AND l.FLOCALEID = 2052`。
- `sys.extended_properties.ep.value` 是 `sql_variant`，`LIKE` 前必须 `CONVERT(nvarchar(200), ep.value)`，直接 LIKE 报 8116。
- 上亿行的过程表别 `COUNT(*)`，用 `SELECT COALESCE(SUM(row_count),0) FROM sys.dm_db_partition_stats WHERE object_id=OBJECT_ID('<表>') AND index_id IN (0,1)`。
- `_L` 多语言表的 join 键 = 主表的业务主键**列名**（`FCOSTITEMID`/`FCOSTCENTERID`/`FMATERIALID`…），主表可能根本没有 `FID`；永远先 `INFORMATION_SCHEMA.COLUMNS` 查列再拼 join。

## 6. 交付形态

可复用的写操作逻辑放 `scripts/tools/<verb>_<object>.js`：默认 dry-run、显式 `--apply` 才写，dry-run 段要打印「拟执行的调用 + 预期状态」供用户核对。同时在 `package.json` scripts 加短命令，并在 README「稳定入口」表登记两行（dry-run 与 `--apply` 各一行）。收尾 `bun run test:safety` + `git diff --check`。

## 7. 已审核销售出库单修改编号

2026-10-19 实证：用户明确要求仅改四张销售出库单编号中的日期段。`SAL_OUTSTOCK` 在原状态 C 下接受最小 Save：`Model: {FID, FBillNo: newNo}`，`NeedUpDateFields: ['FBillNo']`、`IsDeleteEntry: false`，无需反审核。此结果只覆盖本次账套和四张单，不保证其他单据均允许。

执行前重新按旧编号唯一定位 FID、检查目标编号无重复、View 留存前值；默认 dry-run，明确授权且 `--apply` 后逐单保存。每单独立 View 并按新旧编号查询，核对 FID 不变、旧编号消失、新编号唯一、业务日期及审核状态不变；失败或不确定立即停止。编号日期段与实际出库日期是不同字段，必须先澄清用户目的。

本次四单：TK202609301206→TK202610301206、TK202609281099→TK202610301099、TK202609241030→TK202610301030、TK202610080035→TK202610300035。证据：`output/outstock-rename-1019-1792393496523.json`；执行探针：`scripts/scratch/2026-10/rename_outstock_1019.js`。已确认四单编号、原日期、C 状态；未验证下游单据内冗余源单号是否同步刷新，不据此宣称下游引用全部同步。

### 销售订单删除前检查作废状态（2026-10-21 实证）

- 删除前同时读取 `DocumentStatus`、`CancelStatus`、关闭状态、明细关联数量和上下游；`D` 不能单独证明可删除，关联数量全零也不能排除状态门槛。
- 本次 `SAL_SaleOrder` XSDD034943（FID 145230）为 `DocumentStatus=D`、`CancelStatus=B`、`CloseStatus=A`；标准 Delete 返回「不允许对作废状态的单据进行操作」，独立 View 确认单据仍在。原始快照：`output/sale-order-XSDD034943-before.json`。
- 失败后停止，不扩大删除范围。后续反作废必须先验证该表单的操作定义及授权范围；本次未执行反作废，未验证反作废后可成功删除。以上状态仅为当日证据，复用前重新查询。
- 同日用户明确授权反作废后删除：实时 dry-run 仍为 D/B，`executeOperation('SAL_SaleOrder','UnCancel',{Ids:'145230'})` 被 WebAPI 拒绝，原文「销售订单没有此接口，请通过WebAPI在线参考确认此接口是否存在。」；独立 View 确认仍 D/B，未继续删除。不得把工序汇报的 `UnCancel` 可用性套用于销售订单；该表单内核元数据未命中 `UnCancel`，尚未验证其他有效 WebAPI 路径。当时建议人工反作废属于未充分验证的处理建议，不能据此确认前端已配置该按钮或有效操作。证据：`output/sale-order-XSDD034943-after-uncancel-attempt.json`。

- 同日用户要求联网纠错：金蝶社区原作者示例 https://vip.kingdee.com/article/208898552251089408 使用 `Uncancel`。在相同订单实时 dry-run 后按该编码调用仍返回「销售订单没有此接口」；独立 View 仍 D/B。当前 `SAL_SaleOrder` 差量及其 `BOS_BillModel` 模板均未找到反作废操作定义；已找到销售订单 `Cancel`，其操作类型为状态转换，不能将作废操作当反作废调用。证据：`output/sal-saleorder-kernel.xml`、`output/bos-billmodel-kernel.xml`、`output/sale-order-XSDD034943-after-case-check.json`。结论限于本次两种操作编码和已检查的定义，未证明所有 WebAPI 路径不可用，也未验证前端可直接反作废。若需配置，应在 BOS 的销售订单上核实反作废操作及按钮绑定、状态转换 `FCancelStatus B → A`、前值/权限/校验/插件，并在既有授权范围外的表单配置改动前另行确认。
