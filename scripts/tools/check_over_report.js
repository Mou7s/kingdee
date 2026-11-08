#!/usr/bin/env bun
/**
 * 工序汇报「合格数量合计 ≤ 工序数量 × 比例」只读预检 / 清单工具
 *
 * 用途：在二开插件上线前，用与插件完全相同的口径算出「哪些工序会被拦」，
 *       也可作为上线后的日常超报清单（每天/每周跑一次）。
 *
 * 口径（已实测验证）：
 *   工序数量  Q = T_SFC_OPERPLANNINGDETAIL.FOPERQTY  (FDETAILID = 汇报分录 FOptPlanOptId)
 *   已报合计  S = Σ T_SFC_OPTRPTENTRY_A.FQUAQTY      (状态 B/C，未作废，可含草稿 A)
 *   超限判定  S > Q × ratio
 *
 * 只读：不做任何写操作。
 *
 * 用法：
 *   bun scripts/tools/check_over_report.js                       # 近 90 天，比例 1.9
 *   bun scripts/tools/check_over_report.js --ratio 1.5 --days 30
 *   bun scripts/tools/check_over_report.js --plan TX0900134      # 只看某张工序计划
 *   bun scripts/tools/check_over_report.js --top 100 --out output/over_report.json
 */

import mssql from "mssql";
import { K3_DB_HOST, K3_DB_USER, K3_DB_PASS, K3_DB_NAME } from "../../k3cloud.js";
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

const ratio = Number(arg("ratio", "1.9"));
const days = Number(arg("days", "90"));
const top = Number(arg("top", "50"));
const plan = arg("plan", null);
const outPath = arg("out", "output/over_report.json");
const includeDraft = !hasFlag("exclude-draft");

const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

const config = {
  user: K3_DB_USER,
  password: K3_DB_PASS,
  server: K3_DB_HOST,
  database: K3_DB_NAME,
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 600000,
  connectionTimeout: 60000,
};

await mssql.connect(config);

const statusFilter = includeDraft ? "IN ('A','B','C')" : "IN ('B','C')";

