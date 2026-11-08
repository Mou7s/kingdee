#!/usr/bin/env bun
/**
 * 客户「简称」前缀批量替换（例：把 05 开头的简称并到 03），默认只预览。
 *
 * 只读预览：
 *   bun scripts/tools/rename_customer_shortname_prefix.js --from 05 --to 03
 * 执行（先单条样板，再批量；必须显式 --apply，且预览文件必须已由只读模式生成）：
 *   bun scripts/tools/rename_customer_shortname_prefix.js --from 05 --to 03 --apply --one <客户编码>
 *   bun scripts/tools/rename_customer_shortname_prefix.js --from 05 --to 03 --apply
 *
 * 规则：仅替换简称**开头**的 --from 两个字符为 --to，其余部分（等级字母/城市码/名称码/-W）原样保留。
 * 写入走金蝶标准客户 Save 流程（C：反审核 → Save → 提交 → 审核 → 独立 View 回查），
 * 不用 SQL 写入；逐条守卫旧简称与状态，任一条失败立即停止并写日志。
 */
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { K3CloudWebAPI } from "../../lib/k3/index.js";

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
const FROM = argValue("--from");
const TO = argValue("--to");
const PREVIEW_PATH = path.resolve(`output/customer_shortname_prefix_${FROM}_to_${TO}_preview.json`);
const XLSX_PATH = path.resolve(`output/customer_shortname_prefix_${FROM}_to_${TO}_preview.xlsx`);
const LOG_PATH = path.resolve(`output/customer_shortname_prefix_${FROM}_to_${TO}_log.json`);

if (!/^[0-9０-９]{2}$/.test(FROM ?? "") || !/^[0-9０-９]{2}$/.test(TO ?? "")) {
  throw new Error("必须传两位数字：--from 05 --to 03");
}

function refNumber(ref) {
  return ref?.Number ?? ref?.FNumber ?? "";
}
function textValue(value) {
  if (Array.isArray(value)) return value.find((i) => i.Key === 2052)?.Value ?? value[0]?.Value ?? "";
  return String(value ?? "");
}
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
  const model = {
    FCUSTID: detail.Id,
    FNumber: String(detail.Number),
    FName: textValue(detail.Name),
    FShortName: newShortName,
  };
  for (const [key, ref] of Object.entries(requiredRefsFromView(detail))) model[key] = { FNumber: refNumber(ref) };
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

async function fetchCustomers(api) {
  const rows = await api.executeBillQuery(
    FORM_ID,
    "FCUSTID,FNumber,FName,FShortName,FDocumentStatus,FForbidStatus,FSALDEPTID.FName,FSeller.FName",
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
    deptName: String(r[6] ?? "").trim(),
    seller: String(r[7] ?? "").trim(),
  }));
}

function log(entry) {
  const all = fs.existsSync(LOG_PATH) ? JSON.parse(fs.readFileSync(LOG_PATH, "utf8")) : [];
  all.push({ at: new Date().toISOString(), ...entry });
  fs.writeFileSync(LOG_PATH, JSON.stringify(all, null, 2), "utf8");
}

const api = new K3CloudWebAPI();
await api.login();

async function changeShortName(row) {
  const before = await api.viewBill(FORM_ID, row.id);
  const currentShort = textValue(before.ShortName).trim();
  if (currentShort === row.newShortName && before.DocumentStatus === "C" && before.ForbidStatus === "A") {
    console.log(`· ${row.number} 已是 ${row.newShortName}，跳过（断点续跑）`);
    return;
  }
  if (currentShort !== row.oldShortName) {
    throw new Error(`${row.number}: 当前简称「${currentShort}」与预览「${row.oldShortName}」不一致，停止`);
  }
  if (before.ForbidStatus === "B") throw new Error(`${row.number}: 客户已禁用，未处理`);
  const preMissing = missingRequired(before);
  if (preMissing.length && before.DocumentStatus === "C") {
    throw new Error(`${row.number}: 缺少必填值 ${preMissing.join(", ")}，Save 会失败，需人工确认`);
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
    客户编码: String(after.Number) === String(editable.Number),
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
  if (preview.from !== FROM || preview.to !== TO) throw new Error("预览文件与当前 --from/--to 不一致，请重新生成预览");
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
      console.error("已停止，未继续扩散。请先核对上一条的实际状态再决定是否续跑。");
      process.exit(1);
    }
  }
  console.log("执行完成，请继续用独立查询回查简称与客户状态。");
  process.exit(0);
}

