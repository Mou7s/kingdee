#!/usr/bin/env bun
/**
 * 修改物料主数据的默认仓库/仓位与生产领料默认仓库/仓位。
 *
 * 默认 dry-run（只读展示现状与变更方案）；只有显式传入 --apply 才写入。
 * 写入路径：UnAudit(C→D) → Save(仅 SubHeadEntity1/5 目标字段) → Submit → Audit(C)，
 * 之后三通道回查（View / ExecuteBillQuery / SQL）并校验非目标字段未变化。
 *
 * 用法:
 *   bun scripts/tools/update_material_stockplace.js --number <物料编码> --stock <仓库编码> --place <仓位内码> [--expect-place <旧仓位内码>] [--apply]
 *
 * 示例（NBM0760193 默认仓位 CTK11/100051 → CTK10/100080）:
 *   bun scripts/tools/update_material_stockplace.js --number NBM0760193 --stock CTK10 --place 100080 --expect-place 100051
 *   bun scripts/tools/update_material_stockplace.js --number NBM0760193 --stock CTK10 --place 100080 --expect-place 100051 --apply
 */
import {
  K3CloudWebAPI,
  FORMS,
  escapeK3,
  K3_DB_HOST,
  K3_DB_USER,
  K3_DB_PASS,
  K3_DB_NAME,
} from "../../lib/k3/index.js";
import sql from "mssql";

const args = process.argv.slice(2).filter((a) => a !== "--");
const get = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const apply = args.includes("--apply");
const number = get("--number");
const stockNo = get("--stock");
const placeArg = get("--place");
const expectPlace = get("--expect-place");

if (!number || !stockNo || placeArg === undefined) {
  console.error("用法: bun scripts/tools/update_material_stockplace.js --number <物料编码> --stock <仓库编码> --place <仓位内码> [--expect-place <旧仓位内码>] [--apply]");
  process.exit(1);
}
const placeId = Number(placeArg);
if (!Number.isInteger(placeId) || placeId <= 0) {
  console.error("--place 必须是正整数（仓位内码，组合值 ID）");
  process.exit(1);
}
const expectPlaceId = expectPlace !== undefined ? Number(expectPlace) : null;
if (expectPlace !== undefined && (!Number.isInteger(expectPlaceId) || expectPlaceId <= 0)) {
  console.error("--expect-place 必须是正整数");
  process.exit(1);
}

console.log("【参数表（实际生效值）】");
console.log(JSON.stringify({ number, stock: stockNo, place: placeId, expectPlace: expectPlaceId, mode: apply ? "APPLY" : "dry-run" }, null, 2));

const api = new K3CloudWebAPI();
await api.login();

const FORM_ID = FORMS.MATERIAL;

// ---------- 只读 SQL：解仓位组合值 → 仓位条目/名称/所属仓库 ----------
async function resolveStockPlace(targetPlaceId) {
  const pool = await new sql.ConnectionPool({
    server: K3_DB_HOST, user: K3_DB_USER, password: K3_DB_PASS, database: K3_DB_NAME,
    options: { encrypt: false, trustServerCertificate: true },
    requestTimeout: 60000,
  }).connect();
  try {
    const r = await pool.request().input("place", sql.Int, targetPlaceId).query(`
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
      WHERE d.FID = @place
    `);
    return r.recordset;
  } finally {
    await pool.close();
  }
}

// ---------- 只读 SQL：物料库存页当前值（第三通道基线） ----------
async function queryMaterialStockRow(materialId) {
  const pool = await new sql.ConnectionPool({
    server: K3_DB_HOST, user: K3_DB_USER, password: K3_DB_PASS, database: K3_DB_NAME,
    options: { encrypt: false, trustServerCertificate: true },
    requestTimeout: 60000,
  }).connect();
  try {
    const r = await pool.request().input("mid", sql.Int, materialId).query(`
      SELECT FMATERIALID, FSTOCKID, FSTOCKPLACEID, FISBATCHMANAGE, FSTOREUNITID
      FROM T_BD_MATERIALSTOCK WHERE FMATERIALID = @mid
    `);
    return r.recordset;
  } finally {
    await pool.close();
  }
}

// ---------- WebAPI 只读 ----------
async function queryStock(no) {
  const rows = await api.executeBillQuery(
    "BD_STOCK",
    "FStockId,FNumber,FName,FDocumentStatus,FForbidStatus",
    `FNumber='${escapeK3(no)}'`,
    5,
  );
  if (rows.length !== 1) {
    throw new Error(`仓库 ${no} 查询结果不是1条，而是 ${rows.length} 条`);
  }
  return { id: Number(rows[0][0]), number: String(rows[0][1] ?? ""), name: String(rows[0][2] ?? ""), docStatus: String(rows[0][3] ?? ""), forbid: String(rows[0][4] ?? "") };
}

