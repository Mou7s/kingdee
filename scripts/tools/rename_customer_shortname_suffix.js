#!/usr/bin/env bun
/**
 * 客户「简称」批量加后缀（外贸客户标记用），默认只预览。
 *
 * 只读预览：
 *   bun scripts/tools/rename_customer_shortname_suffix.js
 *   bun scripts/tools/rename_customer_shortname_suffix.js --suffix=-W --scope=dept
 * 执行（先单条样板，再批量；必须显式 --apply，且预览文件必须已由只读模式生成）：
 *   bun scripts/tools/rename_customer_shortname_suffix.js --apply --one <客户编码>
 *   bun scripts/tools/rename_customer_shortname_suffix.js --apply
 *
 * scope 取值：
 *   dept       销售部门=外贸部（默认，当前 120 家）
 *   dept-export 仅外贸部中出口口径（美元币别 / 零税率 / 有美元应收）
 *   dept-only   仅外贸部中人民币+13% 内销口径（代理出口类）
 *
 * 写入方式为金蝶标准客户 Save 流程（已审核 C：反审核 → Save → 提交 → 审核 → 独立回查），
 * 不使用 SQL 写入；每条都守卫旧简称与状态，失败即停并保留日志。
 */
import fs from "node:fs";
import path from "node:path";
import mssql from "mssql";
import * as XLSX from "xlsx";
import { K3CloudWebAPI, K3_DB_HOST, K3_DB_USER, K3_DB_PASS, K3_DB_NAME } from "../../lib/k3/index.js";

const FORM_ID = "BD_CUSTOMER";
const ARGS = process.argv.slice(2);
const argValue = (name, fallback = null) => {
  const hit = ARGS.find((a) => a === name || a.startsWith(`${name}=`));
  if (!hit) return fallback;
  if (hit.includes("=")) return hit.slice(hit.indexOf("=") + 1);
  const next = ARGS[ARGS.indexOf(hit) + 1];
  return next && !next.startsWith("--") ? next : fallback;
};
const APPLY = ARGS.includes("--apply");
const ONE = argValue("--one");
const SUFFIX = argValue("--suffix", "-W");
const SCOPE = argValue("--scope", "dept");
const EXPORT_DEPT_NUMBER = argValue("--dept", "BM000016"); // 外贸部默认编码，可通过 --dept 覆盖
const PREVIEW_PATH = path.resolve("output/customer_shortname_suffix_preview.json");
const XLSX_PATH = path.resolve("output/customer_shortname_suffix_preview.xlsx");
const LOG_PATH = path.resolve("output/customer_shortname_suffix_log.json");

const SCOPES = ["dept", "dept-export", "dept-only"];
if (!SCOPES.includes(SCOPE)) throw new Error(`--scope 只支持 ${SCOPES.join(" / ")}`);

/** 出口口径判定所需的只读数据：税率零税率 SL04_SYS，币别美元 PRE007，AR 有美元流水 */
async function fetchExportSet() {
  const pool = await mssql.connect({
    server: K3_DB_HOST, user: K3_DB_USER, password: K3_DB_PASS, database: K3_DB_NAME,
    options: { encrypt: false, trustServerCertificate: true },
  });
  const r = await pool.request().query(`
    SELECT c.FCUSTID AS ID,
           cur.FNUMBER AS CUR_NO, tr.FNUMBER AS TAX_NO,
           ISNULL(usd.BILLS, 0) AS USD_BILLS
    FROM T_BD_CUSTOMER c
    LEFT JOIN T_BD_CURRENCY cur ON cur.FCURRENCYID = c.FTRADINGCURRID
    LEFT JOIN T_BD_TAXRATE tr ON tr.FID = c.FTAXRATE
    LEFT JOIN (
      SELECT r.FCUSTOMERID AS ID, COUNT(DISTINCT r.FID) AS BILLS
      FROM T_AR_RECEIVABLE r
      JOIN T_BD_CURRENCY cur2 ON cur2.FCURRENCYID = r.FCURRENCYID AND cur2.FNUMBER = 'PRE007'
      GROUP BY r.FCUSTOMERID
    ) usd ON usd.ID = c.FCUSTID`);
  await pool.close();
  const set = new Set();
  for (const row of r.recordset) {
    if (row.CUR_NO === "PRE007" || row.TAX_NO === "SL04_SYS" || Number(row.USD_BILLS) > 0) set.add(String(row.ID));
  }
  return set;
}

