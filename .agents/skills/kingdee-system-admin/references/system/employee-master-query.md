# 员工主数据（员工 / BD_Empinfo）查询与部门职位关联

## 目录

- 触发条件
- 已验证事实（2026-09 实测）
- 部门 / 职位的正确取法（只读 SQL）
- 稳定工具
- 坑
- 验证方法
- 新增员工（写操作）
- 员工删除与替换姓名
- 用户（账号）与员工的关联


## 触发条件

- 用户要「员工列表」「查某员工」「某人是哪个部门/什么职位」；
- 需要把业务员/制单人/员工账号映射到员工主数据。

## 已验证事实（2026-09 实测）

- **员工基础资料的表单 ID 是 `BD_Empinfo`**（显示名「员工」）。
  - `BD_STAFF`、`HR_EMPINFO`、`BD_EmpinfoBank`、`BD_EmpInfo` 作为 FormId 一律报「业务对象不存在」（`BD_EmpInfo` 仅大小写不同能命中）。
  - 数据主表是 `T_HR_EMPINFO`（注意：不是 `T_BD_EMPINFO_N735`，那张常为 0 行；`T_BD_STAFF` 是任职/职员表，用于关联部门职位）。
- `executeBillQuery("BD_Empinfo", ...)` 实测**可用**的字段键：
  `FID`、`FNumber`、`FName`、`FStaffNumber`、`FStaffId`、`FPersonId`、`FPostId`、`FForbidStatus`、`FDocumentStatus`、`FCreateOrgId`、`FUseOrgId`、`FIsHR`、`FPostId.FName`。
- **这些字段不存在**（会报「元数据中标识为 X 的字段不存在」，别再试）：
  `FDeptId` / `FDEPTID` / `FDeptID` / `FDepartment` / `FDepartmentId` / `FDeptNumber` / `FPosition` / `FPostName` / `FPostNumber` / `FStartDate` / `FEndDate` / `FEMPINFOID` / `FPersonType` / `FGender`。
- **部门、职位不在员工表单上**，表单上的 `FPostId` 也常为 0，不能当职位用。它们挂在任职（职员）记录上，必须经 `FStaffId` 关联。

## 部门 / 职位的正确取法（只读 SQL）

```sql
SELECT s.FSTAFFID, d.FNAME AS FDEPTNAME, p.FNAME AS FPOSTNAME
FROM T_BD_STAFF s
LEFT JOIN T_BD_DEPARTMENT_L d ON d.FDEPTID = s.FDEPTID AND d.FLOCALEID = 2052
LEFT JOIN T_ORG_POST_L    p ON p.FPOSTID = s.FPOSTID AND p.FLOCALEID = 2052
WHERE s.FSTAFFID IN (...)
```

- 多语言名称列（`FNAME`）必须带 `FLOCALEID = 2052`（简体中文），否则可能取到空名或其它语言。
- 关联键：员工 `FStaffId` = `T_BD_STAFF.FSTAFFID`；部门 `FDEPTID` → `T_BD_DEPARTMENT_L`；职位 `FPOSTID` → `T_ORG_POST_L`。
- 员工无任职记录时部门/职位为空，不是查询失败。

## 稳定工具

`scripts/tools/list_employees.js`（`bun run list-employees`）：

```
bun scripts/tools/list_employees.js                 # 全部员工
bun scripts/tools/list_employees.js --active        # 仅未禁用
bun scripts/tools/list_employees.js --dept=总经办    # 按部门名筛选
bun scripts/tools/list_employees.js --csv=output/employees.csv
```

身份字段走 WebAPI（受登录用户数据权限约束），部门/职位走数据库只读关联；库不可达时自动降级为 `-`，列表仍可出。

## 坑

