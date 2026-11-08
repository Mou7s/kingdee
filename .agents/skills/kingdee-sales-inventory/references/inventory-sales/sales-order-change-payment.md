# 销售订单收款条件变更边界（SAL_SaleOrder）

## 收款条件口径先按表核对

- `BD_RecCondition` 全表拉出再对号：`002=货到7天付款`，`SKTJ01_SYS=货到收款`，`001=款到发货`。用户口语“货到付款”至少对应两个候选，必须先列候选再让用户定，不能凭编号猜。
- 写报文用内码：`002` 的 `FID=131523`（`001` 为 `111750`），View 回查读 `SaleOrderFinance[0].RecConditionId.Number/Name`。

## 下游判定不看单号尾数

- 发货通知单号尾数与订单号相同不等于下游（曾出现同号不同客户、不同源单）。必须二选一验证：`executeBillQuery("SAL_DeliveryNotice", "FBillNo,FDocumentStatus", "FOrderNo='<订单号>'")`，或 `View` 通知单分录的 `OrderNo/OrderSeq/SrcType`。
- 合并发货通知单常见（一单多行挂多个销售订单）：只认属于目标订单的那一行（`OrderNo+OrderSeq`），不要把整单当成目标订单的下游。
- 出库方向另查 `T_SAL_OUTSTOCKENTRY.FSRCENTRYID`，不要只查通知单就下结论。

## 变更单与新变更单的边界

- **旧变更单（`SAL_SaleOrderChange` / `T_SAL_ORDERCHANGE`）**：表头只有 `FCHANGEREASON/FRECEIVEID/FSETTLECURRID` 等，无收款条件、无表头备注字段；分录只有量（`FNQTY`）、价（`FNPRICE/FNTAXPRICE`）、交期、行备注（`FNOTE`）。收款条件变更不要走旧变更单。
- **新变更单（`SAL_XORDER` / `T_SAL_XORDER`，单号形如 `XSDDxxxxxx_V001`）**：
  - 金蝶前端对已审核销售订单点击【业务操作】→【变更】时生成。
  - WebAPI 层面金蝶未开放下推转换规则且无独立变更生成服务。
  - 前端点击【变更】生成变更单后，可在【财务信息】中直接修改收款条件（如 2026-11-05 实测修改为 `002 货到7天付款`），审核生效后自动同步回销售订单。
- 确需下推旧变更草稿时：`RuleId="SaleOrder-SOChange"`（`SAL_SaleOrder→SAL_SaleOrderChange`），`Push` 不带变更原因会被“变更原因是必填项”拒绝；取草稿改用 `IsDraftWhenSaveFail:"true"` 拿到 `Z` 暂存单再补原因。

## 已审单 Save 被价格来源检查拦截即转前端

- 已审核销售订单的 WebAPI `Save`（即使只改表头备注）可能触发“存在记录不符合价格来源检查控制条件”，与锁库场景同类系统校验，`ValidateFlag:false` 绕不过。此时停止用 WebAPI 重试，转金蝶前端手工改（手工通道要点“继续”过弹窗）。
- 收尾：`Push` 产生的暂存变更草稿用 `deleteBill("SAL_SaleOrderChange", [id])` 清理，再 `View` 回查源单状态、收款条件、备注均未变，且 `SAL_SaleOrderChange` 无残留。