function refNumber(ref) {
  return ref?.Number ?? ref?.FNumber ?? "";
}
function textValue(value) {
  if (Array.isArray(value)) return value.find((i) => i.Key === 2052)?.Value ?? value[0]?.Value ?? "";
  return String(value ?? "");
}

async function fetchCustomers(api) {
  const rows = await api.executeBillQuery(
    FORM_ID,
    "FCUSTID,FNumber,FName,FShortName,FDocumentStatus,FForbidStatus,FSALDEPTID.FNumber,FSALDEPTID.FName",
    "",
    20000,
  );
  return rows.map((r) => ({
    id: String(r[0]),
    number: String(r[1] ?? "").trim(),
    name: String(r[2] ?? "").trim(),
    shortName: String(r[3] ?? "").trim(),
    documentStatus: String(r[4] ?? ""),
    forbidStatus: String(r[5] ?? ""),
    deptNumber: String(r[6] ?? "").trim(),
    deptName: String(r[7] ?? "").trim(),
  }));
}

/** 客户 Save 必填引用；缺失则该条不能走 Save（金蝶会报必填） */
function requiredRefsFromView(detail) {
  return {
    FCreateOrgId: detail.CreateOrgId,
    FUseOrgId: detail.UseOrgId,
    FGroup: detail.FGroup,
    FSALDEPTID: detail.SALDEPTID,
    FSALGROUPID: detail.SALGROUPID,
    FSELLER: detail.SELLER,
    FRECCONDITIONID: detail.RECCONDITIONID,
    FSETTLETYPEID: detail.SETTLETYPEID,
  };
}
function missingRequired(detail) {
  const missing = Object.entries(requiredRefsFromView(detail))
    .filter(([, ref]) => !refNumber(ref))
    .map(([key]) => key);
  if (!textValue(detail.Name).trim()) missing.push("FName");
  if (!textValue(detail.ShortName).trim()) missing.push("FShortName");
  return missing;
}
function buildCustomerModel(detail, newShortName) {
  const refs = requiredRefsFromView(detail);
  const model = {
    FCUSTID: detail.Id,
    FNumber: String(detail.Number),
    FName: textValue(detail.Name),
    FShortName: newShortName,
  };
  for (const [key, ref] of Object.entries(refs)) model[key] = { FNumber: refNumber(ref) };
  for (const [key, ref] of [
    ["FTRADINGCURRID", detail.TRADINGCURRID],
    ["FTaxRate", detail.TaxRate],
    ["FTaxType", detail.TaxType],
    ["FCustTypeId", detail.CustTypeId],
  ]) {
    const number = refNumber(ref);
    if (number) model[key] = { FNumber: number };
  }
  return model;
}

const api = new K3CloudWebAPI();
await api.login();

function log(entry) {
  const all = fs.existsSync(LOG_PATH) ? JSON.parse(fs.readFileSync(LOG_PATH, "utf8")) : [];
  all.push({ at: new Date().toISOString(), ...entry });
  fs.writeFileSync(LOG_PATH, JSON.stringify(all, null, 2), "utf8");
}