- **`DynamicFormService.GetFormMetaData` 在本环境返回非 JSON**（`Failed to parse JSON`），不能用来探测表单/字段；探测直接用 `ExecuteBillQuery` 传 `FieldKeys`（先用单字段 `FID` 试表单是否存在，再逐字段验证键）。
- **`FForbidStatus` 取值**：`A` = 正常，`B` = 禁用。`FDocumentStatus` 用 `lib/k3/status.js` 的 `DOC_STATUS_SHORT`（`C` = 已审核）。
- 元数据表 `T_META_OBJECTTYPE` 没有表单名/字段名列；表单中文名在 `T_META_OBJECTTYPE_L`（`WHERE FID=... AND FLOCALEID=2052`），字段列表需靠 `ExecuteBillQuery` 实测。
- 同一姓名可能对应多名员工（重入职、同名），清单里出现重复姓名要作为「需确认」列出，不要擅自合并或判定为脏数据。

## 验证方法

- 员工行数与 `T_HR_EMPINFO` 行数应一致（2026-09 为 310；`T_BD_STAFF` 为 298，两者不一致是正常的——并非每个员工都有任职记录）。
- 随机取一条：`WebAPI` 的 `FStaffId` 应能在 `T_BD_STAFF.FSTAFFID` 命中，且部门/职位名非空。

## 新增员工（写操作）

工具：`scripts/tools/create_employee.js`（默认 dry-run，`--apply` 才写入；`--no-audit` 只存草稿）。

```
bun scripts/tools/create_employee.js --name 梁小春 --dept 测试分选 --post 生产员 --join-date 2026-09-26
bun scripts/tools/create_employee.js --name ... --dept BM000014 --post GW000046 --join-date 2026-09-26 --apply
```

关键点（2026-09 实测成功，YG00074）：

- **部门/职位必须写进分录 `FPostEntity`**，只写表头会建出「没有任职记录」的员工（列表里显示无部门）。分录字段键：`FPost`(职位)、`FPostDept`(部门)、`FStaffStartDate`、`FIsFirstPost`、`FWorkOrgId`。**注意是 `FPost` 不是 `FPostId`**（表头另有同名 `FPostId`，容易混）。
- 分录实体键从元数据 `T_META_OBJECTTYPE.FKERNELXML` 的 `OperationObjectKey` 确认：`FPostEntity`。
- **编码自动取号**：规则 `YG`+5 位，计数器在 `T_BAS_BILLCODES.FNUMMAX`（`FRULEID` 见 `T_BAS_BILLCODERULE` 中 `FBILLFORMID='BD_Empinfo'`）。Save **不要传 `FNumber`**，否则可能与自动号冲突。
- 流程：`Save` → `Submit` → `Audit`。Save 成功后必须独立 `View` 回查 `PostEntity` 的部门/职位/开始日期，确认写对了再提交审核；不确定就停在草稿。
- 保存后 Save 响应里的 `DocumentStatus` 是 `undefined`，要另用 `View`/`ExecuteBillQuery` 读状态。
- 建员工前先按 `FName` 查重；同名重入职属正常现象，但需人工确认后再建。

## 员工删除与替换姓名

- 用户要求「删除旧员工，再将另一员工改为旧姓名」时，先按编码和 FID 唯一锁定两条记录，读取姓名、状态、人员、任职与账号联系对象；默认 dry-run。账号显示名不等于绑定员工姓名。
- 删除必须走 WebAPI；引用校验失败就停止后续改名，不得自动删除任职、改绑账号或通过 SQL 绕过。删除引用对象需要另行明确业务范围。
- 2026-10-14 实证：TK0023 刘晓丽（FID 128595，D）删除被「员工任岗信息（标识：BD_NEWSTAFF）」引用阻止；TK0218 刘阳锐（FID 132840，C）未改名。用户 TK00472 显示名刘晓丽，联系对象为 TK0218 对应人员 132841。以上为当日状态，复用前重新查询。
- 证据：`output/employee-replace-name-2026-10-14.json`；探测脚本 `scripts/scratch/2026-10/employee-replace-name.js`。失败后独立查询两条员工，确认原姓名和状态仍在；本次未验证员工改名 Save 是否可用，不将其写成已验证流程。
- 同日后续经用户同意保留旧档：实时前值已变为 TK0023「刘晓丽（旧」（C/A）、TK0218「刘晓丽」（C/A），按当前前值重新 dry-run；员工最小字段 `Save({FID,FName}, ['FName'])` 和 `forbidBill` 实测成功，回查 TK0023 为「刘晓丽（旧档）」C/B，TK0218 为「刘晓丽」C/A。证据 `output/employee-retire-rename-2026-10-14.json`。保留旧档可避免删除历史引用；改名可能影响历史单据显示姓名，执行前说明。已审核员工此次直接改名保留 C 状态，无需预先反审核；其他环境仍须实时验证。

