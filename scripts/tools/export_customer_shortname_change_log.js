#!/usr/bin/env bun
/**
 * 汇总客户简称改名记录（只读），输出可复核的修改记录 xlsx。
 * 用法: bun scripts/tools/export_customer_shortname_change_log.js
 * 输出: output/客户简称修改记录_YYYYMMDD.xlsx
 */
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { K3CloudWebAPI } from "../../lib/k3/index.js";

const SOURCES = [
  { file: "output/customer_shortname_prefix_05_to_03_log.json", 操作: "并组 05→03", 组: "并组" },
  { file: "output/customer_shortname_swap_02_03_log.json", 操作: "对调 02↔03", 组: "对调" },
];

const api = new K3CloudWebAPI();
await api.login();
const t = (v) => (v == null ? "" : String(v).trim());
/** ISO(UTC) → 北京时间 yyyy-MM-dd HH:mm:ss */
function toCst(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
}
const rows = await api.executeBillQuery(
  "BD_CUSTOMER",
  "FCUSTID,FNumber,FName,FShortName,FDocumentStatus,FForbidStatus,FSALDEPTID.FName,FSeller.FName",
  "", 20000,
);
const live = new Map(rows.map((r) => [t(r[1]), {
  id: r[0], name: t(r[2]), short: t(r[3]), status: t(r[4]), forbid: t(r[5]), dept: t(r[6]), seller: t(r[7]),
}]));

const ops = [];
const previewCache = new Map();
function previewRow(number, file) {
  if (!previewCache.has(file)) {
    previewCache.set(file, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).rows ?? [] : []);
  }
  return previewCache.get(file).find((r) => r.number === number);
}
const SOURCE_PREVIEW = {
  "并组 05→03": "output/customer_shortname_prefix_05_to_03_preview.json",
  "对调 02↔03": "output/customer_shortname_swap_02_03_preview.json",
};
for (const src of SOURCES) {
  if (!fs.existsSync(src.file)) { console.log(`跳过（不存在）: ${src.file}`); continue; }
  const log = JSON.parse(fs.readFileSync(src.file, "utf8"));
  for (const e of log) {
    let oldShort = e.old ?? e.expected ?? "";
    let newShort = e.new ?? e.to ?? "";
    let 备注 = "";
    if (!oldShort && !newShort && e.error) {
      // 失败条目只记了错误：用预览基线补出尝试的 原值→目标值
      const p = previewRow(e.number, SOURCE_PREVIEW[src.操作]);
      if (p) {
        oldShort = p.oldShortName;
        newShort = p.viaTemp ? p.tempShortName : p.finalShortName;
        备注 = "该次尝试被金蝶校验拒绝（实际未改动）";
      }
    }
    ops.push({
      at: e.at, 时间: toCst(e.at), 操作: src.操作, 客户编码: e.number,
      客户名称: live.get(e.number)?.name ?? "", 销售部门: live.get(e.number)?.dept ?? "",
      原简称: oldShort, 新简称: newShort,
      结果: e.ok === true ? "成功" : (e.error ? `失败：${e.error}` : "异常"),
      备注, 审核后状态: e.status ?? "", 异常字段: (e.broken ?? []).join("/"),
    });
  }
}
ops.sort((a, b) => String(a.at).localeCompare(String(b.at)));
for (const o of ops) delete o.at;

// 客户前后对照：今日开始简称 = 该客户最早一条「有原简称」的记录
const perCustomer = new Map();
for (const o of ops) {
  if (!perCustomer.has(o.客户编码)) perCustomer.set(o.客户编码, { firstOld: "", last: null, count: 0 });
  const c = perCustomer.get(o.客户编码);
  c.count++;
  if (!c.firstOld && o.原简称) c.firstOld = o.原简称;
  if (o.结果 === "成功") c.last = o;
}
const compare = [...perCustomer.entries()].map(([number, c]) => {
  const now = live.get(number) ?? {};
  return {
    客户编码: number, 客户名称: now.name ?? "", 销售部门: now.dept ?? "", 销售员: now.seller ?? "",
    今日开始简称: c.firstOld, 现在简称: now.short ?? "", 与预期不符: now.short === c.last.新简称 ? "" : "是",
    改名次数: c.count, 当前状态: `${now.status ?? ""}`, 禁用: `${now.forbid ?? ""}`,
  };
}).sort((a, b) => a.客户编码.localeCompare(b.客户编码));

const okCount = ops.filter((o) => o.结果 === "成功").length;
const failCount = ops.length - okCount;
const summary = [
  { 项目: "涉及客户数", 值: compare.length },
  { 项目: "改名操作总数", 值: ops.length },
  { 项目: "成功", 值: okCount },
  { 项目: "失败/异常", 值: failCount },
  { 项目: "并组 05→03（客户数 / 操作数）", 值: `${compare.filter((c) => c.今日开始简称.startsWith("05")).length} / ${ops.filter((o) => o.操作 === "并组 05→03").length}` },
  { 项目: "对调 02↔03（客户数 / 操作数）", 值: `${compare.filter((c) => c.今日开始简称.startsWith("02") || c.今日开始简称.startsWith("03") || c.今日开始简称.startsWith("05")).length} / ${ops.filter((o) => o.操作 === "对调 02↔03").length}` },
  { 项目: "操作时间范围（北京时间）", 值: ops.length ? `${ops[0].时间} ~ ${ops[ops.length - 1].时间}` : "" },
  { 项目: "当前不符预期的客户", 值: compare.filter((c) => c.与预期不符).length },
  { 项目: "改名后状态非 C / 已禁用", 值: `${compare.filter((c) => c.当前状态 !== "C").length} / ${compare.filter((c) => c.禁用 !== "A").length}` },
  { 项目: "生成时间（北京时间）", 值: toCst(new Date().toISOString()) },
];

const wb = XLSX.utils.book_new();
const ws1 = XLSX.utils.json_to_sheet(summary);
ws1["!cols"] = [{ wch: 34 }, { wch: 46 }];
XLSX.utils.book_append_sheet(wb, ws1, "汇总");

const ws2 = XLSX.utils.json_to_sheet(compare);
ws2["!cols"] = [12, 40, 12, 12, 24, 24, 12, 10, 10, 8].map((w) => ({ wch: w }));
XLSX.utils.book_append_sheet(wb, ws2, "客户前后对照");

const ws3 = XLSX.utils.json_to_sheet(ops);
ws3["!cols"] = [20, 14, 12, 40, 14, 24, 24, 46, 30, 10, 12].map((w) => ({ wch: w }));
XLSX.utils.book_append_sheet(wb, ws3, "逐条操作明细");

const failed = ops.filter((o) => o.结果 !== "成功");
const ws4 = XLSX.utils.json_to_sheet(failed);
ws4["!cols"] = [20, 14, 12, 40, 24, 24, 70, 34, 10, 12].map((w) => ({ wch: w }));
XLSX.utils.book_append_sheet(wb, ws4, "失败异常");

const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
const outPath = path.resolve(`output/客户简称修改记录_${date}.xlsx`);
XLSX.writeFile(wb, outPath);

console.log(JSON.stringify({
  涉及客户数: compare.length, 操作总数: ops.length, 成功: okCount, 失败异常: failCount,
  当前不符预期: compare.filter((c) => c.与预期不符).length,
  页签: wb.SheetNames, outPath, exists: fs.existsSync(outPath),
}, null, 2));
