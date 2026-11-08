# 销售订单锁库（SAL_SaleOrder，替代已撤销的发货通知单锁库）

2026-09-03 实证：业务真实锁库动作在**销售订单**分录（`T_SAL_ORDERENTRY.FLOCKFLAG/FLOCKQTY`），
不是发货通知单。商务员A手工锁 `FLOCKQTY=通知单数量`（如 XSDD034350/50K 中锁 20 给 FHTZD056589）。
发货通知单 `FLockStockFlag` 前台无按钮，此前自动任务锁错单据，已撤销并解开 14 单。

## 字段（ExecuteBillQuery 已验）

- `SAL_SaleOrder` 查询键 `FLOCKFLAG`（布尔，返回 true/false）、`FLOCKQTY`（数量）。
- 注意 `FEntryID` 不能直接做查询键（报“属性没有找到映射”），Save 分录键仍用 `FEntryID`。

## 写路径约束（XSDD035285/035298/035301 实测，均未留下修改）

1. **有下游一律不许反审核**：`UnAudit` 报“订单已有下游单据关联，不允许反审核”。
   下游检查不要只看通知单，要同时查出库（`T_SAL_OUTSTOCKENTRY.FSRCENTRYID`）。
2. **已审核单可直接 Save**（无需反审核）：`Save SAL_SaleOrder { NeedUpDateFields:[FLOCKFLAG,FLOCKQTY],
   IsDeleteEntry:false, Model:{FID, FEntity:[{FEntryID, FLOCKFLAG:true, FLOCKQTY:qty}] } }`，
   成功后无需 Submit/Audit（本来就是 C）。
3. **价格来源检查是硬拦**：直接 Save 触发“存在记录不符合价格来源检查控制条件，是否继续操作？”，
   `ValidateFlag:false` **绕不过**。两单不同订单同样被拦，属系统性校验。
   手工锁库按钮走另一条不触发价格检查的通道，WebAPI Save 模拟不了。
4. 按钮位置已由用户截图确认：**销售订单列表工具栏 `锁库▼`（锁库/解锁/锁库查询/锁库设置）**。
   不要再盲探 Save 参数。

## 按钮后端取证（同会话，结论：无专用接口）

- 公网（官方 OpenAPI ApiDoc、博客、k3cloud SDK）只有 Save/Submit/Audit 等通用接口，
  没有锁库按钮对应的专用 WebAPI。
- `T_STK_LOCKSTOCK` 全账套空表：按钮只写订单分录 `FLOCKFLAG/FLOCKQTY`，不写锁库台账。
- 价格来源检查三单全拦（XSDD035285/035298/035301），属系统性校验；
  所有失败的 Save/UnAudit 均不落库，可放心用新单做探测（探完回查确认原样）。
- 给用户的三条路：继续手工锁 / 只读待锁清单每日推送（不碰写接口） / 找实施顾问开放接口或放行检查。

## ExcuteOperation 探查（同会话，结论：锁库无 Web 服务，不要重探）

- 用户纠正“不用调 save 端口，是另外的”后确认：`k3cloud.js` 已封装
  `executeOperation(formId, opNumber, data)`（`DynamicFormService.ExcuteOperation`，注意官方拼写少个 e）。
- 安全探测法：`data: { Ids: '0' }`（无效单号，零风险）。回音语义已验：
  “销售订单没有此接口”= 操作名不存在；“operationId=N's service interface not found”=
  操作存在但未发布 Web 服务（`Close`→18，`Reserve`→5013）；`Audit`+Ids 0 回空 Errors 即通道正常。
- 锁库候选名全部“没有此接口”：LockStock/Lock/UnLock/StockLock/LockQty/OrderLock/
  SaleLock/LockBill/ReserveStock/Allocate/Occupy/LockEntry/BatchLock。
  `Reserve`（预留）存在但无 Web 服务——前端按钮类操作就没发布，锁库同理调不到。
- `GetFormMetaData` 在本账套直接报 Unknown Error，不能靠它枚举操作。
- 官方手册（销售订单锁库和预留）口径：只能对已审核未执行订单锁库；锁库量自动携带到
  下游通知单/出库单，先出已锁部分，出完自动解锁；已锁订单不许反审核/变更/冻结/关闭；
  库存不足时能否部分锁库看系统参数。

## “订单审核后自动锁库”参数（2026-09-03 用户用官方文章纠正）

- 位置：**单据类型—销售订单—参数设置**，勾选“订单审核后自动锁库”
  （官方知识《销售订单自动锁库》2021-01-15 PT-146866）。
- 教训：此前断言“金蝶标准无此参数”是错的——只查了 `T_BAS_SYSTEMPROFILE`
  （仅有 `MAXLOCKSTOCKLOGID`）和 `T_STK_LOCKSET`（仅 `FLOCKSET=1` 部分锁库策略），
  漏了单据类型参数。以后“有没有某开关”先查单据类型参数设置再下结论。

## 下游关联方向（同会话取证，查下游前必读）

- `T_SAL_DELIVERYNOTICEENTRY_LK` 行长在**下游侧**：`FENTRYID`=通知单分录，
  `FSBILLID/FSID`=上游订单 FID/分录，`FSTABLENAME='T_SAL_ORDERENTRY'`。
  查某订单的通知单下游：`WHERE FSBILLID=<订单FID>`；反向查不到。
- `T_SAL_ORDERENTRY_LK` 本账套是空的，不要用。
- `T_SAL_DELIVERYNOTICEENTRY.FSRCBILLNO/FORDERNO` 不可靠（有下游也可能查空）。
- 出库直连查 `T_SAL_OUTSTOCKENTRY.FSRCENTRYID`。