## 用户（账号）与员工的关联

- **不要用 `T_SEC_USER.FEMPID` 或 `T_HR_EMPINFO.FUserId`**：本账套实测这两列**全为空**（112 个用户 0 个填 `FEMPID`，311 个员工 0 个填 `FUserId`），据此判断会得出「没有关联」的错误结论。
- **真实链路是「用户 → 人员 → 员工」**：
  `T_SEC_USER.FLINKOBJECT`（用户表单的「联系对象」）→ `T_BD_PERSON.FPERSONID` → `T_HR_EMPINFO.FPERSONID`。
  注意人员表主键列是 **`FPERSONID` 不是 `FID`**（`T_BD_PERSON.FID` 与联系对象对不上）。
- 官方视图 **`V_BAS_USERPERSONINFO`** 直接给出用户↔人员映射（`fuserid` / `fusername` / `FUSERACCOUNT` / `FLINKOBJECT` / `FPERSONID` / `fpersonnum`），优先用它。

```sql
SELECT u.FUSERACCOUNT, u.FNAME AS 用户名,
       e.FNUMBER AS 员工编码, el.FNAME AS 员工姓名
FROM T_SEC_USER u
JOIN T_HR_EMPINFO e      ON e.FPERSONID = TRY_CAST(u.FLINKOBJECT AS INT)
LEFT JOIN T_HR_EMPINFO_L el ON el.FID = e.FID AND el.FLOCALEID = 2052;
```

- 员工姓名在 `T_HR_EMPINFO_L`，**`T_HR_EMPINFO` 本身没有 `FNAME` 列**（直接 `WHERE FNAME=...` 会报列名无效）。
- 覆盖情况（2026-09 本账套）：112 个用户，81 个有联系对象且都能落到员工；其余 31 个是系统/部门共享账号（Administrator、Guest、attendance、kingdee、固晶一部/二部、焊线、测试分选2 等），本就没有对应员工。
- **新增员工不会自动生成登录账号**：建员工只创建人员/员工记录，账号要在「用户」里另建并把「联系对象」指到该人员。
- **用户显示名与关联员工姓名可能不一致**（实测登录账号「管理员A」的联系对象指向员工「运维员A」TK0006）。排查账号权限/数据范围时，以 `FLINKOBJECT` 关联到的**员工**为准，不要把用户显示名当成员工姓名；遇到不一致要作为「需用户确认」列出。

### 修改用户的联系对象（把账号绑到某个员工）

- 表单 FormId = **`SEC_User`**（`SEC_USER` 也可用）；联系对象字段 = `FLinkObject`，**带的是员工编码**。
- 更新只改联系对象（不要碰用户名/密码/角色）：

```js
await api.saveBill("SEC_User",
  { FUserID: <用户内码>, FLinkObject: { FNumber: "<员工编码>" } },
  ["FLinkObject"], ["FUserID", "FUserAccount", "FLinkObject"]);
```

保存后必须 `viewBill("SEC_User", <用户内码>)` 回查 `FLinkObject.Number` 是否为目标编码。

- **元数据校验「该联系对象已经使用过，不能再选用」**：一个员工只能被一个账号绑定。改绑前要想清楚——旧员工会被解绑而**变成没有账号**，要提醒用户（本账套实测账号 `TK02126` 由「戴昌喜」改绑到「童炜城」后，戴昌喜即无账号）。
- 工具：`scripts/tools/rebind_user_link.js`（默认 dry-run，`--apply` 才写）：`--account TK02126 --employee YG00075`。
- **不要用 SQL 直接改 `T_SEC_USER`**：属于用户/权限数据，走 WebAPI `DynamicFormService.Save`。
- 若"改成他自己"但系统里根本没有该员工/人员（如「童炜城」），说明 HR 档案缺失：先用 `create_employee.js` 建档，再改绑；不要凭用户名臆测绑定对象。