async function changeShortName(row) {
  const before = await api.viewBill(FORM_ID, row.id);
  const currentShort = textValue(before.ShortName).trim();
  const currentMissing = missingRequired(before);
  if (currentShort === row.newShortName && before.DocumentStatus === "C" && before.ForbidStatus === "A") {
    console.log(`· ${row.number} 已是 ${row.newShortName}，跳过（断点续跑）`);
    return;
  }
  if (currentShort !== row.oldShortName) {
    throw new Error(`${row.number}: 当前简称「${currentShort}」与预览「${row.oldShortName}」不一致，停止`);
  }
  if (currentMissing.length && before.DocumentStatus === "C") {
    throw new Error(`${row.number}: 缺少必填值 ${currentMissing.join(", ")}，Save 会失败，需人工确认`);
  }
  if (before.DocumentStatus === "C") await api.unAuditBill(FORM_ID, row.id);
  const editable = await api.viewBill(FORM_ID, row.id);
  const missing = missingRequired(editable);
  if (missing.length) throw new Error(`${row.number}: 反审核后缺少必填值 ${missing.join(", ")}`);
  if (String(editable.Number) !== row.number) {
    throw new Error(`${row.number}: 反审核后编码变化为 ${editable.Number}，停止`);
  }
  await api.saveBill(FORM_ID, buildCustomerModel(editable, row.newShortName), null,
    ["FCUSTID", "FNumber", "FName", "FShortName", "FDocumentStatus", "FForbidStatus"]);
  const afterSave = await api.viewBill(FORM_ID, row.id);
  if (textValue(afterSave.ShortName).trim() !== row.newShortName) {
    throw new Error(`${row.number}: Save 后简称仍是「${textValue(afterSave.ShortName).trim()}」，未落库`);
  }
  await api.submitBill(FORM_ID, row.id);
  await api.auditBill(FORM_ID, row.id);
  const after = await api.viewBill(FORM_ID, row.id);
  const checks = {
    名称: textValue(after.Name) === textValue(editable.Name),
    销售部门: refNumber(after.SALDEPTID) === refNumber(editable.SALDEPTID),
    结算币别: refNumber(after.TRADINGCURRID) === refNumber(editable.TRADINGCURRID),
    税率: refNumber(after.TaxRate) === refNumber(editable.TaxRate),
    客户分组: refNumber(after.FGroup) === refNumber(editable.FGroup),
    销售员: refNumber(after.SELLER) === refNumber(editable.SELLER),
  };
  const broken = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  const ok = textValue(after.ShortName).trim() === row.newShortName &&
    after.DocumentStatus === "C" && after.ForbidStatus === "A" && broken.length === 0;
  log({ number: row.number, id: row.id, old: row.oldShortName, new: row.newShortName, ok, broken, status: after.DocumentStatus });
  if (!ok) throw new Error(`${row.number}: 审核后回查不符合预期（${broken.join("/") || "状态"}）`);
  console.log(`✔ ${row.number} ${row.oldShortName} → ${row.newShortName}`);
}

if (APPLY) {
  if (!fs.existsSync(PREVIEW_PATH)) throw new Error(`找不到预览文件 ${PREVIEW_PATH}，请先运行不带 --apply 的命令`);
  const preview = JSON.parse(fs.readFileSync(PREVIEW_PATH, "utf8"));
  if (preview.suffix !== SUFFIX || preview.scope !== SCOPE) {
    throw new Error("预览文件与当前 --suffix/--scope 不一致，请重新生成预览");
  }
  let todo = preview.rows;
  if (ONE) todo = todo.filter((r) => r.number === ONE);
  if (!todo.length) throw new Error(`没有可执行的行${ONE ? `（--one ${ONE}）` : ""}`);
  console.log(`本次执行 ${todo.length} 条（总预览 ${preview.rows.length} 条）${ONE ? "，单条样板模式" : ""}`);
  for (const row of todo) {
    try {
      await changeShortName(row);
    } catch (e) {
      log({ number: row.number, id: row.id, error: String(e.message ?? e) });
      console.error(`✘ ${row.number}: ${e.message}`);
      console.error("已停止，未继续扩散。请先按上一条的实际状态核对后再决定是否续跑。");
      process.exit(1);
    }
  }
  console.log("执行完成，请继续用独立查询回查简称与客户状态。");
  process.exit(0);
}

// ---------- 只读预览 ----------
const customers = await fetchCustomers(api);
console.log(`客户总数 ${customers.length}（自检：${customers[0]?.number ?? "无数据"} 起）`);
if (!customers.length) throw new Error("自检失败：客户查询返回 0 行");

const exportSet = await fetchExportSet();
const deptRows = customers.filter((c) => c.deptNumber === EXPORT_DEPT_NUMBER);
console.log(`销售部门=外贸部 ${deptRows.length} 家；出口口径客户 ${exportSet.size} 家（含非外贸部）`);

const scoped = deptRows.filter((c) => {
  const isExport = exportSet.has(c.id);
  if (SCOPE === "dept") return true;
  if (SCOPE === "dept-export") return isExport;
  return !isExport;
});
console.log(`scope=${SCOPE} → 命中 ${scoped.length} 家`);

