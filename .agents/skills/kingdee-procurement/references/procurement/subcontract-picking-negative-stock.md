# 委外领料客供仓负库存（SUB_PickMtrl vs STK_OEMInStock）

## 场景
截图库存流水显示 `CTK04 客供料仓` 物料 `N102012061 RT30N25LM` 货主 `客户S` 出现负库存 `-12.275`：
- `WWLL260825001` 委外领料发出 `24.551` + `589.224`
- `STCLRK001891` 受托加工材料入库收入 `12.276` + `589.224`
- 差额 `12.275` 即最终结存负数，`24.551 ≈ 2 × 12.276`

## 证据链（只读）

1. **定位 FormId**
   - 委外领料：`SUB_PickMtrl`，表 `T_SUB_PICKMTRL` + 明细 `T_SUB_PICKMTRLDATA` (+ `T_SUB_PICKMTRLDATA_A` 货主)，FID 101295
   - 受托加工入库：`STK_OEMInStock`，表 `T_STK_OEMINSTOCK` + 明细 `T_STK_OEMINSTOCKENTRY`，FID 101904
   - API：`ViewBill("SUB_PickMtrl", fid)` 的分录在 `Entity[]`，字段 `ActualQty/BaseActualQty/StockActualQty/AppQty/BaseAppQty` 同值；`ViewBill("STK_OEMInStock", fid)` 分录在 `OEMInStockEntry[]`，字段 `Qty/BaseQty`

2. **查当前状态**
```js
import { K3CloudWebAPI } from "lib/k3/index.js";
const api = new K3CloudWebAPI(); await api.login();
const v = await api.viewBill("SUB_PickMtrl", 101295);
v.Entity.forEach(e=>console.log(e.Seq, e.Id, e.MaterialId.Number, e.ActualQty, e.StockID.Number, e.OwnerID.Number));
const o = await api.viewBill("STK_OEMInStock", 101904);
o.OEMInStockEntry.forEach(e=>console.log(e.Seq, e.Id, e.MaterialId.Number, e.Qty));
```
DB 快速验证：
```sql
SELECT d.FSEQ, d.FENTRYID, d.FACTUALQTY FROM T_SUB_PICKMTRLDATA d WHERE d.FID=101295 ORDER BY d.FSEQ;
SELECT e.FSEQ, e.FENTRYID, e.FQTY FROM T_STK_OEMINSTOCKENTRY e WHERE e.FID=101904 ORDER BY e.FSEQ;
```

3. **区分“没有数据”与“查错表”**
   - `T_SUB_PICKMTRLENTRY` 不存在，明细在 `T_SUB_PICKMTRLDATA`
   - `T_SUB_INStock` 不存在，受托入库是 `STK_OEMInStock`
   - 暴力 `INFORMATION_SCHEMA.COLUMNS WHERE COLUMN_NAME='FBILLNO'` 再按 `FBILLNO='STCLRK...'` 命中表是可靠发现 FormId 的方法

## 修正流程（标准单据，需授权）
仅改委外领料使其不负库存，不动受托入库：
1. 确认目标值：如 `WWLL260825001 Seq1 FENTRYID 105308 24.551 → 12.276`（与 STCLRK Seq1 对齐）
2. 已审核需先 `unAuditBill("SUB_PickMtrl", fid)`
3. `saveBill`：Model 带 `FID`，`FEntity` 中目标行 `FEntryID` 对应 `ActualQty/BaseActualQty/StockActualQty/BaseStockActualQty/AppQty/BaseAppQty/StockAppQty` 7 字段同步改为目标值，`NeedUpDateFields` 显式列出；其余分录原值回填（不要 IsDeleteEntry=true）
4. `submitBill` + `auditBill`，再 `viewBill` 复核
5. 重新查询库存流水验证结存归零

## 已验证执行（2026-08-31 WWLL260825001）
- Dry-run 先构造 Model 并打印 `NeedUpDateFields: [FActualQty,FBaseActualQty,FStockActualQty,FBaseStockActualQty,FAppQty,FBaseAppQty,FStockAppQty]`，不调用 UnAudit/Save
- Apply 实测：`C→UnAudit→D→Save(IsSuccess)→Submit→Audit→C`，View 复核 Seq1 12.276、Seq5 613.775、Seq6 589.224 正确，截图口径结存 0。脚本见 `scripts/scratch/2026-08/dryrun_wwl.js` / `apply_wwl.js`。

## 踩坑
- 一张 `SUB_PickMtrl` 可能含同一物料多行（本例 3 行 856191），截图流水可能只显示部分行，需全量对比后再定改哪行
- 客供仓 `不参与核算` 仍管数量，负数会阻塞后续领料/入库；修正后需同步检查 `T_STK_INVENTORY` 是否归零
- 不要用 SQL 直接改 `T_SUB_PICKMTRLDATA.FACTUALQTY`，必须走 WebAPI 反审核-保存-审核
