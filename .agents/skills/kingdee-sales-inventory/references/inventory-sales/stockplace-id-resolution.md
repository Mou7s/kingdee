# 仓位（FStockPlaceId）双 ID 体系与解析方法

> 沉淀自 2026-09-24 NBM0760193 仓位排查（用户被 `100051` 两个含义绕晕后要求澄清）。

## 坑：两套 ID 撞号

金蝶仓位有两套内码，**数字经常撞在一起但含义不同**：

| 体系 | 落表 | 含义 | 例 |
|---|---|---|---|
| 组合值 ID | `T_BAS_FLEXVALUESDETAIL.FID` | 单据/物料里 `FStockPlaceId`、`StockPlaceId_Id` 存的就是它 | `100051` → 「TO-252成品仓」 |
| 值集条目 ID | `T_BAS_FLEXVALUESENTRY.FENTRYID` | 界面「StockFlexDetail / FlexEntryId_Id」列表里的条目 | `100051` → 「SOD-523成品仓」 |

因此**不能**拿 `StockPlaceId_Id` 直接去值集条目表里查名字（查出来的是另一个仓位）。历史笔记里的 `100079=PDFN3X3成品仓`、`100037=DFN1006成品仓` 均按组合值口径验证吻合。

## 解析 SQL（组合值 → 仓位名称/所属仓库）

```sql
SELECT d.FID AS PlaceId,
       e.FENTRYID AS EntryId, e.FNUMBER AS PlaceNo, l.FNAME AS PlaceName,
       v.FID AS FlexId, v.FNUMBER AS FlexNo, vl.FNAME AS FlexName,
       i.FSTOCKID AS FlexStockId
FROM T_BAS_FLEXVALUESDETAIL d
CROSS APPLY (SELECT EntryId = COALESCE(NULLIF(d.FF100001,0), NULLIF(d.FF100003,0), NULLIF(d.FF100004,0),
                                       NULLIF(d.FF100005,0), NULLIF(d.FF100006,0), NULLIF(d.FF100007,0),
                                       NULLIF(d.FF100008,0), NULLIF(d.FF100009,0), NULLIF(d.FF100010,0),
                                       NULLIF(d.FF100011,0), NULLIF(d.FF100012,0))) x
JOIN T_BAS_FLEXVALUESENTRY e ON e.FENTRYID = x.EntryId
JOIN T_BAS_FLEXVALUES v ON v.FID = e.FID
JOIN T_BD_STOCKFLEXDETAIL sd ON sd.FFLEXENTRYID = e.FENTRYID
JOIN T_BD_STOCKFLEXITEM i ON i.FENTRYID = sd.FENTRYID AND i.FFLEXID = v.FID
LEFT JOIN T_BAS_FLEXVALUESENTRY_L l ON l.FENTRYID = e.FENTRYID AND l.FLOCALEID = 2052
LEFT JOIN T_BAS_FLEXVALUES_L vl ON vl.FID = v.FID AND vl.FLOCALEID = 2052
WHERE d.FID = @placeId
```

- 组合值的多个 `FF1000xx` 指向条目 ID；本账套实测单值组合（只有一个非零），但 COALESCE 全列写法更稳。
- `FlexStockId` 是该仓位值集挂靠的仓库，用于校验「这个仓位属于哪个仓」——不同仓有同名仓位（如 CTK10/CTK11 都有「SOD-523成品仓」），必须按仓库维度校验。
- 相关表：`T_BD_STOCKFLEXITEM`（仓库→值集）、`T_BD_STOCKFLEXDETAIL`（值集→条目）。`BD_STOCKPLACE`/`BD_STOCKLOC` 这些 WebAPI 表单不存在，别试。
- WebAPI 的 `STK_Inventory` 有 `FStockLocId`（可用）但无 `FBatchNo`/`FBASEQTY` 等，字段名别照 SQL 抄。

## 修改物料默认仓位/领料仓位

稳定工具（默认 dry-run，`--apply` 才写）：

```bash
bun scripts/tools/update_material_stockplace.js --number <料号> --stock <仓库编码> --place <仓位组合内码> [--expect-place <旧内码>] [--apply]
```

流程：目标仓位归属校验（上面的 SQL）→ UnAudit(C→D) → Save → Submit → Audit → 三通道回查（View / ExecuteBillQuery / SQL）+ 非目标字段签名守卫。

### Save 报文要点（踩过的坑）

