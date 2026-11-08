#!/usr/bin/env bun
/**
 * 在仓库的「仓位值集」里新建一个仓位（维度值条目），并挂到该仓库的仓位明细。
 *
 * 做两件事（都在正规基础资料流程内，不碰 SQL 写入）：
 *   1. BD_FLEXVALUES（仓位值集）FEntity 子实体追加条目 {编号, 名称}；
 *   2. BD_STOCK 的 FStockFlexItem.FStockFlexDetail 追加一行引用新条目。
 * 落库后解出「仓位组合内码」（T_BAS_FLEXVALUESDETAIL.FID），供物料 FStockPlaceId 使用。
 *
 * 默认 dry-run；只有显式 --apply 才写入。
 *
 * 用法:
 *   bun scripts/tools/create_stock_place.js --stock <仓库编码> --number <仓位编号> --name <仓位名称> [--apply]
 *
 * 示例（CTK11 OEM成品仓新建「PDFN5X6成品仓」）:
 *   bun scripts/tools/create_stock_place.js --stock CTK11 --number 8 --name PDFN5X6成品仓
 *   bun scripts/tools/create_stock_place.js --stock CTK11 --number 8 --name PDFN5X6成品仓 --apply
 */
import { K3CloudWebAPI, FORMS, escapeK3 } from "../../lib/k3/index.js";

const args = process.argv.slice(2).filter((a) => a !== "--");
const get = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const apply = args.includes("--apply");
const stockNo = get("--stock");
const placeNo = get("--number");
const placeName = get("--name");

if (!stockNo || !placeNo || !placeName) {
  console.error("用法: bun scripts/tools/create_stock_place.js --stock <仓库编码> --number <仓位编号> --name <仓位名称> [--apply]");
  process.exit(1);
}

console.log("【参数表（实际生效值）】");
console.log(JSON.stringify({ stock: stockNo, number: placeNo, name: placeName, mode: apply ? "APPLY" : "dry-run" }, null, 2));

const api = new K3CloudWebAPI();
await api.login();

const viewStock = await api.post("DynamicFormService.View", { formid: "BD_STOCK", data: { Number: stockNo } });
const stock = viewStock?.Result?.Result ?? viewStock?.Result ?? viewStock;
if (!stock?.Id) {
  console.error(`仓库 ${stockNo} 读取失败`);
  process.exit(1);
}
const flexItems = Array.isArray(stock.StockFlexItem) ? stock.StockFlexItem : [];
if (flexItems.length !== 1) {
  console.error(`仓库 ${stockNo} 的仓位值集不是 1 个（${flexItems.length}），本工具暂只支持单值集仓库`);
  process.exit(1);
}
const flexItem = flexItems[0];
const flexId = flexItem.FlexId_Id;
const flexNo = flexItem.FlexId?.Number;
const flexName = flexItem.FlexId?.Name?.find?.((x) => x.Key === 2052)?.Value;
const details = Array.isArray(flexItem.StockFlexDetail) ? flexItem.StockFlexDetail : [];

console.log(`\n【仓库】${stock.Number} ${stock.Name?.find?.((x) => x.Key === 2052)?.Value} (FStockId=${stock.Id}, 状态=${stock.DocumentStatus})`);
console.log(`【仓位值集】${flexNo} ${flexName} (FlexId=${flexId})，现有仓位 ${details.length} 个：`);
for (const d of details) {
  console.log(`  - 编号 ${d.FlexEntryId?.Number}（条目ID ${d.FlexEntryId_Id}）「${d.FlexEntryId?.Name?.find?.((x) => x.Key === 2052)?.Value}」`);
}