### 改用户显示名（让用户名和绑定员工一致）

- 显示名字段 = **`FName`**（单语，列 `T_SEC_USER.FNAME`；`T_SEC_USER_L` 里没有名称列）。**登录账号是 `FUserAccount`，与显示名无关**，只改显示名不影响登录。
- 与绑定方向要分清：**绑定错了**改 `FLinkObject`（见上一节）；**绑定正确但名字旧了**改 `FName`。

```js
await api.saveBill("SEC_User", { FUserID: <内码>, FName: "<新显示名>" }, ["FName"],
  ["FUserID", "FUserAccount", "FName", "FLinkObject"]);
```

- 工具：`scripts/tools/rename_user_display.js`（默认 dry-run）：`--account TK2869 --name 运维员A`。
- 改的若是**当前登录账号自己**的显示名，保存后会话仍可用（实测 OK）；仍建议改完用 `viewBill` 回查。

### 禁用 / 反禁用用户（2026-10-16 实证）

- 用户禁用**不是** `forbidBill("SEC_User", ...)`：`Forbid` 对 SEC_User 返回「用户没有此接口」。元数据（`T_META_OBJECTTYPE.FKERNELXML`）中的操作编码是 `Disable`（界面「禁用」）与 `Enable`（界面「反禁用」）。
- 调用：`api.executeOperation("SEC_User", "Disable", { Ids: "<FUserID>" })`；反禁用同理用 `Enable`。界面提示「该用户将立即注销登录」，禁用会踢出该账号的在线会话。
- 状态字段 `FForbidStatus`：A 启用，B 禁用；`FDisableUserId`/`FDisableTime` 记录操作人与时间，`FEnableUserId` 记录反禁用人。
- 验证：先 `executeBillQuery` 按 `FUserAccount` 唯一锁定 FUserID，`viewBill` 读 `FForbidStatus` 作前值（已为 B 则跳过）；执行后 `viewBill` 回查，并用 `T_SEC_USER` 只读 SQL 核对 `FFORBIDSTATUS`、`FDISABLETIME`。
- 证据与探测脚本：`scripts/scratch/2026-10/forbid-user-fanqi.js`（默认 dry-run，`--apply` 才执行）、`scripts/scratch/2026-10/verify-user-fanqi-db.js`；TK4146 樊奇 2026-10-16 16:17:26 禁用，FDISABLEUSERID=100081。

### 客户上的跟单员字段（2026-10-16 实证）