const MATERIAL_FIELDS = "FMATERIALID,FNumber,FName,FSpecification,FDocumentStatus,FForbidStatus,FStockId.FNumber,FStockPlaceId,FIsBatchManage";

function rowToState(row) {
  return {
    materialId: Number(row[0]),
    number: String(row[1] ?? ""),
    name: String(row[2] ?? ""),
    spec: String(row[3] ?? ""),
    docStatus: String(row[4] ?? ""),
    forbid: String(row[5] ?? ""),
    stockNumber: String(row[6] ?? ""),
    stockPlaceId: Number(row[7] ?? 0),
    isBatchManage: row[8],
  };
}

async function reloadState(no) {
  const rows = await api.executeBillQuery(FORM_ID, MATERIAL_FIELDS, `FNumber='${escapeK3(no)}'`, 5);
  return rows.map(rowToState);
}

// ---------- 非目标字段守卫（改前/改后整单签名对比） ----------
function protectedProduceSignature(value) {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  return entries.map((entry) => {
    const copy = structuredClone(entry);
    // 目标字段：生产领料默认仓库/仓位（Save 后金蝶还会自动回写 PickStockId）
    delete copy.PickStockId_Id;
    delete copy.PickStockId;
    delete copy.PickBinId_Id;
    delete copy.PickBinId;
    return copy;
  });
}

function protectedStockSignature(value) {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  return entries.map((entry) => {
    const copy = structuredClone(entry);
    // 目标字段：默认仓库/仓位
    delete copy.StockId_Id;
    delete copy.StockId;
    delete copy.StockPlaceId_Id;
    delete copy.StockPlaceId;
    return copy;
  });
}

function protectedMaterialSignature(detail) {
  return JSON.stringify({
    id: detail?.Id,
    number: detail?.Number,
    name: detail?.Name,
    specification: detail?.Specification,
    documentStatus: detail?.DocumentStatus,
    forbidStatus: detail?.ForbidStatus,
    materialBase: detail?.MaterialBase,
    materialSale: detail?.MaterialSale,
    materialPurchase: detail?.MaterialPurchase,
    materialPlan: detail?.MaterialPlan,
    materialStock: protectedStockSignature(detail?.MaterialStock),
    materialProduce: protectedProduceSignature(detail?.MaterialProduce),
    materialAuxPty: detail?.MaterialAuxPty,
    materialInvPty: detail?.MaterialInvPty,
    materialSubcon: detail?.MaterialSubcon,
    materialQM: detail?.MaterialQM,
  });
}

// ---------- 1. 目标仓库 ----------
const targetStock = await queryStock(stockNo);
if (targetStock.docStatus !== "C" || targetStock.forbid !== "A") {
  throw new Error(`目标仓库 ${targetStock.number} 状态异常: 状态=${targetStock.docStatus} 禁用=${targetStock.forbid}`);
}
console.log(`\n【目标仓库】${targetStock.number} ${targetStock.name} (FStockId=${targetStock.id})`);

// ---------- 2. 目标仓位归属校验 ----------
const placeRows = await resolveStockPlace(placeId);
if (placeRows.length === 0) {
  throw new Error(`仓位内码 ${placeId} 解不出仓位条目（T_BAS_FLEXVALUESDETAIL 无对应组合值），拒绝执行`);
}
const placeInfo = placeRows[0];
const placeBelongs = placeRows.some((r) => Number(r.FlexStockId) === targetStock.id);
console.log(`【目标仓位】内码 ${placeId} = 「${placeInfo.PlaceName}」（编号 ${placeInfo.PlaceNo}），值集 ${placeInfo.FlexNo} ${placeInfo.FlexName}`);
if (!placeBelongs) {
  const holders = [...new Set(placeRows.map((r) => Number(r.FlexStockId)))].join(",");
  throw new Error(`仓位「${placeInfo.PlaceName}」(${placeId}) 不属于仓库 ${targetStock.number}（其值集挂在 FSTOCKID=${holders}），拒绝执行`);
}

// ---------- 3. 物料现状 ----------
const states = await reloadState(number);
if (states.length !== 1) {
  throw new Error(`物料 ${number} 查询结果不是1条，而是 ${states.length} 条`);
}
const state = states[0];
const detail = await api.viewBill(FORM_ID, state.materialId);
if (!detail?.Id) {
  throw new Error(`物料 ${number} View 读取失败`);
}