// 值集条目全集查重（含未挂到本仓库的条目）
const viewFlex = await api.post("DynamicFormService.View", { formid: "BD_FLEXVALUES", data: { Id: String(flexId) } });
const flex = viewFlex?.Result?.Result ?? viewFlex?.Result ?? viewFlex;
const entries = Array.isArray(flex?.FLEXVALUESENTRY) ? flex.FLEXVALUESENTRY : [];
console.log(`\n【值集条目全集】${entries.length} 条`);
const dupNo = entries.filter((e) => String(e.Number) === String(placeNo));
const dupName = entries.filter((e) => e.Name?.find?.((x) => x.Key === 2052)?.Value === placeName);
let existingEntryId = 0;
if (dupNo.length) {
  const sameName = dupNo.find((e) => e.Name?.find?.((x) => x.Key === 2052)?.Value === placeName);
  if (!sameName) {
    console.error(`编号「${placeNo}」已被占用（条目ID ${dupNo.map((e) => e.Id).join(",")}），拒绝执行`);
    process.exit(1);
  }
  existingEntryId = sameName.Id;
  console.log(`\n条目已存在（编号 ${placeNo} = ${placeName}，条目ID ${existingEntryId}），跳过新建，直接进入挂接。`);
} else if (dupName.length) {
  console.error(`名称「${placeName}」已存在于条目ID ${dupName.map((e) => e.Id).join(",")}（编号 ${dupName.map((e) => e.Number).join(",")}），如需复用请改用该条目，拒绝重复新建`);
  process.exit(1);
}

console.log("\n【新建方案】");
console.table([{
  仓库: stockNo,
  值集: `${flexNo} ${flexName}`,
  新条目编号: placeNo,
  新条目名称: placeName,
  同值集参考: entries.map((e) => e.Number).join("/"),
}]);
console.log("说明：名称按同组既有写法（如 CTK10 值集的「PDFN5X6成品仓」）对齐；如需其它命名，改 --name 重跑即可。");

if (!apply) {
  console.log("\n>>> DRY-RUN 结束：未做任何修改。确认后加 --apply 执行。<<<");
  process.exit(0);
}

// ---------- 1. 值集加条目 ----------
let entryId = existingEntryId;
if (!entryId) {
  console.log("\n1. BD_FLEXVALUES 追加条目 ...");
  const saveFlex = await api.saveBill(
    "BD_FLEXVALUES",
    {
      FID: flexId,
      FEntity: [
        { FSeq: entries.length + 1, FNUMBER: String(placeNo), FName: placeName },
      ],
    },
    [],
    [],
    false,
  );
  const flexSaveOk = saveFlex?.Result?.ResponseStatus?.IsSuccess;
  console.log("   Save:", flexSaveOk ? "成功" : "失败", (saveFlex?.Result?.ResponseStatus?.Errors ?? []).map((e) => e.Message).join("; "));
  if (!flexSaveOk) {
    console.error("值集条目保存失败，终止（无写入或已回滚，未挂接仓库）。");
    process.exit(1);
  }

  const viewFlex2 = await api.post("DynamicFormService.View", { formid: "BD_FLEXVALUES", data: { Id: String(flexId) } });
  const flex2 = viewFlex2?.Result?.Result ?? viewFlex2?.Result ?? viewFlex2;
  const newEntry = (flex2?.FLEXVALUESENTRY ?? []).find(
    (e) => String(e.Number) === String(placeNo) && e.Name?.find?.((x) => x.Key === 2052)?.Value === placeName,
  );
  if (!newEntry?.Id) {
    console.error("回查未找到新条目（编号/名称匹配失败），终止，不挂仓库。值集现状请人工核对。");
    console.error("现有条目:", JSON.stringify((flex2?.FLEXVALUESENTRY ?? []).map((e) => ({ Id: e.Id, Number: e.Number, Name: e.Name }))));
    process.exit(1);
  }
  entryId = newEntry.Id;
  console.log(`   回查：新条目条目ID=${entryId}，编号=${newEntry.Number}，名称=${newEntry.Name?.find?.((x) => x.Key === 2052)?.Value}`);
} else {
  console.log("\n1. 条目已存在，跳过新建。");
}