- 客户主档（`T_BD_CUSTOMER`）有两个跟单类基础资料字段，取值都是员工内码（`T_HR_EMPINFO.FID`，非用户内码）：`F_UNW_BASE_KYB` 显示名「跟单员」，`F_UNW_BASE_KYB_W5C` 显示名「跟单员1」。均为 int，未填为 0。
- 数据权限规则 `gendan`（跟单只能看到自己负责的客户，`6a5ad27f022535`）的过滤条件同时引用这两个字段（OR 关系）。员工被禁用或换人，都会影响这些客户的跟单可见性。
- 按员工查挂靠客户：`SELECT ... FROM T_BD_CUSTOMER WHERE F_UNW_BASE_KYB_W5C = <员工FID>`（两个字段都要查）。统计前先确认 FID 而非编码。
- 2026-10-16 实测：樊奇（YG00053，FID 830084）为 300 个启用客户的「跟单员1」，「跟单员」字段均不是他；这 300 个客户同时挂的「跟单员」为 494133（叶珊妹）275 个、694540（业务员B）24 个、128630 1 个。当日快照，复用前重查。
- 改客户跟单员属于客户主数据写入，须用户指定目标员工、范围和清空/替换方式后，先 dry-run 再 WebAPI 保存并回查。证据脚本：`scripts/scratch/2026-10/probe-customer-follow-summary.js`。
- **2026-10-16 清空已验证的写法（用户授权：清空樊奇在全部客户「跟单员1」上的位置）**：
  - **员工引用只认 `FStaffNumber`**：Save 模型写 `{FStaffNumber: "YG00010"}` 才生效；写 `{FNumber: ...}` 或 `null` 保存返回成功但不落库（静默无效）。清空用 `F_UNW_Base_kyb_w5c: {FStaffNumber: ""}`，`NeedUpDateFields` 必须明确列出该字段（传 `null` 无效）。
  - **不能只发 FID + 字段**：报「收款条件/结算方式/销售组/客户名称/跟单员/客户分组…必填」。须从 View 取值，用 F 键构造完整模型：`FName`、`FShortName`、`FCreateOrgId`、`FUseOrgId`、`FGroup`、`FSALDEPTID`、`FSALGROUPID`、`FSELLER`、`FRECCONDITIONID`、`FSETTLETYPEID`（`{FNumber}`）+ 跟单员 `F_UNW_Base_kyb: {FStaffNumber}`；View 原样回传也会因缺 F 键报必填。
  - **已审核(C)客户**：`unAuditBill` → 重新 View → Save → `submitBill` → `auditBill` → 独立 View 回查。简称校验「必须以 0 开头」在本批 300 条 dry-run 中全部通过。
  - 执行结果：299 条逐条回查通过（试点 CTK000008 另有探针改动，见下），数据库 `F_UNW_BASE_KYB_W5C = 830084` 为 0，基线 300 条的跟单员、销售员、编码、单据 C / 禁用 A 均未变。证据：`output/customer-followup1-clear-baseline-2026-10-16.json`、`output/customer-followup1-clear-log-2026-10-16.json`；脚本 `scripts/scratch/2026-10/clear-customer-followup1.js`（默认 dry-run）、`verify-clear-customer-followup1.js`（只读复核）。
  - 试点 CTK000008 的写法探针曾把其跟单员1临时改为叶珊妹（错误的 `FNumber` 写法后又因 `FStaffNumber` 写入），随后已清空；该客户的探针未逐字段 diff，仅确认跟单员、销售员、状态与基线一致。

### 查用户最后登录时间

- 登录明细在 **`T_BAS_USERLOGINRECORD`**（`FUSERID` / `FDATETIME` / `FCLIENTIP` / `FCLIENTTYPE` / `FGATEWAYIP` / `FCOMPUTERNAME` / `FLOGINRESULTTYPE`）。取某用户的最后登录：

```sql
SELECT TOP 3 FUSERID, CONVERT(varchar(19), FDATETIME, 120) AS 时间, FCLIENTIP, FLOGINRESULTTYPE
FROM T_BAS_USERLOGINRECORD WHERE FUSERID=<内码> ORDER BY FDATETIME DESC;
```

- **`T_SEC_USER.FLOGINCOUNT` 不可信**：实测账号 `TK03525` 有 265 条登录记录，但 `FLOGINCOUNT=0`。判定"多久没登录"只认 `T_BAS_USERLOGINRECORD`。
- `T_SEC_USERLOGINSITUATION`（`FUSERID`/`FDATETIME`）保存每个用户的最后登录时刻，可作交叉印证；`T_BAS_USERLOGINSTATISTICS`（登录/登出会话）可能为空，不必依赖。
- `FDATETIME` 的时钟与服务器 `GETDATE()` 一致（用同库最近登录的 Top 值校准时区，别用驱动返回的 `Z` 直接当 UTC）。

### 查用户所属用户组与角色

- **用户组**（部门性质的"组"）：`T_SEC_USER.FPRIMARYGROUP` → `T_SEC_USERGROUP_L.FNAME`（`FLOCALEID=2052`）。本账套 14 个：销售部/财务部/总经办/玻封部/PMC/品质部/工程部/采购部/生产部/仓库/人事部/一部/二部/三部。
- **角色**：用 `T_SEC_ROLEUSER`（`FUSERID` + `FROLEID`）→ `T_SEC_ROLE_L.FNAME`。
  **不要用 `T_SEC_USERROLEMAP`**：它的键是 `FENTITYID`，实测按用户内码查不到该用户的角色。