- 物料库存页在 Save 模型里是 **`SubHeadEntity1` 单对象**，按 View 返回的 `MaterialStock` 数组回传会「返回成功但静默忽略」；生产页对应 **`SubHeadEntity5`**。
- 字段：`SubHeadEntity1: { FEntryId, FStockId: { FNumber }, FStockPlaceId: <组合内码> }`、`SubHeadEntity5: { FEntryId, FPickStockId: { FNumber }, FPickBinId: <组合内码> }`。
- 仓位为 0/空时**不传** `FPickBinId`（0 会被当成不存在的仓位基础资料）。
- Save 库存仓库后金蝶会自动回写 `FPickStockId`，回查时两个都要核。
- `T_BD_MATERIALSTOCK.FISBATCHMANAGE` 在 SQL 侧是 char(1)（`'1'/'0'`）、WebAPI 侧是布尔，比较前先归一化，否则回查误报「批号管理标志发生变化」。
- `T_BD_MATERIAL` 主键是 `FMATERIALID`（不是 `FID`）、分组列是 `FMATERIALGROUP`；`T_BD_MATERIALSTOCK` 关联键 `FMATERIALID`、仓位列 `FSTOCKPLACEID`（不是 `FSTOCKLOCID`）。

## 新建仓位（值集条目 + 仓库挂接）

稳定工具（默认 dry-run，`--apply` 才写）：

```bash
bun scripts/tools/create_stock_place.js --stock <仓库编码> --number <仓位编号> --name <仓位名称> [--apply]
```

流程：编号/名称查重 → `BD_FLEXVALUES`（仓位值集）加条目 → `BD_STOCK` 挂明细 → 解析并输出组合内码。内部 Save 报文（元数据 `T_META_OBJECTTYPE.FKERNELXML` 确认的键）：

- 值集加条目：`saveBill("BD_FLEXVALUES", { FID: <值集ID>, FEntity: [{ FSeq, FNUMBER: "8", FName: "PDFN5X6成品仓" }] })`。子实体键是 **`FEntity`**（EntryName 是 FLEXVALUESENTRY，别用错）、主键 `FID`、行字段 `FNUMBER`/`FName`/`FSeq`。**已存在同编号+同名条目时脚本自动复用**（断点续做，不会重复建）。
- 仓库挂明细：`saveBill("BD_STOCK", { FStockId: <仓库ID>, FStockFlexItem: [{ FEntryId: <值集行ID>, FStockFlexDetail: [{ FFlexEntryId: { FEntryID: <条目ID> } }] }] })`。三层键 = 元数据 `<Key>`：`FStockFlexItem`（EntryEntity）→ `FStockFlexDetail`（SubEntryEntity）→ 字段 `FFlexEntryId`。
- **引用字段 `FFlexEntryId` 必须传字典且键是 `FEntryID`**（2026-09-24 实测）：传数字/`{Id}` 会「Save 成功但静默忽略」，传 `{FNumber}` 靠编号解析有跨值集歧义；只有 `{ FEntryID: <条目ID> }` 真实落库。凡「Save 成功但回查没变化」先怀疑引用字段格式。
- 值集条目建成后 `T_BAS_FLEXVALUESDETAIL` 组合行**自动生成**，组合内码（如 8=PDFN5X6成品仓 → `100112`）就是物料 `FStockPlaceId` 要写的值。
- `DynamicFormService.GetFormMetaData` 在本账套不可用（返回 `response_error: Unknown Error`）；字段键走 `T_META_OBJECTTYPE.FKERNELXML` 的 SQL 切片法（见 `bill-operations-and-metadata.md`）。

## 批量迁移默认仓/仓位

`bun scripts/cases/migrate_default_stockplace.js --groups "BM076,BQ076" --stock CTK11 --place 100112 [--limit N] [--apply]`：按物料分组取未禁用且现状≠目标的候选，逐条走单条工具同样的受控流程并做轻量非目标守卫（名称/规格/分组/类别/单位/批号管理），**失败即停**，报告落 `output/migrate_default_stockplace_*.json`。dry-run 阶段会按现状仓位分组给分布表，并只读列出非零库存行提醒（改默认仓不影响存量，但以后单据默认带新仓）。2026-09-24 实跑 142 条全部成功、SQL 分组复查 143/143 一致。

## 验证方法

1. dry-run 打印的参数表与目标仓位名称（如「100080 = PDFN5X6成品仓」）先核对；
2. 写入后三通道一致：View `StockId.Number/StockPlaceId_Id/PickStockId.Number/PickBinId_Id`、Query 同值、SQL `T_BD_MATERIALSTOCK.FSTOCKID/FSTOCKPLACEID`；
3. 非目标字段签名（Base/Sale/Purchase/Plan/QM/批次等）与改前一致。