const sql = `
  SELECT
    e.FOPTPLANNO                    AS PlanNo,
    e.FOPERNUMBER                   AS OperNumber,
    pl.FNAME                        AS OperName,
    dp.FNAME                        AS DeptName,
    MAX(d.FOPERQTY)                 AS OperQty,
    SUM(a.FQUAQTY)                  AS SumAll,
    SUM(CASE WHEN h.FDOCUMENTSTATUS IN ('B','C') THEN a.FQUAQTY ELSE 0 END) AS SumBC,
    COUNT(DISTINCT h.FID)           AS BillCount,
    MIN(h.FDATE)                    AS FirstDate,
    MAX(h.FDATE)                    AS LastDate,
    COUNT(*)                        AS EntryCount
  FROM T_SFC_OPTRPTENTRY e
  JOIN T_SFC_OPTRPT h            ON h.FID = e.FID
  JOIN T_SFC_OPTRPTENTRY_A a     ON a.FENTRYID = e.FENTRYID
  JOIN T_SFC_OPERPLANNINGDETAIL d ON d.FDETAILID = e.FOPTPLANOPTID
  LEFT JOIN T_ENG_PROCESS p       ON p.FID = d.FPROCESSID
  LEFT JOIN T_ENG_PROCESS_L pl    ON pl.FID = p.FID AND pl.FLOCALEID = 2052
  LEFT JOIN T_BD_DEPARTMENT_L dp  ON dp.FDEPTID = d.FDEPARTMENTID AND dp.FLOCALEID = 2052
  WHERE h.FDATE >= '${from}'
    AND ISNULL(h.FCANCELSTATUS,'A') <> 'B'
    AND h.FDOCUMENTSTATUS ${statusFilter}
    AND d.FOPERQTY > 0
    ${plan ? `AND e.FOPTPLANNO = '${plan.replace(/'/g, "''")}'` : ""}
  GROUP BY e.FOPTPLANNO, e.FOPERNUMBER, e.FOPTPLANOPTID, pl.FNAME, dp.FNAME, d.FOPERQTY
  HAVING SUM(a.FQUAQTY) > d.FOPERQTY * ${ratio}
  ORDER BY SUM(a.FQUAQTY) / d.FOPERQTY DESC`;

const res = await mssql.query(sql);
const rows = res.recordset.map((r) => ({
  ...r,
  Ratio: Number((Number(r.SumAll) / Number(r.OperQty)).toFixed(4)),
  RatioBC: Number((Number(r.SumBC) / Number(r.OperQty)).toFixed(4)),
}));

// 汇总：全部工序数 + 超限数（按同一时间窗）
const totalRes = await mssql.query(`
  SELECT COUNT(*) AS c FROM (
    SELECT e.FOPTPLANOPTID
    FROM T_SFC_OPTRPTENTRY e
    JOIN T_SFC_OPTRPT h ON h.FID = e.FID
    JOIN T_SFC_OPTRPTENTRY_A a ON a.FENTRYID = e.FENTRYID
    JOIN T_SFC_OPERPLANNINGDETAIL d ON d.FDETAILID = e.FOPTPLANOPTID
    WHERE h.FDATE >= '${from}' AND ISNULL(h.FCANCELSTATUS,'A') <> 'B'
      AND h.FDOCUMENTSTATUS ${statusFilter} AND d.FOPERQTY > 0
    GROUP BY e.FOPTPLANOPTID
  ) t`);

// 超限工序的汇报单号明细（一次性批量取，按计划号分片）
const details = [];
{
  const plans = [...new Set(rows.map((r) => r.PlanNo))];
  const billRows = [];
  for (let i = 0; i < plans.length; i += 300) {
    const chunk = plans.slice(i, i + 300).map((p) => `'${p.replace(/'/g, "''")}'`).join(",");
    const d = await mssql.query(`
      SELECT e.FOPTPLANNO AS PlanNo, e.FOPERNUMBER AS OperNumber, h.FBILLNO AS BillNo,
             h.FDOCUMENTSTATUS AS Status, h.FDATE AS BillDate, a.FQUAQTY AS QuaQty
      FROM T_SFC_OPTRPTENTRY e
      JOIN T_SFC_OPTRPT h ON h.FID = e.FID
      JOIN T_SFC_OPTRPTENTRY_A a ON a.FENTRYID = e.FENTRYID
      WHERE e.FOPTPLANNO IN (${chunk})
        AND ISNULL(h.FCANCELSTATUS,'A') <> 'B'
        AND h.FDOCUMENTSTATUS ${statusFilter}
      ORDER BY e.FOPTPLANNO, e.FOPERNUMBER, h.FDATE`);
    billRows.push(...d.recordset);
  }
  const map = new Map();
  for (const b of billRows) {
    const key = `${b.PlanNo}|${b.OperNumber}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(b);
  }
  for (const r of rows) {
    const bills = map.get(`${r.PlanNo}|${r.OperNumber}`) ?? [];
    r.Bills = bills.map((b) => `${b.BillNo}(${b.Status},${b.QuaQty})`).join(" ");
    details.push({ PlanNo: r.PlanNo, OperNumber: r.OperNumber, Bills: bills });
  }
}

await mssql.close();

const summary = {
  生成时间: new Date().toISOString(),
  统计区间: `${from} ~ 今天`,
  比例阈值: ratio,
  计入草稿: includeDraft,
  区间内有汇报的工序数: totalRes.recordset[0].c,
  超限工序数: rows.length,
  超限占比: totalRes.recordset[0].c
    ? Number(((rows.length / totalRes.recordset[0].c) * 100).toFixed(2)) + "%"
    : "0%",
};

console.log("========== 工序汇报超报预检 ==========");
for (const [k, v] of Object.entries(summary)) console.log(`${k}: ${v}`);
console.log("\n--- 超限工序（按倍数降序，前 50） ---");
console.log(
  ["计划号", "工序", "工序名称", "车间", "工序数量", "已报合计", "倍数", "单数"].join("\t")
);
for (const r of rows.slice(0, 50)) {
  console.log(
    [r.PlanNo, r.OperNumber, r.OperName ?? "", r.DeptName ?? "", r.OperQty, r.SumAll, r.Ratio, r.BillCount].join("\t")
  );
}

const payload = { summary, rows, details };
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
console.log(`\n明细已写入 ${outPath}（共 ${rows.length} 条超限工序）`);