- 用户组与角色是两套独立的东西，回答"这账号归哪个组/有哪些权限"要分别查。

#### 移除单一用户的角色分配（2026-10-15 实测）

- 分清“移除某用户的角色分配”和“删除角色定义”；前者可从角色表单 `SEC_KDRoles` 的用户关系分录保存，不调用角色Delete，不写SQL。
- 先实时View用户和角色，按用户ID/账号/姓名及角色ID/编码锁定；核对角色全部用户、用户全部组织与角色，默认dry-run。角色表单主键是 `FRoleID`，用户关系实体 `FEntityUser`，分录主键 `FEntityID`，View中对应 `RoleUser[].Id`。
- 当目标用户在该角色中唯一且明确授权移除时，`Model:{FRoleID:角色内码,FEntityUser:保留分录.map(x=>({FEntityID:x.Id}))}`，`NeedUpDateFields:['FEntityUser']`、`IsDeleteEntry:true`，保留其他用户原分录主键；只传已有主键避免重新解析其他用户（可能已禁用）。不改变角色编码、类型、属性、定义或其他用户关联。
- `SEC_KDRoles`标准Save服务会同步用户组织角色映射，本次已通过独立View用户/角色以及 `T_SEC_ROLEUSER`、`T_SEC_USERORG`、`T_SEC_USERROLEMAP`复查。必须确认仅移除目标配对，其余用户与角色分录原值保留、用户组织范围与许可分组未变。
- 用户侧嵌套模型 `SEC_User/FOrgInfo/FRoleInfo` 本次先返回成功但关联不变，空更新白名单重试后又对所有原角色报“不存在”；原因尚未完整验证，不作为可用方案。不要把保存成功当成移除成功；失败脚本 `scripts/scratch/2026-10/remove-sunmengyu-warehouse-role.js` 已拦截apply。
- 成功案例：业务员ATK03775仅移除仓管员SCM06_SYS，保留其余5角色，其他12个账号的仓管员关联不变。脚本 `scripts/scratch/2026-10/remove-sunmengyu-warehouse-via-role.js` 默认dry-run；证据 `output/sunmengyu-remove-warehouse-via-role-before/save/after-2026-10-15.json`（三个独立文件）。人数与角色是当日快照，复用重新查询。

### 用户许可分组（是不是"专业应用组"）

- **这不是角色权限，是许可（计费）分组**：用户表单里的字段名就叫「**许可分组**」(`FAppGroup` / 列 `T_SEC_USER.FAPPGROUP`)。
- 取值是许可分组的枚举（`T_META_FORMENUM` FID `20ac82c5-a441-457e-8651-2de5d6da088a`），其中：
  - `Pro` → **专业应用组**
  - `All` → **全员应用组**
  - 其余是各云/模块代码（MFG、SCM、PLM、BOS、CRM…）
- **枚举项的中文名在 `T_META_FORMENUMITEM_L.FCAPTION`（`FLOCALEID=2052`），不是 `FNAME`**；关联键是 `FENUMID`（不是 `FID`）。用 `T_META_FORMENUMITEM.FID='<枚举FID>'` 取项，再 join `_L` 拿 caption。
- 本账套实测（2026-09，112 用户）：`Pro`／专业应用组 50 个；`FAPPGROUP` 为空 59 个（即**不在专业应用组**）；未设置 3 个（系统账号）。**为空 ≠ Pro**，判断"在不在专业应用组"只看是不是 `Pro`。
- 常见误判：把用户的 `FPRIMARYGROUP`（用户组，部门性质）或角色当成许可分组。三者是不同字段。
- **数许可占用**：直接数 `FAPPGROUP='Pro'` 的用户（本账套实测全部为启用；若要严格可再加 `FFORBIDSTATUS='A'`）。**许可"总量"库里查不到**：`T_SEC_REGUSER`（数据中心库与配置库）实测为空，租户注册 blob `T_BAS_TENANTREGUSER.FREGUSER` 是加密 image，取不到总数——总量只能看管理中心许可页/许可文件。`FISREGISTER` 是云通行证绑定状态，**不是**许可计数口径。
- **一台服务器可能有多个数据中心（账套）**：`sys.databases` 里每个 `AIS*` 是一个账套，各自有独立的 `T_SEC_USER`；许可是否跨账套共用要以管理中心为准，别只数当前库。（2026-09 本服务器：`<K3_MAIN_DB>`=本账套 112 用户/Pro 50；`<K3_SUB_DB>` 另一账套 92 用户/Pro 73 但仅 19 正常。）









