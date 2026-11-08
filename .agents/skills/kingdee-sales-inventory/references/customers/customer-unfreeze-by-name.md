# 按名称解冻客户（CTK000482 客户H1实证 2026-09-04）

## 当前安全边界与反冻结接口验证（2026-10-09）

用户约定（2026-10-09）：用户明确“解冻客户排除在这之外”，客户解冻不受 AGENTS.md 第一节第二条的历史脏数据限定；已同步该文件的客户解冻例外。明确指定客户并要求解冻即为该客户解冻授权，不需重复询问 SQL 路径许可。仍须实时读取、唯一范围核对、默认 dry-run、事务与前值守卫、影响行数核对，以及数据库和 WebAPI 独立复查；不得扩展到其他属性。

2026-10-09 实测：名称片段“客户H2”仅匹配 `CTK000754`（深圳市客户H2半导体有限公司-1），客户内码 `494655`，已审核、启用、冻结出库 `B/OutStock`。`BD_CUSTOMER` 元数据确有 `UnFreeze`（反冻结，OperationId 45），但 `executeOperation('BD_CUSTOMER','UnFreeze',{Ids:'494655'})` 返回成功后，独立列表及 View 的 `BD_CUSTOMEREXT[0]` 仍为 `B/OutStock`，未解冻。此次只验证了该调用组合，不能断言前端反冻结不可用，也不能猜测未生效原因。证据脚本：`scripts/scratch/2026-10/unfreeze_huazhimei.js`，默认 dry-run。

2026-10-16 复核：按同一流程解冻 `CTK000170`（深圳市客户X科技有限公司），名称片段“客户X”唯一命中 `FCUSTID 133734`、扩展分录 `FENTRYID 100294`、`B/OutStock`、操作人 100081、冻结日期 2026-07-03；`scripts/scratch/2026-10/unfreeze_xinrui_CTK000170.js` 事务内前值守卫更新，影响 1 行，数据库 + 编码/名称 `executeBillQuery` + `viewBill` 三路均 `A`，审核 `C`、启用 `A` 未变。工具 `unfreeze_customer.js`（按编码）仍无事务与前值守卫，本次改用带守卫的一次性脚本；若继续使用稳定工具，需自行按本节要求补复核。

最终实测：用户明确例外后，`scripts/scratch/2026-10/unfreeze_huazhimei_sql.js` 在事务内按客户内码和扩展分录内码及冻结前值更新，影响 1 行；独立数据库查询、按编码和名称的列表查询、View 均确认正常 `A`，冻结范围为空格、操作人为 0、日期为空。审核状态 `C`、启用状态 `A` 保持。以上内码与状态为当次证据，复用前重新查询。

## 既有 SQL 解冻流程

用户常只给名称片段（如“客户H1”），不给编码。固定流程：

1. **名称→编码只读解析**：`T_BD_CUSTOMER JOIN T_BD_CUSTOMER_L (FLOCALEID=2052) LEFT JOIN T_BD_CUSTOMEREXT`，`WHERE cL.FNAME LIKE N'%片段%'`，取 `FCUSTID/FNUMBER/FNAME/FFREEZESTATUS/FFREEZELIMIT/FFREEZEDATE`。本次命中 1 条：`深圳市客户H1电子有限公司 / CTK000482 / FCUSTID 148529 / B 冻结 / OutStock / 2026-07-03`。
2. **dry-run 预览**：`bun run unfreeze-customer -- <编码>`，确认显示 `B (冻结)` 与将执行 `FFREEZESTATUS=A, 清空 limit/operator/date`。
3. **范围确认与工具审阅**：稳定工具走 SQL `UPDATE T_BD_CUSTOMEREXT`（与历史 `unfreeze_by_fnumber.ts` 一致；稳定工具仍缺少事务和前值守卫，必须先补齐或使用经审阅的守卫脚本）。dry-run 输出必须写清单编码、单 FCUSTID、前值和目标值（`FFREEZESTATUS='A', FFREEZELIMIT=' ', FFREEZEOPERATOR=0, FFREEZEDATE=NULL`），仅 1 条记录。名称 LIKE 命中唯一、且用户已指名该客户时，这份 dry-run 输出即为范围确认，可直接 `--apply`；命中多条或范围含糊时才用 clarify 让用户选。
4. **执行 + 独立复核**：使用已补齐事务与前值守卫的脚本执行后，再用独立 SQL 重查同一编码，确认 `A / ' ' / null`。脚本自带 after 查询不算独立复核；再补 `executeBillQuery`（字段 `FFreezeStatus,FFreezeLimit`，按 `FNumber` 与按 `FName` 各查一路）与 `viewBill` 两路，确保前端/API 侧也读到 `A`。**`viewBill("BD_CUSTOMER", …)` 第二参数必须传 `FCUSTID` 数值**（传编码字符串报 `Id的值CTK000810类型错误，无法转换为整型`）；内置助手返回的已是解包后的模型，直接读 `v.BD_CUSTOMEREXT[0].FreezeStatus/FreezeLimit/FreezeDate`，不要再套 `.Result.Result`（会得到 `undefined`、`Object.keys()` 为空而不报错）。复核输出用表格给前值/后值 + 三路一致结论，并声明其他字段（名称/简称/组织/审核状态/禁用标志）未变。