const stockEntries = Array.isArray(detail.MaterialStock) ? detail.MaterialStock : detail.MaterialStock ? [detail.MaterialStock] : [];
const produceEntries = Array.isArray(detail.MaterialProduce) ? detail.MaterialProduce : detail.MaterialProduce ? [detail.MaterialProduce] : [];
if (stockEntries.length !== 1 || produceEntries.length !== 1) {
  throw new Error(`View 库存页/生产页分录数异常: 库存=${stockEntries.length} 生产=${produceEntries.length}，拒绝批量语义写入`);
}
const stockEntry = stockEntries[0];
const produceEntry = produceEntries[0];

console.log("\n【物料现状】");
console.log(JSON.stringify({
  料号: state.number, 名称: state.name, 规格: state.spec,
  状态: state.docStatus, 禁用: state.forbid, 批号管理: state.isBatchManage,
  默认仓库: stockEntry?.StockId?.Number, 默认仓位内码: Number(stockEntry?.StockPlaceId_Id ?? 0),
  领料仓库: produceEntry?.PickStockId?.Number, 领料仓位内码: Number(produceEntry?.PickBinId_Id ?? 0),
}, null, 2));

// 旧值守卫
if (expectPlaceId !== null && Number(stockEntry?.StockPlaceId_Id ?? 0) !== expectPlaceId) {
  console.error(`旧值守卫失败：期望当前默认仓位为 ${expectPlaceId}，实际为 ${Number(stockEntry?.StockPlaceId_Id ?? 0)}，终止！`);
  process.exit(1);
}

const before = {
  material: protectedMaterialSignature(detail),
  stockNumber: stockEntry?.StockId?.Number,
  stockPlaceId: Number(stockEntry?.StockPlaceId_Id ?? 0),
  pickStockNumber: produceEntry?.PickStockId?.Number,
  pickBinId: Number(produceEntry?.PickBinId_Id ?? 0),
};

console.log("\n【变更方案】");
console.table([{
  料号: state.number,
  默认仓库: `${before.stockNumber} → ${targetStock.number}`,
  默认仓位: `${before.stockPlaceId} → ${placeId}（${placeInfo.PlaceName}）`,
  领料仓库: `${before.pickStockNumber} → ${targetStock.number}`,
  领料仓位: `${before.pickBinId} → ${placeId}（${placeInfo.PlaceName}）`,
}]);

if (!apply) {
  console.log("\n>>> DRY-RUN 结束：未做任何修改。确认后加 --apply 执行。<<<");
  process.exit(0);
}

// ---------- 状态守卫 ----------
if (state.docStatus !== "C" || state.forbid !== "A") {
  console.error(`当前状态为 ${state.docStatus}/禁用${state.forbid}，非已审核未禁用，停止写入！`);
  process.exit(1);
}

const fid = String(state.materialId);
const stockEntryId = stockEntry.Id;
const produceEntryId = produceEntry.Id;

// ---------- 4. 反审核 ----------
const un = await api.unAuditBill(FORM_ID, [fid]);
const unOk = un?.Result?.ResponseStatus?.IsSuccess;
console.log("1. 反审核(unAudit):", unOk ? "成功" : "失败", JSON.stringify(un?.Result?.ResponseStatus?.Errors ?? []));
if (!unOk) process.exit(1);
const afterUn = (await reloadState(number))[0];
if (afterUn.docStatus !== "D") {
  console.error(`反审核后状态为 ${afterUn.docStatus}，非重新审核(D)，终止！`);
  process.exit(1);
}

// ---------- 5. Save（仅目标字段） ----------
const saveModel = {
  FMATERIALID: state.materialId,
  // 库存页在 Save 模型中是 SubHeadEntity1 单对象；按数组回传会「成功但忽略」
  SubHeadEntity1: {
    FEntryId: stockEntryId,
    FStockId: { FNumber: targetStock.number },
    FStockPlaceId: placeId,
  },
  // 生产页是 SubHeadEntity5；空仓位不传 FPickBinId（0 会被当作不存在的仓位）
  SubHeadEntity5: {
    FEntryId: produceEntryId,
    FPickStockId: { FNumber: targetStock.number },
    FPickBinId: placeId,
  },
};
const save = await api.saveBill(FORM_ID, saveModel, [], [], false);
const saveOk = save?.Result?.ResponseStatus?.IsSuccess;
console.log("2. 保存仓位(Save):", saveOk ? "成功" : "失败", (save?.Result?.ResponseStatus?.Errors ?? []).map((e) => e.Message).join("; "));
if (!saveOk) {
  console.error("保存失败，物料当前停留在 D（重新审核）状态，请人工处理，终止！");
  process.exit(1);
}

