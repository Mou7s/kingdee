# 供应商核查（BD_SUPPLIER）

针对“查一下供应商 X”类请求的标准化只读核查路径，本次以供应商X有限公司为案例验证。

## 1. 主数据定位

- FormId `BD_SUPPLIER`（大小写均可，`BD_SUPPLIER`/`BD_Supplier` 均返回）。`AP_SUPPLIER` 不存在。
- 模糊定位：`executeBillQuery("BD_SUPPLIER", "FSupplierId,FNumber,FName,FDocumentStatus,FForbidStatus", "FName like '%迅隆%' or FNumber like '%迅隆%'", 20)`
- 精确定位：`FName like '%常德%'` 或 `FNumber='G026'`
- 本例命中 2 条：`G026 供应商X`（C/A，FGroup 07 成品）与 `GYSQT0002 供应商X（待禁用）`（C/A，QT 其他）——后者为重复档案，无地址/联系人/付款条件，需先处理其唯一应付 AP00014094 再禁用。

## 2. View 明细必查字段

`DynamicFormService.View` formid `BD_SUPPLIER`，`data:{Number:"G026"}`
- 基础：`Number/Name/ShortName/CDXL`、`FGroup`（成品 vs 其他）、`CreateOrgId/UseOrgId`、Creator/Modifier/Auditor、CreateDate/FModifyDate/FAuditDate
- `SupplierBase[0]`：`Address`（湖南常德市德马大道357号）、`SupplyClassify`（CG）、`SOCIALCRECODE`
- `SupplierBusiness[0]`：`SettleTypeId` 电汇 JSFS04_SYS、`PayCondition` 月结60天 005、`BusinessStatus` A
- `SupplierFinance[0]`：`PayCurrencyId` PRE001 人民币、`FTaxType` SFL02_SYS 一般纳税人、`TaxRateId` SL02_SYS 13%
- `SupplierLocation[]`：`Number/Name/Address IsDefaultSupply/Settle/Payee` + `ContactId` 许腾锐 0755-82544115/15920006249
- `SupplierContact[]`：`Mobile/EMail/IsDefault/ConForbidStatus`
- 重复码 `GYSQT0002` 的 `SupplierLocation` 为空，可作为识别未完善档案的信号。

## 3. 业务流水盘点（TopRowCount 逐级放大 + JS 排序）

- `PUR_PurchaseOrder`：`FSupplierId.FNumber='G026'` — 本例 217 张，`FCloseStatus B` 已关闭为主，仅最新 `TK20260901027` (2026-09-01) 为 `C/A` 未关闭。查询需 `TopRowCount 500` 避免截断，`executeBillQuery` 无 OrderString 时结果为最旧优先，需在 JS 中 `sort((a,b)=>new Date(b[1])-new Date(a[1]))` 再取最新。
- `PUR_ReceiveBill`：`FSupplierId.FNumber='G026'` — 本例 11 张 (2024-10-09~2024-12-03)
- `AP_PAYABLE`：`FSUPPLIERID.FNumber='G026'` — 本例 350 张 (2024-10-15~2026-07-28)，`FSUPPLIERID.FName` 联表验证；GYSQT0002 仅 1 张。字段坑：`FPayBillTypeID/FAmountFor/FPayBillTypeID` 不存在，正确表头为 `FBillNo,FDate,FDocumentStatus,FSUPPLIERID.FNumber,FSUPPLIERID.FName`，金额需 `View` 后取 `FALLAMOUNTFOR`（如 AP00015746=87.5，WRITTENOFFSTATUS=C）。
- `SUB_SUBREQORDER` / `PUR_SubContract`：委外订单 0 张，`PUR_SubContract` FormId 不存在，说明为成品采购非委外。
- `STK_InStock` 按 `FSupplierId.FNumber` 查不到入库（0 行），需结合收料单判断是否走其他入库路径。
- `OrderString` 用 `FDate DESC` 在部分表单报空结果，改用 `FBillNo DESC` 或直接 JS 排序更稳。

## 4. 公开工商补充

企查查/天眼查对该名称当前需登录且有地区风控，`web_search` 仅返回官网介绍页，无法免登取注册资本/法人/统一信用代码。金蝶内地址与联系人可作为当前事实，工商信息需用户另行在企查查付费查询。

## 5. 输出模板

1) 主数据对照表（编码/名称/状态/分组）2) View 关键字段摘要 3) 流水盘点表（单据类型/数量/日期范围/最新单号状态） 4) 重复码/禁用建议 5) 未验证限制（工商、库存等）