// ---------- 2. 挂到仓库仓位明细 ----------
console.log("\n2. BD_STOCK 挂接仓位明细 ...");
const saveStock = await api.saveBill(
  "BD_STOCK",
  {
    FStockId: stock.Id,
    FStockFlexItem: [
      {
        FEntryId: flexItem.Id,
        // 引用字段必须传字典，且键是 FEntryID（传 Id/数字会被静默忽略或报格式错误）
        FStockFlexDetail: [{ FFlexEntryId: { FEntryID: entryId } }],
      },
    ],
  },
  [],
  [],
  false,
);
const stockSaveOk = saveStock?.Result?.ResponseStatus?.IsSuccess;
console.log("   Save:", stockSaveOk ? "成功" : "失败", (saveStock?.Result?.ResponseStatus?.Errors ?? []).map((e) => e.Message).join("; "));
if (!stockSaveOk) {
  console.error(`仓位明细挂接失败。条目已建成（条目ID=${entryId}），但未挂到仓库，需人工在仓库档案里挂接或重试。`);
  process.exit(1);
}

// ---------- 3. 三通道回查 + 解析组合内码 ----------
console.log("\n【回查】");
const viewStock2 = await api.post("DynamicFormService.View", { formid: "BD_STOCK", data: { Number: stockNo } });
const stock2 = viewStock2?.Result?.Result ?? viewStock2?.Result ?? viewStock2;
const details2 = (stock2?.StockFlexItem ?? []).flatMap((i) => i.StockFlexDetail ?? []);
const hit = details2.find((d) => d.FlexEntryId_Id === entryId);
console.log("通道1 View 仓库仓位明细:", details2.map((d) => `${d.FlexEntryId?.Number}=${d.FlexEntryId?.Name?.find?.((x) => x.Key === 2052)?.Value}(条目ID ${d.FlexEntryId_Id})`).join("、"));
if (!hit) {
  console.error("❌ View 未见新仓位挂接，请人工核对");
  process.exit(1);
}

// SQL 解组合内码（只读）
const { K3_DB_HOST, K3_DB_USER, K3_DB_PASS, K3_DB_NAME } = await import("../../lib/k3/index.js");
const sql = await import("mssql");
const pool = await new sql.ConnectionPool({
  server: K3_DB_HOST, user: K3_DB_USER, password: K3_DB_PASS, database: K3_DB_NAME,
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 60000,
}).connect();
try {
  const r = await pool.request().input("entryId", sql.Int, entryId).query(`
    SELECT d.FID AS PlaceId,
           e.FENTRYID AS EntryId, e.FNUMBER AS PlaceNo, l.FNAME AS PlaceName,
           i.FSTOCKID AS FlexStockId
    FROM T_BAS_FLEXVALUESDETAIL d
    CROSS APPLY (SELECT EntryId = COALESCE(NULLIF(d.FF100001,0), NULLIF(d.FF100003,0), NULLIF(d.FF100004,0),
                                             NULLIF(d.FF100005,0), NULLIF(d.FF100006,0), NULLIF(d.FF100007,0),
                                             NULLIF(d.FF100008,0), NULLIF(d.FF100009,0), NULLIF(d.FF100010,0),
                                             NULLIF(d.FF100011,0), NULLIF(d.FF100012,0))) x
    JOIN T_BAS_FLEXVALUESENTRY e ON e.FENTRYID = x.EntryId
    JOIN T_BD_STOCKFLEXDETAIL sd ON sd.FFLEXENTRYID = e.FENTRYID
    JOIN T_BD_STOCKFLEXITEM i ON i.FENTRYID = sd.FENTRYID
    LEFT JOIN T_BAS_FLEXVALUESENTRY_L l ON l.FENTRYID = e.FENTRYID AND l.FLOCALEID = 2052
    WHERE e.FENTRYID = @entryId
  `);
  console.log("通道2 SQL 仓位解析:", JSON.stringify(r.recordset, null, 2));
  if (r.recordset.length === 0) {
    console.error("⚠️ 组合值（T_BAS_FLEXVALUESDETAIL）尚未生成：条目与挂接已建好，但暂时没有可写入物料 FStockPlaceId 的组合内码。可稍后重查或在界面打开仓库档案保存一次触发生成。");
  } else {
    console.log(`\n✅ 新仓位建成。组合内码 = ${r.recordset[0].PlaceId}，可执行：`);
    console.log(`   bun scripts/tools/update_material_stockplace.js --number <料号> --stock ${stockNo} --place ${r.recordset[0].PlaceId} --apply`);
  }
} finally {
  await pool.close();
}
