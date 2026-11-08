# K3 Cloud 用户权限与数据范围排查

## 目录

- [适用场景](#适用场景)
- [先区分两个权限层](#先区分两个权限层)
- [证据链](#证据链)
- [关键数据库对象](#关键数据库对象)
- [最容易漏掉的根因](#最容易漏掉的根因)
- [输出格式建议](#输出格式建议)
- [安全边界](#安全边界)
- [字段保密与角色拆分（2026-10-13）](#字段保密与角色拆分2026-10-13)
- [角色使用情况盘点（2026-10-17）](#角色使用情况盘点2026-10-17)
- [车间工序汇报审核范围（2026-10-29，待实施）](#车间工序汇报审核范围2026-10-29待实施)

## 适用场景

用户能看到不属于自己的客户、应收单、销售单或报表数据，或用户认为“只看自己”已经设置但实际没有生效时，按本参考逐层核对。它适用于金蝶原生单据/报表，也适用于本账套自建系统直连 K3 SQL 的边界检查。

## 先区分两个权限层

1. **功能权限**：能否打开菜单、调用“查看/查询/导出”等操作。
2. **数据权限**：打开后能看到哪些组织、客户、销售员或单据。

有功能权限不代表数据范围受限。尤其是自建页面通过 SQL Server 直查 K3 表时，不会自动继承 K3 Cloud 原生权限。

## 证据链

按以下顺序建立证据，不要只看用户界面的角色名称：

1. 用户：账号、用户 ID、禁用状态、组织、员工/业务员关联。
2. 用户角色：所有直接及间接角色，保留角色 ID；权限通常按角色并集计算。
3. 业务对象：确认页面实际使用的 FormId/报表对象，例如 `AR_RECEIVEBILL` 与 `AR_SumReport` 不是同一个对象。
4. 操作权限：查看、查询、引出等具体权限项，不能只看菜单是否存在。
5. 数据规则：该对象、该操作是否有 `FDATARULE`，规则名称、对象类型、规则字段和启用状态。
6. 业务归属：客户的 `FSELLER`、销售员业务员分录、员工关联是否能映射到当前账号。
7. 实际样本：从截图或当前查询中挑选一至三条非本人客户，回查客户主数据上的销售员，形成可复核证据。

## 关键数据库对象

常用只读调查表：

- `T_SEC_USER`：用户、账号、组织/员工关联字段
- `T_SEC_ROLEUSER`、`T_SEC_USERROLEMAP`：用户与角色关系（先核实实际使用的关联表）
- `T_SEC_ROLE`、`T_SEC_ROLE_L`：角色状态和名称
- `T_SEC_FUNCPERMISSION`、`T_SEC_FUNCPERMISSIONENTRY`：角色对业务对象和操作权限
- `T_SEC_PERMISSIONITEM`、`T_SEC_PERMISSIONITEM_L`：操作编码/名称，如 `BOS_VIEW`
- `T_SEC_DATARULE`、`T_SEC_DATARULE_L`、`T_SEC_DATARULEGROUP*`：数据规则定义和规则字段
- `T_BD_CUSTOMER`、`T_BD_CUSTOMER_L`：客户及客户销售员字段
- `T_BD_OPERATORENTRY*`、`T_BD_STAFF*`、`T_HR_EMPINFO*`：业务员/员工关联

具体字段和表名必须先查当前账套元数据；不同版本不能凭经验拼接列名。

## 最容易漏掉的根因

### 1. 只给客户主档设置了规则

`BD_Customer` 上的“当前销售员只能看自己负责客户”，不等于 `AR_RECEIVEBILL` 或 `AR_SumReport` 自动继承相同范围。单据和报表必须分别检查。

### 2. 规则挂在了错误的对象

截图中的页面可能是报表对象，而不是单据对象。至少分别核对：

- `AR_RECEIVEBILL`：收款单（应收单为AR_receivable）
- `AR_SumReport`：应收汇总/分析类报表（以当前账套实际对象为准）

如果报表对象的 `FDATARULE` 为空，即使单据对象有“只看自己”，报表仍可能返回全量。

### 3. 角色并集放大范围

一个角色挂了“只看自己”并不能抵消另一个角色对同一对象授予的无规则查看权限。对每个角色输出：角色名、对象、操作名、对象禁用状态、权限状态和 `FDATARULE`；特别关注“查看权限存在但 `FDATARULE` 为空”的角色。

此检查同样适用于审核、反审核等写操作。2026-10-16只读核对商务员ATK00856：销售员基础权限和本账套销售主管的应收单审核/反审核使用规则6753b946a71c20（FSetAccountType不等于3），跟单角色同操作有权且规则为空，配置层存在放宽路径；未以目标账号执行审核，不能称为实操验证。证据：`output/songjinmei-role-permissions-2026-10-16.json`、`output/songjinmei-permission-summary-2026-10-16.json`。角色精简须同时比较功能项、数据规则与禁止项；单纯按对象/操作计算的重复或独有数量不能证明移除角色后数据范围不变。规则XML中的当前人动态条件可能按调查登录身份展开，不得把Administrator等展开值当作目标用户的固定授权范围。

2026-10-16用户批准商务员A销售跟单边界调整后，采用仅绑定该账号的禁止角色SJM_LIMIT_V1（933869），避免修改共享旧角色或在报表迁移不完整时移除角色。默认dry-run后配置17个普通对象125项操作禁止，再分配目标用户；逐对象WebAPI/SQL回读，全表角色分配差异仅新增111677/933869，独立核对有效操作1340→1215、无新增授权、原字段和基础资料范围未变。数量按对象+权限项内码计算，不按操作编码。工具`configure-songjinmei-boundaries.js`与`verify-songjinmei-boundaries.js`位于`scripts/scratch/2026-10/`；证据`output/songjinmei-boundaries-2026-10-16T01-30-24-580Z/`。销售系统参数SAL_SystemParameter为220类型，新建功能授权受过滤限制，修改/发送短信两项未处理；当前保留旧6角色并加专属限制，共7角色，三角色合并及客户/单据范围统一未完成，未用目标账号实测。禁止角色覆盖是权限收紧方案，不可称为角色合并完成，也不能把旧范围保留称为已实现仅负责客户。

### 4. 账号与业务员没有正确绑定

**当前用户操作偏好（2026-10-16明确纠正）**：金蝶权限配置仅使用WebAPI，不使用浏览器；WebAPI当前已验证路径不能完成的项目，应列出业务对象、角色、操作/字段及目标值，由用户在前端手工处理，再以WebAPI回读。不能因已有浏览器路径而自动接管。用户明确要求直接修改既有共享跟单666737，并接受已说明的其他成员影响，此授权取代下方只读预案中的独立新岗位角色建议；不得继续把“共享角色不改”作为阻塞理由。原共享角色其他成员不擅自迁移。

**权限修改现行默认路径（2026-10-21用户最新明确约定）**：用户在15:03~15:04实测确认“原角色修改权限→重新保存用户”恢复查看成功后，明确要求“以后记得设置完权限之后记得去保存一下用户”。后续WebAPI保存角色权限后，必须再保存受影响用户 `SEC_User`，模型仅 `{FUserID:用户内码}`，`NeedUpDateFields=[]`、`IsDeleteEntry=false`，然后独立回读并验证目标账号实际行为；共享角色须实时查全成员逐一保存。用户同时授权本次重新保存全部用户。此最新约定取代本会话较早“暂以同名重建角色修改权限”的默认办法；保留角色内码的原角色修改加用户保存是现行路径，同名重建仅为后备，不再声称必须删除重建或只能部署二开。其他对象/操作/组织和多成员场景仍需实际验证，不把用户推广使用的约定表述为全场景均已实测。工具 `scripts/tools/refresh_user_permissions.js` 默认dry-run，显式 `--apply` 写入。

**保留的同名重建后备路径**：在用户指定的角色及权限调整范围内，完整读取与备份→移除原分配→删除旧角色→新建同名角色（默认保留原编码，但内码必然变化）→恢复全部未调整权限并写入目标变更→恢复全部原成员/组织分配→独立回读→用户或目标账号实际验证。用户已允许按授权任务实施必要的同名重建，不为该已约定路径重复索取确认。

- 每次仍先实时预检、默认dry-run，再显式apply；备份包括全部业务对象操作、字段限制、数据规则、基础资料联动范围、角色属性、成员和组织映射。不得将专属测试中只写一项权限的模型照搬给业务角色。
- 同名重建改变角色内码，须核对岗位、工作流、项目团队等引用及共享角色全部成员，确认能完整恢复且目标权限的共享影响在本次业务授权范围内。该临时路径不是任意改动其他共享角色或丢弃原引用的授权；无法保真迁移时停在写入前，给出具体阻塞项。
- 逐步验证移除、删除、新建、完整权限恢复和成员恢复；失败不盲重试。实际行为验证前只称配置完成，不能仅凭Save成功或回读宣称权限已生效。
- 已知本现场标准角色Delete可能留下旧权限头，而单删权限头报 `FForbidStatus` 校验错误；记录残留并披露，不擅自SQL清理。该默认路径是用户接受的暂行方案，非已证明的底层缓存修复，也不保证覆盖未验证的特殊对象或外部角色引用。
- 证据与已验证范围见本文件“WebAPI 权限回读与实际生效边界”及2026-10-21闭环记录：TK2869 / SAL_SaleOrder / BOS_VIEW；934184禁止、934185有权由用户分别确认，最后测试角色已删除。

本轮已修改现有跟单，创建跟单限制FOLLOW_LIMIT_V1/933909，未切换业务员B原5角色。证据`output/longlu-shared-follow-merge-1792136861656/`：普通功能/范围与7类字段已逐项双查；35类特殊对象迁移已读回。用户禁止浏览器之前，标准授权界面以全无权保存可建立特殊对象授权头，不先扩权；后续省略FObjectTypeId按已有FItemID用WebAPI迁入。前端显示名可能不同于元数据：SAL_SystemParameter显示“销售系统参数”，SAL_SOChangeSynPriceRpt显示“新变更单变更单价同步更新单据价格查询”；不得将精确名称过滤零行视为对象不存在。该界面路径仅作为历史证据，当前不再执行。

同轮客户规则FOLLOW_CUSTOMER_UNION_V1/6ad1dacd4b5a62已在禁止浏览器前保存，顶层FilterSetting含原5fe586b214b2c2四个动态条件与6a5ad27f022535两个动态条件的纯OR；经SQL/WebAPI核对后，仅绑定跟单的客户查看及出库明细报表客户基础资料范围。未修改两个源规则，未把Administrator展开值硬编码。前端fill显示文字可能未触发金蝶模型更新，保存返回名称/编码必填空；实际键入触发输入事件后才保存成功。后续通过WebAPI读顶层FilterSetting验证等价，不把嵌套XML或IsSuccess当作条件生效。尚缺STK_StockSummaryRpt和STK_StockDetailRpt两张无有效查看入口报表的38个字段禁止迁入；用户手工补头/字段后再WebAPI核对，不提前移除源角色。WebAPI-only独立检查脚本`scripts/scratch/2026-10/verify-longlu-merge-webapi-only.js`及待办`output/业务员B三角色合并待手工补齐_2026-10-16.md`。

2026-10-16业务员B三角色合并只读预案：用户明确先做“全员角色＋跟单＋跟单限制”的重复角色归并，不沿用此前建议的岗位收紧。先核对目标角色共享成员：跟单666737当前8人，将业务员B有效有权项补入的模拟会使张怡TK03047新增855项有效功能；其余成员功能无新增不代表数据范围及字段等价。个人迁移优先使用未分配的岗位目标角色，不擅自修改/重命名共享角色或迁移其他用户。全员110额外带来5项公共查看，需单独披露。客户查看原销售员本人规则与跟单本人规则须保留动态OR并集；不能为收敛三角色任选一条或放空规则。此为评估，未修改权限；证据：`output/longlu-three-role-merge-audit-2026-10-16.json`、`output/longlu-three-role-merge-impact-2026-10-16.json`、`output/业务员B三角色合并方案_2026-10-16.md`。数量为当日快照，实施前重查。

不能因为账号姓名和业务员姓名相同就判定绑定正确。应从用户关联字段追到员工、业务员编码和有效组织分录，再确认客户 `FSELLER` 使用的是同一业务员实体/分录。

### 客户列表为空时检查个人查询方案（2026-10-16）

- 当当前角色授权与截图空列表不符，先区分授权、个人查询方案、左侧客户分组及状态过滤。搜索框显示空值不能单独证明保存方案没有条件。
- 只读核对 `T_BAS_FILTERSCHEME` 的表结构，再按目标 `FUSERID`、`FFORMID='BD_Customer'` 取 `FSCHEME`，分别检查 `FilterSetting`、`QuickFilterSetting`、`StatusFilterSetting`、组织及行数限制；不要直接用 SQL 修改方案。
- 2026-10-16 跟单员A TK00206（111060）案例：个人方案66dc00d36a6140的 `QuickFilterSetting` 保存 `FSELLER.FName` / Compare17 / 跟单员A；刘栋梁客户分组TK01304实时157家，销售员均129186，销售组营销三部。跟单员A销售员133543当前包含营销三部等5组；销售总监查看挂XSGLY，另有总经理无规则查看。保存的本人销售员筛选与刘栋梁分组叠加可产生零行，不能据此继续扩大授权。
- 初次调查仅证实保存配置和数据分布，未由Agent登录目标账号验证。随后用户于2026-10-16反馈“good 解决了”，确认上述个人方案筛选排查建议解决问题；具体清除操作由用户完成，未提供操作明细。此案例可记为用户确认解决，不应表述为Agent亲自完成前端验证。类似问题先指导在前端清除销售员条件、检查“过滤”窗口、重置后刷新；若仍空，再查会话缓存、组织、其他列表过滤及官方用户权限报表。
- 证据：`output/wangjiao-customer-visibility-live-2026-10-16.json`；实时只读探针 `scripts/scratch/2026-10/check-wangjiao-customer-visibility.js`。复用前重新查询。
- **列表分页与表头列漏斗筛选假象（2026-11-06 主管A `PRD_INSTOCK` 案例）**：用户反映“入库单列表里看不到未审核单据、表头『单据状态』下拉只有『已审核』，但从批号追踪能打开 `SCRK261106009`（审核中）”。只读核查 `T_BAS_FILTERSCHEME`、`T_BAS_OPERATELOG` 与 `T_PRD_INSTOCK` 证实并非权限或保存方案隔离：① 当日共生成 71 张入库单、299 条明细分录，列表按分录分页（每页 200 行，默认倒序），主管A 15:18 全选审核了第 1 页前 200 行（`SCRK261106022`~`071`），而上午创建的 `SCRK261106001`~`021`（98 条分录，含排在第 267~277 行的 `SCRK261106009`）落在第 2 页未审；② 16:39 主管A误点分页栏末页跳到 `第 691 页 / 691 页`（2024-10 最早的 78 行已审核单据，本页数量合计 `2,933`），且 K3 Cloud 列表表头列旁的漏斗筛选仅枚举**当前分页已加载行**的值，不查全表，因此当页全为已审核时下拉框不会出现 `审核中`。排查此类“列表找不到单据”时，须结合截图右下角页码/行数与 `T_BAS_OPERATELOG`（`当前页行数`），指导用户使用左上角「过滤」弹窗或快捷过滤栏做服务端查询。证据：`output/xiaoyuanping-prd-instock-pagination-2026-11-06.json`、只读脚本 `scripts/scratch/2026-11/verify-page691-and-page2.js`。

### 5. 自建 SQL 页面绕过原生权限

Nitro 路由中的 `getAuthSession` + `hasPermission` 只证明“谁能调用接口”，不等于销售员数据范围。若服务端 SQL 直接查询 `T_AR_RECEIVABLE`、`T_BD_CUSTOMER` 等表，必须把当前会话映射到业务员/客户范围，并在列表和明细接口都在服务端过滤；不能只靠前端筛选。

## 输出格式建议

最终结论分开写：

- **已验证事实**：账号、角色、对象、规则、员工/业务员映射、样本客户归属。
- **主因**：错误对象、无规则角色、账号映射缺失，或自建 SQL 未过滤。
- **未验证限制**：对象名称不确定、状态码未映射、缓存尚未刷新等。
- **修正建议**：先改最小权限范围；不要直接改业务数据。
- **验证动作**：权限刷新/重新登录后，用该账号检索一条本人客户和一条他人客户；同时验证列表、查看详情、导出三个入口。

## 安全边界

### 用户权限报表行数限制导致授权漏项（2026-10-13）

沈君梅 TK00012 的首次用户权限报表截图只显示销售员查看无权、销售主管查看有权且挂本人客户规则；同次数据库及 SEC_User View 还存在销售总监角色及无数据规则查看授权。用户随后确认报表右下角原先限制100行，改为200后，新截图显示销售总监查看有权且数据规则为空，与数据库一致。此前“原因未确认”的记录已失效，差异源于报表显示不完整，不是数据库授权记录错误。核查报表截图时，先检查行数上限、分页及筛选是否覆盖全部角色，不把未显示的行直接当成不存在；200仅为此案例设置，不是通用足够的上限。沈君梅按授权并集可查看组织权限范围内全部客户，其他角色的本人客户规则不能收窄该授权。证据：output/customer-view-audit-2026-10-13.json、用户当日两次截图及行数限制说明；未用沈君梅账号验证实际客户列表。

权限调查默认只读。不要用 SQL 直接写权限表或业务表；需要修改角色/数据规则时，先明确对象和范围，修改后重新读取目标记录并用实际账号验证。不要在日志或回复中输出密码、Token、连接字符串或完整凭据。

## 字段保密与角色拆分（2026-10-13）

### 功能权限迁移的报表入口限制（2026-10-14 至 2026-10-15）

- 用户授权将业务员A移除仓管员后缺少的功能权限补到计划员，再移除其仓管员；同时明确禁止使用浏览器。该授权不授予 SQL 写权限，也不授权部署新的服务端插件。
- 实时按全部角色的对象与权限项计算授权并集，状态 0 为有权、1 为无权、2 为禁止；保留其余角色的禁止项。不要把所有仓管员授权直接复制给计划员，也不要只按角色名称判断覆盖。迁移会影响计划员角色的全部关联账号，须列出实际范围。
- 当日差集为 94 个对象、1093 个对象与操作组合，属于当日快照，复用必须重新查询。部分对象为报表等类型；`SEC_FuncPermissionInfo` 的 `FObjectTypeId` 元数据过滤为 `FModelTypeId in(400,100,500)`。标准 WebAPI 对 `STK_StockBookRpt` 的 Save 返回“字段‘业务对象’是必填项”；后续只读查询确认计划员该对象未落权限表头，业务员A六个角色仍在。
- 只读反编译当前复制的 `Kingdee.BOS.Business.PlugIn.dll`：`IntegrityDetailPerAllocatePlugIn.Save` 使用 `BusinessDataServiceHelper.Save` 保存权限集合并清权限缓存。这证明前端路径不同于通用 WebAPI 表单 Save，不证明已存在可供外部直接调用的授权接口。不得为通过保存而改元数据过滤、用 SQL 写权限表或凭猜测调用内部写接口。
- 完整补权并独立回读前不移除源角色；接口不覆盖全部对象时停止写入，明确说明没有完成。功能权限以外的数据范围、基础资料联动和字段禁止需要另行核对；成功返回不能代替数据库与 WebAPI 双通道复查和目标账号验证。
- 本次证据：`output/sunmengyu-role-transfer-plan.json`、`output/STK_StockBookRpt-planner-func-before.json`、`output/func-permission-current-meta.json`；默认 dry-run 脚本为 `scripts/scratch/2026-10/sunmengyu-role-transfer.js`。失败未生成保存结果文件；错误及后续核查结果见本次会话，不能把缺少结果文件解读为已保存。
- 2026-10-15 联网检索补充：官方[数据引入工具手册](https://open.kingdee.com/k3cloud/help/BD_NewTopic302.html)和[业务应用说明](https://vip.kingdee.com/article/1582)明确提供用户、角色、功能权限模板与数据的引入引出，工具是 Excel/VSTO 加载项，可作为不用浏览器的后续调查方向。文档未证明当前版本的报表等对象覆盖范围、现有授权合并行为或可直接外调的 HTTP 接口；必须先取得当前工具导出的模板并验证，不能照旧文档猜模板、直接覆盖计划员已有授权。
- [WebAPI V6.0 官方说明](https://vip.kingdee.com/article/490771221039228672?productLineId=1)列出通用单据接口与自定义 WebAPI 扩展能力；本次搜索未找到角色功能授权的标准直接写入接口，不等于证明平台绝无该接口。此前结论应限定为当前已验证的通用 Save 路径受阻。自定义接口是另一条需开发、验证和部署的路线，不能称为已有可调用能力。
- 2026-10-15 用户纠正后改查请求本身：本仓库 `saveBill` 封装未传 `IsVerifyBaseDataField`，这使赋值失败表现为笼统的必填项错误。实时前值为空后，仅对原库存台账请求补 `IsVerifyBaseDataField:true`、`ValidateFlag:true` 并要求返回关键字段，执行一次受控诊断重试；返回“单据头中的业务对象值为:【STK_StockBookRpt】不存在”，`FObjectTypeId:null`，但角色 MFG09_SYS 和 BOS_EXPORT/BOS_VIEW/BOS_PRINT 三项均正确解析。独立数据库复查仍无该权限表头。该参数用于揭示赋值失败，不是放开对象限制的解决参数，禁止关校验或改元数据强行落库。
- 同次只读 WebAPI 对照：`BOS_ObjectType` 无对象类型过滤可查到库存台账；加字段实际过滤 `FModelTypeId in(400,100,500)` 后零行；采购入库单在相同过滤下可查到。已定位本次报表的可选范围冲突，尚未证明所有支持类型的功能权限 Save 都不可用，也未证明角色授权缺失。必须把普通单据/基础资料与报表等对象分开验证，不能用本次报表失败得出“WebAPI不能修改权限”的总括结论。
- 诊断证据：`output/func-permission-verified-basefield-retry-2026-10-15.json`（完整请求、返回及数据库前后值）、`output/func-permission-object-filter-proof-2026-10-15.json`（有无过滤及普通单据对照）、`output/func-permission-inherited-meta-2026-10-15.json`（实时继承元数据）、`output/permission-lookups-meta-2026-10-15.json`（引用主键/检索键）。未执行角色移除。
- 2026-10-15 用户要求验证普通单据后，实时 dry-run 选取唯一缺项 `STK_TransferDirect/BOS_DELETE`。标准 `SEC_FuncPermissionInfo` Save 已成功给计划员40305补该权限；模型按已有 `FItemID`、`FEntryID` 合并，`FRoleId:{FNumber:'MFG09_SYS'}`、`FObjectTypeId:{FID:'STK_TransferDirect'}`、`FPermissionItemId:{FItemID:权限项内码}`，权限状态0，沿用仓管员该项数据范围（空）。开启 `IsVerifyBaseDataField:true`、`ValidateFlag:true`，保留分录且不自动提交审核。WebAPI与数据库逐项核对新授权、非目标分录状态与数据范围通过。证据为 `output/STK_TransferDirect-planner-func-before.json`、`output/STK_TransferDirect-planner-func-save.json`、`output/STK_TransferDirect-planner-func-after.json`。这是普通单据可保存的实证，不代表所有类型对象可保存；报表对象限制仍未解决，业务员A的仓管员角色未移除。

### 普通单据批量补权与收尾复查（2026-10-15）

- 用户授权继续后，先刷新差集，再按对象串行保存模型类型100/400/500的缺项；每个对象重新读前值，保留已有权限分录主键，不改非目标状态和数据规则。任一保存或回查失败即停止队列。回查同时验证目标新授权的状态与数据规则，以及每条非目标原分录的主键、权限项、状态和数据范围。
- 本次最终与2026-10-14初始快照比较：计划员累计新增或改为有权999项操作，涉及74个对象（含先前直接调拨单验证项）；非计划变更0项、原权限记录缺失0项。该结果只是当日配置实测，不是长期默认；各对象保存前、返回和双通道回查证据为 `output/*-planner-func-before/save/after.json`。
- 仍有20个对象、94项操作未覆盖：16个900报表、800仓位值集、220库存参数、两个元数据未找到的旧对象 `STK_StockCountData` 和 `PUR_InitMRB`。没有修改表单过滤、写SQL、猜测替代对象或移除用户源角色。缺项明细及最终审计见 `output/业务员A角色权限迁移进度_2026-10-15.md`、`output/sunmengyu-role-transfer-audit-2026-10-15.json`。
- 移除角色前还须检查数据与字段限制，不能只看功能授权差集。本次仓管员192条字段分录中160条为无权、32条为禁止；32条禁止均被目标用户其余角色的同对象同字段同状态覆盖。仓管员及计划员当前无非空操作数据规则或基础资料数据规则分录。证据为 `output/sunmengyu-role-transfer-scope-field-check-2026-10-15.json`、`output/sunmengyu-field-prohibition-coverage-2026-10-15.json`。这不证明目标用户实际菜单、字段显示、缓存、打印或导出已验证。
- 2026-10-15 用户随后明确确认剩余20对象94项权限不再需要，并要求移除业务员A的仓管员分配；该范围已从待补改为经用户确认不迁移，不再阻止角色移除。用户侧SEC_User嵌套Save未生效；改用实时核对过的SEC_KDRoles标准Save，只删除目标用户关联后，用户及角色View、角色关系和组织角色映射回查通过。其余5角色、仓管员定义及其他12账号的仓管员分配保持不变。现行移除步骤见同目录 `employee-master-query.md` 的“移除单一用户的角色分配”；证据 `output/sunmengyu-remove-warehouse-via-role-before/save/after-2026-10-15.json`。未以目标用户登录验证缓存或菜单。

- 隐藏客户名称属于字段权限，不是客户记录的数据范围。官方字段授权说明：查看/编辑支持有权、无权、禁止，优先级为禁止、有权、无权。多角色用户须用禁止覆盖允许；允许看名称的人不能同时保留禁止该字段的角色。来源：https://help.open.kingdee.com/dokuwiki_std/doku.php?id=%E5%AD%97%E6%AE%B5%E6%8E%88%E6%9D%83 。
- 按岗位拆“计划主管能看、计划员不能看”前，比较真实对象与操作权限，再计算目标用户全部角色的有效差集。角色名不代表权限超集。本次计划主管40304并未覆盖计划员40305；计划员ATK1104移除计划员后仍会失去BOM维护、库存报表、工序计划反审核等授权。易变权限必须实时重新查询。
- 专业应用组使用用户许可分组 `FAppGroup=Pro`，不是部门分组 `FPRIMARYGROUP`。本次专业应用组计划员为计划员A、财务员A、业务员A、工程师A、张晓露；这是当日快照。
- 用户批准的方向：TK1104保留计划主管、移除计划员；其余四人保留计划员，财务员A和工程师A原有计划主管需纳入调整。仓管/生产/通用等其他岗位角色不应顺手清空。
- 客户主档名称、单据客户基础资料引用、货主/付款方、报表与打印导出需要分别验证；不得把禁止整个客户引用当成“仅隐藏名称、保留编码”已实现。

### 标准接口保存失败及待处理记录

本次 `SEC_FieldPermissionInfo` 的 `View` 能读取现有价格字段限制。只读元数据确认表头为 `T_SEC_FIELDPERMISSION`，分录为 `T_SEC_FIELDPERMISSIONENTRY`；查看/编辑字段是 `FVIEW/FEDIT`，禁止值2。

按实时空前值执行 `Save` 模型（计划员MFG09_SYS、对象BD_Customer、FEntityPermission中的FName/FView=2/FEdit=2）返回成功，但仅落表头，数据库无分录，独立View的FEntityPermission为空。对同一表头显式指定NeedUpDateFields=['FEntityPermission']重试一次，结果相同。原因未验证；不得复用此模型批量扩散。

待处理表头编号 `6acd8614486e03`，角色40305、对象BD_Customer，未完成清理。`Forbid` 返回“表单字段权限信息不存状态字段，不能进行状态转换”；`Delete` 返回表达式 `FForbidStatus =='A'` 中字段未定义。浏览器登录控制连续超时。没有执行SQL写入，没有改变五人角色，没有完成客户名称限制。应先在标准字段权限页面核查这条空记录并配置/清理，重新查询后再继续角色切换。不得宣称保存成功就是限制生效。

证据：`scripts/scratch/2026-10/customer-name-permission-pilot.js` 已禁止apply；`output/customer-permission-fields-2026-10-13.json` 为候选字段清单（增量元数据、尚未完成继承合并，不可直接作为写入清单）。

### 同日用户手工配置后的复查

上述空记录待处理描述是历史状态。同日后续只读数据库与WebAPI View确认：`6acd8614486e03` 已有FName分录，FView/FEdit均为2；计划员客户主档名称限制已落库。用户五人的角色已按约定拆分：计划员A保留计划主管、不再有计划员，其他四人保留计划员，财务员A及工程师A不再有计划主管。实时功能权限差集只剩计划员A的“生产订单→新增生产分录”和“生产用料清单→发送短信”未覆盖。没有验证目标用户前端实际显示、单据引用、打印或导出；不能据客户主档限制宣称所有页面客户名称均隐藏。此复查不证明前述WebAPI保存模型有效，仍禁止复用失败模型。

### WebAPI机制取证与范围限制（同日后续）

- 用户明确要求只用WebAPI，不再使用网页操作；此偏好适用于本次后续设置。
- 从当前应用服务器只读复制 `Kingdee.BOS.Business.PlugIn.dll`，使用既有ilspycmd查看 `FieldPermissionPlugIn.BeforeSave`：`FFieldName` 空值或空串的分录会被删除，且FView非0时FEdit强制同步。这是此前分录未保存的已验证原因。修正报文应包含FFieldName；尚未成功验证修正后的单据写入，不得把推导称为已验证保存方案。代码证据位于 `scripts/scratch/2026-10/operation-plugin/FieldPermissionPlugIn.cs`。
- 当前 `SAL_SaleOrder` 标准元数据及其扩展没有独立客户名称字段。客户/收货方/付款方分别为FCustId/FReceiveId/FChargeId，属于基础资料引用。字段助手按field.Key生成授权项，不提供引用名称子属性独立授权；当前已确认的标准字段授权途径不能满足“只隐藏名称并保留编码与选择”。不能未经用户确认禁止整个引用字段。
- 初始候选字段文件使用正则解析嵌套XML，有错配风险（如客户被错误映射到FPRICELISTID）；后续必须用XML解析器读取 `BusinessInfo/Elements` 直接子节点，并合并继承与扩展，旧文件不可作为写入依据。
- `PLN_InvReserveAnalyzeRpt` 与 `PLN_MtrlSupplyDemandDetailRpt` 的FCustName确为独立客户名称文本字段。仅对前一个报表尝试补齐FFieldName后保存，返回“字段‘业务对象’是必填项”。SEC_FieldPermissionInfo的FObjectTypeId元数据过滤仅包含模型类型400/100，报表不在该选择范围；这是限制解释，尚未另行验证报表授权入口。停止扩展写入，等待单据整字段限制范围确认。脚本为 `scripts/scratch/2026-10/customer-name-report-permissions.js`，默认预检；不应绕过标准对象过滤。

### 修正报文已验证成功及用户授权范围

用户后续明确：仅隐藏客户全称，保留简称等其他字段；若单据只有一个客户基础资料引用字段，允许禁止整个引用（包括编码及选择能力）。只使用WebAPI。

此前“尚未验证修正报文”的限制已更新：补齐 `FFieldName` 后，`SEC_FieldPermissionInfo` 的Save已验证成功。模型使用 `FRoleId:{FNumber:'MFG09_SYS'}`、`FObjectTypeId:{FID:对象}`，分录包含FFieldKey、非空FFieldName、FView='2'、FEdit='2'；已有权限按FItemID和FEntryID合并，保留非目标分录，独立View与数据库逐字段核对。不是SQL写入，未修改其他角色或客户名称/简称主数据。报表与动态平台对象的适用限制仍有效。

本次新增配置共22对象49字段：销售订单/发货通知/销售出库/销售退货、受托加工材料收料/入库/退料、批号/序列号/归档序列号/仓库、预测单/预测变更/计划模拟、其他出库/出库申请/直接调拨/分步调入/分步调出、生产订单/工序计划/工序汇报。生产三对象的需求客户为扩展字段FDCustId/FCustId，已通过实时标准对象列表查询验证字段存在后保存。四人持计划员，TK1104不持计划员，限制未写到计划主管。实际前端重登显示、打印和导出仍未验证，不得宣称全局保密完成。

未配置的对象类型500（排产、生管、预留综合等动态平台）和900（库存/供需报表）不在标准权限保存对象选择范围内，需进一步确认专用机制，不凭猜测绕过过滤。名单保存于 `output/customer-permission-unsupported-objects.json`。保存工具及逐对象前后快照为 `scripts/scratch/2026-10/apply-customer-field-permissions.js` 和 `output/*-customer-field-before/after.json`；完整计划为 `output/customer-permission-batch-plan.json`，属于本次明确授权清单，不自动授权复用。

### 发货通知客户简称核查（2026-10-15）

- 实时读取SAL_DELIVERYNOTICE及全部直接扩展的BusinessInfo/Elements直接子节点：客户为FCustomerID基础资料引用，未发现独立客户简称字段；客户资料BD_Customer有FShortName（简称）。WebAPI查询发货通知的FCustomerID.FNumber、FCustomerID.FName、FCustomerID.FShortName成功，三项可同时取值。不能说系统没有简称，也不能把可查询的引用子属性等同于可独立授权的字段。
- 当前单据客户控件未配置独立简称显示；按岗位显示编码/简称并隐藏全称，需要另行验证BOS扩展或插件方案，普通字段授权尚无可用方案。更改全局显示不能直接当作按角色保密；收货方、结算方、付款方和列表/选客/打印/导出仍须覆盖。未修改生产元数据或权限。
- 证据：output/delivery-customer-display-metadata-2026-10-15.json、output/delivery-customer-display-fields-2026-10-15.json及当次WebAPI只读查询。

### 仓管员客户字段限制（2026-10-15）

- 用户明确接受禁止整个客户引用，以及公共仓管员角色对非专业应用组账号的连带影响后执行；默认查询范围以后为FAppGroup=Pro，但写公共角色仍须核对全部关联账号的影响。此授权仅为本次个案。
- 当前SCM06_SYS仓管员设置3对象11字段查看/编辑禁止：BD_Customer.FName；SAL_DELIVERYNOTICE的FCustomerID/FReceiverID/FSettleID/FPayerID；SAL_OUTSTOCK的前述4字段及FSETTLECustomerID/FESettleCustomerId。逐字段实时查询确认可解析，合并原分录、保留原限制，通过WebAPI和SQL双通道复查。未改角色分配、功能权限或客户主数据。
- 专业应用组王志平、周开玺、主管A的全部11字段已被禁止；王剑锋不持仓管员，普通客户字段未新增禁止，其原有销售出库结算组织客户禁止保留。其他单据、预设基础资料、客户物料名称、地址/备注、打印导出及实际界面尚未完整验证，不能宣称所有渠道客户信息均不可见。
- 证据：output/warehouse-customer-restriction-plan-2026-10-15.json、output/*-warehouse-customer-field-before/after-2026-10-15.json、output/warehouse-customer-restriction-four-user-audit-2026-10-15.json；工具scripts/scratch/2026-10/restrict-warehouse-customer-fields.js默认预检。

### 计划通用合并预检（2026-10-15）

- 用户要求计划员继承计划通用并删除计划通用。实时确认计划通用144914/JH有11成员，其中专业应用组财务员A持计划员，计划员ATK1104和工程师ATK7773未持计划员；其他8成员均持计划员。删除角色须检查全成员，不能仅凭财务员A单人权限差集决定。
- 已通过标准功能权限Save向计划员40305补齐8对象65项有权操作，逐对象WebAPI/SQL回查并保留非目标分录，重算差集应为0。计划员原有客户名称禁止保留。计划通用14条字段分录均为无权1，无禁止2；不能把无权当成禁止迁移。
- 直接删除计划通用仍会使工程师A减少230、计划员A减少227项功能权限（当日计算值），跨组装拆卸、销售出库、受托收料/入库、生产入库、其他入库、采购入库/退料。未自动新增计划员，因为会连带扩大权限并引入客户名称禁止；角色尚未删除，等待用户决定是否接受权限减少或另行迁移。证据：output/role-merge-144914-before-2026-10-15.json、output/plan-common-removal-impact-TK7773-2026-10-15.json、output/plan-common-removal-impact-TK1104-2026-10-15.json、output/merge-plan-common-targets-2026-10-15.json及各对象merged-plan-common-func-before/save/after快照。

### 计划通用删除及孤立组织映射（2026-10-15后续）

- 用户进一步授权计划主管承接后再删除计划通用。已向计划主管40304/MFG08_SYS补齐9对象249项权限，逐对象双通道复查。删除前计划通用274项有权操作均被计划员、计划主管覆盖；11成员均持至少一个承接角色，无须添加计划员或改变客户字段限制。
- SEC_KDRoles标准Delete角色144914/JH返回成功；实时数据库角色及T_SEC_ROLEUSER关联均为0，但T_SEC_USERROLEMAP仍留11条，SEC_User View对应FRoleId_Id=144914、FRoleId=null。标准Delete成功不证明全部映射清理，今后同类合并应先经角色用户分录解除关联再删除定义，并独立复查两种关联表；空分录清除方法仍需验证。此为新的实际发现，前述待删除状态已更新。
- 尝试以SEC_User已有组织和保留角色分录原主键清理财务员A残留；Save返回Administrator对用户TK03556修改冲突锁，未证实该模型可清理，不重试扩散、不SQL写入。11人其他有效角色与两承接角色权限均复查未变。角色删除完成，11条孤立映射清理未完成；不能宣称完全清理。
- 证据：output/merge-plan-common-supervisor-targets-2026-10-15.json、各对象supervisor-merged-plan-common-func快照、output/delete-plan-common-preflight/result/verified-2026-10-15.json、output/plan-common-orphan-cleanup-pilot-before/save-2026-10-15.json。工具scripts/scratch/2026-10/delete-merged-plan-common.js在残留检查处失败后即停止，不能重复删除。

### 仓管员客户字段恢复（2026-10-15后续）

- 用户授权恢复仓管员客户查看。已将前次3对象11目标字段恢复：原有分录恢复原状态，新加限制改有权0；未移除源角色功能或其他价格限制。完整FItemID+FRoleId+FObjectTypeId+FEntityPermission模型saveBill经WebAPI/SQL逐分录回查成功。
- 不要用NeedUpDateFields仅FEntityPermission并删空分录来恢复：对BD_Customer返回成功但FName仍2，且插件生成130条默认字段0/0，表头变131分录；同白名单模型修改FName也未生效。后续完整模型才将FName改为0，130条默认有权分录仍存在，不能称精确还原原空配置。此为接口副作用，尚未验证删除空表头或只删默认分录机制，禁止SQL清理或盲目重试。旧试探脚本restore-warehouse-customer-fields.js已禁止apply。
- 发货通知4字段已0/0；销售出库24字段中原18字段不变，新增6字段已0/0；客户资料131字段中FName已0/0。恢复的是查看限制，不是新增客户资料BOS_VIEW功能；用户实际界面/缓存/打印导出未验证。证据output/*-warehouse-customer-field-restore-verified-2026-10-15.json及BD_Customer-warehouse-restore-corrected-save-2026-10-15.json。

### 客户数据范围联动纠正（2026-10-15官方文档核实）

- 此前“客户规则不会影响其他单据”“收款单查看未挂规则就能看全部客户收款”均遗漏全局联动机制，不能作为最终结论。官方数据权限手册说明V7.7新增“基础资料数据范围联动应用到业务对象”，路径系统管理/权限基础设置/数据规则选项；开启并设置基础资料对应受控单据及字段后，客户查看范围可联动限制相关业务单据，包括头/体。必须查询实际参数及客户到AR_RECEIVEBILL对应字段映射后才能判定实际收款范围。
- 与“联动应用基础资料本身的查看数据范围”区分：后者主要影响新增单据的基础资料F8选择范围，不能等同现有单据列表隔离。
- 官方来源https://help.open.kingdee.com/dokuwiki_std/doku.php?id=%E6%95%B0%E6%8D%AE%E6%9D%83%E9%99%90 ，当日在线检索。13人未挂收款查看数据规则、2人挂只看自己是已验证授权层事实，但全局参数及受控字段未验证，因此销售部15人客户与收款单查看权限_2026-10-15.xlsx中“13人全部客户收款”结论须标待核实，不得继续引用为已确认实际范围。当日试查元数据全文因15秒超时失败，不代表功能未启用。

### 收款单多类别往来与联动范围核查（2026-10-15）

- 实时AR_RECEIVEBILL及直接扩展元数据：FCONTACTUNIT为ItemClassField，控制字段FCONTACTUNITTYPE为ItemClassTypeField，可选BD_Supplier/BD_Customer/BD_Department/BD_Empinfo/FIN_OTHERS/ORG_Organizations/BD_BANK；FPAYUNIT/FPAYUNITTYPE亦多类别。不是固定引用客户的BaseDataField。单据体FKDBPCUSTOMER是关联应收单客户的BasePropertyField，不能当独立客户引用。
- 应用范围界面插件BaseDataDRApplySettingPlugIn通过GetBaseDataApplyAuthObjects按基础资料取对象，再由GetBaseDataFieldList返回ObjectTypeId与当前基础资料相同的字段显示。尚未取得服务器枚举函数实现，不能宣称所有ItemClassField一律不受支持；结合用户界面无收款单、当前元数据多类别结构，推断为该列表未识别固定客户引用的适配限制。
- 实时数据库T_SEC_BASEDATADRAPPLY/ENTRY（头FOBJECTTYPEID，分录FBASEDATAOBJTYPEID/FFIELDKEY/FISENABLED）确认AR_RECEIVEBILL无联动配置；对照SAL_DELIVERYNOTICE有6客户字段、SAL_OUTSTOCK有8客户字段且全部启用1。故当前收款单不能据客户联动开关声称已隔离；发货/出库确有客户联动配置。另有插件或供应链隔离未全面审计，实际可见列表仍待目标账号验证。
- 收款隔离可按收款单独立规则处理；“本人创建/单据销售员”与“客户主档负责范围”不同，不得未经确认用前者替代后者。若要复用客户主档范围，须验证多类别往来条件或另行BOS扩展/列表插件方案，不改通版往来字段类型。
- 证据output/receipt-party-meta-2026-10-15.json、output/base-data-linkage-apply-meta-2026-10-15.json、output/receipt-base-data-linkage-check-2026-10-15.json及scripts/scratch/2026-10/operation-plugin/BaseDataDRApplySettingPlugIn.cs；官方收款单手册https://open.kingdee.com/k3cloud/help/AR_RECEIVEBILL.html，多类别属性说明https://vip.kingdee.com/article/220956461760004096 。本次只读。
- 2026-10-15 复查补充：应收单 `AR_receivable` 实际有 5 个客户字段在 `T_SEC_BASEDATADRAPPLY` 启用联动（FCUSTOMERID/FChargeId/FORDERID/FOUTCUSTOMERID/FTRANSFERID，均 FISENABLED=1），并非只有发货/出库有联动；收款单 `AR_RECEIVEBILL` 仍无任何联动配置。判读“收款单是否被客户范围隔离”时应按对象逐个查联动表，不能据销售单据有联动推断财务单据也有。联动表关联键为分录 `T_SEC_BASEDATADRAPPLYENTRY.FID = T_SEC_BASEDATADRAPPLY.FID`（分录主键 `FENTRYID`，不是 `FITEMID`，凭权限表习惯拼 `FITEMID` 会报 Invalid column name）。证据 output/sales-customer-view-recheck-2026-10-15.json。
- 2026-10-15 销售部递归子组 15 人实时复查：15 人对 `BD_Customer` 的查看授权全部挂在数据规则上（SJGLYHSQ 当前销售员只看负责客户 / XSGLY 销售管理员可看所属组 / gendan 跟单只看负责客户三类，无空规则查看项），BD_Customer 无字段查看/编辑禁止；主管/总监并集仍会放宽（跟单员A XSGLY 覆盖营销三部+终端事业部，沈君梅覆盖营销一/二/三/五部，覃琼燕/商务员A覆盖国际一部）。叶珊妹、李银兰、陈秋伶、业务员B、周雪菲 5 人未查到有效销售组分录（FOPERATORTYPE='XSY' 无行），组维度范围无法从配置推断，属当日快照。证据 output/sales-customer-view-recheck-2026-10-15.json、scripts/scratch/2026-10/sales-customer-view-recheck.js（只读）。

### 销售部其他无客户联动入口筛查（2026-10-15）

- 将销售部递归子组15人的有效BOS_VIEW与实时T_SEC_BASEDATADRAPPLY/ENTRY启用客户配置比对，候选须再核对字段；不能把没有客户字段的业务、客户物料引用或参数表列作客户隔离漏洞。当前候选元数据只读核对发现CN_PAYAPPLY往来多类别，销售部谭艳有查看且未挂规则；CRM_ACTIVITY/CRM_OPP_Clue/CRM_OPP_Opportunity及CP_Maintenance涉及客户信息，7人有查看且未挂查看规则，均无启用BD_Customer联动配置。CP客户与CRM对象不必然就是BD_Customer，需要继续核对引用对象，不能声称标准客户联动一定适用。
- 无联动配置的销售报表另列：销售出库明细15人、应收款汇总15人、客户交易分析14人、销售订单执行汇总/明细14人、销售出库汇总14人、开票跟踪14人、应收单跟踪12人等。报表有自身基础资料数据权限/过滤插件机制，不能从业务单据联动表缺项判断报表可看全部；需另查报表机制。本次仅核对权限入口，未审计实际菜单访问日志。
- 证据output/sales-unlinked-object-candidates-2026-10-15.json、output/sales-unlinked-bill-meta-2026-10-15.json、output/sales-unlinked-customer-fields-2026-10-15.json、output/sales-customer-unlinked-focus-2026-10-15.json。

### 核心销售单据客户联动与数据规则配置实践（2026-10-15）

- **历史“双重锁”推断，不能作为已验证的通用机制**：
  - 原文曾把空查看规则直接判为“全量放开并穿透联动”，未提供启用联动后的目标账号实测或完整引擎证据；该绝对结论撤销。需同时检查全局开关、受控字段、角色操作规则和基础资料范围，不能仅凭空查看规则判断所有数据可见。
  - 以下两层应分别核对；不能未经业务确认将销售员规则强加给跟单：
    1. 单据本身查看权限（`BOS_VIEW`）挂接单据级业务规则（如销售员规则 `zkzj`/`010101`/`FH01`/`CK-1`/`1-1`）；
    2. 单据功能权限挂接客户基础资料联动子实体（`FEntityBaseDataPer`，指定 `BD_Customer` 对应规则如 `SJGLYHSQ`）。
- **WebAPI `SEC_FuncPermissionInfo` 保存基础资料联动子实体规范**：
  - 子实体键：`FEntityBaseDataPer`（底层表 `T_SEC_FUNCPERBASEDATARULEENTRY`）。
  - 关联基础资料字段：必须传对象结构 `FBaseDataObjectTypeID: { FID: 'BD_Customer' }`；若传 `{ Id: 'BD_Customer' }` 会静默失败并存为空字符串。
  - 数据规则主键：传字符串 ID `FDataRuleID: '5fe586b214b2c2'`。
  - 保存参数：`NeedUpDateFields: []`（必须传空数组，传非空或字段名会导致子实体无法落库）；必须带 `IsVerifyBaseDataField: true, ValidateFlag: true`。
  - 变更后必须同时执行 WebAPI `viewBill` 与 SQL 独立双通道回查。
- **报表对象类型限制**：
  - 应收款汇总表（`AR_SumReport`）等对象属于报表类（`FModelTypeId: 900`），受金蝶标准 WebAPI 权限服务对象过滤校验限制，无法通过通用的 `SEC_FuncPermissionInfo` 接口直接保存，需通过金蝶前端管理界面或报表级过滤插件维护。
- **跨部门/历史主管角色穿透风险**：
  - 销售员兼任历史角色（如谭艳挂有【采购主管_新增权限】、林思萍挂有【销售主管】）时，主管角色上的无规则查看会穿透销售单据隔离。审计与修复单据规则后，必须对用户所有在用角色的并集进行全量交叉核验。
- **回滚与解绑规范（2026-10-15用户明确撤销）**：
  - 用户下达“撤销”后，基于预存基线快照 `output/perm-fix-*-before.json` 逐单据逐角色精准回退。
  - 解绑客户联动子实体：`SEC_FuncPermissionInfo` 保存时若仅传空数组 `FEntityBaseDataPer: []` 不会物理删除既有子实体分录；彻底脱钩需传 `{ FEntryID: 分录内码, FBaseDataObjectTypeID: { FID: '' }, FDataRuleID: ' ' }`，成功使 `T_SEC_FUNCPERBASEDATARULEENTRY` 中对象与规则恢复为空白，WebAPI `viewBill` 回查确认脱钩；
  - 恢复单据查看规则：将 `FEntityPermission` 中 `BOS_VIEW` 的 `FDataRule` 精准回填为变更前原值（原为空者回填 `' '`）；
  - 18 项配置（5 大单据 × 5 类基础角色）已全量通过 WebAPI 成功回滚，并通过 WebAPI 与数据库 SQL 双通道回查验证，系统状态 100% 复原。
- **重大纠正与事故教训：严禁将业务员规则套用于【跟单】或非销售角色（2026-10-15用户纠正）**：
  - **根因分析**：跟单员不是业务单据上的销售员字段（`FSalesManID`/`FSalerId`/`FSALEERID`），也不是客户主档的负责销售员（`FSELLER`）；跟单员专属客户规则为 `gendan`（跟单只能看到自己负责的客户，ID: `6a5ad27f022535`）。此前脚本过度推导并擅自扩大范围，将销售员规则（`FSalesManID in (-1)`）与 `SJGLYHSQ` 强加给【跟单】角色，导致跟单员按业务员字段匹配结果全部为 0，前台所有销售订单、发货通知单、出库单瞬间全部变空白，严重阻塞跟单正常办公，迫使用户手动紧急修复。
  - **铁律守则**：
    1. **角色属性严禁混淆**：跟单员与销售员属于不同业务岗位，单据级销售员规则绝对不得赋给跟单角色；
    2. **严禁擅自扩大范围**：用户询问“收款单等单据不受联动”，应仅针对收款单联动机制核实与处理，严禁私自将其他 4 大单据、5 个角色的查看规则全部覆盖重写；
    3. **禁止替业务做规则假设**：单据级过滤字段（销售员、跟单员、制单人等）与组织业务模式强相关，必须由用户明确指定，不得凭空代设。
- 证据与脚本：`scripts/scratch/2026-10/apply-sales-forms-data-rules.js`、`scripts/scratch/2026-10/revert-sales-forms-data-rules.js`、`scripts/scratch/2026-10/check-before-states.js`、`scripts/scratch/2026-10/check-gendan.js`、`output/perm-revert-*-before/save/after.json`。

### 单账号权限优化与WebAPI迁移门槛（2026-10-15）

- 用户明确本次仅优化刘栋梁TK01304：客户范围为本人客户；取消非销售业务写入，保留查询；后续推广另行处理。共享角色不得直接修改，需独立配置且核验完成后才替换目标账号关联。
- 当前用户明确要求使用WebAPI，已停止浏览器操作。浏览器仅打开携带权限复制的未保存表单，未保存新角色、未改权限；本次没有实际权限迁移。
- 实时WebAPI复查 `BOS_ObjectType`：`SAL_SaleOrder` 在 `FModelTypeId in (400,100,500)` 下存在，`AR_SumReport` 无过滤存在、加该过滤0行。不能为保留查询而直接用通用权限Save猜报表模型，也不能在报表未迁移时先移除原角色。此限制只针对当前已验证的通用接口，不是所有WebAPI都不能管理权限的结论。
- 当前复制的服务器程序集 `RoleManage4Bill` 反编译确认：携带权限复制在前端 `AfterSave` 中调用 `PermissionInnerServiceHelper.CopyRolePermission`；普通WebAPI角色Save不等于已复制功能/字段/数据权限。未确认该函数有可直接调用的标准WebAPI入口，不猜内部写接口。
- 仅配置角色上的单据销售员规则不能直接证明“客户主档本人负责”的口径，两者需按实际客户归属核对；客户负责人查询157家为当时快照，不得把数量或客户名单固化为规则。
- 已生成候选取消/保留/接口范围外清单，分类为评审候选，不代表全部操作已获逐项业务验证。证据 `output/liudongliang-optimization-plan-2026-10-15.json`、`output/刘栋梁权限优化执行清单_2026-10-15.md`，脚本 `scripts/scratch/2026-10/build-liudongliang-optimization-plan.js`。当前阻塞：无法通过已验证接口完整迁移查询权限；未修改角色定义、未切换目标用户关联。

### 权限迁移的公开文档检索（2026-10-15）

- 已检索金蝶官方手册、SDK索引及云社区。官方角色手册明确“复制时同时复制权限”，但没有在该页给出标准WebAPI复制接口：https://help.open.kingdee.com/dokuwiki/doku.php?id=%E8%A7%92%E8%89%B2 。不能从产品复制能力推导通用Save或ExcuteOperation已覆盖。
- 官方数据引入工具手册明确支持功能权限模板及权限数据引入引出：https://open.kingdee.com/k3cloud/help/BD_NewTopic302.html 。这是独立工具方案，未证实为可直接调用的标准WebAPI、当前版本所有报表覆盖或原授权合并语义。
- WebAPI说明书提供继承 `AbstractWebApiBusinessService` 的服务端自定义WebAPI扩展示例：https://vip.kingdee.com/article/490771221039228672?productLineId=1 。因此可研究用受控服务端扩展封装现有权限服务；这是开发方向，尚未开发、部署或验证，不是已找到开箱即用权限复制端点；用户要求搜资料不等于授权部署。
- SDK官方字段索引列出 `SEC_FuncPermissionData`：https://open.kingdee.com/K3cloud/SDK/Kingdee.BOS.Core~Kingdee.BOS.Core.FormIdConst_fields.html 。当前账套只读元数据确认它仅有对象/权限项/数据规则/用户/组织文本字段，没有角色与有权无权禁止配置实体，不能当作 `SEC_FuncPermissionInfo` 的等价授权保存入口。证据 `output/SEC_FuncPermissionData-search-meta-2026-10-15.xml`。
- 检索未找到标准WebAPI完整角色复制或报表授权迁移的明确可用文档。此为检索结果，不证明此类接口在所有版本绝对不存在。权限未写入，浏览器未继续使用。

### 三角色合并试点的实际配置进度（2026-10-15续办）

- 用户再次明确目标是新建并配置三个角色，而非放弃合并。已经用标准WebAPI新建 `XS_SELF_QUERY_V1`（932561，销售-公共查询）、`XS_SELF_BIZ_V1`（932562，销售-本人客户业务）、`XS_SELF_LIMIT_V1`（932563，销售-操作与成本限制）；全部为未分配用户的试点角色。
- 新建Role View会带 `RoleUser:[{Id:0,UserId_Id:0,UserId:null}]` 空行，不能用数组长度判断已分配；须核对有效用户内码并独立查 `T_SEC_ROLEUSER`。首条角色创建后因错误地按length判定而停止，实时回查确认未分配后修正；没有重复创建。
- 已按现有五角色授权并集、禁止优先生成163组支持类型的角色/业务对象配置，并逐项WebAPI/数据库核对权限状态和数据规则。非销售仅保留查询类候选，未新增原来没有的权限；原明确禁止归入限制角色。客户BD_Customer查看使用现有严格销售员规则SJGLYHSQ-1（6704fd56e5bb9a）。其他单据/报表不能因此宣称已按客户负责人隔离，尚待逐项核验。
- 已迁移7类普通对象的36条字段配置，WebAPI/数据库逐字段验证；2类库存报表的38条字段限制受模型过滤未迁移。功能权限另有54类对象（报表等）未迁移。普通功能与字段保存可先完成，不必把完整旧角色复制当成新建角色的前提；但查询及字段限制尚不完整，仍不能提前切换用户角色。
- 为未分配查询角色验证AR_SumReport，`IsVerifyBaseDataField:false`且保留`ValidateFlag:true`仍返回“业务对象是必填项”；实时SQL确认该角色该报表无表头，禁止继续同参数盲重试。`SEC_FuncPermissionInfoImp`当前为无落库表、无操作插件的导入模型，不据名字推定标准Save可配置完整权限。
- 最终实时核对：三个新角色都无有效用户分配；刘栋梁原五角色仍在。用户实际权限未切换，本任务为部分配置完成，非已完成优化。证据 `output/sales-three-pilot-current-verification.json`、`output/sales-three-roles-functional-verified.json`、`output/sales-three-roles-field-verified.json`、`output/pilot-report-save-result.json`；源/目标ID和状态仅为当日快照。

### 系统预置角色的权限保存验证（2026-10-15）

- 用户要求实测系统预置角色能否改权限。实时 `SEC_KDRoles/40305` 返回计划员 `MFG09_SYS`、`FIsDefault=true`；不能只凭 `_SYS` 编码判断预置属性。
- 对该角色直接调拨单 `STK_TransferDirect` 的既有26条功能权限，先 dry-run，再通过 `SEC_FuncPermissionInfo` 标准 Save 按原值保存，返回 `IsSuccess=true`；WebAPI回读及数据库前后明细核对完成，数据库权限分录完全一致。证据：`output/preset-role-permission-save-probe-2026-10-15.json`，探针：`scripts/scratch/2026-10/probe-preset-role-permission-save.js`。
- 此次是原值保存测试，证明该预置角色未被功能权限 Save 一概拦截，不是本次实际增减权限测试。结合上文直接调拨单新增权限的历史实证，不能声称“系统预置角色一律不能改权限”；仍须区分角色基本资料、功能权限、字段权限、数据规则与报表对象限制，不能推广到全部预置角色或全部接口。

### 两个预置角色合并与手工交接（2026-10-15，未切换完成）

- 后续用户明确改为“全员角色 BD10_SYS（110）＋销售员 SCM04_SYS（10043）”，并授权修改预置角色；此授权取代前述本次不得修改共享预置角色的范围限制，不扩展至其他原自定义共享角色。三个试点角色仍未分配。
- 当前回查：完成210组功能配置、7类对象36条字段配置；全员角色仅10项基础查看，已分配沈君梅、陶葆、刘晓丽、叶珊妹、刘栋梁。销售员仍缺15类对象授权和物料收发汇总表20、明细表18条字段禁止。刘栋梁旧五角色仍保留，现加全员共六个，不能宣称非销售写入已从其有效权限中取消。
- 已有报表授权表头可用 FItemID、FRoleId、FEntityPermission 保存，省略 FObjectTypeId 避免重新解析报表对象；NeedUpDateFields 空数组、IsDeleteEntry=false、校验开启，新增权限项才实际落地。仅限已实时确认正确的既有表头；新建报表表头仍受限制，不可据此推广。SAL_DetailReport 新增原有短信权限已由 View 与数据库复核。
- 角色新增用户关联用 FEntityUser/FUserId/FUserID；本次完整模型、NeedUpDateFields 空数组及 IsDeleteEntry=true 后成功。窄更新白名单曾返回成功但只产生空用户行；成功响应不能代替双通道检查有效用户ID。删除既有分录与新增引用的模型加载行为须分别验证。
- SAL_QUOTATION 存在既有失效权限引用，完整重解析报不存在。保留该行 FEntryID、目标状态及数据规则而省略失效引用后保存并双查，未以SQL清理。不得在遇到未知引用时扩大删除范围。
- 全员角色原先虽无成员仍有17项授权，含监控对象写入；已将目标之外项设为无权，最终确认仅10项查看。角色无人不等于权限为空，分配前必须审阅完整目标权限。
- PermissionObjectId 别名映射不能单独证明各报表数据范围和有效权限等同，不能据映射擅自从待办中删项。本人客户规则仅确认客户主档，不推广为所有报表或单据本人隔离。
- 用户撤回浏览器操作要求，改为本人手工补齐。当前不再操作浏览器，也不提前移除旧角色；交接清单为 output/销售员角色_剩余手工配置清单_2026-10-15.md。用户完成后先WebAPI及数据库复核，再仅移除刘栋梁四个旧角色关联，其他四人原分配保留。证据目录 output/preset-two-roles-1792047913563，含 functional-plan、functional-done、field-plan、fields-done、final-verification；这是当日阶段快照。

### 手工补齐后的实时复核（2026-10-15）

- 用户告知已改好后，通过 verify-sales-manual-completion.js 复查225组功能计划及9类字段对象；15项待办中14类已补齐，两个库存报表38条字段查看/编辑禁止均经WebAPI与数据库确认。
- 仍缺 SAL_SOChangeSynPriceRpt 查看；另 BD_Currency 的附件下载、在线预览目前无权，与原方案有权不同，未擅自覆盖用户手工结果。刘栋梁仍六角色，不提前切换。
- 证据 output/preset-two-roles-1792047913563/manual-completion-verification.json。复核须覆盖既有配置回归，不能只检查手工待办；此为当日快照。

### 刘栋梁两角色切换完成（2026-10-15）

- 用户明确跳过未找到的 SAL_SOChangeSynPriceRpt；币别附件下载及在线预览保留当前无权。重新复查其余225组计划与9类字段对象后，仅保留上述已披露差异。
- switch-liudongliang-two-roles.js 默认dry-run，预演后 --apply，通过角色已有成员分录主键仅移除刘栋梁在四个旧角色的关联。每步全量对比 T_SEC_ROLEUSER，确认其他用户分配完全不变；同时核对角色定义和其他成员分录未变。
- 最终 SEC_User View、T_SEC_ROLEUSER、T_SEC_USERORG/T_SEC_USERROLEMAP 确认 TK01304 仅110全员角色、10043销售员，组织及用户其他属性不变。证据 output/preset-two-roles-1792047913563/two-role-switch-final.json。配置和关联已完成，不等于已用刘栋梁登录实测客户列表、详情、导出；客户本人规则仍仅指已核验客户主档规则，其他报表不扩大表述。

### 两角色切换后客户规则检查（2026-10-15）

- 实时 SEC_User 与角色分配确认刘栋梁仅销售员、全员；BD_Customer 授权表头仅销售员存在，查看挂6704fd56e5bb9a（业务员只能看到自己），规则启用，FSELLER 当前销售员比较118。账号人员128827→员工129026→有效XSY分录129186，WebAPI按此销售员查到157家客户，数量仅为当日快照。
- 不能把正确的查看规则等同于完整客户操作隔离：同一客户对象修改、删除、引出等原授权未挂规则，还保留移动销售全部客户、查看全部联系人、批改销售员、数据直接授权。此为配置风险提示，不证明已实际绕过列表或引出；各操作是否复用查看过滤需实际账号验证。评估时须列出相关操作和替代入口，禁止自动扩大修改共享角色。
- 证据 output/liudongliang-customer-rule-live-2026-10-15.json；只读脚本 check-liudongliang-customer-rule-live.js。本次未修改权限。

### 移动销售入口权限取消（2026-10-15）

- “移动销售—客户维护—全部客户”指手机端可见客户入口，不能仅凭名称断言绕过客户查看数据规则。此前将此权限直接列为应取消项过于笼统，须结合使用需求和实际范围判断。
- 用户明确未使用手机端并要求取消，已将共享销售员角色10043/BD_Customer 的 SCM_MOBALLCUSTOMER 从有权0改为无权1。默认dry-run后执行，WebAPI与SQL回查，完整客户权限分录比对确认只改该项，客户本人查看规则保持不变。
- 脚本 scripts/scratch/2026-10/disable-sales-mobile-all-customers.js；证据 output/sales-mobile-all-customers-1792050285945.json。属于共享角色变更，影响该角色全部使用者，不表述为仅刘栋梁，也不表述为关闭全部手机端功能。

### 刘栋梁可查看对象的客户联动扫描（2026-10-15）

- audit-liudongliang-unlinked-customer-objects.js 从实时SEC_User有效角色、有效BOS_VIEW授权（扣除禁止）取得200个对象，对照启用BD_Customer联动配置和对象主元数据。169个对象没有启用此配置，包含大量无关基础资料和参数，不能将169当作客户隔离漏洞数量。
- 新确认候选含收款单分录列表、客户对账单、催收管理、应收坏账风险监控、销售价目表、销售折扣表、批号主档、客户仓库对应表、销售物流信息；均有查看、无查看规则、无启用客户联动。报表另列，缺联动不等于无报表过滤。CRM客户及活动等需核对CRM独立客户对象，不能直接套BD_Customer。
- 主元数据字段扫描仅用于候选定位：嵌套引用、物料属性中的客户辅助字段不能直接当单据客户主字段；模型500动态表单和参数页面也不一定是独立业务记录列表。最终修复前应核对实际入口、扩展元数据、过滤插件及目标账号。
- 证据 output/liudongliang-unlinked-customer-objects-2026-10-15.json；可读清单 output/刘栋梁客户未联动对象核查_2026-10-15.md。当前只读未改；名单为当日权限配置快照。

### 三对象按客户主档负责人隔离的验证边界（2026-10-15）

- 用户仅授权销售价目表、收款单、收款单分录列表的查看规则，要求与客户主档本人销售员规则一致；不以单据销售员或制单人替代，也不改其他对象。
- 只读元数据确认：BD_SAL_PriceList.FCustID为客户引用（FENTITY2），Sal_ReceiveList.FCONTACTUNIT为客户引用（FSALRECEIVE）；AR_RECEIVEBILL.FCONTACTUNIT为多类别ItemClassField。WebAPI对收款单FCONTACTUNIT.FSELLER明确报引用字段不存在。
- SEC_DataRule业务对象字段过滤 FModelTypeId in(400,100) AND FDevType<>2；Sal_ReceiveList为500。按其真实FID保存新规则报业务对象必填，未创建成功；不得声称动态查询规则已配置，也不改模型绕过。
- 价目表新建XS_CUST_SELF_PRICE_V1（6ad088234a7943）并曾挂销售员BOS_VIEW，SQL/View保存回查成功；后续语义检查 FCustID.FSELLER 默认显示值为姓名，ID比较发生nvarchar转int错误，二级.FName/.FNumber/.FEntryID扩展引用被拒绝，因此不能认定比较118能正确转换此嵌套字段。已仅撤回该查看规则到原空值，完整权限分录与SQL回查恢复。该新规则仍未分配，禁止未经验证复用。未更改原客户规则。
- 本轮三对象均未达到用户要求，不能表述完成。标准API限制已定位；后续需验证原生规则设计器支持的客户引用比较或受控服务端权限/列表扩展，未部署任何插件。用户禁止浏览器的要求继续有效。
- 证据 output/three-customer-rule-model-probe.json、output/customer-three-view-rules-1792051032919/（含规则保存与price-rollback-verified.json）；探测与默认dry-run脚本在 scripts/scratch/2026-10/。保存成功必须继续核验字段类型及运行过滤，出现疑点及时恢复本轮前值。

### 用户截图指定收款单现有规则（2026-10-15）

- 用户明确展示并要求使用收款单zkzj“只看自己”；实时规则6710cdae0d5618启用，条件FSALEERID比较118（当前业务员）OR FCreatorId比较103（当前用户）。这是用户新指定的单据自身规则口径，取代此前针对收款单不得替代客户负责人规则的限制；两种口径仍不等价，不能描述为随客户主档负责人自动联动。
- 已将销售员10043的AR_RECEIVEBILL/BOS_VIEW由空规则改挂zkzj，默认dry-run后执行，完整分录SQL比对及WebAPI回读确认仅该查看规则改变。未改共享规则定义、其他操作或其他对象。证据output/receipt-zkzj-sales-view-1792051563437.json；脚本apply-receipt-zkzj-sales-view.js。
- 用户纠正：应先核对现有规则设计器和规则条件，不因跨客户引用受阻便否认可在角色上配置独立单据规则。官方数据权限说明亦支持按对象查看权限选择规则：https://open.kingdee.com/K3Cloud/help/SEC_DATARULE.html 。
- 其他两项仍未配置：价目表既有规则3仅创建人当前用户，不自动等于客户负责人；Sal_ReceiveList目前无独立规则。不得将本次收款单成功推广为三个对象完成，也不未经字段映射核对套用zkzj。

### 收款单分录列表是否继承主单规则的表述边界（2026-10-15）

- AR_RECEIVEBILL与Sal_ReceiveList元数据的PermissionObjectId不同（418de76e91cf4b2fa2ea08654a12dcf0、62981a3bc5e3b9）。后者由Kingdee.K3.SCM.Sal.Business.PlugIn.SalReceiveBill动态表单插件取数；这只证明权限入口分开，不证明插件不继承主单过滤。
- 已有标准SEC_DataRule模型过滤排除500，仅能证明当前标准保存方式受限，不能说分录列表产品上“一定不能做数据规则”。反之也不能因收款单已挂zkzj就断言分录入口已覆盖。当前未拿到该插件取数实现，未以目标账号实测，继承关系仍待验证。
- 金蝶2022-06-30补丁公告有销售订单关联收款单与收款列表数据权限一致性相关改进：https://vip.kingdee.com/article/334995353404001024 。这是历史版本差异线索，不代替当前安装版本与目标插件核实。本次未修改权限。

### 刘晓丽两角色收敛评估（2026-10-15，只读）

- 刘晓丽TK00472（111676）实时六角色与刘栋梁切换前相同。仅保留110/10043模拟：有效功能权限1775→1511，减少264项，无新增权限；所有原明确禁止项、字段查看/编辑禁止均由保留角色覆盖，无遗漏。
- 查询/引出/打印/下载/预览类仅发现SAL_SOChangeSynPriceRpt查看损失（此前用户明确该对象不用）；收款单新增/修改/删除、销售折扣表维护及其他非销售写入等也会取消，须在评估结论披露，不能统称纯重复无影响。
- 客户查看从SJGLYHSQ宽口径与严格规则并集，收敛为SJGLYHSQ-1本人销售员；收款查看仍zkzj。有效业务员分录129183，账号员工绑定有效。实际前端行为未实测。本轮仅用户要求核对，未移除角色。
- 证据output/liuxiaoli-two-role-assessment-2026-10-15.json；只读脚本assess-liuxiaoli-two-role-reduction.js。推广前重新按个人角色和权限差异核对，不能仅凭同名部门直接套用。

### 刘晓丽两角色切换完成（2026-10-15）

- 用户确认“去做吧”后重新实时评估，减少264项且禁止/字段限制无损，查询仅少此前不用的新变更单查询；默认dry-run后 --apply，逐一移除其在CommonRole、TYXS、禁止审核盘盈亏、1-XSJCQX的关联。
- SEC_User View、T_SEC_ROLEUSER全表差异检查、T_SEC_USERORG/T_SEC_USERROLEMAP均核对：TK00472只保留110全员与10043销售员。其他用户角色分配、四个旧角色定义和成员分录、刘晓丽的组织与其他账号属性未变。
- 证据output/liuxiaoli-two-role-switch-2026-10-15/liuxiaoli-two-role-switch-final.json；脚本switch-liuxiaoli-two-roles.js。前端重新登录行为尚未实测，不将配置回查说成账号功能实测。

### 陶葆两角色切换完成（2026-10-15）

- 用户承接刘晓丽精简请求“陶葆的呢”，按相同目标处理。实时TK00338（111675）为5角色，没有CommonRole；只移除TYXS、禁止审核盘盈亏、1-XSJCQX三关联，不凭前两人模板假定四个待删角色。
- 只读评估有效功能1761→1511，减少250项，无新增、禁止项及字段禁止无遗漏；查询类仅少用户此前不用的新变更单查询。默认dry-run后执行，SEC_User与角色关联全表、用户组织映射SQL回查确认仅保留110/10043，其余用户分配及角色定义不变。
- 证据output/taobao-two-role-assessment-2026-10-15.json、output/taobao-two-role-switch-2026-10-15/taobao-two-role-switch-final.json；脚本assess-taobao-two-role-reduction.js、switch-taobao-two-roles.js。前端使用效果未实测。

### 沈君梅精简前发现职责差异（2026-10-15，只读）

- TK00012（111061）实时六角色：禁止审核盘盈亏、信用管理、销售主管、销售员、销售总监、全员。与前三个账号的普通销售旧角色不同，不可直接套用两角色移除。
- 模拟只留110/10043，有效功能2297→1511，少786项，包括39个对象的查看入口（大量信用管理、信用特批、客户信用档案、经营分析等）；另销售总监的29项供应商禁止未由目标角色显式覆盖。当前模拟没有新有效授权，不等于可遗漏禁止设计。
- 客户范围将从主管/总监规则并集收窄为本人，收款从存在空规则授权收窄为zkzj，属于职责变化，须先确认保留管理职责还是改普通销售；本轮未修改任何角色关联。证据output/shenjunmei-two-role-assessment-2026-10-15.json，脚本assess-shenjunmei-two-role-reduction.js。

### 沈君梅逐角色冗余复核（2026-10-15，只读）

- 逐个移除模拟（含功能禁止优先、查看数据规则、字段状态、基础资料规则子实体）：只有481674禁止审核盘盈亏移除后功能无损、无新增、规则范围无变化、字段状态无变化，也无独有基础资料规则；其限制已经其他保留角色覆盖，可作为纯冗余关联。
- 销售主管不是完全重复：仍独有5项有效操作（价目表禁用/反禁用、币别附件/上传、手机全部客户），且客户查看5fe586b214b2c2与剩余规则不同，未验证等价；不可声称删除零影响。信用管理独有317项有效功能。销售总监独有206项，且移除会解除供应商相关禁止，使主管4项授权生效，不能仅按“高级角色包含低级角色”判断。
- 全员仍独有员工/税种查看；销售员独有203项并承担大量禁止与字段限制，不能作为重复删除。本轮不修改关联。
- 证据output/shenjunmei-role-redundancy-live-2026-10-15.json、output/shenjunmei-role-redundancy-basedata-2026-10-15.json；脚本assess-shenjunmei-redundant-roles.js。非空不同规则只标差异，未猜等价。

- 2026-10-15执行补充：用户明确只移除沈君梅的“禁止审核盘盈亏”。实时重跑逐角色评估确认完全冗余，dry-run后仅删除111061与481674关联；WebAPI、T_SEC_ROLEUSER全表差异及用户组织映射独立回查，保留110/10042/10043/148785/569143五角色，其他用户分配及角色定义未变。证据output/shenjunmei-remove-restriction-two-role-switch-2026-10-15/shenjunmei-remove-restriction-two-role-switch-final.json，脚本remove-shenjunmei-redundant-restriction.js；不据文件名中的two-role误称只剩两个角色。

### 供应商单据权限岗位限制（2026-10-16）

- 用户要求杨阳 TK02685（用户 117559，采购部采购员）的 BD_Supplier「审核」打开、「新增」关闭。新建岗位角色 `CGY_SUPPLIER_LIMIT_V1`（933933，名称「采购员-供应商权限限制」，按岗位命名而非个人），仅分配该账号；`BOS_AUDIT` 有权 0、`BOS_NEW` 禁止 2；未修改任何共享角色。
- 「关闭」选禁止 2 而非无权 1：同用户的采购主管 SCM02_SYS（10038）对 `BOS_NEW` 为有权 0，无权不能覆盖有权，只有禁止能（禁止优先）。判断目标状态前必须先按账号全部有效角色计算。
- 操作项 `FITEMID` 为 32 位 GUID 字符串（`BOS_AUDIT`=`47afe3d45bc84016b416a1206e121d45`，`BOS_NEW`=`fce8b1aca2144beeb3c6655eaf78bc34`）。对其使用 `Number()` 得到 NaN，dry-run 中 itemId 显示为 null；比较与传参一律用字符串。
- 验证：WebAPI View 与 `T_SEC_FUNCPERMISSIONENTRY` 双通道一致；`T_SEC_ROLEUSER` 相对执行前仅新增 933933 关联，其余 7 个角色原样保留。未以杨阳账号登录验证界面、审核或新增行为。证据 `output/yangyang-supplier-perms-2026-10-16T09-23-15-332Z/`；脚本 `scripts/scratch/2026-10/configure-yangyang-supplier-perms.js`（默认 dry-run；角色已存在时停止，不重复创建）。

### 销售员向销售总监补权（2026-10-16）

- 仅复制源角色有效有权、目标未授权的操作；差集键必须为业务对象与权限项内码，不能用操作编码：同对象可能存在相同操作编码的不同权限项内码，本次客户对象因此曾漏1项，最终已补入并双通道回查。
- 保存前实时读权限表头和WebAPI View，逐项合并并保留分录主键；新授权沿用源操作数据规则，不改目标已有客户查看规则、字段限制和角色成员。每对象保存后WebAPI与数据库检查目标状态/规则以及非目标分录，失败停止。
- 本次补入212项，最后只读差集剩7对象26项：六类报表25项无目标表头且不在标准Save对象过滤范围，HR_ShiftInfo一项缺元数据，均未写。已有报表权限表头可按内码更新的实证不等于可通过过滤新建报表表头。未登录目标账号验证。
- 工具：scripts/scratch/2026-10/catchup-director-from-salesperson.js（默认dry-run）。证据：output/sales-to-director-2026-10-16-*-before/save/after.json；剩余范围以output/sales-to-director-plan-2026-10-16.json最终dry-run为准。过程计划会被后续运行刷新，不能把最后计划数量当作初始迁移数量。

### 移除销售员角色前的账号级模拟（2026-10-16）

- 按SEC_User组织分配与T_SEC_USERORG/T_SEC_USERROLEMAP交叉核对，纳入账号所有有效角色；以业务对象+权限项内码计算移除前后有效权限（禁止优先）。字段逐对象/字段分别合并查看、编辑状态；未配置不等于已验证可见/可编辑。还须比较基础资料数据范围子实体，不能仅比较操作上的FDATARULE。
- 本次只读模拟沈君梅退出销售员：失去HR_ShiftInfo查看1项，解除34项功能禁止；74个字段配置来源变化，其中57个字段查看/编辑禁止失去来源。催收管理和应收坏账风险监控两项本人客户基础资料规则只在销售员角色，移除可能扩大范围。跟单员A没有销售员角色，无需移除。均为当时配置快照，未执行角色移除，未验证目标账号前端。
- 工具scripts/scratch/2026-10/audit-director-without-salesperson.js；证据output/director-without-salesperson-audit-2026-10-16.json（账号及字段WebAPI、SQL快照、规则XML和联动映射）与output/销售总监退出销售员角色前核对_2026-10-16.md。复用前实时重查，不将动态规则XML中登录用户展开值当目标账号范围。

### 销售总监权限边界配置与报表字段阻塞（2026-10-16）

- 用户认可建议后授权配置总监：已用标准WebAPI设10项操作禁止（销售出库删除/作废；销售退货删除/反审核/审核；退货通知删除/反审核/引入/附件删除；应收获取成本信息），33个采购/出库价格成本字段查看编辑禁止；两项催收/坏账风险客户基础资料范围使用现有总监动态规则676df6b034697d。操作/字段/范围及非目标原分录均已回读核对。
- 物料收发汇总表20与明细表18字段没有总监字段权限表头；标准字段授权新建对象模型范围受限，未修改过滤、未SQL写入。等待前端配置这38字段为查看/编辑禁止；未移除沈君梅销售员角色。配置只完成可写部分，不能宣称角色拆分完成或目标账号页面已验证。
- 脚本scripts/scratch/2026-10/configure-director-boundaries.js默认dry-run；本次执行证据目录output/director-boundaries-2026-10-16T00-55-11-871Z，含完整计划、逐对象前值/请求/返回/回读及进度；手工清单output/销售总监剩余字段保密配置_2026-10-16.md。收尾模拟仅剩38报表字段禁止失去来源和3项其他字段配置差异，功能解除禁止由34减至24项，HR_ShiftInfo查看仍为唯一缺项。均是当时快照，继续前实时重查。

### 纠正：未授权报表的字段限制不构成角色移除门槛（2026-10-16）

- 用户指出销售总监无物料收发汇总表/明细表查看权限。实时重查功能权限，销售员10043及总监148785均无这两对象的有效功能授权；沈君梅保留的总监、信用管理、全员角色同样无查看。因此上节要求迁移38字段并等待手工配置后才能移除角色的结论失效；手工清单不再执行，不新增报表查看权限。
- 原因：只比较字段记录来源变化，遗漏了对应对象在账号移除前后是否具有有效查看权限。正确顺序：先按账号全部有效角色合并功能权限，再评估可访问对象的字段影响；无查看入口的字段记录变化应标记潜在配置差异，不能直接作为当前泄露或移除阻塞。
- 跟单员A另从仓库主管获得两报表查看权，但其没有销售员角色，本次不涉及移除；不应为沈君梅拆角色而给共享总监增加38字段禁止，从而顺带改变跟单员A仓库岗位的字段权限。
- 证据：output/director-without-salesperson-audit-2026-10-16.json在2026-10-16T00:59:12Z的只读重查。原38字段待办已撤销，脚本configure-director-boundaries.js移除这两报表配置范围；此前33字段、10操作、2客户范围写入仍保留。本段只纠正待办，未移除沈君梅角色。

### 沈君梅移除销售员完成（2026-10-16）

- 用户确认继续后，实时核对仅HR_ShiftInfo查看为功能缺项（旧对象不补），33字段禁止、10操作禁止、2客户范围均已配置；38个不可访问报表字段不再列为阻塞。
- 通过SEC_KDRoles标准Save，仅从销售员10043/SCM04_SYS的FEntityUser删除沈君梅111061/TK00012关联，保留其他成员原分录主键；用户及角色WebAPI、T_SEC_ROLEUSER、T_SEC_USERORG/T_SEC_USERROLEMAP回查一致。沈君梅仅保留全员角色110、销售总监148785、信用管理569143；其余4名销售员成员和角色定义未变。未登录沈君梅验证菜单、数据、缓存及导出效果。
- 工具scripts/scratch/2026-10/remove-shenjunmei-salesperson-via-role.js默认dry-run，固定个案身份与角色前值守卫；证据output/shenjunmei-remove-salesperson-via-role-before/save/after-2026-10-16.json，最终只读审计output/director-without-salesperson-audit-2026-10-16.json。该段更新此前尚未移除的历史状态，复用必须实时重查。

### 岗位角色命名纠正（2026-10-16）

用户明确：限制针对岗位，不针对个人。可复用岗位角色的名称、编码和说明按岗位命名，当前只分配一人不等于个人角色；新增其他成员仍需明确授权。角色933869已由SJM_LIMIT_V1/商务员A-销售跟单业务限制改为SALES_FOLLOW_LIMIT_V1/销售跟单-业务限制，说明同步改为岗位用途。WebAPI和数据库回读名称编码一致，功能、字段与成员分录前后完全相同。证据：output/rename-sales-follow-limit-role-2026-10-16-before/save/after.json；脚本scripts/scratch/2026-10/rename-sales-follow-limit-role.js默认dry-run。前述旧编码仅为历史记录，复用脚本须先重新核对当前编码。

同日用户进一步明确岗位范围为国际部：角色933869现名为国际部跟单限制，编码INTL_FOLLOW_LIMIT_V1，说明同步限定国际部跟单岗位；上一段SALES_FOLLOW_LIMIT_V1为历史中间名称。权限及人员分配前后不变，WebAPI及数据库复查通过。证据：output/rename-intl-follow-limit-role-2026-10-16-before/save/after.json。岗位角色命名应采用用户确认的部门及岗位范围，不能用泛化岗位名称替代。

### 系统参数既有授权取消（2026-10-16）

用户在确认两个授权来源后要求取消有权：销售员基础权限172802/1-XSJCQX、本账套销售主管240774/1-XSZG的SAL_SystemParameter/BOS_MODIFY已由0改1（无权），属于共享角色调整。实时成员分别16人、2人（后者包含在前者中），执行前已提示共享影响；角色定义、成员、其他操作及数据规则回查未变，商务员A全部角色已无此项有权。未实测目标账号界面。标准接口不能为220类型新建表头，不代表不能更新其既有表头：本次使用原FItemID、原分录FEntryID，省略FObjectTypeId，校验开启，WebAPI与数据库验证成功。工具scripts/scratch/2026-10/remove-sales-system-parameter-modify.js默认dry-run；证据output/remove-sales-system-param-modify-1792114616447/。仅取消修改，发送短信未改；历史125项专属限制与三角色合并未完成的状态不因此改变。

### 国际部跟单旧角色精简（2026-10-16，部分完成）

用户授权精简商务员A旧角色。逐角色模拟显示移除481674不会改变当前有效功能，但严格检查发现其4项显式禁止并非全部已有同状态来源；不能把gain=0称为所有禁止均已覆盖。已先将盘盈/盘亏审核及反审核4项禁止迁入INTL_FOLLOW_LIMIT_V1/933869（SQL与WebAPI验证），再仅从481674的FEntityUser删除111677关联；其他成员、角色定义、用户属性和组织映射回查未变。角色7→6，未完成最终三角色合并。迁移证据output/songjinmei-migrate-stockcount-denials-1792115426166/；移除证据output/songjinmei-reduce-roles-1792115430149/。脚本migrate-songjinmei-stockcount-denials.js与remove-songjinmei-redundant-role.js均位于scripts/scratch/2026-10/，默认dry-run。

剩余实时评估：TK通用权限独有18操作、移除会新增33有效操作及108字段状态变化，含2个新建授权受限的报表；通用销售权限独有9操作、38有效操作被解除禁止、1条基础资料范围；本账套销售主管独有4操作、2条操作范围及43条基础资料范围来源；销售员基础权限独有8操作、1条操作范围、1字段状态及61条基础资料范围来源。以上是当日配置快照与差异来源数，不等于业务风险数量或全部实际显示变化，复用须重新核对可访问对象与并集。未为减少角色跳过必要查询、范围及字段保护，也未修改其他共享角色。完整评估output/songjinmei-role-reduction-status-2026-10-16.json，说明output/商务员A旧角色精简进度_2026-10-16.md；报表等对象通过标准角色权限界面迁移仍待完成，目标账号前端未实测。

### 国际部跟单替换通用销售权限完成（2026-10-16）

用户授权迁移147855通用销售权限后移除商务员A分配。实时按对象+权限项内码、禁止优先及操作数据规则签名核对，9项独有有效查询迁入新岗位角色国际部跟单-公共查询933871/INTL_FOLLOW_QUERY_V1；原69项禁止中66项缺同等保留来源，迁入现有国际部跟单限制933869，其余3项已覆盖。源应收款汇总表AR_SumReport的BD_Customer规则5fe586b214b2c2在保留角色172802有同规则，因此无需为这条重复范围新建报表授权，不应当成接口阻塞。

先dry-run，配置后模拟最终有效功能及数据规则签名完全一致，才给新查询角色分配111677并从147855删除该用户分录；全表分配仅两处预期差异，其他成员、源角色定义和源功能权限未变。有效功能1214项、字段配置及基础资料范围并集不变，组织映射回查通过，未实测目标账号前端。当前角色仍6个（替换一个新增一个），完整三角色合并未完成。脚本scripts/scratch/2026-10/replace-songjinmei-common-sales-role.js默认dry-run；独立检查verify-songjinmei-common-sales-migration.js。证据output/songjinmei-common-sales-migration-1792115765562/，结果output/商务员A通用销售权限替换结果_2026-10-16.md。

### 公共查询复用全员角色与末成员清理（2026-10-16）

用户明确要求复用全员角色。实时核对现有沈君梅、陶葆、刘晓丽、叶珊妹、刘栋梁五名成员均已有效拥有临时公共查询的9项授权；向110/BD10_SYS补入辅助资料3项、辅助属性值6项不会改变五人的有效功能/操作范围。商务员A新增全员后额外获得币别、存货类别、汇率、结算方式、库存状态5项查看，执行前已明确说明；此为用户授权复用的实际差异，不可声称全部人员权限零变化。现有原授权、字段和非空基础资料范围回查不变。

标准SEC_KDRoles Save传FEntityUser=[]、NeedUpDateFields=['FEntityUser']、IsDeleteEntry=true，对唯一成员返回成功但未清除，不能复用先前多成员删除经验断言空列表有效。随后确认临时角色933871只用于本任务、只有商务员A且9项全部被全员承接后，通过标准Delete清理临时角色；该Delete移除角色与T_SEC_ROLEUSER但遗留T_SEC_USERROLEMAP，SEC_User View显示FRoleId=null而FRoleId_Id仍933871。使用标准SEC_User Save修复：FUserID=111677，FOrgInfo仅原FEntityID，FRoleInfo只带保留分录FDetailID，NeedUpDateFields=[]、IsDeleteEntry=true、IsVerifyBaseDataField=true、ValidateFlag=true，不重新赋FRoleId引用。WebAPI与数据库确认只删除目标孤儿组织角色行、其他成员关系和账号属性不变。这是带原主键的嵌套删除成功实证，不证明早先重新解析角色编码的失败模型可复用。全程无SQL写入。

最终商务员A保留全员110、TK通用145640、销售员基础172802、本账套销售主管240774、跟单666737、国际部跟单限制933869，临时角色933871已删。证据output/reuse-common-intl-query-1792116018518/含baseline、逐项保存、空成员假成功诊断、Delete、孤儿清理及final；脚本reuse-common-role-for-intl-query.js、finish-common-role-reuse.js、cleanup-common-reuse-orphan-map.js位于scripts/scratch/2026-10/，写入默认dry-run；finish脚本--verify-only只读。目标账号前端未实测，三角色合并仍未完成。

### 国际部跟单承接主管权限准备（2026-10-16，未切换）

用户授权继续移除商务员A本账套销售主管后，实时核对独有4操作（生产订单打印/引出/预览、其他出库查看）、客户/报价两条操作规则，以及未在其他角色同规则覆盖的基础资料范围；其中13个900报表仍可访问，不能忽略范围变化。跟单666737有9名成员，不能直接加主管组范围影响其他人；全员其他5人均无其他出库查看，不能把该项顺手加给全员。

已创建未分配角色国际部跟单933873/INTL_FOLLOW_BIZ_V1，默认dry-run后按原主管实时有效有权且未被商务员A其他角色禁止的项，迁入29个支持对象579项操作、27条基础资料范围，含4项独有查询及客户/报价规则，逐对象WebAPI和SQL回查通过。原用户角色、共享主管定义与成员不变，新角色未分配，原主管未移除，当前仍6角色；这些配置是迁移准备，不是已生效的新岗位切换。13个报表新建授权仍受对象类型过滤，未写入，待在标准权限界面补齐操作和客户范围后再验证并切换。不得跳过或宣称6减5完成。脚本scripts/scratch/2026-10/prepare-intl-follow-supervisor-migration.js默认dry-run；只读评估plan-songjinmei-supervisor-removal.js。证据output/intl-follow-supervisor-migration-1792117017696/，交接output/国际部跟单主管权限迁移待办_2026-10-16.md。未实测目标账号页面。

### 手工补六报表后的主管切换完成（2026-10-16）

用户按建议配置六张报表后，实时查到国际部跟单933873已被用户分配商务员A（当时七角色）；六报表查看/引出等已授权但FEntityBaseDataPer均空。因已有报表权限表头，可标准Save按FItemID、FRoleId只写基础资料子实体，省略FObjectTypeId，校验开启；六张均补BD_Customer/676df6b034697d，操作分录与用户手工成本/短信选择前后不变，WebAPI/SQL验证成功。六张为SAL_DetailReport、SAL_CollectReport、Sal_OutStockDetailRpt、SAL_OutStockSummaryRpt、SAL_OutStockInvoiceRpt、SAL_CusArrRateRpt。用户选择暂不补的其余七张，仅主管来源的组客户基础资料范围未迁；仍可能从销售员基础等角色获得报表功能，不能称报表入口已关闭。

默认dry-run后移除商务员A在240774/1-XSZG的唯一成员行，保留覃琼燕原分录，源角色定义、其他分配、字段及有效操作/操作规则签名不变；仅七个经选择不迁的组范围从并集中减少，账号属性和组织映射核对通过。最终110、145640、172802、666737、933869、933873六角色；实际七减六，是主管换岗位角色，不是六减五。六张成本/短信仍按用户手工授权保留，未实测目标账号页面。证据output/intl-follow-report-switch-1792117456088/，此前手工配置回查output/intl-follow-manual-report-check-1792117344572/；脚本scripts/scratch/2026-10/complete-intl-follow-report-scope-switch.js默认dry-run。已有报表头可更新基础资料范围的实证不能推广到新建900表头。

### 三角色最终合并的普通对象迁移与规则失败（2026-10-16，未完成）

用户确认继续收敛到全员110、国际部跟单933873、国际部跟单限制933869。已将六张选定报表中的出库明细/汇总成本查看2项、五张报表短信5项在933873设禁止，逐项SQL/WebAPI回查，其他操作和六张客户范围未变。证据output/intl-follow-report-cost-sms-1792117682204/。

实时合并全部六角色后，将目标尚未覆盖的普通对象原有有效有权/显式禁止迁入933873/933869：96组功能配置562项操作、12条基础资料范围；7类对象140条字段迁入限制角色，携带FFieldName。所有写入逐对象双查，独立按禁止优先及操作规则签名、字段查看/编辑状态并集复核，当前有效权限与字段状态未变，原角色定义和成员未变。38条STK_StockSummaryRpt/StockDetailRpt字段限制对应无有效查看入口，标为潜在配置差异，不作为当前切换阻塞。证据output/intl-follow-final-three-1792117834344/含plan/progress/final/independent-verification。三旧角色尚未移除；31个报表/参数等对象无目标表头受类型过滤、2处操作范围并集及33处基础资料范围来源差异仍需核对处理；七张此前不用的报表不得因此全部重加。完整手工待办output/国际部跟单三角色合并待办_2026-10-16.md。

新数据规则失败实证：试图按现有动态纯OR原子创建原范围并集，标准SEC_DataRule Save返回成功，但顶层FXML的FilterString、FilterSetting为空，仅CustomFilterSetting的嵌套原FXML保留输入。不能用嵌套文本含条件或IsSuccess证明条件生效。只读反编译NewDataRulePlugIn显示AfterSave使用内部_dataRule及SaveDataRule重写顶层XML，解释了当前通用Save路径不保留筛选网格状态；尚无已验证修正写入模型。测试只新建未引用规则6ad18e3a4b2f71/INTL_SCOPE_UNION_1_V1，未绑定任何权限，失败后已用标准Delete清理并SQL回查，原7条规则未变，禁止盲目继续批量新建或应用。脚本merge-intl-follow-data-rule-unions.js已禁止apply；失败/清理证据output/intl-follow-rule-unions-1792118125515/，cleanup-unused-intl-union-rule.js默认dry-run。后续需在前端建立等价并集，再重新验证；不得改SQL权限表或硬编码当前调查账号展开值。

工具scripts/scratch/2026-10/tighten-intl-follow-report-cost-sms.js、migrate-intl-follow-final-three.js均默认dry-run，verify-intl-follow-final-stage.js只读；当前仍六角色，三角色目标未实现，实际账号页面未实测。

### 用户手工补八对象后的复查与小缺项修正（2026-10-16）

用户称已配置并要求核对，实时SQL及WebAPI确认七张报表必要功能齐全，仓位值集已有目标权限表头但BOS_VIEW为1；新六张报表BAS_SendSMS又为0。按已授权仅查看/不短信的方向，将六项短信设禁止，成本两项原禁止保持；已有800类型仓位头可省略FObjectTypeId按原FItemID/FEntryID把查看1改0，逐项双查，不代表可直接新建800表头。应收款汇总表与应收单跟踪表客户基础资料范围均空，而保留源角色172802有5fe586b214b2c2；已按原规则补到新角色的已有报表表头，其他操作不变。证据output/intl-follow-report-cost-sms-1792118972086/、output/intl-follow-eight-small-gaps-1792119070611/。

末次audit-intl-follow-manual-eight.js（只读）确认八对象必要权限无缺、六新增报表短信无有权；四类预期动态纯OR并集在目标角色仍未挂齐，客户查看仍主管组规则、报价查看仍所属组规则，不能据报表查看勾选齐全移除旧角色。比较动态规则必须取顶层FilterSetting，排除CustomFilterSetting内嵌旧XML；按FieldName/Compare/Value及OR括号语义核对，结构不同的规则不得仅凭名称宣称等价或不存在。当前仍六角色，未进一步移除角色或修改原规则。结果output/国际部跟单手工配置复查_2026-10-16.md；具体最新证据目录由output/intl-follow-manual-eight-latest.json指向。未实测目标账号页面。

### 用户确认最终客户范围及三角色收敛完成（2026-10-16）

用户明确：所属组规则已包含需要范围、报价不用再处理、客户范围以其当前修改为准。这项业务确认取代此前完整重建旧角色规则并集的要求，不再以四类并集未建阻止切换，也不再擅自修改用户已确认的范围。实时只读发现用户已经移除172802、145640、666737；不得称为本次Agent执行了移除。当前TK00856仅110全员、933873国际部跟单、933869国际部跟单限制，SEC_User View、T_SEC_ROLEUSER及组织映射三路一致，源三角色其他成员与迁移基线一致。

最终核对八对象功能齐全、18项日常订单/发货/库存/报表必要权限及12项禁止/无有效授权检查通过，13个所选报表短信无有效权限，出库两张成本查看禁止；所有引用数据规则存在且启用。最终1126项有效操作是当日快照，不作长期默认。配置层三角色目标完成，实际账号页面/锁库/打印导出/缓存仍未实测。只读脚本scripts/scratch/2026-10/verify-intl-follow-final-approved-three.js，证据output/intl-follow-final-approved-three-1792119407260/，结果output/国际部跟单三角色最终复查_2026-10-16.md；旧合并待办、手工复查、主管待办均已加历史状态说明，先前并集要求撤销。

### 覃琼燕与国际部跟单三角色比较（2026-10-16，只读）

用户要求检查覃琼燕。实时TK02886/111069为四角色：145640 TK通用权限、147855通用销售权限、240774本账套销售主管、172802销售员基础权限；无666737跟单角色，业务员分录129182归国际一部。用户View、角色关系和组织映射一致，客户功能权限头以WebAPI独立回读。当前1255项有效操作、151对象；出库成本查看、工序计划写入、调拨写入、应收核销等仍配置有权。与商务员A三角色比较，候选1126项会失去211项且新增82项，其中生产入库新增/修改/提交、收款整单退款来自原商务员A跟单权限来源，不能因为同一销售组就直接复用；本次没有任何权限写入或角色切换。差集计数按对象+权限项内码并计算禁止优先，字段与数据范围不由功能数替代。证据output/qinqiongyan-role-audit-1792132081208/audit.json；报告output/覃琼燕角色权限核对_2026-10-16.md；脚本scripts/scratch/2026-10/audit-qinqiongyan-roles.js只读。所有数量为当时快照，未用目标账号实测。

### 覃琼燕收敛至既有外贸经理（2026-10-16，配置切换完成）

历史中间状态：下文单角色方案随后被用户纠正，现行结构见下一节“外贸经理三角色职责拆分”。“优化到外贸经理里面”不应自行推定为取消全员及限制角色；岗位业务角色承接业务能力与三角色分工可以同时成立。

用户明确优化到一个既有外贸经理角色，并选择“保留销售审批，关闭成本查看”，同时收紧财务核销、生产维护、调拨写入。实时唯一角色187988/WMJL原无成员，但有大量遗留授权，不能直接分配。按覃琼燕四来源的有效权限、禁止优先及岗位边界编译目标，将遗留非原有授权取消；85对象372项功能状态/规则调整，5对象17项非默认字段权限迁入。原STK_InStock等全部无权1按默认状态保留，38条无查看入口的库存报表字段不为迁移而新增报表。客户与报价选择原主管所属组规则676df6b034697d、67a5a8427a07ca，基础资料规则优先原主管来源；这是岗位范围选择，不宣称与所有旧OR来源严格等价，商务员A确认不自动当作其他人员范围证明。

目标缺少UNW_MOOScheduleRpt生产计划单分单明细表、SFC_OperationReportRpt工序汇报汇总表两个900授权表头。通过当前登录金蝶前端“业务对象功能授权”选择WMJL、显示全部业务对象、过滤对象后补齐：前者原有查看/打印/引出/短信4项，后者仅原有查看。授权后页面显示角色授权成功和已设置是，后续SQL独立核实。金蝶自定义表格的DOM checkbox check/setChecked及双击可能出现短暂勾选后丢失；先观察，改用截图定位单次实际复选框点击，读取AX状态确认互斥列，再点授权并核对数据库，不把临时DOM勾选当保存成功。未改变元数据类型过滤，无SQL写入。

独立核对1255→1217项有效操作，恰少38项经岗位策略关闭项，无新增和非预期丢失；可访问字段状态一致，目标基础资料规则均有原来源。标准SEC_KDRoles Save添加111069后，以SEC_User Save的原组织FEntityID、保留新角色原FDetailID、IsDeleteEntry=true删除原四个组织角色行，不重新解析保留角色引用；T_SEC_ROLEUSER全表仅新增187988/111069和删除原四条，SEC_User View、组织角色映射三路最终均只187988，源角色其他成员不变。此为普通有效角色关联的嵌套删除成功实证，补充前述孤儿关联清理案例；避免唯一成员角色空FEntityUser假成功。

脚本scripts/scratch/2026-10/stage-foreign-manager-fields.js、stage-foreign-manager-functions.js、verify-switch-foreign-manager.js均默认dry-run，--apply显式写入。证据output/foreign-manager-fields-1792133141051/、output/foreign-manager-functions-1792133223120/、output/foreign-manager-switch-1792133608066/。业务员国际一部为当日快照；配置生效已核实，未以覃琼燕账号实测业务页面、审批或打印导出。

### 外贸经理三角色职责拆分（2026-10-16，用户纠正）

用户明确采用全员110/BD10_SYS、外贸经理187988/WMJL、外贸经理限制933905/WMJL_LIMIT_V1三角色。岗位名不能按个人命名。全员角色只复用，未修改其定义；赋予覃琼燕后新增币别、汇率、结算方式、库存状态、存货类别5项公共查看。原经理业务权限及客户/报价范围不扩大。新限制角色通过标准WebAPI创建，260项普通对象禁止及5对象17项字段配置迁入；先分配限制角色，再分配全员，确认有效功能和字段合并状态后才将经理里已覆盖禁止、字段状态重置为无权1。不得先清除保护后迁移。

限制角色无既有900表头，4项不能标准WebAPI新建：销售出库汇总报表/销售出库明细报表的成本查看禁止、生产订单执行汇总表/生产订单工序进度表的发送短信禁止。这4项继续保留于经理角色，待用户在限制角色前端设禁止后再双查并清除经理重复项，不得因此临时解除禁止或称全部限制拆分完成。工具split-foreign-manager-restrictions.js、finish-foreign-manager-split.js在scripts/scratch/2026-10/，默认dry-run；证据output/foreign-manager-split-1792134051566/和output/foreign-manager-split-finish-latest.json所指目录。

本次用户进一步明确：此类权限设置只使用WebAPI，不操作浏览器；WebAPI不支持的精确对象、操作及目标状态交由用户手工设置。后续即使存在可用浏览器也不能自动代操作。此约定优先于前述Agent前端补报表历史案例。

用户称已补齐后的复查：实际仅两张出库成本和生产订单工序进度短信3项覆盖，生产订单执行汇总表/发送短信仍缺限制角色授权头；不得把“设置了”视为四项已全齐。另出库明细短信被用户额外设禁止，保留该手工选择，实际有效操作1222→1221且无新增。已通过WebAPI复读三个限制表头，并标准Save仅清除经理中对应3项禁止，剩余1项仍由经理禁止保护。证据output/foreign-manager-split-finish-1792134988019/。finish脚本重复执行须忽略经理里已重置为1/1的字段行，不能拿它与限制角色非默认值强行比较而误报未覆盖；最终合并字段签名仍必须验证。后续只需用户补生产订单执行汇总表的短信禁止，再复查最后一项。

### 外贸跟单下推收款和应收入口缺失（2026-10-16）

商务员A反馈销售订单下推窗口缺少收款单、应收单。实时SEC_User及SQL确认当前仅全员110、国际部跟单933873、国际部跟单限制933869；两财务对象均无有效BOS_NEW，岗位角色只保留查看，限制角色对应新增当前为无权1（不是禁止2）。SEC_FuncPermissionInfo View独立回读权限头。配置缺少目标新增与截图现象一致，但未以目标账号实测，也未据此证明转换规则和单据条件全正常。本次仅诊断，未改授权。证据output/songjinmei-ar-push-diagnosis-2026-10-16.json；只读脚本scripts/scratch/2026-10/diagnose-songjinmei-ar-push.js。

收紧财务权限时必须区分跟单下推生成/保存草稿与财务审核、核销；不能把所有新增、修改、提交、审核一并视为无需跟单参与。若用户授权恢复下推，先明确两目标单的新增、保存所需修改及提交边界，保持审核/反审核/核销等独立控制，再逐项双查并请目标账号重新登录验证入口和实际生成行为；禁止仅凭配置成功宣称业务已恢复。

用户随后明确授权恢复。默认dry-run后，仅用标准WebAPI给国际部跟单933873的AR_RECEIVEBILL、AR_receivable新增BOS_NEW及BOS_MODIFY有权0，共4项；限制角色对应无权1不构成禁止，无须修改限制角色。既有权限头按FItemID合并、保留原分录主键及规则，新分录规则空；基础资料范围与所有非目标操作SQL/WebAPI回查不变，用户三角色分配不变。提交、审核、反审核、核销等保持原状态，未创建业务单据。证据output/intl-follow-ar-draft-rights-1792135081880/plan.json、final.json及逐对象save/after；工具scripts/scratch/2026-10/restore-intl-follow-ar-draft-rights.js默认dry-run。配置恢复已验证，目标账号下推实际行为仍待重新登录验证，不可称实操恢复已完成。

### WebAPI-only 角色权限只读汇总（2026-10-17）

- 先通过 `SEC_User` 查询唯一账号并 View 组织角色，再按角色查 `SEC_FuncPermissionInfo` 权限头；按真实 FItemID 去重、分批 View，及时保存原始结果后再解析规则，避免长批次因汇总失败丢失证据。
- 当前 View 返回的引用字段采用不同命名：角色引用是 `FNumber/FName`，业务对象引用是 `Name`，权限项引用是 `Number/Name`；不能照角色结构读取权限项。用样本核实结构后，按对象及权限项内码计算有权并集，禁止优先，操作规则不能只保留任一来源。
- 无规则可能返回单个空格 `FDataRule=' '`，须先 trim 再决定是否调用 `SEC_DataRule` View；空格直接传入会报“单据内码为空，无法打开单据”。规则顶层动态条件按既有规则解释，不能用调查账号展开值代替目标用户。
- 陈秋伶 TK03772 当日只读 WebAPI 快照：6角色，按已读配置合并1373项操作/151对象；跟单对财务应收审核/反审核存在无规则放宽路径，OEM跟单授予生产订单审核，盘盈亏审核/反审核明确禁止。未做字段授权完整核查、官方用户权限报表或目标账号实操，不能视为完整运行验证。证据 `output/chenqiuling-permission-audit-2026-10-17.json`，原始回读 `output/chenqiuling-raw-live.json`；脚本 `scripts/scratch/2026-10/audit-chenqiuling-roles.js`。数量及角色必须复用前重查。

### OEM跟单权限分阶段整理（2026-10-17，历史方案已撤销）

历史状态，随后被用户纠正：现行应使用原OEM角色，保留当前权限，不新增收紧。原18项收紧已撤销，新业务及限制角色均无人使用，旧手工清单失效，详见下节“原OEM共享角色归并”。用户曾确认陈秋伶为OEM跟单，并授权按全员＋岗位业务＋限制三角色优化。实时现有OEM/855125由李银兰、林思萍、陈秋伶、周雪菲4人共用，未获其他成员权限变动授权，故保持其定义与成员不变，新建OEM跟单业务OEM_FOLLOW_V1/933972、OEM跟单限制OEM_FOLLOW_LIMIT_V1/933973。岗位业务角色尚未分配；限制角色仅分配陈秋伶TK03772/457984，原6角色保留，当前7角色。不得称三角色收敛完成，也不得直接改共享OEM。

本次已迁141组普通功能配置和7类字段，普通对象限制生效后1373→1355项有效配置，恰减少18项、无新增：应收提交/审核/反审核/核销，收款退款/核销/现金与银行余额，生产订单审核/反审核/强制结案，客户删除/审核/反审核/禁用/反禁用/冻结/解冻。销售审批及尚未经业务必要性核实的工序反向操作保留；不是将所有生产写入关闭。应收收款新增/修改供下推保存草稿保留。客户四动态条件与跟单两条件的现有6ad1dacd4b5a62经顶层纯OR原子验证，等价覆盖源规则，业务目标复用它，没有新建或改源数据规则。

尚缺35个业务角色特殊对象头、限制角色两张出库报表成本禁止头；两张成本目前仍有效。当前直接切换会少139项非拟收紧操作，故不移除原角色。两张无当前查看入口库存报表的38个字段为额外潜在差异，不为迁移新增查看权限。手工清单`output/陈秋伶OEM跟单权限优化进度_2026-10-17.md`列精确角色、对象、FormId、操作及目标状态：用户补头后，以默认dry-run脚本重算、WebAPI填原操作及基础资料范围，再完整验证后切换；不因勾了查看就视为范围已迁。

WebAPI批量只读可直接查询SEC_FuncPermissionInfo的FItemID/FRoleId/FObjectTypeId/FPermissionItemId/FPermissionItemId.FNumber/FPermissionItemId.FName/FPermissionStatus/FDataRule，另查FBaseDataObjectTypeID/FDataRuleID、FObjectTypeId.FModelTypeId/FName；字段查询SEC_FieldPermissionInfo的FFieldKey/FView/FEdit。FFieldName当前不是可查询元数据字段，写入所需名称从View取。批量查询设足够Limit并检查截断，头/项按内码去重；View主要用于写前及逐对象写后检查，可避免为只读汇总逐个View数百头。所有写入依旧默认dry-run、显式--apply，发现异常立即停。

工具：`scripts/scratch/2026-10/stage-oem-follow-roles.js`（可继续补头后迁移，始终不移除源角色）、`verify-oem-follow-stage.js`（独立只读）。证据`output/oem-follow-stage-1792203344958/`，实时来源指针`output/oem-follow-stage-latest.json`。逐对象写前/写后与独立WebAPI批量回读确认源功能、字段、基础资料范围及共享角色未变；未使用目标账号验证业务页面和缓存。所有数量均为当日快照。


### 原OEM共享角色归并（2026-10-17，历史迁移阶段）

用户连续纠正：直接用原OEM跟单OEM/855125，李银兰、林思萍、陈秋伶、周雪菲4人都要整理，接受共享角色影响；“先不要限制角色权限，先现在有什么就给他们什么”。此业务确认取代此前孤立新岗位和收紧20项的策略，不能继续要求给OEM跟单业务933972补头或分配OEM跟单限制933973。

先实时读陈秋伶与限制角色，通过SEC_User原组织/角色分录主键仅移除933973，WebAPI独立确认还原原6角色且账号属性未变，先前18项收紧撤回。未删除源角色与业务单据。工具restore-oem-follow-unrestricted.js默认dry-run；证据output/oem-follow-restore-1792203788606/。新建两角色当前都无人分配。

实时全查4位成员角色及功能、规则、基础资料和字段。李银兰、陈秋伶、周雪菲同6角色，各1373项；林思萍为7角色，另有林思萍个人187110、销售主管10042，无跟单666737，共2202项。按前三人的已有有效操作、原有禁止、字段合并状态迁入原OEM；不把林思萍个人/主管权限复制给另外3人，原角色分配全部保留。用户接受共享角色影响；预检向其明确林思萍将新增43项岗位操作后，执行121个普通对象1293项功能状态/规则迁移、6类字段迁移。未新增收紧，原禁止项保留。客户现有动态OR并集6ad1dacd4b5a62顶层原子等价已实时验证，未修改源规则。

独立WebAPI回查前三人1373项不变且操作规则并集不变；林思萍2202→2245、无减少，新增43项为收款、出库、生产入库等原跟单岗位能力；应收审核/反审核由原6753b946a71c20限制放宽为无操作数据规则。这是共享归并影响，不能声称4人权限严格不变。所有人字段合并状态不变，源其他角色配置、用户属性、所有角色分配及规则定义未变。

仍缺35个报表/参数/仓位等特殊对象授权入口，需用户仅在原OEM角色建头，再WebAPI迁移原有操作、成本查看与基础资料范围。新角色及成本禁止旧清单已废止；当前不关闭成本。两张无当前查看入口库存报表38个字段等潜在差异保留在来源角色，不为迁移扩大查看入口。原角色未移除，最终角色收敛尚未完成；林思萍个人和主管角色继续保留。未以目标账号实测。

现行工具snapshot-oem-shared-unrestricted.js（先刷新基线）、merge-original-oem-preserve.js（默认dry-run，再显式--apply，检测漂移/减少即停）、verify-original-oem-preserve.js（独立只读），均在scripts/scratch/2026-10/。历史stage-oem-follow-roles.js已阻止apply，避免误套旧收紧。证据output/oem-original-preserve-1792203935464/，指针output/oem-original-preserve-latest.json；现行手工清单output/原OEM跟单权限归并进度_2026-10-17.md。复用前重查实时状态。


### OEM用户确认选定报表后的最终归并（2026-10-17，现行完成状态）

用户明确“可以了就这样，其他的用不上，我补充了一点报表进去”，以其当前手工添加的10个报表为最终范围，取代旧“补齐35个特殊对象”的要求。不得继续以其余25类对象缺少授权头阻止收尾，也不得擅自批量补回不用的权限。新建限制策略仍撤销，不新增财务、生产及成本收紧。

实时原OEM/855125新增10头：SFC_MOOScheduleRpt、SFC_OperationReportRpt、UNW_MOOScheduleRpt、AR_SumReport、Sal_OutStockDetailRpt、SAL_CollectReport、SAL_DetailReport、SAL_ConsignOrdArrRateRpt、SAL_OutStockSummaryRpt、SAL_ExpectQtyQueryReport。用户手工工序汇报汇总表除查看外还选打印/引出/短信，保留该选择，不能按旧快照回退。全部功能配置回读不变。已有表头可省略FObjectTypeId按FItemID只补基础资料范围：AR_SumReport、SAL_CollectReport、SAL_ConsignOrdArrRateRpt、SAL_OutStockSummaryRpt补BD_Customer/5fe586b214b2c2，Sal_OutStockDetailRpt补BD_Customer/6ad1dacd4b5a62；原无来源范围的SAL_DetailReport不凭猜测新增。每次Save后比对原操作分录完全不变。

切换前按当前全部角色、禁止优先核对：普通业务、保留对象操作规则并集、可访问字段无差异；减少仅来自用户确认不用的特殊对象。先给4人添加全员110，保留全员原成员主键，再通过SEC_User原组织FEntityID、保留角色FDetailID、IsDeleteEntry=true仅移除这4人的145640/147855/172802/481674/666737关联（各人按实际存在范围）。最终李银兰TK03570/187888、陈秋伶TK03772/457984、周雪菲TK4370/904966仅110全员＋855125原OEM跟单；林思萍TK00381/111059保留110、10042销售主管、187110林思萍个人、855125，共4角色。当前不分配OEM跟单限制933973；原禁止保护已由原OEM承接，不为凑三角色添加空角色。

最终WebAPI独立核对前三人各1283项，林思萍2229项。前三人相对用户刚补报表后的1376项减少25类不用对象98项，并因全员增5项公共查看；林思萍2253→2229减少24项，额外主管/个人来源仍可能保留部分不用对象，不宣称所有25对象均已关闭。10报表查看齐全，全部功能和字段配置切换前后完全相同，仅5条目标基础资料范围变化；角色定义、其他用户分配、目标用户其他属性不变，11条引用规则存在且启用。两张无查看入口库存报表的原字段配置差异不阻塞本次用户确认范围的切换。未以目标账号实测缓存、下推、打印导出。

实时另外发现933972新业务角色已不存在，不能把读取不存在报错当权限配置失败，也不能声称是Agent本次删除；当时933973存在但未分配，随后用户明确要求删除；2026-10-17已通过WebAPI唯一对象及零成员预检、dry-run后Delete删除933973/OEM_FOLLOW_LIMIT_V1，按内码和编码复查零行，4位用户及原OEM角色与功能未变。证据output/delete-oem-limit-1792204652541/，工具scripts/scratch/2026-10/delete-unused-oem-limit.js默认dry-run。查询可先以SEC_KDRoles/FRoleID精确查存在性再View；不存在和查询失败须区分。

工具scripts/scratch/2026-10/finalize-oem-selected-reports.js默认dry-run、--apply才写；verify-oem-selected-final.js独立只读。证据output/oem-final-selected-1792204474140/（baseline/plan/逐对象范围补录/逐账号切换/final/independent-final-verification），指针output/oem-final-selected-latest.json。最终报告output/OEM跟单角色归并最终核对_2026-10-17.md；先前进度和手工待办均已标历史，不再执行。复用所有角色数及权限数前重新查询。

### OEM客户及应收收款范围只读核查（2026-10-17）

用户询问4位OEM人员是否只看本人客户、应收/收款哪个未关联、规则是否设置好。本次只读：4账号均绑定同名员工；BD_Customer查看均挂OEM的6ad1dacd4b5a62动态OR并集，林思萍个人/主管另有5fe586b214b2c2，无空规则客户查看来源。应解释为本人销售员/负责人/跟单关联范围，不能说只按销售员姓名等于本人。样本CTK000001销售林思萍、跟单陈秋伶/周雪菲可多人负责；主档归属样本不等于目标账号实际可见列表验证。

首次通过纯WebAPI读取联动存储：SEC_BASEDATADRAPPLY的ExecuteBillQuery字段FObjectTypeId,FBASEDATAOBJTYPEID,FFIELDKEY,FISENABLED，按对象过滤。实时应收AR_receivable有5个BD_Customer字段启用（FTRANSFERID/FChargeId/FORDERID/FCUSTOMERID/FOUTCUSTOMERID），收款AR_RECEIVEBILL零行，查询成功。OEM收款BOS_VIEW规则空且无客户基础资料范围；林思萍销售主管收款同样无规则，不能认定收款已按本人保护。应收OEM客户基础资料范围为5fe586b214b2c2，但BOS_VIEW空；林思萍主管亦为空且无客户范围，需结合全局开关/实际账号进一步核对。

当前getFormMetadata调用返回response_error解析失败；数据规则选项SEC_BaseDataRuleSource的FIsEnabledBaseDataDRForList查询字段不存在，故全局选项未验证。不能借旧SQL输出代替当前验证，不用SQL或浏览器绕过WebAPI-only。上述纯WebAPI查询方法可复用，元数据改动前重查。

同轮纠正历史“双重锁”绝对推断：仅凭BOS_VIEW无规则不能认定必然穿透已启用的客户联动，规则空/关联空/全局开关未验证/运行时范围是不同证据层。收款没有映射且没有自身规则可判断本次配置保护未配好，但不声称已用目标账号证实所有收款可见。历史zkzj按单据销售员或本人制单，与客户主档跟单负责范围不同，不擅自绑定。

本次未改权限。证据output/oem-customer-scope-audit-1792204713915/；报告output/OEM客户及应收收款数据范围核查_2026-10-17.md，脚本scripts/scratch/2026-10/audit-oem-customer-receipt-scope.js、read-oem-customer-linkage.js及summarize-oem-customer-scope.js。未实测目标账号列表/详情/导出。

2026-10-17用户称已设置后的只读复查：原OEM收款查看已由空变为启用zkzj/6710cdae0d5618，顶层条件为单据销售员当前业务员OR制单人当前用户，不等同客户主档跟单范围。李银兰/陈秋伶/周雪菲收款查看已无空规则来源；林思萍销售主管10042仍收款无规则查看，不能称4人均已隔离。应收5字段联动及查看空规则未变，收款联动仍无；本次不改权限。证据output/oem-customer-scope-audit-1792204967193/，报告output/OEM收款规则手工设置复查_2026-10-17.md。

## 角色使用情况盘点（2026-10-17）

回答“有多少没人用的角色”时按本节口径，只读查询后重新计数，不把下列数字当长期默认值。

- **权威关联表是 `T_SEC_ROLEUSER`**（`FROLEID` + `FUSERID`）。`T_SEC_USERROLEMAP` 的 `FENTITYID` **不是用户内码**，而是 `T_SEC_USERORG.FENTITYID`（用户组织分录）；按 `FUSERID` 关联会得到 0 行，不能据此否定角色分配。先用 `T_SEC_USERORG` 把 `FENTITYID` 映射到 `FUSERID` 才能核对映射表。
- **无成员角色判据**：`T_SEC_ROLE r WHERE NOT EXISTS (SELECT 1 FROM T_SEC_ROLEUSER ru WHERE ru.FROLEID = r.FROLEID)`。角色总数取 `T_SEC_ROLE`，名称取 `T_SEC_ROLE_L`（`FLOCALEID=2052`），状态取 `FFORBIDSTATUS`，`FISDEFAULT='1'` 为预设角色（char 列，JS 里不要直接用真值判断）。
- **除用户外还要查其他使用入口**：工作流模板 `T_WF_TEMPLATEROLE`（不是 `T_SEC_WF_TEMPLATEROLE`）、岗位 `T_ORG_POSTROLE` / `T_BOS_POSTROLEMAPENTITY`、员工 `T_BD_STAFFROLE`、PLM 项目团队模板 `T_PLM_STD_PROTEAMTEMP`。这些表有引用时不能仅凭“无用户”判定无人使用。
- **2026-10-17 实时快照（账套 <K3_MAIN_DB>）**：角色 133 个，有成员 62 个，无成员 **71 个**（预设 46、自定义 25）；71 个全部为启用 `A`；其中 57 个仍配置了功能权限；上述工作流/岗位/员工/PLM 表引用均为 0；不存在“成员全部为已禁用用户”的角色。WebAPI `SEC_KDRoles` 交叉核对角色总数同为 133。
- **25 个自定义无成员角色**中，932561/932562/932563 是 2026-10-15 建立、有意未分配的销售试点角色；172537~172540（1-NMXSZ1/2/3、1-WMXSZ）连功能权限头都为 0；其余含 test、wj、临时权限、禁止采购员操作、内贸销售各组、通用计划员、本账套销售主管等历史角色。
- **`T_SEC_USERROLEMAP` 遗留**：22 行指向已不存在的角色 130156、144914（各 11 行），均能对上仍存在的用户组织分录、涉及 22 个账号；144914 即已删除的计划通用。这是映射残留，不计入无成员角色数；清理须按角色关联流程并另做授权，不能直接 SQL 写权限表。
- **“无成员”不等于可删**：预设角色（如 `BD11_SYS` 全功能角色、PLM 项目角色）和权限模板可能保留备用。删除前须确认无工作流/岗位/员工/PLM 引用、确认用户确实不再使用，并取得明确授权；删除后同时复查 `T_SEC_ROLE`、`T_SEC_ROLEUSER`、`T_SEC_USERROLEMAP`。
- **删除候选分层（2026-10-17 全引用扫描）**：把 71 个无成员角色逐一对 `sys.columns` 中全部 `FROLEID` 表及 `FROLES` 字符串列做引用扫描后，自定义角色只命中 `T_SEC_FUNCPERMISSION` / `T_SEC_FIELDPERMISSION` / `T_SEC_SYSPERMISSIONINFO`（都是角色自身权限配置，不是外部使用），预设角色另有 `T_META_ROLECONSOLETAILREF`、`T_BAS_ROLEBUSINESSCHARTREF`、`T_SCP_ROLEDATA` 等系统引用。据此分层：①零功能权限、零字段权限、零外部引用的空壳（test、1-NMXSZ1/2/3、1-WMXSZ）风险最低；②有权限但无成员、无外部引用的历史业务角色需业务确认；③系统预设与 PLM 角色不建议删。角色删除只移除定义，`T_SEC_USERROLEMAP` 可能留孤立行（见上文 130156/144914），删除前先确认该表无本角色行，删除后复查。
- 证据：`output/unused-roles-2026-10-17.json`、`output/unused-roles-2026-10-17.csv`；只读脚本 `scripts/scratch/2026-10/export_unused_roles.js`。

### 无人使用角色盘点（2026-10-17）

- 通过 WebAPI 查询 `SEC_KDRoles` 的 `FRoleId,FNumber,FName,FForbidStatus` 和 `SEC_User` 的 `FUserID,FUserAccount,FName,FForbidStatus`，核对列表未截断，不预先排除禁用账号或角色。
- 逐用户 View 汇总全部 `Userorg[].EntityRole[].FRoleId_Id`，按角色内码与用户内码去重；逐角色 View 的 `RoleUser[].UserId_Id` 独立交叉核对。无任何成员与仅有禁用成员分开统计；不将“无成员”解释为可以直接删除或从未使用。
- 用户分录可能残留已经不存在的角色内码。2026-10-17 实测角色130156的 `SEC_KDRoles` View 返回不存在/可能已删除；此类关联单列异常，不计入现存角色数量，不能因用户关联出现就断言角色列表漏项。
- 只保存必要的角色、账号与状态证据，不导出完整用户 View（含敏感字段）。工具：`scripts/scratch/2026-10/check-unused-roles.js`；证据：`output/unused-roles-2026-10-17.json`。数据为当日快照，复用前实时重查；交叉核对不一致时须披露，不能宣称完全一致。
- 空角色 View 可能返回 `RoleUser=[{Id:0,UserId_Id:0,UserId:null}]` 占位行（实测111、932563）；统计成员必须排除空用户及零内码，不能将占位行误判为分配不一致。本次133角色/112用户双侧核对后，71个无成员、62个有启用成员、0个仅禁用成员；另有2个不存在角色内码的22条残留关联，均未修改。
- 第一批空壳角色删除实证（2026-10-17，用户明确授权）：WebAPI `SEC_User` 列表可用 `FUserID,FRoleId` 获取全部组织角色映射，并按 `FRoleId IN (...)` 查残留引用；本次删除144837/test、172537/1-NMXSZ1、172538/1-NMXSZ2、172539/1-NMXSZ3、172540/1-WMXSZ前，双侧成员均空、非预设、功能及字段权限头均空。默认dry-run后逐个Delete并逐个回查，最后全部非目标角色清单与575行用户角色映射均未变，角色总数133→128。脚本 `scripts/scratch/2026-10/delete-first-empty-roles.js`，证据 `output/delete-empty-roles-1792226812066/`。该WebAPI映射查询可用于发现已删除角色的残留关联；不能声称本次也清理了其他旧残留。

### WebAPI 权限回读与实际生效边界（2026-10-21）

- 刘晓丽 TK00472 / 销售员角色 SCM04_SYS（角色内码10043），组织示例电子有限公司：使用 `DynamicFormService.Save` 修改 `AR_receivable` 的 `BOS_NEW`、`BOS_MODIFY`、`BOS_PUSH` 后，WebAPI `SEC_FuncPermissionInfo` View 均回读 `FPermissionStatus=0`，保存前后快照也显示非目标操作和基础资料范围未变。
- 但目标账号实际界面仍提示“您没有‘应收单’的‘新增’权限”。用户随后在金蝶前端重新授权后反馈操作成功。官方[业务对象功能授权手册](https://help.open.kingdee.com/dokuwiki/doku.php?id=%E4%B8%9A%E5%8A%A1%E5%AF%B9%E8%B1%A1%E5%8A%9F%E8%83%BD%E6%8E%88%E6%9D%83)明确要求设置各权限状态后点击“授权”才生效。回看本案例，之前只调用通用 `DynamicFormService.Save` 写 `SEC_FuncPermissionInfo`，没有执行该角色功能授权流程；这是本案例已确认的操作遗漏。WebAPI View 回读成功只证明权限记录已保存，不代表“授权”流程完成或用户运行时已生效。
- 用户之后要求验证关闭权限时，通用 Save 将 `BOS_NEW`、`BOS_MODIFY` 写为状态1，WebAPI View 与独立查询均回读1，但用户仍能新增。刘晓丽当时绑定的另一个角色 `BD10_SYS` 没有 `AR_receivable` 权限头。因此本次反向验证进一步说明：单改权限记录状态没有执行正式授权步骤，不能据回读判断运行时权限已撤销。权限以多个角色并集生效，仍需逐角色和目标账号核验。
- 本仓库只读反编译的 `IntegrityDetailPerAllocatePlugIn.Save` 显示授权按钮 `tbSave` 进入专用 `BarItemClick`，通过 `BusinessDataServiceHelper.Save` 保存，并继续调用 `PermissionInnerServiceHelper.UpdateSystemPermission`、`PermissionDataServiceHelper.ClearInvaildFunItemData`、`PermissionServiceHelper.ClearPermissionCache`；启用基础资料权限联动时也清对应缓存（见本节上方 2026-10-14 至 2026-10-15 记录）。官方 WebAPI V6 的 `ExecuteOperation` 需要 `formid`、`opNumber` 和数据包，但没有说明可将动态表单工具栏事件键 `tbSave` 当作操作编码；当前未发现两者的已验证映射。对 `SEC_DetailPermissionAllocate`、`SEC_FuncPermissionAllocate` 调用标准 `GetFormMetaData` 的本次探测收到 `response_error`。因此不能猜操作编码或宣称通用 Save/ExecuteOperation 已完成授权。
- 官方 WebAPI V6 文档还提供继承 `AbstractWebApiBusinessService` 的自定义 WebAPI 服务示例，说明自定义服务部署在应用层服务器；这为调用金蝶服务端权限 helper 提供了候选方向，但不是现成端点。本案例仓库没有自定义 WebAPI 服务工程，也没有现成服务部署或调用证据。若标准 API 无法调用完整授权流程，下一步需评估窄范围、自带权限校验和审计的自定义 WebAPI 服务，并先完成代码审查、测试与部署授权；不得改用浏览器或 SQL 写权限表。
- 本案例说明权限配置应区分“API保存并读回”与“目标账号实际可用”两个完成门槛。历史脚本及输出仅作本案例证据，不可视为 WebAPI 一般失效或普遍需要前端重授权的结论。
- 证据：`output/sales-role-ar-new-1792550654474/verified.json`、`output/sales-role-ar-modify-1792551673672/verified.json`、`output/sales-role-ar-push-1792551727379/verified.json`、`output/test-disable-sales-role-ar-rights-1792552080211/verified.json`、`output/liuxiaoli-permission-runtime-diagnosis-2026-10-21.json`；用户于2026-10-21确认前端重新授权后可用，并确认仅通用 Save 将状态改为无权后仍可新增。
- 官方说明来源：业务对象功能授权手册要求设置权限状态后点击“授权”才生效（上方链接）。官方 SDK `IPermissionService.ClearPermissionCache(ctx, roleids)` 的接口说明为 <https://open.kingdee.com/k3cloud/sdk/Kingdee.BOS.Contracts~Kingdee.BOS.Contracts.IPermissionService~ClearPermissionCache.html>；仅为辅助缓存机制证据，不能把缓存清理等同完整授权。
- 结论边界（15:04实测后修正）：不要称 WebAPI 普遍不可用。只Save权限记录与回读曾不能让旧角色生效，但补Save被授权用户已在本案例恢复查看，不再把自定义WebAPI服务说成纯API唯一方案。尚未覆盖的对象/操作按最小范围验证；不得转为浏览器或SQL写权限表。

### 授权流程的纯 WebAPI 边界（2026-10-21 续查，已验证/未验证分开）

- **后续用户约定与身份核对（2026-10-21）**：用户接受权限设置后由本人进入页面点击“授权”，后续不得将通用 Save 当作授权完成。本日用户将第三方应用的“测试用户”改为 Administrator 后要求检查接口，重新 `AuthService.ValidateUser` 登录仍返回 TK2869 / 运维员A（100081）；当前客户端使用账号密码认证，该页面的测试用户变更未改变这条连接的实际身份。
- **运维员A销售订单禁止测试（2026-10-21，配置已回读，运行时待用户测试）**：按用户具体要求新增专属角色 `LCG_DENY_SO_VIEW_V1`（934182，运维员A－禁止查看销售订单），仅配置 `SAL_SaleOrder/BOS_VIEW` 状态 `2`，权限头 `6ad855054e0934`；只分配给 TK2869 / 100081。原有 ALL（100079）与 administrator（6）角色保留，不移除管理员角色来制造测试效果。先 dry-run，再 `--apply`，新会话独立回读角色成员、用户角色和唯一禁止项；全用户角色映射差集仅新增该关联，原有销售订单权限未变。未执行页面“授权”，不得称已禁止成功；管理员角色是否影响运行时测试结果也尚未验证。脚本 `scripts/scratch/2026-10/configure-<USER>-deny-sales-order-view.js`；证据 `output/<USER>-deny-so-view-1792562436821/verified.json`。
- **同一测试恢复有权（2026-10-21）**：用户要求“再去开启”，只将上述专属角色的 `BOS_VIEW` 从 `2` 改成 `0`，角色成员及其他权限模型字段回读未变，未执行正式授权，运行时待用户测试。首次仅传分录内码/状态并用 `NeedUpDateFields=['FEntityPermission.FPermissionStatus']`，Save 返回成功但回读仍为 `2`（没有实际变化）；查明后采用仓库既有写法，`NeedUpDateFields=[]`，同时传角色、权限项标识、原分录内码和原数据规则，回读才变成 `0`。不把首次成功响应当作改动完成，也不把该组合探测推广为所有表单的字段规则。脚本 `scripts/scratch/2026-10/enable-<USER>-sales-order-view.js`；成功证据 `output/<USER>-enable-so-view-1792562634593/verified.json`，首轮未变化证据 `output/<USER>-enable-so-view-1792562601620/after-investigation.json`。
- **恢复后的用户实测（2026-10-21 14:06）**：用户反馈“还是看不了”；重新 WebAPI 查询，TK2869 仍绑定 ALL、administrator 和专属测试角色，测试角色启用、仅绑定100081，`SAL_SaleOrder/BOS_VIEW` 仍为 `0`。因此本次 API 配置改回有权未恢复用户实际访问，不能把回读成功称为恢复成功。按已接受的手工授权约定，交接用户进入“业务对象功能授权”，选择测试角色 `LCG_DENY_SO_VIEW_V1`，将销售订单查看设为有权并点击“授权”；操作后再回读并由本人重测。截图仅展示菜单搜索，具体点击错误未采集；尚不据此断定唯一根因或宣称手工步骤已完成。
- **移除再分配测试（2026-10-21 14:10）**：用户明确补充“刚才的添加角色禁用是生效的”，并要求移除后再分配同一角色。通过 `SEC_User` Save，以 `FOrgInfo/FRoleInfo` 保留非目标 `FDetailID`，`IsDeleteEntry=true`、`NeedUpDateFields=[]` 移除测试角色；从用户、角色及全用户角色映射分别回读确认仅减少100081/934182；随后 `SEC_KDRoles` Save（`FEntityUser=[{FUserId:{FUserID:100081}}]`、`NeedUpDateFields=[]`）重新分配，再三路核对原映射完整恢复，权限头仍仅 `BOS_VIEW=0`，原ALL与administrator角色保留。未手工授权；运行时恢复效果待用户验证，尚不能将重新分配确认为通用刷新办法。过程中角色侧空成员列表以及显式 `NeedUpDateFields=['FEntityUser']` 的尝试均返回成功却没有预期关联变化，已通过回读发现，不能作成功范例。脚本 `scripts/scratch/2026-10/reassign-<USER>-test-role.js`、`restore-<USER>-test-role.js`；证据 `output/<USER>-reassign-test-role-1792562980369/verified.json`。
- **删除旧角色、同名重建测试（2026-10-21 14:15）**：用户明确要求删除上述角色后同名重建并重新分配。已移除100081/934182关联，标准 `SEC_KDRoles` Delete 删除旧角色934182；随后同名、同编码 `LCG_DENY_SO_VIEW_V1` 新建角色934183，设置唯一 `SAL_SaleOrder/BOS_VIEW=0`（新权限头 `6ad858954e0bd8`），仅分配TK2869，用户角色为6、100079、934183。非目标角色清单及全用户角色映射比对通过；未执行页面授权，运行时待用户实测。**未清理项**：旧权限头 `6ad855054e0934` 仍指向已删除角色934182；删除角色没有连带清理该头。单独标准 Delete `SEC_FuncPermissionInfo` 在此现场返回 `FForbidStatus =='A'` 未定义的校验表达式错误，未绕过校验或SQL写入，不宣称权限记录已完整删除。此遗留是已观测事实，不直接认定其影响运行时。脚本 `scripts/scratch/2026-10/recreate-<USER>-test-role.js`、`finish-recreate-<USER>-test-role.js`；证据 `output/<USER>-recreate-test-role-1792563304790/verified.json`；首次权限头删除失败发生于 `output/<USER>-recreate-test-role-1792563269288/` 后，未重复该失败请求。
- **只修改现有角色禁止查看测试（2026-10-21 14:20）**：用户要求在现有934183角色上直接禁止，不再创建角色。实时读取该权限头时已变为64项（BOS_VIEW为0、其他63项保留；不推断这些新增项由谁写入）。仅更新原 `BOS_VIEW` 分录状态0→2，角色内码、成员关系和其他63项及模型字段全部回读未变。未重新创建/分配角色，未执行页面授权；运行时是否立即禁止待用户测试，不能以API回读替代实测结论。脚本 `scripts/scratch/2026-10/deny-existing-<USER>-sales-order-view.js`；证据 `output/<USER>-deny-existing-so-view-1792563645812/verified.json`。
- **再次同名重建禁止角色受锁阻挡（2026-10-21 14:22）**：用户要求删除934183后同名新建并设置销售订单查看禁止。默认dry-run通过，执行首步移除用户关联时返回“Administrator使用业务单据用户、[用户-TK2869-修改]冲突”；未重试、未清锁、未进入角色删除/重建。新会话复查934183仍存在、仍仅关联100081、用户仍绑定ALL/administrator/934183、查看状态仍为2。待用户关闭相应用户编辑窗口释放锁后重新预检；不能称此次重建完成。脚本 `scripts/scratch/2026-10/recreate-<USER>-deny-role.js`；证据 `output/<USER>-recreate-test-role-1792563760410/blocked-readback.json`。
- **上述锁解除后重建完成（2026-10-21 14:31）**：用户通知“应该没有冲突了”后，重新dry-run和实时预检，再执行同一已授权范围。旧角色934183已移除成员并删除，同名同编码新角色934184仅设置 `SAL_SaleOrder/BOS_VIEW=2`（新权限头 `6ad85c244e0e3a`），分配给100081/TK2869；原ALL和administrator角色保留，其他角色清单和全用户角色关联差集核对符合预期。旧角色934183的权限头 `6ad858954e0bd8` 仍留存，未SQL清理；与此前934182的残留分开记录。未执行页面授权，运行时效果待用户测试。证据 `output/<USER>-recreate-test-role-1792564259474/verified.json`。
- **重建禁止实测成功、再重建有权（2026-10-21 14:33）**：用户明确反馈934184“这次生效了”，确认此次新建禁止角色并分配确实阻断查看；不能据此推断所有权限修改均生效。随后用户要求删除该角色、改成有权、重新赋予；按此前同名重建测试方式，已删除934184，新建同名同编码934185，唯一 `SAL_SaleOrder/BOS_VIEW=0`（权限头 `6ad85cb14e0e40`），仅绑定TK2869。用户仍保留ALL/administrator，其他角色及成员关联核对不变；旧934184权限头仍留存，不声称完全清理。未执行页面授权，恢复查看的运行时结果待本人验证。脚本 `scripts/scratch/2026-10/recreate-<USER>-allow-role.js`；证据 `output/<USER>-recreate-test-role-1792564400616/verified.json`。此删除重建仅为用户逐次授权的专属测试，不作为共享角色的默认刷新办法。
- **闭环确认与最终清理（2026-10-21 14:35）**：用户明确确认934185同名重建“有权”后恢复查看成功，并要求删除测试角色。实时核对后移除100081/934185关联、删除934185，角色编码 `LCG_DENY_SO_VIEW_V1` 查询不存在，用户仅保留ALL（100079）与administrator（6）；其他角色定义及全用户角色映射未变。934182~934185四个已删除测试角色各留一条旧权限头，本次未绕过标准Delete缺陷或SQL写入，须区分“角色及分配已删除”和“旧权限记录仍残留”。脚本 `scripts/scratch/2026-10/delete-<USER>-permission-test-role.js`；证据 `output/<USER>-delete-permission-test-role-1792564510068/verified.json`。
- **本案例可复用结论及边界**：用户实测确认新角色内码934184的禁止生效、再用新内码934185有权后恢复成功；同名同编码不代表同一授权对象，实际内码和权限头均变化。对已分配角色直接Save再回读，曾出现配置改回有权但用户仍无法查看。由此确认“新建角色→设置权限→分配”和“原角色上直接改权限”两条路径在现场效果不同；旧角色的有效权限同步/缓存未更新、新角色避开旧状态属于合理推断，尚未通过服务端跟踪定位到唯一机制，不能简单归因浏览器缓存或宣称只需清某一缓存。成功新建和失败修改均由当前ValidateUser连接完成，应用测试用户变成Administrator不能解释两条路径差异。未经同样实测不得推广到所有单据/操作；共享角色重建可能破坏其他成员或流程引用，不把本次特批测试写成默认操作。
- **补充官方检索证据（2026-10-21）**：检索找到金蝶知识库[用户授完权后，权限没有立即生效原因](https://vip.kingdee.com/knowledge/568397425027474432?productLineId=1&isKnowledge=2&lang=zh-CN)，其问题场景包含升级后权限失效、需要删除角色重加才可用、基础资料授权延迟、多应用服务器授权未即时生效。已通过公开原始HTML的“知识详情”SSR元信息核对正文（网页工具直开失败，转curl读取成功；未执行网页脚本），原文保存于 `output/permission-delay-knowledge-568397425027474432.html`。正文解释为权限缓存，建议角色或用户授权后重新保存用户，或Administrator在缓存管理清缓存；多应用服务器还要在其他应用服务器上清理。此官方案例高度支持本次缓存解释，但它不是专门针对 `SEC_FuncPermissionInfo` WebAPI Save 的复现，不能据此宣称我们已经验证单次 `SEC_User` Save或定向缓存清理即可替代重建。
- **SDK与外部WebAPI仍须区分（同次检索）**：官方SDK的 [ClearPermissionCache](https://open.kingdee.com/k3cloud/sdk/Kingdee.BOS.Contracts~Kingdee.BOS.Contracts.IPermissionService~ClearPermissionCache.html) 明确是按角色清理权限缓存，签名为 `IPermissionService.ClearPermissionCache(Context,IEnumerable<string>)`；[ClearUserCache](https://open.kingdee.com/k3cloud/sdk/Kingdee.BOS.Contracts~Kingdee.BOS.Contracts.IPermissionService~ClearUserCache.html) 按用户清缓存，均为服务端.NET接口文档，不是可据名称拼接的标准HTTP WebAPI端点。结合[业务对象功能授权手册](https://help.open.kingdee.com/dokuwiki/doku.php?id=%E4%B8%9A%E5%8A%A1%E5%AF%B9%E8%B1%A1%E5%8A%9F%E8%83%BD%E6%8E%88%E6%9D%83)明确要求点击授权，以及现场插件 `Save()` 的 `UpdateSystemPermission`/`ClearInvaildFunItemData`/`ClearPermissionCache` 调用，通用Save未覆盖完整生效流程的解释得到支持。仍需区分系统权限同步与缓存失效各自作用；本轮只研究未改真实权限，用户此前接受的同名重建暂行路径保持有效。
- **官方“重新保存用户”方法已实测成功（2026-10-21 15:03~15:04）**：用户要求试用上述方法；新建专属禁止角色934187（`LCG_DENY_SO_VIEW_V1`、权限头 `6ad863604e114e`），仅分配TK2869，用户明确确认销售订单无法查看、禁止基线生效。随后保持同一角色内码/分配，通用Save将BOS_VIEW从2改0，回读后再Save `SEC_User`，模型仅 `{FUserID:100081}`、`NeedUpDateFields=[]`、`IsDeleteEntry=false`，接口成功。前后核对用户身份、状态、应用组、部门组、关联对象、组织角色模型及全用户角色映射、角色模型、非目标权限均未变。没有重建/重新分配角色、没有页面授权或手工清缓存。**用户保持当前登录实测回答“可以查看，已恢复”。** 这证明该组合在TK2869 / SAL_SaleOrder / BOS_VIEW的禁止→有权方向有效，不能推广为全部方向和对象均已验证，也未唯一定位服务端刷新机制。脚本 `scripts/scratch/2026-10/test-permission-refresh-by-resaving-user.js`；基线证据 `output/<USER>-deny-so-view-1792566111911/verified.json`，方法执行证据 `output/<USER>-test-resave-user-1792566195615/verified.json`。
- **此轮临时角色清理（2026-10-21 15:04）**：上述成功反馈后已移除并删除934187，用户仅保留ALL（100079）和administrator（6），其他角色定义和全用户角色映射比对不变。此轮旧权限头 `6ad863604e114e` 仍留存，已删除的测试角色934182/934183/934184/934185/934187共五条权限头残留，不擅自SQL清理。脚本 `scripts/scratch/2026-10/delete-<USER>-resave-test-role.js`；证据 `output/<USER>-delete-permission-test-role-1792566283439/verified.json`。
- **全用户重新保存与独立核对（2026-10-21 15:11）**：用户明确要求今后设置权限后保存用户，并授权现在保存全部用户。实时清单112人（启用84、禁用28，含Guest/Administrator等内置账号），逐一仅传FUserID保存SEC_User；总计112成功、0失败。新会话复查全用户清单、24项非凭据属性/组织角色模型、有效角色关联和完整角色定义通过；未逐账号登录测试全部业务操作。工具 `scripts/tools/refresh_user_permissions.js` 默认dry-run，支持 `--resume-from <原运行目录>` 复查后断点继续，所有写入串行。证据 `output/refresh-user-permissions-1792566623166/verified.json`（前6个已写入请求证据在 `output/refresh-user-permissions-1792566527854/`，后续106人未重复已成功项）。
- **全用户保存发现的系统自动清理（同次已核对）**：首次保存莫家明111049后发现用户角色模型变化，立即停止调查。实时角色定义确认130156与144914均已不存在，原112用户快照中22个用户仍持有其失效关联；金蝶标准Save SEC_User仅传ID也会自动清理这类关联。确认首次仅少111049/130156、有效角色及禁用状态未变后，继续工具仅容许清除实时已不存在角色的关联，其余属性及有效关联任何变化仍停止。全程最终自动去除22条失效关联（130156与144914各11条），无新增关联、无有效角色关系变化；不是Agent SQL删除或人工角色调整。不能把未过滤失效关联的严格JSON相等检查误报为有效权限丢失，也不能忽略未知关联变化。名单及请求/回读证据见上述verified与baseline/blocked文件。
- **内置账号空值差异（同次验证）**：SEC_User列表查询Guest100和Administrator16394的FUserAccount返回空格，View返回空字符串；身份预检只对这两个来源的账号字符串作trim比较，不回写账号、不凭账号空值排除用户。凭据FPassword/Salt/AccessToken/TokenSecret等不写入快照，业务属性仅允许列出的非凭据字段导出。
- **用户要求重试后的复查（2026-10-21 14:29）**：重新dry-run及执行仍返回同一Administrator用户修改冲突。改试角色侧标准Save（`NeedUpDateFields=[]`、`FEntityUser=[]`、`IsDeleteEntry=true`）未报冲突，但回读关联未移除，不能据成功响应继续删除；新会话确认角色完整模型与权限完整模型均未变，用户角色仍为ALL/administrator/934183，未删除、未重建、未清锁。说明当前现场清空单成员列表即使空更新白名单也不能直接作为有效移除方案。证据 `output/<USER>-recreate-test-role-1792564166178/blocked-readback.json`；用户侧同锁错误出现在 `output/<USER>-recreate-test-role-1792564130617/` 对应执行中。需先处理仍存在的用户修改锁，再重新预检，不自动绕过锁或SQL写入。

- **已验证：标准 WebAPI 无授权端点。** 现场 9.0.280.13 的 `Kingdee.BOS.WebApi.ServicesStub` 全类型反编译无 Permission 服务；`DynamicFormService` 全部方法（Save/BatchSave/Audit/ExecuteOperation/Push/QueryBusinessInfo 等）无授权或清缓存。
- **已验证：`ExcuteOperation` 不能触发授权。** 运行时 `QueryBusinessInfo`（只读）返回 `SEC_FuncPermissionInfo` 操作仅 `Delete/Save/View/Forbid/Enable/None/ValidateUser/BatchSave/ExecuteBillQuery/BillQuery/QueryBusinessInfo/WorkflowAudit/SwitchOrg`；授权是动态表单工具栏 `tbSave`，不是 operation。`SEC_DetailPermissionAllocate` 在账套元数据无表单记录。
- **已验证：`GetFormMetaData` 现场缺陷。** 对 `SEC_FuncPermissionInfo`/`SEC_KDRoles`/`SEC_User` 返回 `response_error / Unknown Error`，而 `QueryBusinessInfo` 正常；不得据此判断表单不可用或没有操作。
- **已验证：权限状态语义。** 反编译 `PermissionActionType` 为 `Allow=0 / NotAllow=1 / Deny=2`，缺失记录按无权。写 1 就是撤权，不能再当成“有权”。
- **已验证：其他清缓存入口不可用。** `SEC_KDRoles` 仅在 `Operation_StatusConvert`（禁用/反禁用）后 `ClearRoleCache`（`scripts/scratch/2026-10/operation-plugin/RoleManage4Bill.cs`），会改角色状态并影响全部成员；批量授权 `tbAllocate` 同样是工具栏事件。
- **旧结论已被后续实测纠正（15:04）**：“纯API只剩自定义WebAPI服务”过于绝对。虽然没有已验证的标准外部HTTP端点直接调用授权按钮全流程，但 `Save SEC_FuncPermissionInfo → Save SEC_User({FUserID})` 已由用户确认在本案例恢复查看成功，无需新建角色或部署二开。自定义服务补齐 `UpdateSystemPermission`、`ClearInvaildFunItemData`、`ClearPermissionCache` 仅保留为未验证场景的候选方案；旧分析 `output/permission-authorize-webapi-analysis-2026-10-21.md` 与服务骨架只能视为当时研究记录，不得继续引用其“唯一方案”判断。
- **验证口径：** 先把“直接新增应收单”与“从源单下推生成”分开实测；`BOS_PUSH` 缺失是否阻断下推尚未验证。权限快照会被人改动（本日 11:19→11:33 `BOS_NEW` 由 1 变 0，非本 Agent 写入），任何结论前重新回读。
- 只读取证脚本：`scripts/scratch/2026-10/probe-webapi-facade.js`、`probe-role-operations.js`、`probe-permission-cache-tables.js`、`probe-syspermission-consistency.js`。

## 专业应用组账号权限导出（2026-10-27）

- 范围为用户许可分组 `FAppGroup=Pro`，不是部门或角色；导出包含禁用账号并单列状态。按 `SEC_User` 实时列表及逐用户 View 提取组织角色，输出文件不保存用户完整 View（可能含敏感属性）。
- `ExecuteBillQuery` 本次请求 Limit/TopRowCount=200000 仍只返回10000行；不能以“返回少于请求条数”认定全量。对权限实体使用 StartRow 分页（本次5000行/页、TopRowCount=0），固定排序，直到末页不足页大小，按头/角色/对象/权限项及实体键去重。本次功能查询70547行；数字仅为当日快照。
- `SEC_FuncPermissionInfo` 查询字段 `FForbidStatus` 本次报元数据不存在，不能把表单字段猜作数据库同名列。报表须说明配置汇总边界，角色状态从用户角色View核对。
- 数据规则 View 读取失败时保留规则内码和原错误，标记待核实，不改成“无规则”或“全部数据”。本次33个引用规则中8个读取失败，属于当日异常，复用前重新查。
- 官方 `SEC_UserPermissionDataRpt` 的 GetSysReportData 本次缺少FieldKeys失败，元数据读取返回非JSON；未完成官方报表交叉核对时，输出只称“当前角色配置统计”，不得声称实际最大范围已确认。角色按组织保留；汇总跨组织角色不等于每个组织都有并集权限。管理员与特殊对象须单独考虑。
- 证据：`output/pro-accounts-permissions-2026-10-27.json`；只读提取脚本 `scripts/scratch/2026-10/export-pro-accounts-permissions.js`；交付 `output/pro-permissions-20261027/专业应用组账号及权限汇总_2026-10-27.xlsx`。未修改任何账号或授权。

### 易读汇报版（2026-10-27 用户纠正）

用户指出技术明细虽然规范，但需要“用你自己的语言总结一下每个人大概有什么权限”。后续人员权限汇报先给每人一行的业务语言摘要：姓名/共用账号名称、登录账号、用户组、启停状态、大致业务、主要能做的事、关键限制。区分查询、制单和审核，突出跨岗位广泛权限及停用账号；不堆角色名称、内码、操作数量或字段标识。摘要须逐人核对实际授权及禁止项，不能只凭部门和角色名推断。客户范围与价格保密未实测时不写“全公司可看”或“完全不可看”。技术配置明细另供追溯。交付 `output/pro-permissions-20261027/专业应用组每人权限说明_易读版_2026-10-27.xlsx`，依据同日13:54快照，不冒称再次实时查询。

### 客户与供应商范围页（2026-10-27 用户调整）

本次用户要求从交付删除“核对边界”列、“口径与异常”及“基础资料范围”页，增加逐人的客户及供应商查看范围。按组织保留当前启用角色，对 BD_Customer/BD_Supplier 的 BOS_VIEW 先处理禁止，再合并有权范围；无规则授权写“组织授权范围内全部”，不写跨组织无限制。受限规则读取顶层 FilterSetting，不把登录调查者展开的 FilterString 当目标用户条件；具体销售组未核实须明示，不凭姓名猜组。供应商规则67bd4022811f41本次确认条件为分组编码包含CKGYS，不扩大为全部供应商。禁用账号保留状态；配置不等于实际登录验证。证据 output/pro-permissions-20261027/view-scope-evidence.json；交付更新版保留其余三个明细页数据，使用openpyxl定向删除列和页，同时修正原生表格范围，再用Artifact Tool读取及渲染新页验证。


## 车间工序汇报审核范围（2026-10-29，待实施）

- 用户确认：11个车间账号保留跨车间查看，仅SFC_OperationReport审核/反审核按本车间限制；个人计划/管理账号不变。对应HX→焊线部BM000012；GJ1/GJ2/GJ3→固晶部BM000010；MY→模压部BM000013；CQ→切筋成型BM000029；CSFX/CSFX1/CSFX2→测试分选BM000014；QJ→外观全检BM000031；RK→包装入库BM000032。用户明确银胶固化、固化、回流焊不需交料、不纳入这些账号范围；WFSX为专人，尚未指定车间范围，不推断其权限变更。
- 当日WebAPI当前查询：11账号的工序汇报无范围审核/反审核来自车间统计员40379、车间主管40528；此对象现存数据规则0条。角色共享个人账号，不直接修改共享角色扩大影响，不把新增受限角色当作抵消原宽授权。证据output/workshop-own-audit-preflight-20261029.json；易变配置实施前重查。
- 各账号历史制单跨车间不代表兼管授权；只读样本output/workshop-account-dept-evidence-20261029.json每账号上限1000行，未完整枚举历史。
- 当前未修改权限：既有SEC_DataRule通用Save顶层条件丢失问题未解决，先前端建立7组加工车间等于指定部门的规则，再WebAPI核对顶层条件。角色副本/专属岗位的非目标权限（含特殊对象、字段与基础资料范围）须保真迁移，不能未验收就移除旧角色。完成后保存受影响SEC_User，并实际验证本车间和跨车间操作边界。
- 执行单output/车间工序汇报仅本车间审核_执行单_20261029.md；该文件是待实施方案，不是配置成功证据。


### 车间范围实施前的两类问题区分（2026-10-29用户提醒）

- 用户提醒优先复核2026-10-21“保存角色权限后保存SEC_User”成功记录；该现行流程解决已有权限变更的运行时生效问题，不能继续把同名重建/手工授权当作默认必要步骤。
- 2026-10-16新建SEC_DataRule顶层筛选条件丢失是另一独立历史问题；尚无证据证明保存用户可以生成原本未存入的筛选条件，也不能据旧失败直接断言本次固定车间条件必须前端建立。实施前应分别验证规则顶层条件持久化、绑定权限和保存用户后的实际行为；没有新验证前只称当前接口路径待验证，不将历史复杂OR规则失败泛化为所有新规则都不能创建。


### 固定车间条件新建规则实测（2026-10-29）

- 用户授权“新建规则看看”；只测试SEC_DataRule新建WORKSHOP_RPT_CQ_V1，未分配给角色/账号。实时核对切筋成型BM000029/111598及SFC_OperationReport字段FWorkShopID.FNumber；等于Compare=67来自既有规则。默认dry-run后执行一次标准Save，开启IsVerifyBaseDataField/ValidateFlag，提交XML含单一固定条件。
- 返回新内码6ae2ea63521732，但WebAPI View、ExecuteBillQuery及数据库独立读取一致：顶层FilterString和FilterSetting为空，输入XML仅嵌入CustomFilterSetting。简单固定条件也未持久化；不能绑定空规则，不能声称只需刷新用户就能补全未保存的条件。此次没有执行保存用户实验，因此不声称实测排除了所有其他接口路径。
- 本次规则确认为未引用（功能/基础资料规则引用均0），默认dry-run后仅通过标准Delete清理本次测试规则；WebAPI和数据库双查确认不存在，原角色和用户权限未修改。证据output/workshop-rule-cq-create-plan.json、workshop-rule-cq-created-view.json、workshop-rule-cq-independent-check.json、workshop-rule-cq-cleanup-verified.json（均位于output/）；脚本scripts/scratch/2026-10/create-workshop-cq-rule-test.js与cleanup-workshop-cq-rule-test.js。该结果仅覆盖这次标准Save路径，其他事件驱动或专用服务未验证。

- 同日用户前端手工新增WORKSHOP_RPT_CQ_V1后，WebAPI独立回读6ae2ee0f5219de（启用A，对象SFC_OperationReport）：顶层FilterString为FWorkShopID.FNumber = BM000029，FilterSetting为同字段Compare67/Value BM000029，条件确已保留；与先前接口空规则不同。证据output/workshop-rule-cq-manual-saved-20261029.json。此时只完成规则定义，尚未绑定审核/反审核权限、尚未保存用户刷新或实测范围。

- 2026-10-29用户要求联网检索：金蝶官方WebAPI值更新说明https://vip.kingdee.com/article/584409706211454208指出传入字段触发值更新；本地NewDataRulePlugIn代码显示FFilterGrid更新事件解析到_dataRule，AfterSave再用SaveDataRule写回，直接FXML不会走该解析分支。当前实时元数据FFilterGrid/FEntitySelect为界面控件；GetFormMetadata本次response_error。按此线索仅补测一次标准Save传FFilterGrid+FEntitySelect，创建WORKSHOP_RPT_HX_V1/6ae2eef2521a24，仍返回成功但顶层条件为空。未绑定，引用0后标准Delete并WebAPI/数据库双查清理通过。证据output/workshop-rule-grid-test-plan.json、workshop-rule-grid-test-response.json、workshop-rule-grid-test-readback.json、workshop-rule-hx-cleanup-verified.json；本次联网未找到直接新建规则的公开标准接口，不据此证明不存在。官方自定义WebAPI机制可作为需开发验证的后备：https://vip.kingdee.com/article/490771221039228672?productLineId=1；未开发部署，不能称现成可用路径。

- 2026-10-29用户指出规则列表已有QJ/RK：必须实时刷新后再报缺项。WebAPI查到CQ/QJ/RK三条启用，CQ条件正确；QJ=6ae2eecb521a18、RK=6ae2eeb6521a16均实际保存了FWorkShopID.FNumber等于空串（FilterSetting.Value为空），不能仅凭名称/列表存在认定条件完成；应分别补BM000031/BM000032。HX/GJ/MY/CSFX当前未建。证据output/workshop-rules-latest-check-20261029.json；状态易变，下一次复用先实时重查。


### 11车间账号审核范围配置完成（2026-10-29，待账号实测）

- 用户手工建好7规则后逐条WebAPI核对顶层字段FWorkShopID.FNumber/Compare67/对应部门值，均启用且正确；证据output/workshop-seven-rules-verified-20261029.json。
- 实施采用两项权限分离而非完整复制角色：新建7组车间授权角色，仅SFC_OperationReport的BOS_AUDIT/BOS_UNAUDIT有权并绑定对应规则；另建WS_RPT_APPROVE_KEEP_V1，仅向两原角色中非目标20账号保留原两项无范围授权。为全部成员提供替代授权并回查后，才将共享40379/40528的这两项改无权1（不是禁止2）。保留原角色分配、其他操作、字段和基础资料范围；避免整角色迁移及特殊对象复制。该结构已改变这两个共享角色未来新增成员的默认权限，新成员须显式分配适用审核岗位。
- 新角色：WS_RPT_APPROVE_CQ_V1/934613；WS_RPT_APPROVE_HX_V1/934614；WS_RPT_APPROVE_GJ_V1/934615；WS_RPT_APPROVE_MY_V1/934616；WS_RPT_APPROVE_CSFX_V1/934617；WS_RPT_APPROVE_QJ_V1/934618；WS_RPT_APPROVE_RK_V1/934619；WS_RPT_APPROVE_KEEP_V1/934620。目标账号11个，非目标保留20个（含WFSX）；受影响31用户全部按既定最小SEC_User Save重新保存。
- 首轮角色成员批量Save因禁用姜露TK01895/131544被基础资料有效性校验拒绝，停止时尚未撤去原授权。独立查询确认账号仍B；改从SEC_User本人FOrgInfo/FRoleInfo添加新角色，不启用账号、不关闭校验，成功读回；其余非目标19人亦逐用户添加。断点脚本重新核对已建8角色及预期成员映射后续处理，禁止整批重跑创建。只证明本次标准用户侧新增角色对禁用用户可行，不泛化其他禁用基础资料。
- 验证：原两权限头除4项状态0→1外完整View一致；原全部角色关联不减，仅新增预期31条；31用户身份/状态/组织及原角色模型不变；20非目标审核/反审核有效范围签名与前值一致；11目标只剩22条有权项且全部对应指定车间规则。7规则定义未变，独立数据库联查确认目标无无规则有权项。
- 证据output/workshop-audit-scope-1793257763411/（初轮）、output/workshop-audit-scope-1793257861793/verified.json及independent-db-verification.json；脚本scripts/scratch/2026-10/apply-workshop-audit-scope.js、resume-workshop-audit-scope.js、add-workshop-preserve-role-disabled-user.js。所有写入默认dry-run，显式apply；非幂等创建脚本遇现有角色即停止，不能直接重跑。
- 当前仅配置与用户刷新回查完成，尚未以车间账号验证本车间可审核/反审核、他车间被拒；不得为验权随意反审核正式单据。先由用户用合法业务对象验证，其他工序转移等对象未收紧。


### 车间账号调整为可审核、禁止反审核（2026-10-29最新用户约定）

- 用户随后要求“改成能审核、不能反审核”，覆盖上述11车间账号的反审核许可。仅对7个WS_RPT_APPROVE_*车间角色的SFC_OperationReport/BOS_UNAUDIT状态0→2禁止，原BOS_AUDIT有权及本车间数据规则不变；不改WS_RPT_APPROVE_KEEP_V1和其他业务对象。
- 执行前实时核对7角色成员恰为11指定账号、原权限状态；默认dry-run后apply，逐权限头完整View差异仅反审核状态；重新保存全部11个SEC_User，用户属性和角色分配未变；全用户角色映射不变，非目标保留权限头不变。最终逐用户全角色查询均有反审核禁止、无反审核有权，审核各有且仅有对应本车间规则的有权项。配置回查通过，实际账号行为待验证。
- 脚本scripts/scratch/2026-10/deny-workshop-unaudit.js；证据output/workshop-deny-unaudit-1793261127198/verified.json及逐角色请求/响应、11用户保存响应。早先“可在本车间反审核”只为历史阶段，现行目标为工序汇报完全不可反审核。


### 最终纠正：审核不限车间、反审核仅本车间（2026-10-29最新生效配置）

- 用户明确纠正前一轮理解：“审核都可以，反审核仅允许本车间”。本条覆盖前两阶段11车间账号操作范围，不将“能审核不能反审核”继续作为现行规则。
- 仅修改7个车间审核角色：SFC_OperationReport/BOS_AUDIT保留有权0，FDataRule清为空（原组织授权范围内不限车间）；BOS_UNAUDIT由禁止2恢复有权0，保留各自原车间数据规则。查看、其他权限、角色成员、20非目标保留账号不变。
- 实时预检→dry-run→apply；7权限头完整View仅两项目标字段差异，7规则定义不变、全用户角色关联不变；11用户全部最小Save刷新且属性/原角色不变。逐用户全角色回查无审核/反审核禁止项，审核恰有一条无规则有权，反审核恰有一条对应本车间规则有权。配置回查通过，未做正式业务单据试操作。
- 脚本scripts/scratch/2026-10/workshop-audit-all-unaudit-own.js；证据output/workshop-audit-all-unaudit-own-1793261364660/verified.json及逐角色/用户响应。