## 为什么解冻不走 WebAPI Save（实测结论，勿重复试）

`BD_CUSTOMER` 的 `DynamicFormService.Save` **改不动冻结字段**：四种组合（分录键 `FEntryID`/`Id` × 字段键 `FFreezeStatus`/`FreezeStatus`，`NeedUpDateFields` 传实体名 `BD_CUSTOMEREXT` 与点号字段名两组写法，`IsDeleteEntry` 真假）全部返回 `IsSuccess=true`、`SuccessEntitys` 带 `Id`，但立刻查 `T_BD_CUSTOMEREXT` 仍为 `B/OutStock` —— 静默忽略，没有任何报错可追。结论：解冻只走 SQL 工具路径，Load 报成功不等于落库，任何写入都必须查库复核。

同表单另两个坑：

- **`viewBill` 返回的模型不能直接回传 Save**：视图里 `Name`/`ShortName`/`Description` 是 `[{Key,Value}]` 多语言数组，原样回传报「客户名称/简称等必填项缺失」，且报错点名的字段其实都有值。
- **整单 Save 的报头要用原生键**：`FName`/`FShortName`/`FGroup`/`FSALDEPTID`/`FSALGROUPID`/`FSELLER`/`FRECCONDITIONID`/`FSETTLETYPEID`/`FCreateOrgId`/`FUseOrgId` 用 `{FNumber}` 或 `{FStaffNumber}`（跟单员字段 `F_UNW_Base_kyb`）；用这套键 Save 能通过校验，用视图键（`Name`/`FGroup_Id` 混合）则整批报必填项缺失。仅最小模型（只传 `Id` + 一条分录）也会触发同样的必填校验。

坑位：不要用旧输出或历史单号代替当前查询；名称 LIKE 可能多条时逐条列出请用户确认后再解冻；探测 Save 路径用 `scripts/scratch/YYYY-MM/` 的一次性脚本，别把不落库的“解冻工具”留在 `scripts/tools/` 里误导后续会话。

## 历史探测脚本

`scripts/scratch/2026-09/_probe_customer_unfreeze_save*.js` 用于当次 Save 探测；`scripts/bun_test/unfreeze_via_api_save.ts` 已证实未落库，不可当作有效解冻工具。历史 `find_and_unfreeze_*.ts`、`unfreeze_batch_*.ts` 仅供调查，不能跳过唯一范围、事务及前值守卫后直接运行。

## 客户出库冻结流程与实证（2026-11-03 众邦 CTK000957 / 客户F CUST0159）

用户要求“冻结这个客户出库”（附群名称或名称片段），操作字段与解冻成镜像关系：

1. **名称与前值核对**：根据群聊或客户简称模糊匹配，全库确认唯一对象（例：“众邦”唯一匹配 `CTK000957` 客户Z电子有限公司，`FCUSTID 830354`，分录 `101646`；“客户F”唯一匹配 `CUST0159` 客户F电子有限公司，`FCUSTID 133720`，分录 `100280`）。前值必须为 `FFREEZESTATUS='A'`、`FFREEZELIMIT` 为空。
2. **冻结字段规范**：
   - `FFREEZESTATUS`: `'B'`（已冻结）
   - `FFREEZELIMIT`: `'OutStock'`（冻结出库）
   - `FFREEZEOPERATOR`: 操作人用户 ID（系统当前用户 `100081` 运维员A）
   - `FFREEZEDATE`: 当前执行时间 `GETDATE()`
3. **事务前值守卫更新**：仅更新目标客户该条分录，带 `FFREEZESTATUS='A'` 守卫并严格校验影响行数 1 行。
4. **三路复核**：执行后经独立 SQL、WebAPI 列表（按编码/按名称 `executeBillQuery`）及 `viewBill` 三路核对，确认已落库 `B/OutStock`，且审核状态（`C`）、启用状态（`A`）与其它基础信息保持不变。证据脚本：`scripts/scratch/2026-11/freeze_zhongbang_CTK000957.js`、`scripts/scratch/2026-11/freeze_fuan_CUST0159.js`。
