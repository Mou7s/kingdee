# 设备运维管理（`TK_EQM`）BOSIDE 搭建、发布与权限验收交接执行单

## 目录

- [一、当前已验证基线（2026-11-20 10:33 核验）](#一当前已验证基线2026-11-20-1033-核验)
- [二、另一台电脑 Computer Use 必读防踩坑清单](#二另一台电脑-computer-use-必读防踩坑清单)
- [三、任务 1：搭建《设备维修单》（ADKB_EquipRepair）](#三任务-1搭建设备维修单adkb_equiprepair)
- [四、任务 2：搭建《设备保养单》（ADKB_EquipMaint）](#四任务-2搭建设备保养单adkb_equipmaint)
- [五、任务 3：主控台双端发布（SBWB 4 项）与全部签入](#五任务-3主控台双端发布sbwb-4-项与全部签入)
- [六、任务 4：权限补授、双通道验证与技能沉淀](#六任务-4权限补授双通道验证与技能沉淀)
- [七、给另一台电脑 Agent 的即用开场指令（可复制发送）](#七给另一台电脑-agent-的即用开场指令可复制发送)

> **用途**：供另一台已登录 BOSIDE 的电脑与 Computer Use Agent 仅通过 `git pull` 即直接接手完成《设备维修单》和《设备保养单》搭建、主控台发布、签入、权限补授及全链路验收。  
> **安全约束**：本文件属于公开 Git 仓库内容，严格不含任何密码、Token、手机号、IP、主机名、真实数据库名、公司全称或员工个人姓名；另一台电脑本地仍需准备好未跟踪的 `k3cloud.local.json`。

---

## 一、当前已验证基线（2026-11-20 10:33 核验）

| 模块 / 对象 | 现状 | 关键标识与数据库证据（复核前请重新只读查询） |
|---|---|---|
| 业务子系统 | 已建完成 | `设备运维管理`（编码 `TK_EQM`，`FSUBSYSID='6afe9ff618b898'`） |
| 主控台分组 | 已建 2 组 | `设备档案`（`SBDA`，`6afebbb818c408`）；`保养与维修`（`SBWB`，`6afebbcb18c40a`） |
| 《设备台账》基础资料 | 已建表、绑权、发布并签入 | `ADKB_Equipment`（模型 `400`，物理表 `T_ADKB_Equipment`，权限对象 `6afef41f18cb31` 共 26 项） |
| 《设备台账》菜单 | 桌面端 + 浏览器双端已启用 | `SBTZ`（设备台账 / `BOS_NEW` / `FTYPE=0`）与 `SBTZLB`（设备台账列表 / `BOS_VIEW` / `FTYPE=1`），均 `FSTATUS='1'` 且 `FHTMLSTATUS='1'` |
| 焊线部设备数据导入 | **已完成 152 条并全审核** | `T_ADKB_Equipment` 共 152 条（分类 `1` 焊线机 100 / `6` 夹具治具 47 / `7` 其他设备 5），全部 `FDOCUMENTSTATUS='C'`、使用部门 `BM000012`、责任工程师工号 `YG00084` |
| 专用角色与现有授权 | 已建并刷缓存 | `SBWB_ENGINEER`（设备运维工程师，`FRoleID=953117`）已获 `ADKB_Equipment` 26 项及 `BD_MATERIAL`/`BD_STOCK` `BOS_VIEW`，已配给 `TK4377`（`FUSERID=952928`，保留原 5 个角色 `110,145640,285028,392071,481674`，现共 6 个角色）；`ALL`（`FRoleID=100079`）亦已获 `ADKB_Equipment` 26 项并刷新全部成员缓存 |
| **尚未入库待建对象** | **待接手完成** | `ADKB_EquipRepair`（《设备维修单》）、`ADKB_EquipMaint`（《设备保养单》）在数据库 `T_META_OBJECTTYPE` 中均尚不存在；`SBWB` 分组下 4 项菜单尚未发布 |

---

## 二、另一台电脑 Computer Use 必读防踩坑清单

1. **安全与仓库红线（`AGENTS.md`）**
   - **严禁直接 SQL 写入** `T_META_*`、`T_SEC_*` 或任何业务表；元数据和发布只能通过 BOSIDE GUI 完成，角色与功能权限必须通过官方 WebAPI（`DynamicFormService.Save`）完成。
   - **严禁修改或签出任何金蝶标准表单**（如 `BD_*`、`PRD_*`、`SFC_*`、`FA_*`）。
   - 写操作脚本必须默认 dry-run，显式传 `--apply` 才写入；任何操作结束并等待用户或完成任务前，务必释放桌面控制权（`ControlStatus(release=true)`）。

2. **管理员权限一致性（防 Windows UIPI 拦截）**
   - `Kingdee.BOS.IDE.exe` 常以管理员（`TokenElevation=1`）运行；若 Computer Use 的普通权限 MCP 点击/移动无效，需确保从提权终端调用拖拽脚本或让 BOSIDE 与 MCP 同权限级别。

3. **BOSIDE 与 WebAPI 同账号会话互斥（`403 NO01`）**
   - 使用与 BOSIDE 相同的本地用户登录 `K3CloudWebAPI` 会直接踢出 BOSIDE 会话。
   - **因此，在 BOSIDE 运行期间，所有自动化 WebAPI 脚本必须使用独立管理员账号 `K3_ADMIN_USERNAME`（`Administrator`）**，严禁使用正在登录 BOSIDE 的开发账号调 WebAPI。

4. **BOSIDE V9.0 登录要求**
   - `Kingdee.BOS.IDE.exe` V9.0 入口强制禁用无界面 `NoUILogin` 并走 `frmCloudLogin` 云账号交互登录（且服务端 `isAllowCloudIDE=False` 时无网页设计器）。须由用户人工登录进入 BOSIDE 主界面后，再开始后续自动化步骤，严禁绕过认证。

5. **Win32 OLE `DoDragDrop` 拖拽控件要点（最关键）**
   - BOSIDE 表单设计器的 `OverlayWindow` 仅在收到真实 Win32 OLE `DoDragDrop`（且含 `createData`）时才会向画布或单据体添加字段；简单瞬移拖拽通常无法触发 `NavBar_MouseMove` 阈值，点选/双击也不会加控件。
   - Git 仓库已内置通用脚本 **[scripts/tools/boside_win32_drag.ps1](../../../../scripts/tools/boside_win32_drag.ps1)**，使用 Win32 `SendInput`（按下左键 → 右移 15px 越过拖拽阈值 → 30 步平滑移动到目标坐标 → 松开左键）触发 BOSIDE OLE `DoDragDrop`。调用示例（先根据当前屏幕截图与分辨率确认坐标）：
     ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/tools/boside_win32_drag.ps1 -X1 80 -Y1 468 -X2 480 -Y2 248
     ```
   - ⚠️ **Tab 切换坑**：`DynamicFormDesigner` 仅在当前激活的设计页签挂接 `IToolBoxView.OnDoDragDrop`；同一 BOSIDE 会话里**不要打开又关闭其他表单设计器标签页**（关闭其他页签会解绑当前设计器钩子导致光标变禁放 `NoDrop`）。一次只新建并做完当前这一张单据，保存签入后再新建下一张。
   - 必须从左侧工具箱 **`常规`** 页签拖字段控件，不要用「通用」页签（后者只是纯界面布局/标签控件）。
   - 表头字段拖到**上半区空白画布**，分录字段拖到**下半区单据体表格的列头灰色横条区域**松开。

6. **画布尺寸与唯一标识**
   - 不要强拖蓝色设计边框缩放画布，直接在右下角 **「属性」** 栏顶部下拉框选中 **`单据头-FBillHead`** 修改 `宽度=1050`、`高度=650`，选中 **`单据体-FEntity`** 修改 `上=360`、`高度=220`、`宽度=960`。
   - 「新建向导」弹窗中的唯一标识文本框默认预填了 `ADKB_`，输入时务必全选覆写，避免变成 `ADKB_ADKB_EquipRepair`。
   - 文本输入框优先使用剪贴板粘贴（`Ctrl+V`），防止中文输入法拦截英文标识。

7. **枚举新建顺序**
   - 选中下拉列表字段 → 右下属性 `枚举类型 (none)` 点 `...` → 点 **`新增`** → **先填顶部「枚举类型」名称**（为空无法保存）→ 逐行点 **`新增行`** 填编码值与名称 → 点左下 **`自动生成序号`** → **`保存并关闭`** → 在枚举列表选中它确认绑定。

---

## 三、任务 1：搭建《设备维修单》（`ADKB_EquipRepair`）

1. **前置确认**：先用只读 SQL 核对 `T_META_OBJECTTYPE` 尚无 `ADKB_EquipRepair`。若此前别的客户端残留未保存页签请先确认关闭。
2. **新建对象**：在右侧项目树展开 **`生产制造 → 设备运维管理 → 单据`** → 右键（或顶部 `新建`）→ 类型选 **`单据`** → 模板选 **`1.2.1 带分录业务单据模板`** → 名称填 `设备维修单`，唯一标识 **`ADKB_EquipRepair`** → 确定。
3. **实体属性设置**（在右下角「属性」栏顶部下拉框切换）：
   - 选中 **`单据头-FBillHead`**：`表名` = `T_ADKB_EquipRepair`，`宽度` = `1050`，`高度` = `650`。
   - 选中 **`单据体-FEntity`**：`标题` = `更换备件明细`，`表名` = `T_ADKB_EquipRepairEntry`，`上` = `360`，`高度` = `220`，`宽度` = `960`。
4. **拖入表头字段（13 个，拖至上半区画布）**：

| 序号 | 控件类型 | 标识（Key） | 名称 / 标题 | 关键属性设置 |
|---:|---|---|---|---|
| 1 | 组织 | `F_ADKB_OrgId` | 组织 | 勾选 **必录** |
| 2 | 基础资料 | `F_ADKB_Equipment` | 设备 | 勾选 **必录**；基础资料选 `ADKB_Equipment` |
| 3 | 基础资料 | `F_ADKB_UseDept` | 使用部门 | 基础资料选 `BD_Department` |
| 4 | 日期 | `F_ADKB_ReportDate` | 报修日期 | 勾选 **必录** |
| 5 | 基础资料 | `F_ADKB_Reporter` | 报修人 | 基础资料选 `BD_Empinfo` |
| 6 | 基础资料 | `F_ADKB_Repairer` | 维修工程师 | 基础资料选 `BD_Empinfo` |
| 7 | 文本 | `F_ADKB_FaultType` | 故障类别 | 长度 `50` |
| 8 | 多行文本 | `F_ADKB_FaultDesc` | 故障现象 | 长度 `500` |
| 9 | 长日期 | `F_ADKB_StartTime` | 维修开始时间 | 默认 |
| 10 | 长日期 | `F_ADKB_EndTime` | 维修完成时间 | 默认 |
| 11 | 小数 | `F_ADKB_Downtime` | 停机时长(小时) | 精度 `2` |
| 12 | 多行文本 | `F_ADKB_Solution` | 处理措施 | 长度 `1000` |
| 13 | 下拉列表 | `F_ADKB_RepairResult` | 维修结果 | 新建枚举（如 `设备维修结果`）：`1=已修复, 2=待观察, 3=委外维修, 4=建议报废` |

5. **拖入单据体 `FEntity` 字段（5 个，拖至表格列头区）**：

| 序号 | 控件类型 | 标识（Key） | 名称 / 标题 | 关键属性设置 |
|---:|---|---|---|---|
| 1 | 基础资料 | `F_ADKB_Material` | 备件物料 | 基础资料选 `BD_MATERIAL` |
| 2 | 基础资料 | `F_ADKB_Unit` | 单位 | 基础资料选 `BD_UNIT` |
| 3 | 小数 | `F_ADKB_Qty` | 更换数量 | 精度 `2` |
| 4 | 基础资料 | `F_ADKB_Stock` | 领用仓库 | 基础资料选 `BD_STOCK` |
| 5 | 文本 | `F_ADKB_EntryNote` | 备件备注 | 长度 `200` |

6. **绑定主业务组织 + 保存建表 + 绑定权限对象（必须按顺序）**：
   1. 属性下拉框切回顶层 **`设备维修单-_Bill`** → 将 **`主业务组织`** 绑定为 **`组织 (F_ADKB_OrgId)`**。
   2. 点击工具栏 **`保存`**，等待输出窗口确认 `保存操作结束`（生成 `T_ADKB_EquipRepair` 与 `T_ADKB_EquipRepairEntry` 物理表）。
   3. 顶部菜单 **`编辑(E) → 权限控制设置`** → 点 **`初始化权限对象`** → 切到 **`操作权限控制`** → 点 **`自动匹配`** → 关闭弹窗。
   4. **再次点击 `保存`**，使权限对象绑定关系正式落库。

---

## 四、任务 2：搭建《设备保养单》（`ADKB_EquipMaint`）

1. **新建对象**：选中 **`单据`** → **`新建`** → **`1.2.1 带分录业务单据模板`** → 名称填 `设备保养单`，唯一标识 **`ADKB_EquipMaint`** → 确定。
2. **实体属性设置**：
   - 选中 **`单据头-FBillHead`**：`表名` = `T_ADKB_EquipMaint`，`宽度` = `1050`，`高度` = `650`。
   - 选中 **`单据体-FEntity`**：`标题` = `保养项目与耗材明细`，`表名` = `T_ADKB_EquipMaintEntry`，`上` = `360`，`高度` = `220`，`宽度` = `960`。
3. **拖入表头字段（10 个，拖至上半区画布）**：

| 序号 | 控件类型 | 标识（Key） | 名称 / 标题 | 关键属性设置 |
|---:|---|---|---|---|
| 1 | 组织 | `F_ADKB_OrgId` | 组织 | 勾选 **必录** |
| 2 | 基础资料 | `F_ADKB_Equipment` | 设备 | 勾选 **必录**；基础资料选 `ADKB_Equipment` |
| 3 | 基础资料 | `F_ADKB_UseDept` | 使用部门 | 基础资料选 `BD_Department` |
| 4 | 日期 | `F_ADKB_MaintDate` | 保养日期 | 勾选 **必录** |
| 5 | 下拉列表 | `F_ADKB_MaintType` | 保养类型 | 新建枚举（如 `设备保养类型`）：`1=日保, 2=周保, 3=月保, 4=季保, 5=年保, 6=专项保养` |
| 6 | 日期 | `F_ADKB_PlanDate` | 计划保养日期 | 默认 |
| 7 | 日期 | `F_ADKB_NextDate` | 下次保养日期 | 默认 |
| 8 | 基础资料 | `F_ADKB_Maintainer` | 执行工程师 | 基础资料选 `BD_Empinfo` |
| 9 | 下拉列表 | `F_ADKB_MaintResult` | 保养结论 | 新建枚举（如 `设备保养结论`）：`1=正常, 2=异常需维修, 3=限期整改` |
| 10 | 多行文本 | `F_ADKB_Summary` | 保养总结 | 长度 `1000` |

4. **拖入单据体 `FEntity` 字段（5 个，拖至表格列头区）**：

| 序号 | 控件类型 | 标识（Key） | 名称 / 标题 | 关键属性设置 |
|---:|---|---|---|---|
| 1 | 文本 | `F_ADKB_CheckItem` | 保养项目 | 长度 `200` |
| 2 | 文本 | `F_ADKB_CheckResult` | 检查结果 | 长度 `50` |
| 3 | 基础资料 | `F_ADKB_Material` | 消耗备件 | 基础资料选 `BD_MATERIAL` |
| 4 | 小数 | `F_ADKB_Qty` | 消耗数量 | 精度 `2` |
| 5 | 文本 | `F_ADKB_EntryNote` | 明细备注 | 长度 `200` |

5. **绑定主业务组织 + 保存 + 绑定权限对象**：
   - 属性栏选中 **`设备保养单-_Bill`** → 绑定 **`主业务组织 = F_ADKB_OrgId`** → **`保存`** → **`编辑(E) → 权限控制设置 → 初始化权限对象 → 操作权限控制 → 自动匹配`** → **再次 `保存`**。

---

## 五、任务 3：主控台双端发布（`SBWB` 4 项）与全部签入

1. 顶部菜单 **`发布 → 发布到主控台`** → 定位 **`生产制造 → 设备运维管理 → 保养与维修 (SBWB)`**。
2. 逐条新增以下 4 个菜单项（⚠️ **每一条底部务必同时勾选「桌面端」和「浏览器」**）：

| 编码 | 名称 | 业务对象 | 权限项（点 `...` 选） | 发布类型 | 显示序号 |
|---|---|---|---|---|---:|
| `SBWXD` | 设备维修单 | `ADKB_EquipRepair` | 新增（`BOS_NEW`） | 维护 | 10 |
| `SBWXDLB` | 设备维修单列表 | `ADKB_EquipRepair` | 查看（`BOS_VIEW`） | 列表 | 20 |
| `SBBYD` | 设备保养单 | `ADKB_EquipMaint` | 新增（`BOS_NEW`） | 维护 | 30 |
| `SBBYDLB` | 设备保养单列表 | `ADKB_EquipMaint` | 查看（`BOS_VIEW`） | 列表 | 40 |

3. 关闭发布窗口，回到项目树检查并将 **`ADKB_Equipment`**、**`ADKB_EquipRepair`**、**`ADKB_EquipMaint`** 全部执行 **`签入`**（避免对象留在未签入锁定状态）。
4. 操作完成或暂停等待用户时，调用 `ControlStatus(release=true)` 释放桌面控制权。

---

## 六、任务 4：权限补授、双通道验证与技能沉淀

### 1. 官方 WebAPI 补授两张新单据权限与刷新缓存
两张单据在 BOSIDE 保存并绑定权限对象后，需分别将 **`ADKB_EquipRepair`** 与 **`ADKB_EquipMaint`** 的全量权限授给角色 **`SBWB_ENGINEER`**（`FRoleID=953117`）与 **`ALL`**（`FRoleID=100079`），随后刷新受影响用户的 `SEC_User` 缓存：

- **若另一台电脑已直接拷贝了原电脑的未跟踪脚本**（`scripts/scratch/2026-11/grant-eqm-role-tk4377.js` 与 `grant-eqm-to-all-role.js`），直接运行即可（默认 dry-run，加 `--apply` 执行）：
  ```powershell
  bun scripts/scratch/2026-11/grant-eqm-role-tk4377.js --apply
  bun scripts/scratch/2026-11/grant-eqm-to-all-role.js --apply
  ```
- **若另一台电脑仅通过 `git pull` 拉取仓库（无原电脑的 `scripts/scratch/` 目录）**，按下列自包含步骤编写默认 dry-run、`--apply` 写入的 `scripts/scratch/2026-11/` 一次性脚本执行即可（**严禁直接 SQL 写 `T_SEC_*` 表**）：
  1. **使用管理员连接 WebAPI**：从本地 `k3cloud.local.json` 读取 `K3_ADMIN_USERNAME`、`K3_ADMIN_PASSWORD` 登录 `K3CloudWebAPI`（切勿使用与当前 BOSIDE 同名的日常账号，防止踢掉 BOSIDE 会话）。
  2. **查询绑定权限项（只读 SQL）**：
     ```sql
     SELECT otp.FOBJECTTYPEID, otp.FPERMISSIONOBJECTID, pe.FPERMISSIONITEMID, i.FNUMBER
     FROM T_SEC_OBJECTTYPEPERMISSION otp
     JOIN T_SEC_PERMISSIONOBJECTENTRY pe ON pe.FITEMID = otp.FPERMISSIONOBJECTID
     JOIN T_SEC_PERMISSIONITEM i ON i.FITEMID = pe.FPERMISSIONITEMID
     WHERE otp.FOBJECTTYPEID IN ('ADKB_EquipRepair', 'ADKB_EquipMaint')
     ORDER BY otp.FOBJECTTYPEID, i.FNUMBER;
     ```
  3. **检查既有权限头**：查 `T_SEC_FUNCPERMISSION WHERE FROLEID IN (953117, 100079) AND FOBJECTTYPEID IN ('ADKB_EquipRepair', 'ADKB_EquipMaint')`，避免重复建头；对缺省对象的角色通过 `DynamicFormService.Save` 保存 `SEC_FuncPermissionInfo`：
     ```js
     {
       NeedUpDateFields: [],
       IsDeleteEntry: false,
       IsVerifyBaseDataField: true,
       ValidateFlag: true,
       IsAutoSubmitAndAudit: false,
       Model: {
         FRoleId: { FNumber: roleNumber }, // "SBWB_ENGINEER" 或 "ALL"
         FObjectTypeId: { FID: formId },   // "ADKB_EquipRepair" 或 "ADKB_EquipMaint"
         FEntityPermission: items.map((itemId) => ({
           FPermissionItemId: { FItemID: itemId },
           FPermissionStatus: "0", // 允许
           FDataRule: " ",         // 单个空格
         })),
       },
     }
     ```
  4. **刷新受影响用户 `SEC_User` 缓存**：查询 `T_SEC_ROLEUSER` 下分别归属 `953117`（如 `952928`/`TK4377`）与 `100079`（`ALL` 全成员）的全部 `FUSERID` 去重列表，逐个调用：
     ```js
     await api.post("DynamicFormService.Save", {
       formid: "SEC_User",
       data: {
         NeedUpDateFields: [],
         IsDeleteEntry: false,
         IsVerifyBaseDataField: true,
         ValidateFlag: true,
         IsAutoSubmitAndAudit: false,
         Model: { FUserID: uid },
       },
     });
     ```

### 2. SQL + WebAPI + 实测登录验收标准（必须全部核对通过）
1. **元数据与权限只读 SQL 核对**：
   - `T_META_OBJECTTYPE` 中同时存在 `ADKB_Equipment`、`ADKB_EquipRepair`、`ADKB_EquipMaint`；
   - `T_SEC_OBJECTTYPEPERMISSION` 中三者均已绑定非空 `FPERMISSIONOBJECTID`；
   - `T_META_CONSOLEDETAIL` 中 `SBTZ`、`SBTZLB`、`SBWXD`、`SBWXDLB`、`SBBYD`、`SBBYDLB` 共 6 项均满足 `FSTATUS='1' AND FHTMLSTATUS='1'`；
   - `T_ADKB_Equipment` 保持 152 条全部 `FDOCUMENTSTATUS='C'`；
   - `TK4377`（`952928`）在 `T_SEC_ROLEUSER` 与 `T_SEC_USERROLEMAP` 中保留原有 5 个角色（`110,145640,285028,392071,481674`）外加 `SBWB_ENGINEER`（`953117`），共 6 个角色；
   - `T_SEC_FUNCPERMISSION` 中 `953117`（`SBWB_ENGINEER`）与 `100079`（`ALL`）均对 `ADKB_Equipment`、`ADKB_EquipRepair`、`ADKB_EquipMaint` 全部权限项为 `'0'`。
2. **`TK4377` 独立账号实测（无脏数据留存）**：
   - 使用 `TK4377` 登录 WebAPI（或在金蝶客户端/HTML5 重登）：
     - 查询 `ADKB_Equipment` 仍能查出全部 152 条；
     - 对 `ADKB_EquipRepair` 与 `ADKB_EquipMaint` 各跑一次草稿 **Save → View → Delete** 冒烟（引用已导入焊线机如 `TK-WB1706002-SF`），确认权限全通且删单后 SQL 核实 `SELECT COUNT(*) FROM T_ADKB_EquipRepair` 与 `T_ADKB_EquipMaint` 均为 **`0`**。
3. **收尾文档与测试检查**：
   - 将已落地的 `ADKB_EquipRepair` 与 `ADKB_EquipMaint` 补充记录到 [k3cloud-form-ids.md](../../../kingdee-k3cloud/references/system/k3cloud-form-ids.md)（严格脱敏，参照 `AGENTS.md` §5.3）；
   - 运行并通过：`bun run test:safety`、`bun scripts/tools/audit_skill_routes.js`、`bun test ./scripts/tests/audit_skills.test.js`、`git diff --check`。

---

## 七、给另一台电脑 Agent 的即用开场指令（可复制发送）

> 请先阅读 `.agents/skills/kingdee-system-admin/references/system/eqm-boside-handoff.md` 与仓库 `AGENTS.md`。我已在当前电脑登录好了金蝶 BOSIDE（设备运维管理 `TK_EQM`），请先只读核对数据库现状，然后严格按交接文档完成以下工作：  
> 1. 在 BOSIDE 搭建并保存《设备维修单》（`ADKB_EquipRepair`）和《设备保养单》（`ADKB_EquipMaint`），绑定权限对象，发布 4 个主控台菜单（桌面端+浏览器双勾选）并签入（拖拽统一使用 `scripts/tools/boside_win32_drag.ps1` 并遵守单页签与防踩坑规则）；  
> 2. 通过官方 WebAPI（使用 `K3_ADMIN_USERNAME` 登录，先 dry-run 后 `--apply`）给 `SBWB_ENGINEER`（`953117`）与 `ALL`（`100079`）补授两张新单据全量权限并刷新受影响 `SEC_User` 缓存（按交接文档第六节执行，或如有本机配套 `grant-eqm-*.js` 则直接补跑）；  
> 3. 完成 SQL、WebAPI（`TK4377` 建/查/删单冒烟不留脏数据）验收，并更新 `.agents/skills/kingdee-k3cloud/references/system/k3cloud-form-ids.md` 后跑通 `bun run test:safety`、`audit_skill_routes.js` 与 `audit_skills.test.js`。
