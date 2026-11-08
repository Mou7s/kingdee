#!/usr/bin/env bun
/**
 * 员工列表查询（只读）
 *
 * 数据来源：
 *   - 身份字段：WebAPI 表单 `BD_Empinfo`（员工）
 *   - 部门/职位：数据库只读关联 `T_BD_STAFF`（任职）
 *       `T_BD_STAFF.FDEPTID` → `T_BD_DEPARTMENT_L.FNAME`
 *       `T_BD_STAFF.FPOSTID` → `T_ORG_POST_L.FNAME`
 *     （`BD_Empinfo` 本身没有部门/职位名称字段；它们挂在任职上，经 `FStaffId` 关联）
 *
 * Usage:
 *   bun scripts/tools/list_employees.js
 *   bun scripts/tools/list_employees.js --active
 *   bun scripts/tools/list_employees.js --dept=总经办
 *   bun scripts/tools/list_employees.js --csv=output/employees.csv
 */
import {
  K3CloudWebAPI,
  FORMS,
  DOC_STATUS_SHORT,
  statusLabel,
  K3_DB_HOST,
  K3_DB_USER,
  K3_DB_PASS,
  K3_DB_NAME,
} from "../../lib/k3/index.js";
import sql from "mssql";

const args = process.argv.slice(2);
const opt = (name) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : true;
};

const deptFilter = typeof opt("dept") === "string" ? opt("dept") : null;
const activeOnly = opt("active") === true;
const csvPath = typeof opt("csv") === "string" ? opt("csv") : null;
const top = Number(opt("top")) > 0 ? Number(opt("top")) : 1000;

// A=正常 / B=禁用 是 K3 基础资料 FForbidStatus 的标准取值
const FORBID = { A: "正常", B: "禁用" };
const forbidLabel = (v) => FORBID[v] || v || "-";

const api = new K3CloudWebAPI();
await api.login();

const FIELDS = "FID,FNumber,FName,FStaffId,FForbidStatus,FDocumentStatus";
const rows = await api.executeBillQuery(
  FORMS.EMPLOYEE,
  FIELDS,
  activeOnly ? "FForbidStatus='A'" : "",
  top
);

// 关联部门/职位（库不可达时降级为“-”，不影响列表）
const staffInfo = new Map(); // FStaffID -> { dept, post }
try {
  const pool = await sql.connect({
    server: K3_DB_HOST,
    user: K3_DB_USER,
    password: K3_DB_PASS,
    database: K3_DB_NAME,
    options: { encrypt: false, trustServerCertificate: true },
    connectionTimeout: 8000,
    requestTimeout: 20000,
  });
  const ids = [...new Set(rows.map((r) => r[3]).filter((v) => v && v !== 0))];
  if (ids.length) {
    const req = pool.request();
    const placeholders = ids.map((id, i) => {
      req.input(`id${i}`, sql.Int, id);
      return `@id${i}`;
    });
    const res = await req.query(`
      SELECT s.FSTAFFID, d.FNAME AS FDEPTNAME, p.FNAME AS FPOSTNAME
      FROM T_BD_STAFF s
      LEFT JOIN T_BD_DEPARTMENT_L d ON d.FDEPTID = s.FDEPTID AND d.FLOCALEID = 2052
      LEFT JOIN T_ORG_POST_L p ON p.FPOSTID = s.FPOSTID AND p.FLOCALEID = 2052
      WHERE s.FSTAFFID IN (${placeholders.join(",")})`);
    for (const r of res.recordset) {
      staffInfo.set(Number(r.FSTAFFID), { dept: r.FDEPTNAME || "", post: r.FPOSTNAME || "" });
    }
  }
  await pool.close();
} catch (e) {
  console.error(`(提示) 部门/职位关联失败，已降级：${e.code || e.message}`);
}

let data = rows.map((r) => ({
  fid: r[0],
  number: r[1],
  name: r[2],
  staffId: r[3],
  forbid: r[4],
  docStatus: r[5],
  dept: staffInfo.get(Number(r[3]))?.dept || "",
  post: staffInfo.get(Number(r[3]))?.post || "",
}));

if (deptFilter) {
  const kw = deptFilter;
  data = data.filter((d) => d.dept.includes(kw));
}

data.sort((a, b) => String(a.number).localeCompare(String(b.number), "zh-CN"));

// 汇总
const byDept = new Map();
for (const d of data) byDept.set(d.dept || "(无部门)", (byDept.get(d.dept || "(无部门)") || 0) + 1);
const disabled = data.filter((d) => d.forbid === "B").length;

console.log(`员工总数: ${data.length}  禁用: ${disabled}  正常: ${data.length - disabled}`);
if (deptFilter) console.log(`部门筛选: 名称含 "${deptFilter}"`);
console.log("\n按部门统计:");
for (const [dept, n] of [...byDept.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${dept}`);
}

console.log("\n| 编码 | 姓名 | 部门 | 职位 | 状态 |");
console.log("| --- | --- | --- | --- | --- |");
for (const d of data) {
  console.log(`| ${d.number} | ${d.name} | ${d.dept || "-"} | ${d.post || "-"} | ${forbidLabel(d.forbid)} |`);
}

if (csvPath) {
  const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const lines = ["编码,姓名,部门,职位,禁用状态,数据状态,FID"];
  for (const d of data) {
    lines.push([d.number, d.name, d.dept, d.post, forbidLabel(d.forbid), statusLabel(d.docStatus, DOC_STATUS_SHORT), d.fid].map(esc).join(","));
  }
  await Bun.write(csvPath, "\uFEFF" + lines.join("\r\n"));
  console.log(`\n已导出 CSV: ${csvPath}`);
}