## 6. 坑位

- `BD_SUPPLIER` View 的 `DocumentStatus=C` 不代表业务已停，需结合 PUR/AP 最新日期判断活跃度。
- 重复供应商常见命名为 `原名（待禁用）` + 编码 `GYSQTxxxx`，分组 `QT 其他`，Location 为空。
- 供应链 FormId 大小写不敏感但 `AP_SUPPLIER` 不存在，不要混用应付表单查供应商。
- TopRowCount 默认 10/20 会截断计数，务必用 500+ 探测总量。

## 7. 审核 / 反审核（写入路径，2026-10-16 GYS020003 实测）

前端保存并提交后供应商为 `B`（审核中），审核即 `B → C`。

- 审核：`DynamicFormService.Audit`，`{formid:"BD_SUPPLIER", data:{Ids:"<FID>"}}`（客户端 `auditBill("BD_Supplier", fid)`）。成功回执 `ResponseStatus.IsSuccess=true` 且 `SuccessEntitys[0].Id` 等于目标 FID。
- 反审核：`DynamicFormService.UnAudit`（`unAuditBill`），`C → D`。
- 前置守卫：先 `executeBillQuery` 确认 `FNumber` 唯一命中且 `FDocumentStatus='B'`，否则不执行；`FAuditDate=null` / 无审核人可佐证尚未审核。`A`（草稿）/`D`（重新审核）直接 Audit 的门槛本次未在供应商上实测（他类基础资料经验是必须先进 `B`），不要当成已验证结论。
- 回查用两条独立通道：列表查询 `FDocumentStatus='C'` + `FAuditDate` + `FAuditorID.FName`，再 `View` 复核 `DocumentStatus`。**`View` 不回传 `Auditor`/`FAuditDate`**，审核人只能从列表查询取。
- 脚本形态：默认 dry-run 打印前值与计划，`--apply` 才调用 `auditBill`；对象、方向、数量以用户明确范围为准。
- 第二例（2026-10-16 GYS040002 供应商K，FID 933855，主账套组织）：列表查询 `FSupplierId,FNumber,FName,FDocumentStatus,FForbidStatus,FAuditDate,FAuditorID.FName` 实测可用；dry-run 守卫（唯一命中、`B/A`、审核日期与审核人均为 null）通过后 `--apply`，Audit 回执 `IsSuccess=true` 且 `SuccessEntitys[0].Id=933855`；审后列表 `C`、`FAuditDate=2026-10-16T16:19:31.27`、审核人 运维员A，View `DocumentStatus=C`。一次性脚本 `scripts/scratch/2026-10/audit_supplier_gys040002.js`，对象已写死，不能直接套用到其他供应商。
- 审核前未覆盖的非阻断信息：该档案 `SupplierLocation` 与银行账户行均为空（界面截图同样为空），审核不要求补齐；是否补录由业务决定。
- **审核中（`B`）供应商的撤销与删除（2026-11-13 实测）**：`BOS_BaseDataModel` 的 `Delete` 仅允许 `FDocumentStatus` 为 `Z`/`A`/`D` 且未被业务单据/物料默认供应商等引用的记录。对 `B`（审核中）的未用供应商，须先核查采购/委外/收退料/入库/应付/付款/价目表/货源清单/物料默认供应商等引用均为 0 并留存 `viewBill` 备份，再执行 `executeOperation("BD_Supplier", "CancelAssign", { Ids: "<FID>" })` 撤销为 `D`，随后调用 `deleteBill("BD_Supplier", ["<FID>"])` 删除，最后通过 WebAPI 与 SQL 双通道复查归零；注意关联的公共联系人（`T_BD_COMMONCONTACT`）不会随供应商删除自动清除。

## 8. executeBillQuery 字段键坑（易与 View 键混淆）

- 简称列表查询必须用 `FShortName`；传裸 `ShortName` 报「元数据中标识为ShortName的字段不存在」。`View` 里的键才叫 `ShortName`（多语言数组 `[{Key:2052,Value}]`）。
- 列表查询可用：`FSupplierId,FNumber,FName,FShortName,FDocumentStatus,FForbidStatus,FGroup.FName,FSupplyClassify,FUseOrgId.FName,FCreateOrgId.FName`。
- 定位时编码与名称一起查（`FNumber='...' or FName like '%关键字%'`），不要只按界面截图里的编码字符串猜——截图字符易误读，且编码本身可能是 `GYS020003` 这类多字母前缀。

