# K3 写超时孤儿单清理

适用：`Save` / `Submit` / `Audit` 返回超时（504 / “K3Cloud 请求超时”），但单据可能已落单。
超时常发生在 Save 成功之后：账套里留下一张 `A` 草稿，调用方只看到失败，本地记录为 FAILED。
此时盲重试会造重复单，必须先反查再定重试或删除。

## 步骤

1. **绝不盲重试**：先按第 2 步反查账套真实状态，再决定续做还是清理。
2. **用 FNote 追踪标记定位**：Save 时把可追踪标记写入 `FNote`（如 `WMS:{requestId}`），
   超时后按 `FBillNo` / `FNOTE LIKE '%标记%'` 反查。WebAPI 用 `ExecuteBillQuery`，
   或直连 SQL 查表头。
3. **表名不要猜**：直接调拨单（`STK_TransferDirect`）的表头是 `T_STK_STKTRANSFERIN`
  （含 `FBILLNO` / `FDOCUMENTSTATUS` / `FDATE` / `FNOTE`），`T_STK_TRANSFERDIRECT` 不存在。
   未知表单先查 `INFORMATION_SCHEMA.TABLES` / `COLUMNS` 确认表名与备注列。
4. **预检状态**：存在且 `FDocumentStatus='A'` 才可 `Delete`；非 `A`（审核中/已审核/
   他人已处理）立即停手转人工。删除走 WebAPI `Delete`，禁止 SQL 直删单据。
5. **删后回查**：该单已消失，且 `TOP N` 相邻单据的单号与状态未变。
6. **本地记录清理守卫**：FAILED 行按 `request_id` 精确匹配，要求行数 `== 1` 且状态仍为
   `FAILED` 才删；不满足任一条件就停手。

## 配置来源

独立脚本调 K3 WebAPI 所需地址与账套凭据，与调用方既有客户端同源，不要另起一套
（ctk-system 侧读 MySQL `sys_config` 的 `kingdee.*`，见 `ruoyi-tongke` 的 K3 配置来源坑；
`kingdee/` 侧用 `k3cloud.js` 既有导出）。值仅进程内使用，不打印、不落盘、不提交。
