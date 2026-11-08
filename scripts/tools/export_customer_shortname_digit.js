#!/usr/bin/env bun
/**
 * 只读：导出客户列表中「简称以数字开头」的客户，并按简称前缀分类。
 *
 * 简称实测结构：<两位数字><等级字母A/B/C/D><城市码><名称码>[-W]
 *   - 两位数字：01~05（实测与销售部门/销售员/地区/建档日期均无对应关系，按业务口径待确认）
 *   - 第三位字母：A/B/C/D（等级位，最常见 C）
 *   - -W 后缀：外贸部客户的既有习惯写法
 *
 * 用法: bun scripts/tools/export_customer_shortname_digit.js
 * 输出: output/customer_shortname_digit_YYYYMMDD.xlsx（多 Sheet，扁平无筛选/表格样式）
 */
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { K3CloudWebAPI } from "../../lib/k3/index.js";

const DOC_LABEL = { A: "创建", B: "审核中", C: "已审核", D: "重新审核", Z: "暂存" };
const FORBID_LABEL = { A: "正常", B: "禁用" };
const DIGIT_START = /^[0-9０-９]/;

const api = new K3CloudWebAPI();
await api.login();

const rows = await api.executeBillQuery(
  "BD_CUSTOMER",
  "FCUSTID,FNumber,FName,FShortName,FDocumentStatus,FForbidStatus,FSALDEPTID.FName,FSeller.FName,FGroup.FName,FCreateDate",
  "",
  20000,
);

const text = (v) => (v == null ? "" : String(v).trim());

const all = rows.map((r) => ({
  客户内码: text(r[0]),
  客户编码: text(r[1]),
  客户名称: text(r[2]),
  简称: text(r[3]),
  单据状态: `${text(r[4])}${DOC_LABEL[r[4]] ? `(${DOC_LABEL[r[4]]})` : ""}`,
  禁用状态: `${text(r[5])}${FORBID_LABEL[r[5]] ? `(${FORBID_LABEL[r[5]]})` : ""}`,
  销售部门: text(r[6]),
  销售员: text(r[7]),
  客户分组: text(r[8]),
  建档日期: text(r[9]).slice(0, 10),
}));

const hit = all.filter((c) => DIGIT_START.test(c.简称));
const miss = all.filter((c) => !DIGIT_START.test(c.简称));

function decorate(c) {
  const s = c.简称;
  const num = s.match(/^[0-9０-９]+/)?.[0] ?? "";
  const level = s.slice(num.length, num.length + 1).toUpperCase();
  return {
    ...c,
    前缀两位数字: num,
    等级位: /^[A-Z]$/.test(level) ? level : "(非字母)",
    城市码: s.slice(num.length + 1, num.length + 3).toUpperCase(),
    名称码: s.slice(num.length + 3),
    是否外贸后缀W: /-W$/i.test(s) ? "是" : "",
  };
}
const detail = hit.map(decorate).sort((a, b) => a.简称.localeCompare(b.简称));

// 汇总：前两位 × 等级位 矩阵
const nums = [...new Set(detail.map((d) => d.前缀两位数字))].sort();
const levels = ["A", "B", "C", "D", "(非字母)"];
const matrix = nums.map((n) => {
  const row = { 前缀两位数字: n };
  for (const lv of levels) row[lv] = detail.filter((d) => d.前缀两位数字 === n && d.等级位 === lv).length;
  row.合计 = detail.filter((d) => d.前缀两位数字 === n).length;
  row.外贸W = detail.filter((d) => d.前缀两位数字 === n && d.是否外贸后缀W === "是").length;
  const dept = {};
  for (const d of detail.filter((x) => x.前缀两位数字 === n)) dept[d.销售部门] = (dept[d.销售部门] || 0) + 1;
  row.部门分布 = Object.entries(dept).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ");
  return row;
});
const totalRow = { 前缀两位数字: "合计" };
for (const lv of levels) totalRow[lv] = detail.filter((d) => d.等级位 === lv).length;
totalRow.合计 = detail.length;
totalRow.外贸W = detail.filter((d) => d.是否外贸后缀W === "是").length;
totalRow.部门分布 = `客户总数 ${all.length}，数字开头 ${hit.length}，非数字开头 ${miss.length}`;

const summarySheet = [
  { 项目: "客户总数", 数量: all.length },
  { 项目: "简称数字开头", 数量: hit.length },
  { 项目: "简称非数字开头", 数量: miss.length },
  { 项目: "简称空", 数量: all.filter((c) => !c.简称).length },
  { 项目: "其中外贸 -W 结尾", 数量: detail.filter((d) => d.是否外贸后缀W === "是").length },
  { 项目: "取值时点", 数量: new Date().toISOString().slice(0, 19).replace("T", " ") },
];

function sheetOf(data, cols) {
  const ws = XLSX.utils.json_to_sheet(data, cols ? { header: cols } : undefined);
  const keys = cols ?? Object.keys(data[0] ?? {});
  ws["!cols"] = keys.map((k) => ({ wch: k === "客户名称" ? 40 : k === "部门分布" ? 46 : Math.max(10, Math.min(28, k.length * 2 + 6)) }));
  return ws;
}

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, sheetOf(summarySheet), "总览");
XLSX.utils.book_append_sheet(wb, sheetOf([...matrix, totalRow]), "分类汇总");
XLSX.utils.book_append_sheet(wb, sheetOf(detail), "数字开头明细");
XLSX.utils.book_append_sheet(wb, sheetOf(miss), "非数字开头对照");

const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
const outPath = path.resolve(`output/customer_shortname_digit_${date}.xlsx`);
XLSX.writeFile(wb, outPath);

console.log(
  JSON.stringify(
    { 客户总数: all.length, 数字开头: hit.length, 非数字开头: miss.length, 分类: matrix.map((m) => `${m.前缀两位数字}:${m.合计}`), outPath, exists: fs.existsSync(outPath) },
    null,
    2,
  ),
);