## 9. 委外订单供应商过滤规则与供货类别（FSupplyClassify）维护

- **委外订单静默过滤表现**：业务员在标准委外订单（`CGDD02_SYS`）或普通委外订单录入供应商时，输入供应商关键词搜不出目标供应商，但供应商主数据状态正常（已审核、未禁用）。
- **根因**：委外单据 F7 快速下拉和选单强制过滤供应商资质，要求供货分类必须为 `ZH`（综合）或具备委外属性。若供应商建档时 `FSupplyClassify` 设为 `CG`（采购/货品），会被系统前端与接口静默排除。
- **实体与修改规则**：
  - 物理表：`T_BD_SUPPLIERBASE.FSUPPLYCLASSIFY`；枚举取值：`CG`（采购/货品）、`WW`（委外）、`FW`（服务）、`ZH`（综合）。
  - WebAPI 实体键：`FBaseInfo`（View 映射为 `SupplierBase`）。在 `DynamicFormService.Save` 时，**`FBaseInfo` 必须作为单对象传入**（如 `FBaseInfo: { FEntryId: entryId, FSupplyClassify: 'ZH' }`），不能传数组；且 `NeedUpDateFields` 传空数组 `[]`。
  - 标准变更闭环：反审核 `unAuditBill` (`C → D`) → 保存修改 `Save` → 提交 `submitBill` → 审核 `auditBill` (`D → C`)。
  - 标准工具：`scripts/tools/update_supplier_supply_classify.js`（支持 `--number`, `--classify`, `--expect`, 默认 dry-run，`--apply` 生效）。

## 10. 供应商建档配套独立权限项：「联系人」与「供应商分组」（2026-11-11 ~ 2026-11-12 实证）

- **易漏现象**：为角色开通 `BD_Supplier` 的 `BOS_NEW`（新增）、`BOS_MODIFY`（修改）、`BOS_SUBMIT`（提交）后，采购员虽可打开「供应商 - 新增」，但仍会遇到两类独立权限阻塞：
  1. 在「联系人」页签点击「新增」等按钮无权限；
  2. 表头必填项 `FGroup`（「供应商分组」，`MustInput=1`，引用 `BOS_FORMGROUP` / `t_BD_SupplierGroup`）因缺少分组查看权限而无法选择分组（若对比账号同时兼任「采购主管」等角色，可能掩盖单「采购员」角色的缺口）。
- **元数据与独立权限项**：
  - **联系人操作**（底层同时写 `T_BD_COMMONCONTACT` 与 `t_BD_SupplierContact`，无需单配 `BD_CommonContact`，受 `BD_Supplier` 自身 5 项权限控制）：
    - `BD_New_Contact`（新增联系人，内码 `5f221df2466398`，同时控制 `NewContact` 与 `AddContactLine`）
    - `BD_Modify_Contact`（修改联系人，内码 `5f221e3b466407`）
    - `BD_Delete_Contact`（删除联系人，内码 `5f221e6b467ec7`）
    - `SCM_ForbidContact`（禁用联系人，内码 `5b46fb94886ffb`）
    - `SCM_UnForbidContact`（反禁用联系人，内码 `5b46fbc6886ffe`）
  - **供应商分组操作**（绑定在 `BD_Supplier` 自身的 4 项分组权限上，不随 `BOS_VIEW`/`BOS_NEW` 自动放行）：
    - `BOS_GROUP_VIEW`（查看分组，内码 `43da5e07837a498bb1d6994e3a16c43d`）—— 建档选填已有供应商分组及查看左侧分组树的必备项；
    - `BOS_GROUP_ADD`（新增分组，内码 `ff6cd13a502f43fc9b3c2614d43e382d`）、`BOS_GROUP_MODIFY`（编辑分组，内码 `f17a85251d634f70888cd972502729fa`）、`BOS_GROUP_DELETE`（删除分组，内码 `59f6bff0ff6042ada2510b50c65fa131`）—— 维护分组目录树时按需授权。
- **配置与刷新要点**：为角色开通供应商建档/维护权限时，须按用户明确授权范围一并核对联系人 5 项与分组权限（至少核对 `BOS_GROUP_VIEW`）；经 `SEC_FuncPermissionInfo` 保存后，必须按 `kingdee-system-admin` 约定逐一保存该角色全部成员 `SEC_User`（仅 `{FUserID}`），并通过独立会话与数据库双通道复查（前端运行时效果仍以目标账号重新登录实测为准）。