### 部门用户组须包含递归子组（2026-10-15纠正）

- 查询销售部不得仅按用户组名称等于销售部筛选。用户截图及实时表结构确认：T_SEC_USERGROUP.FID为主键、FPARENTID为父组，销售部111710/001下有一部598585/0011、二部598586/0012、三部598587/0013。按FPARENTID递归取全部子组后联接T_SEC_USER.FPRIMARYGROUP，默认FAPPGROUP=Pro。此层级和ID为当日快照，复用须重新查询。部门子组与业务员销售组须分开。
- 当日完整销售部专业应用组为15人，父组10人之外补入陶葆、刘晓丽、张怡、叶珊妹、刘栋梁。此前10人汇总和XLSX范围不完整，不得继续当全销售部结果使用；旧文件未自动覆写。新证据output/sales-department-descendants-permissions-2026-10-15.json，脚本scripts/scratch/2026-10/sales-descendants-customer-permissions.js。15人角色View与T_SEC_ROLEUSER一致，客户主档均有查看授权且未查到名称字段禁止；具体可见集合仍须目标账号验证运行时规则。

### 修改用户部门分组（2026-10-15 实证）

- 用户明确给出人员与目标部门后，修改的是 `SEC_User.FPRIMARYGROUP`，不是业务员销售组、角色或许可分组。先按姓名唯一定位账号，再 View 核对；目标组从 `T_SEC_USERGROUP` / `_L` 实时核对编码、名称和父组。
- 元数据 `SEC_User` 的 GroupField 明确 Key/PropertyName 为 `FPRIMARYGROUP`、关联表为 `T_SEC_USERGROUP`。最小保存已验证：`saveBill('SEC_User', { FUserID: id, FPRIMARYGROUP: { FID: groupId } }, ['FPRIMARYGROUP'], ['FUserID','FPRIMARYGROUP'])`；View 回查 `FPRIMARYGROUP_Id` 与 `FPRIMARYGROUP.Number`，再用数据库只读独立核对。
- 默认 dry-run；已是目标值直接跳过。批处理中如返回“使用业务单据：用户…业务操作冲突，请稍候再使用”，立即停止，先只读盘点已成功及未改对象，请占用者保存并关闭对应用户编辑窗口，不清锁、不用 SQL 绕过、不盲目重试。恢复前重新查询，跳过已完成对象。
- 当日案例：刘栋梁 TK01304 从跟单组移至国内部成功；陶葆 TK00338 原已在国内部；随后刘晓丽 TK00472 因 Administrator 编辑冲突未保存，后续三人未执行。此为部分完成快照，不代表后续状态。证据：`scripts/scratch/2026-10/change-six-user-departments.js`、`output/user-department-2026-10-15-apply.json`；复用须重查。不得把完整 SEC_User View 写入日志或工件，只记录本次必要字段。
- 同日续办结果：用户关闭刘晓丽编辑窗口后，重新 dry-run 与实时前值核对，再执行剩余四人保存成功。WebAPI View 与数据库独立回查全部六人：国内部为刘栋梁、刘晓丽、陶葆、沈君梅，国际部为商务员A、覃琼燕。最终证据 `output/user-department-2026-10-15-verified.json`；上条部分完成记录保留为历史过程。
