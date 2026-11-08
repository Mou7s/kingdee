#!/usr/bin/env bun
/**
 * 客户「简称」前缀互换（例：02 与 03 对调），默认只预览。
 *
 * 只读预览：
 *   bun scripts/tools/swap_customer_shortname_prefix.js --a 02 --b 03
 * 执行：
 *   bun scripts/tools/swap_customer_shortname_prefix.js --a 02 --b 03 --apply --one <客户编码>
 *   bun scripts/tools/swap_customer_shortname_prefix.js --a 02 --b 03 --apply
 *
 * 互换必须借道临时前缀，分两段（每段都是一次独立的改名流程）：
 *   A 组（--a 开头）: --a → --temp → --b
 *   B 组（--b 开头）: --b → --a
 * 只替换开头两位，其余（等级字母/城市码/名称码/-W/空格）原样保留。
 *
 * 写入走金蝶标准客户 Save 流程（C：反审核 → Save → 提交 → 审核 → 独立 View 回查），不用 SQL。
 * 断点续跑：按每条当前简称判定所处阶段（原始值/临时值/最终值），失败即停并写日志。
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
const A = argValue("--a");
const B = argValue("--b");
const TEMP = argValue("--temp", "00");
if (!/^[0-9]{2}$/.test(A ?? "") || !/^[0-9]{2}$/.test(B ?? "") || !/^[0-9]{2}$/.test(TEMP)) {
  throw new Error("必须传两位数字：--a 02 --b 03 [--temp 00]");
}
if (A === B || [A, B].includes(TEMP)) throw new Error("--a/--b/--temp 不能相同");
// 账套有保存校验「客户简称必须以 0 开头」：临时前缀也必须 0 开头，否则 Save 直接被拒（99 实测被拦）
if (!TEMP.startsWith("0")) throw new Error(`--temp ${TEMP} 不是 0 开头；账套校验要求客户简称必须以 0 开头，请改用 00/06/07/08/09 这类空闲前缀`);

const TAG = `customer_shortname_swap_${A}_${B}`;
const PREVIEW_PATH = path.resolve(`output/${TAG}_preview.json`);
const XLSX_PATH = path.resolve(`output/${TAG}_preview.xlsx`);
const LOG_PATH = path.resolve(`output/${TAG}_log.json`);

const refNumber = (ref) => ref?.Number ?? ref?.FNumber ?? "";
function textValue(value) {
  if (Array.isArray(value)) return value.find((i) => i.Key === 2052)?.Value ?? value[0]?.Value ?? "";
  return String(value ?? "");
}
function requiredRefsFromView(detail) {
  return {
    FCreateOrgId: detail.CreateOrgId, FUseOrgId: detail.UseOrgId, FGroup: detail.FGroup,
    FSALDEPTID: detail.SALDEPTID, FSALGROUPID: detail.SALGROUPID, FSELLER: detail.SELLER,
    FRECCONDITIONID: detail.RECCONDITIONID, FSETTLETYPEID: detail.SETTLETYPEID,
  };
}
function missingRequired(detail) {
  const missing = Object.entries(requiredRefsFromView(detail)).filter(([, ref]) => !refNumber(ref)).map(([k]) => k);
  if (!textValue(detail.Name).trim()) missing.push("FName");
  if (!textValue(detail.ShortName).trim()) missing.push("FShortName");
  return missing;
}
function buildCustomerModel(detail, newShortName) {
  const model = { FCUSTID: detail.Id, FNumber: String(detail.Number), FName: textValue(detail.Name), FShortName: newShortName };
  for (const [k, ref] of Object.entries(requiredRefsFromView(detail))) model[k] = { FNumber: refNumber(ref) };
  for (const [k, ref] of [["FTRADINGCURRID", detail.TRADINGCURRID], ["FTaxRate", detail.TaxRate], ["FTaxType", detail.TaxType], ["FCustTypeId", detail.CustTypeId]]) {
    const n = refNumber(ref);
    if (n) model[k] = { FNumber: n };
  }
  return model;
}
async function fetchCustomers(api) {
  const rows = await api.executeBillQuery(FORM_ID,
    "FCUSTID,FNumber,FName,FShortName,FDocumentStatus,FForbidStatus,FSALDEPTID.FName,FSeller.FName", "", 20000);
  return rows.map((r) => ({
    id: String(r[0]), number: String(r[1] ?? "").trim(), name: String(r[2] ?? "").trim(),
    shortName: String(r[3] ?? "").trim(), documentStatus: String(r[4] ?? ""),
    forbidStatus: String(r[5] ?? ""), deptName: String(r[6] ?? "").trim(), seller: String(r[7] ?? "").trim(),
  }));
}
function log(entry) {
  const all = fs.existsSync(LOG_PATH) ? JSON.parse(fs.readFileSync(LOG_PATH, "utf8")) : [];
  all.push({ at: new Date().toISOString(), ...entry });
  fs.writeFileSync(LOG_PATH, JSON.stringify(all, null, 2), "utf8");
}

const api = new K3CloudWebAPI();
await api.login();

/** 把一条简称写到目标值，走标准流程并回查 */
async function applyShortName(row, target) {
  const before = await api.viewBill(FORM_ID, row.id);
  const current = textValue(before.ShortName).trim();
  if (current === target && before.DocumentStatus === "C" && before.ForbidStatus === "A") {
    console.log(`· ${row.number} 已是 ${target}，跳过`);
    return;
  }
  if (current !== row.expectedCurrent) {
    throw new Error(`${row.number}: 当前简称「${current}」与预期「${row.expectedCurrent}」不一致，停止`);
  }
  if (before.ForbidStatus === "B") throw new Error(`${row.number}: 客户已禁用，未处理`);
  const preMissing = missingRequired(before);
  if (preMissing.length && before.DocumentStatus === "C") throw new Error(`${row.number}: 缺少必填值 ${preMissing.join(", ")}`);
  if (before.DocumentStatus === "C") await api.unAuditBill(FORM_ID, row.id);
  const editable = await api.viewBill(FORM_ID, row.id);
  const missing = missingRequired(editable);
  if (missing.length) throw new Error(`${row.number}: 反审核后缺少必填值 ${missing.join(", ")}`);
  if (String(editable.Number) !== row.number) throw new Error(`${row.number}: 反审核后编码变化为 ${editable.Number}`);
  await api.saveBill(FORM_ID, buildCustomerModel(editable, target), null,
    ["FCUSTID", "FNumber", "FName", "FShortName", "FDocumentStatus", "FForbidStatus"]);
  const afterSave = await api.viewBill(FORM_ID, row.id);
  if (textValue(afterSave.ShortName).trim() !== target) {
    throw new Error(`${row.number}: Save 后简称仍是「${textValue(afterSave.ShortName).trim()}」`);
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
  const ok = textValue(after.ShortName).trim() === target && after.DocumentStatus === "C" && after.ForbidStatus === "A" && !broken.length;
  log({ number: row.number, id: row.id, expected: row.expectedCurrent, to: target, ok, broken, status: after.DocumentStatus });
  if (!ok) throw new Error(`${row.number}: 审核后回查不符合预期（${broken.join("/") || "状态"}）`);
  console.log(`✔ ${row.number} ${row.expectedCurrent} → ${target}`);
}

if (APPLY) {
  if (!fs.existsSync(PREVIEW_PATH)) throw new Error(`找不到预览文件 ${PREVIEW_PATH}，请先运行不带 --apply 的命令`);
  const preview = JSON.parse(fs.readFileSync(PREVIEW_PATH, "utf8"));
  if (preview.a !== A || preview.b !== B || preview.temp !== TEMP) throw new Error("预览文件与当前 --a/--b/--temp 不一致，请重新生成");

  // 临时前缀必须是干净的（预检时已确认），避免误改无关客户
  const live = await fetchCustomers(api);
  const foreign = live.filter((c) => c.shortName.startsWith(TEMP) && !preview.rows.some((r) => r.number === c.number));
  if (foreign.length) throw new Error(`有 ${foreign.length} 家非本次范围的客户简称以 ${TEMP} 开头，会误伤，请换 --temp`);

  let todo = preview.rows;
  if (ONE) todo = todo.filter((r) => r.number === ONE);
  if (!todo.length) throw new Error(`没有可执行的行${ONE ? `（--one ${ONE}）` : ""}`);
  console.log(`本次执行 ${todo.length} 条（总预览 ${preview.rows.length} 条，A 组 ${preview.aCount} / B 组 ${preview.bCount}）${ONE ? "，单条模式" : ""}`);

  let done = 0, skipped = 0;
  // 两趟：第 1 趟 A 组 原始→临时、B 组 原始→最终；第 2 趟 临时→最终（已是最终值的直接跳过）
  for (const pass of [1, 2]) {
    console.log(`—— 第 ${pass} 趟 ——`);
    for (const row of todo) {
      try {
        // 按当前简称实时判定所处阶段：原始 → 临时 → 最终（B 组：原始 → 最终）
        const cur = await api.viewBill(FORM_ID, row.id);
        const current = textValue(cur.ShortName).trim();
        let expectedCurrent, target;
        if (current === row.finalShortName) { skipped++; continue; }
        if (current === row.oldShortName) {
          expectedCurrent = row.oldShortName;
          target = row.viaTemp ? row.tempShortName : row.finalShortName;
        } else if (row.viaTemp && current === row.tempShortName) {
          expectedCurrent = row.tempShortName;
          target = row.finalShortName;
        } else {
          throw new Error(`${row.number}: 当前简称「${current}」不属于本次调换的任何阶段，停止`);
        }
        await applyShortName({ ...row, expectedCurrent }, target);
        done++;
      } catch (e) {
        log({ number: row.number, id: row.id, error: String(e.message ?? e) });
        console.error(`✘ ${row.number}: ${e.message}`);
        console.error("已停止，未继续扩散。请先核对上一条实际状态再决定是否续跑。");
        process.exit(1);
      }
    }
  }
  console.log(`执行完成：处理 ${done} 条，已是目标值跳过 ${skipped} 条。请继续用独立查询回查。`);
  process.exit(0);
}

// ---------- 只读预览 ----------
const customers = await fetchCustomers(api);
console.log(`客户总数 ${customers.length}（自检首行：${customers[0]?.number ?? "无数据"}）`);
if (!customers.length) throw new Error("自检失败：客户查询返回 0 行");

const aRows = customers.filter((c) => c.shortName.startsWith(A));
const bRows = customers.filter((c) => c.shortName.startsWith(B));
console.log(`简称 ${A} 开头 ${aRows.length} 家；${B} 开头 ${bRows.length} 家`);

const tempOccupied = customers.filter((c) => c.shortName.startsWith(TEMP));
console.log(`临时前缀 ${TEMP} 当前占用：${tempOccupied.length} 家${tempOccupied.length ? "（非 0，需换 --temp）" : ""}`);

const owners = new Map();
for (const c of customers) {
  if (!owners.has(c.shortName)) owners.set(c.shortName, []);
  owners.get(c.shortName).push(c.number);
}

const planned = [], skippedRows = [];
for (const [group, list] of [[A, aRows], [B, bRows]]) {
  for (const c of list) {
    const finalShortName = `${group === A ? B : A}${c.shortName.slice(2)}`;
    const row = {
      id: c.id, number: c.number, name: c.name, dept: c.deptName, seller: c.seller,
      group: group === A ? `A(${A}→${B})` : `B(${B}→${A})`,
      oldShortName: c.shortName, viaTemp: group === A,
      tempShortName: group === A ? `${TEMP}${c.shortName.slice(2)}` : "",
      finalShortName, documentStatus: c.documentStatus, forbidStatus: c.forbidStatus,
    };
    if (c.forbidStatus === "B") { skippedRows.push({ ...row, reason: "客户已禁用" }); continue; }
    // C 已审核；D 重新审核（上一次中途失败留下）也允许——Save → 提交 → 审核 即可回到 C
    if (c.documentStatus !== "C" && c.documentStatus !== "D") { skippedRows.push({ ...row, reason: `状态 ${c.documentStatus} 非已审核/重新审核` }); continue; }
    row.conflictWith = (owners.get(finalShortName) ?? []).filter((n) => n !== row.number).join(",");
    planned.push(row);
  }
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
  generatedAt: new Date().toISOString(), formId: FORM_ID, a: A, b: B, temp: TEMP,
  rule: `${A} ↔ ${B}（A 组经临时前缀 ${TEMP} 中转），仅换前两位，其余原样`,
  totalCustomers: customers.length, aCount: aRows.length, bCount: bRows.length,
  plannedCount: planned.length, skippedCount: skippedRows.length, tempOccupied: tempOccupied.length,
  rows: planned, skipped: skippedRows,
};
fs.mkdirSync(path.dirname(PREVIEW_PATH), { recursive: true });
fs.writeFileSync(PREVIEW_PATH, JSON.stringify(preview, null, 2), "utf8");

const xlsxRows = [
  ...planned.map((r) => ({ 处理: "本次修改", 组: r.group, 客户编码: r.number, 客户名称: r.name, 销售部门: r.dept, 销售员: r.seller, 原简称: r.oldShortName, 中转简称: r.tempShortName, 最终简称: r.finalShortName, 最终简称已被占用: r.conflictWith || "", 缺少必填: r.missingRequired ?? "" })),
  ...skippedRows.map((r) => ({ 处理: "跳过", 组: r.group, 客户编码: r.number, 客户名称: r.name, 销售部门: r.dept, 销售员: r.seller, 原简称: r.oldShortName, 中转简称: r.tempShortName, 最终简称: r.finalShortName, 最终简称已被占用: "", 缺少必填: "", 备注: r.reason })),
];
const ws = XLSX.utils.json_to_sheet(xlsxRows);
ws["!cols"] = [10, 14, 12, 40, 12, 12, 22, 24, 26, 20, 16, 16].map((w) => ({ wch: w }));
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "简称前缀调换预览");
XLSX.writeFile(wb, XLSX_PATH);

const reasons = skippedRows.reduce((m, r) => ((m[r.reason] = (m[r.reason] ?? 0) + 1), m), {});
console.log(`\n拟处理 ${planned.length} 条（A组 ${planned.filter((r) => r.viaTemp).length} / B组 ${planned.filter((r) => !r.viaTemp).length}），跳过 ${skippedRows.length} 条 ${JSON.stringify(reasons)}`);
console.log(`最终简称已被其他客户占用（仅提示）: ${planned.filter((r) => r.conflictWith).length} 条`);
if (viewProblems.length) console.log(`预检必填缺失 ${viewProblems.length} 条：\n${viewProblems.slice(0, 20).join("\n")}`);
console.log("\n前 8 条示例:");
for (const r of planned.slice(0, 8)) console.log(`${r.number}\t${r.oldShortName}${r.viaTemp ? ` →(中转 ${r.tempShortName})` : ""} → ${r.finalShortName}\t${r.name}`);
console.log(`\n预览文件: ${PREVIEW_PATH}\n预览表格: ${XLSX_PATH}`);
console.log("dry-run 完成：未修改金蝶数据。");