// ---------- 只读预览 ----------
const customers = await fetchCustomers(api);
console.log(`客户总数 ${customers.length}（自检首行：${customers[0]?.number ?? "无数据"}）`);
if (!customers.length) throw new Error("自检失败：客户查询返回 0 行");

const scoped = customers.filter((c) => c.shortName.startsWith(FROM));
console.log(`简称以 ${FROM} 开头：${scoped.length} 家`);

const owners = new Map();
for (const c of customers) {
  if (!owners.has(c.shortName)) owners.set(c.shortName, []);
  owners.get(c.shortName).push(c.number);
}

const planned = [];
const skipped = [];
for (const c of scoped) {
  const row = {
    id: c.id, number: c.number, name: c.name, dept: c.deptName, seller: c.seller,
    oldShortName: c.shortName, newShortName: `${TO}${c.shortName.slice(FROM.length)}`,
    documentStatus: c.documentStatus, forbidStatus: c.forbidStatus,
  };
  if (c.forbidStatus === "B") { skipped.push({ ...row, reason: "客户已禁用" }); continue; }
  if (c.documentStatus !== "C") { skipped.push({ ...row, reason: `状态 ${c.documentStatus} 非已审核` }); continue; }
  row.conflictWith = (owners.get(row.newShortName) ?? []).filter((n) => n !== row.number).join(",");
  planned.push(row);
}

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
  generatedAt: new Date().toISOString(), formId: FORM_ID, from: FROM, to: TO,
  rule: `简称开头 ${FROM} → ${TO}，其余原样保留`,
  totalCustomers: customers.length, scopedCount: scoped.length,
  plannedCount: planned.length, skippedCount: skipped.length,
  rows: planned, skipped,
};
fs.mkdirSync(path.dirname(PREVIEW_PATH), { recursive: true });
fs.writeFileSync(PREVIEW_PATH, JSON.stringify(preview, null, 2), "utf8");

const xlsxRows = [
  ...planned.map((r) => ({ 处理: "本次修改", 客户编码: r.number, 客户名称: r.name, 销售部门: r.dept, 销售员: r.seller, 原简称: r.oldShortName, 新简称: r.newShortName, 目标简称已被占用: r.conflictWith || "", 缺少必填: r.missingRequired ?? "" })),
  ...skipped.map((r) => ({ 处理: "跳过", 客户编码: r.number, 客户名称: r.name, 销售部门: r.dept, 销售员: r.seller, 原简称: r.oldShortName, 新简称: r.newShortName, 目标简称已被占用: "", 缺少必填: "", 备注: r.reason })),
];
const ws = XLSX.utils.json_to_sheet(xlsxRows);
ws["!cols"] = [10, 12, 40, 12, 12, 22, 24, 20, 16, 16].map((w) => ({ wch: w }));
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "简称前缀替换预览");
XLSX.writeFile(wb, XLSX_PATH);

const reasons = skipped.reduce((m, r) => ((m[r.reason] = (m[r.reason] ?? 0) + 1), m), {});
console.log(`\n本次拟修改 ${planned.length} 条，跳过 ${skipped.length} 条 ${JSON.stringify(reasons)}`);
console.log(`目标简称已被其他客户占用（仅提示，简称不强制唯一）: ${planned.filter((r) => r.conflictWith).length} 条`);
if (viewProblems.length) console.log(`预检必填缺失 ${viewProblems.length} 条：\n${viewProblems.slice(0, 20).join("\n")}`);
console.log("\n前 15 条示例:");
for (const r of planned.slice(0, 15)) console.log(`${r.number}\t${r.oldShortName} → ${r.newShortName}\t${r.name}\t${r.dept}`);
console.log(`\n预览文件: ${PREVIEW_PATH}\n预览表格: ${XLSX_PATH}`);
console.log("dry-run 完成：未修改金蝶数据。确认后可 `--apply --one <编码>` 先做单条样板。");
