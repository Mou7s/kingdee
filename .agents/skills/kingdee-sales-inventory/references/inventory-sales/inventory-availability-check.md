# 发货通知单审核卡「预计可发量不足」排查（案例 FHTZD055207 · 2026-08-22）

## 现象
用户：发货通知单审核不了，提示「预计可发量不足，操作终止」，但截图里即时库存明细明明有货。

## 根因
**单据分录上的仓库 ≠ 有库存的仓库。** 审核/提交时的「预计可发量检查」只按分录 `FStockId` 所指仓库计算可用量，与用户当时在界面上查的是哪个仓无关。

实测（WebAPI）：
- 分录：NDB0320002 (MB10F) × 2,096，发货仓库 = **CTK13 CK成品仓** → 该仓库存 0 → 0 < 2096 → 卡审核
- 同物料实际库存分布：CTK13 成品仓 0、CTK18 样品仓 0、**CTK19 外贸仓 3,000 可用**
- 用户截图有货是因为他查询时过滤到了外贸仓

## 排查步骤（复用）
1. 查单据分录：FormId `SAL_DELIVERYNOTICE`，取物料、数量、`FStockId.FNumber/FName`
2. 按**同一物料**查 `STK_Inventory` 全部仓库分布（不要带仓库条件过滤）
3. 对比：分录仓可用 ≥ 分录数量？
4. 处理二选一：
   - 改单：分录仓库改成有货的仓 → Save → Submit → Audit
   - 或先调拨补货到分录仓，入库后再审

## 已验证字段（本账套实测）

### SAL_DELIVERYNOTICE 可用
`FBillNo, FDate, FDocumentStatus, FMaterialId.FNumber, FMaterialId.FName, FQty, FStockId.FNumber, FStockId.FName, FLot.FNumber`

### SAL_DELIVERYNOTICE 报「元数据中不存在」（别再用）
`FCustId`, `FBaseQty`

### STK_Inventory 可用
`FMaterialId.FNumber, FMaterialId.FName, FStockId.FNumber, FStockId.FName, FLot.FNumber, FBaseQty, FStockStatusId.FName`

注意 STK_Inventory 一行一 (物料×仓×批)；同物料多行是正常的，汇总后再比数量。
