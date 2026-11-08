#!/usr/bin/env bun
/**
 * 导出客户列表 xlsx（只读查询，无写入）。
 * 用法: bun scripts/tools/export_customers.js
 * 输出: output/customer_list_YYYYMMDD.xlsx（扁平单 Sheet，无筛选/表格样式，避免 Excel 修复提示）
 */
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { K3CloudWebAPI } from "../../lib/k3/index.js";

const DOC_LABEL = { A: "创建", B: "审核中", C: "已审核", D: "重新审核", Z: "暂存" };
const FORBID_LABEL = { A: "正常", B: "禁用" };

const api = new K3CloudWebAPI();
await api.login();

const rows = await api.executeBillQuery(
  "BD_CUSTOMER",
  "FCUSTID,FNumber,FName,FShortName,FDocumentStatus,FForbidStatus,FCreateOrgId.FNumber,FUseOrgId.FNumber",
  "",
  10000,
);

const data = rows
  .map((r) => ({
    客户内码: String(r[0] ?? ""),
    客户编码: String(r[1] ?? ""),
    客户名称: String(r[2] ?? "").trim(),
    简称: String(r[3] ?? "").trim(),
    单据状态: `${r[4] ?? ""}${DOC_LABEL[r[4]] ? `(${DOC_LABEL[r[4]]})` : ""}`,
    禁用状态: `${r[5] ?? ""}${FORBID_LABEL[r[5]] ? `(${FORBID_LABEL[r[5]]})` : ""}`,
    创建组织: String(r[6] ?? ""),
    使用组织: String(r[7] ?? ""),
  }))
  .sort((a, b) => a.客户编码.localeCompare(b.客户编码, "zh-Hans-CN"));

const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
const outPath = path.resolve(`output/customer_list_${date}.xlsx`);

const ws = XLSX.utils.json_to_sheet(data);
ws["!cols"] = [{ wch: 10 }, { wch: 14 }, { wch: 40 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "客户列表");
XLSX.writeFile(wb, outPath);

console.log(JSON.stringify({ count: data.length, outPath, fileExists: fs.existsSync(outPath) }, null, 2));
