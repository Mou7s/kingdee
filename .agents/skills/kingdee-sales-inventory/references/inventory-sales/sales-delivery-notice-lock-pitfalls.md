# 发货通知单锁库坑位（FEntity vs 明细键）

> 2026-09-02 对 FHTZD056589 暴力枚举 6 种 Save 组合后定位，复盘见 `scripts/scratch/2026-09/brute_lock_field.js` / `test_lock_qty.js`

## 现象
- `Save SAL_DeliveryNotice` 用 `SAL_DELIVERYNOTICEENTRY.LockStockFlag=true` 返回 `IsSuccess:true` 但 DB `FLOCKSTOCKFLAG` 仍 `0`，View 仍 `false` — 静默忽略
- `ViewBill SAL_SaleOrder 144638` 的 `SaleOrderEntry[0]` 根本不暴露 `LockQty/LockFlag`，`Save SAL_SaleOrder SaleOrderEntry.{FLockQty}` 触发“价格来源检查”拦截

## 根因
- 发货通知单明细在 BOS 元数据里的实体键是 `FEntity`，不是表名 `SAL_DELIVERYNOTICEENTRY`；`NeedUpDateFields` 必须与 Model 键一致才会真写
- `FLockStockFlag` 是 `CHAR(1)`，WebAPI 要求字符串 `"1"/"0"`，传布尔 `true/false` 或 `FName=LockStockFlag` 会被忽略却仍报成功

## 已验证正确写法
```js
await api.unAuditBill("SAL_DeliveryNotice", [176739]);
await api.saveBill("SAL_DeliveryNotice", {
  FID: 176739,
  FEntity: [
    { FEntryID: 237583, FLockStockFlag: "1", FLockStockBaseQty: 37.5 },
    { FEntryID: 237584, FLockStockFlag: "1", FLockStockBaseQty: 20 }
  ]
}, ["FLockStockFlag","FLockStockBaseQty"], [], false);
await api.submitBill("SAL_DeliveryNotice", [176739]);
await api.auditBill("SAL_DeliveryNotice", [176739]);
// DB: T_SAL_DELIVERYNOTICEENTRY.FLOCKSTOCKFLAG="1" FLOCKSTOCKBASEQTY=Qty
// View: SAL_DELIVERYNOTICEENTRY[].LockStockFlag=true LockStockBaseQty=Qty
```
回滚同路径改 `"0"/0`。

## 侧载选型建议
- 若业务要“按通知单全锁”即锁通知单自身，用本通路，无价格检查
- 若财务要求锁在销售订单源头（`T_SAL_ORDERENTRY.FLOCKQTY` + `T_STK_LOCKSTOCKLOG`），需另走 SO 链，先 `T_SAL_DELIVERYNOTICEENTRY_LK` 拿 `FSBILLID/FSID`，再 Save SO，有价格检查需前端二次确认