// ---------- 6. 提交 + 审核 ----------
const sub = await api.submitBill(FORM_ID, [fid]);
const subOk = sub?.Result?.ResponseStatus?.IsSuccess;
console.log("3. 提交(Submit):", subOk ? "成功" : "失败", (sub?.Result?.ResponseStatus?.Errors ?? []).map((e) => e.Message).join("; "));
if (!subOk) process.exit(1);

const aud = await api.auditBill(FORM_ID, [fid]);
const audOk = aud?.Result?.ResponseStatus?.IsSuccess;
console.log("4. 审核(Audit):", audOk ? "成功" : "失败", (aud?.Result?.ResponseStatus?.Errors ?? []).map((e) => e.Message).join("; "));
if (!audOk) process.exit(1);

// ---------- 7. 三通道回查 ----------
console.log("\n【三通道回查】");
const finalDetail = await api.viewBill(FORM_ID, state.materialId);
const finalStates = await reloadState(number);
const finalState = finalStates[0];
const finalSqlRows = await queryMaterialStockRow(state.materialId);

const finalStock = (Array.isArray(finalDetail.MaterialStock) ? finalDetail.MaterialStock : [])[0];
const finalProduce = (Array.isArray(finalDetail.MaterialProduce) ? finalDetail.MaterialProduce : [])[0];
const result = {
  通道1_View: {
    默认仓库: finalStock?.StockId?.Number,
    默认仓位内码: Number(finalStock?.StockPlaceId_Id ?? 0),
    领料仓库: finalProduce?.PickStockId?.Number,
    领料仓位内码: Number(finalProduce?.PickBinId_Id ?? 0),
    状态: finalDetail?.DocumentStatus,
    禁用: finalDetail?.ForbidStatus,
  },
  通道2_ExecuteBillQuery: {
    默认仓库: finalState.stockNumber,
    默认仓位内码: finalState.stockPlaceId,
    状态: finalState.docStatus,
    禁用: finalState.forbid,
    批号管理: finalState.isBatchManage,
  },
  通道3_SQL: finalSqlRows,
};
console.log(JSON.stringify(result, null, 2));

const problems = [];
if (finalStock?.StockId?.Number !== targetStock.number) problems.push("View 默认仓库不符");
if (Number(finalStock?.StockPlaceId_Id ?? 0) !== placeId) problems.push("View 默认仓位不符");
if (finalProduce?.PickStockId?.Number !== targetStock.number) problems.push("View 领料仓库不符");
if (Number(finalProduce?.PickBinId_Id ?? 0) !== placeId) problems.push("View 领料仓位不符");
if (finalDetail?.DocumentStatus !== "C") problems.push(`View 状态=${finalDetail?.DocumentStatus} 非C`);
if (finalDetail?.ForbidStatus !== "A") problems.push(`View 禁用=${finalDetail?.ForbidStatus} 非A`);
if (finalState.stockNumber !== targetStock.number || finalState.stockPlaceId !== placeId) problems.push("Query 默认仓库/仓位不符");
if (finalState.docStatus !== "C" || finalState.forbid !== "A") problems.push("Query 状态/禁用不符");
if (finalSqlRows.length !== 1) problems.push(`SQL 库存页行数=${finalSqlRows.length}`);
else {
  const row = finalSqlRows[0];
  if (Number(row.FSTOCKID) !== targetStock.id) problems.push(`SQL FSTOCKID=${row.FSTOCKID} 不符`);
  if (Number(row.FSTOCKPLACEID) !== placeId) problems.push(`SQL FSTOCKPLACEID=${row.FSTOCKPLACEID} 不符`);
  // FISBATCHMANAGE 在 SQL 侧是 char(1)('1'/'0')，WebAPI 侧是布尔，先归一化再比
  const sqlBatch = ["1", "true", "True", true, 1].includes(row.FISBATCHMANAGE);
  const apiBatch = ["1", "true", "True", true, 1].includes(state.isBatchManage);
  if (sqlBatch !== apiBatch) problems.push("SQL 批号管理标志发生变化");
}
const afterSig = protectedMaterialSignature(finalDetail);
if (afterSig !== before.material) problems.push("非目标字段签名发生变化（请人工比对 before/after）");

if (problems.length === 0) {
  console.log("\n✅ 修改完成，三通道回查一致，非目标字段未变化。");
} else {
  console.error("\n❌ 回查存在不符，请人工介入：");
  for (const p of problems) console.error("  - " + p);
  console.error("改前签名:", before.material);
  console.error("改后签名:", afterSig);
  process.exit(1);
}