const allShortNames = new Map(customers.map((c) => [c.id, c.shortName]));
const planned = [];
const skipped = [];
for (const c of scoped) {
  const row = {
    id: c.id, number: c.number, name: c.name,
    dept: c.deptName || c.deptNumber,
    oldShortName: c.shortName,
    newShortName: c.shortName ? `${c.shortName}${SUFFIX}` : "",
    documentStatus: c.documentStatus, forbidStatus: c.forbidStatus,
    isExportScope: exportSet.has(c.id),
  };
  if (c.forbidStatus === "B") { skipped.push({ ...row, reason: "客户已禁用" }); continue; }
  if (c.documentStatus !== "C") { skipped.push({ ...row, reason: `状态 ${c.documentStatus} 非已审核` }); continue; }
  if (!c.shortName) { skipped.push({ ...row, reason: "简称为空，需先确定简称" }); continue; }
  if (c.shortName.endsWith(SUFFIX)) { skipped.push({ ...row, reason: `简称已带 ${SUFFIX}，跳过` }); continue; }
  planned.push(row);
}

// 目标简称占用检查（简称不强制唯一，仅提示）
const owners = new Map();
for (const c of customers) {
  const key = c.shortName;
  if (!owners.has(key)) owners.set(key, []);
  owners.get(key).push(c.number);
}
for (const row of planned) {
  const conflict = (owners.get(row.newShortName) ?? []).filter((n) => n !== row.number);
  row.conflictWith = conflict.join(",");
}

// 逐条 View 预检必填引用（Save 会因必填缺失失败）
const viewProblems = [];
for (const row of planned) {
  try {
    const v = await api.viewBill(FORM_ID, row.id);
    const missing = missingRequired(v);
    if (missing.length) { row.missingRequired = missing.join(","); viewProblems.push(`${row.number}: ${missing.join(",")}`); }
  } catch (e) {
    row.missingRequired = `View 失败: ${e.message}`;
    viewProblems.push(`${row.number}: View 失败 ${e.message}`);
  }
}

const preview = {
  generatedAt: new Date().toISOString(),
  formId: FORM_ID,
  suffix: SUFFIX,
  scope: SCOPE,
  scopeRule: "销售部门=外贸部",
  totalCustomers: customers.length,
  deptCustomers: deptRows.length,
  scopedCount: scoped.length,
  plannedCount: planned.length,
  skippedCount: skipped.length,
  rows: planned,
  skipped,
};
fs.mkdirSync(path.dirname(PREVIEW_PATH), { recursive: true });
fs.writeFileSync(PREVIEW_PATH, JSON.stringify(preview, null, 2), "utf8");

const xlsxRows = [
  ...planned.map((r) => ({ 处理: "本次修改", 客户编码: r.number, 客户名称: r.name, 销售部门: r.dept, 原简称: r.oldShortName, 新简称: r.newShortName, 目标被占用: r.conflictWith || "", 缺少必填: r.missingRequired ?? "", 备注: r.isExportScope ? "出口口径" : "外贸部内销口径" })),
  ...skipped.map((r) => ({ 处理: "跳过", 客户编码: r.number, 客户名称: r.name, 销售部门: r.dept, 原简称: r.oldShortName, 新简称: r.newShortName, 目标被占用: "", 缺少必填: "", 备注: r.reason })),
];
const ws = XLSX.utils.json_to_sheet(xlsxRows);
ws["!cols"] = [10, 12, 40, 12, 20, 22, 16, 16, 18].map((w) => ({ wch: w }));
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "简称加后缀预览");
XLSX.writeFile(wb, XLSX_PATH);

console.log(`\n本次拟修改 ${planned.length} 条，跳过 ${skipped.length} 条`);
const reasons = skipped.reduce((m, r) => ((m[r.reason] = (m[r.reason] ?? 0) + 1), m), {});
console.log("跳过原因:", JSON.stringify(reasons));
console.log(`目标简称被占用（仅提示）: ${planned.filter((r) => r.conflictWith).length} 条`);
if (viewProblems.length) {
  console.log(`\n预检发现必填缺失（这些条 Save 会失败）:\n${viewProblems.slice(0, 20).join("\n")}`);
}
console.log("\n前 15 条示例:");
for (const r of planned.slice(0, 15)) {
  console.log(`${r.number}\t${r.oldShortName} → ${r.newShortName}\t${r.name}\t${r.dept}`);
}
console.log(`\n预览文件: ${PREVIEW_PATH}\n预览表格: ${XLSX_PATH}`);
console.log("dry-run 完成：未修改金蝶数据。确认后可 `--apply --one <编码>` 先做单条样板。");
