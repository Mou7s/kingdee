#!/usr/bin/env bun
/**
 * 导出物料列表 xlsx（只读查询，无写入）。
 * 用法: bun scripts/tools/export_materials.js [输出文件名]
 * 输出: output/material_list_YYYYMMDD.xlsx（扁平单 Sheet，无表格/筛选样式，避免 Excel 修复提示）
 *
 * 字段与口径：
 * - 物料属性 FErpClsID 的枚举值来自实测取样（采购/生产/委外/分组交叉验证）：
 *   1=外购 2=自制 3=委外 10=资产 11=费用；其他码保留原码并标「未验证」。
 * - executeBillQuery 不支持 as 别名，按列下标取值；分页需显式 StartRow（helper 固定 StartRow=0）。
 */
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { K3CloudWebAPI } from "../../lib/k3/index.js";

const DOC_LABEL = { A: "创建", B: "审核中", C: "已审核", D: "重新审核", Z: "暂存" };
const FORBID_LABEL = { A: "正常", B: "禁用" };
const ERPCLS_LABEL = { 1: "外购", 2: "自制", 3: "委外", 10: "资产", 11: "费用" };
const yesNo = (v) => (v === true || v === "true" || v === 1 || v === "1" ? "是" : "否");

const FIELDS = [
  "FMATERIALID",
  "FNumber",
  "FName",
  "FSpecification",
  "FMaterialGroup.FNumber",
  "FMaterialGroup.FName",
  "FErpClsID",
  "FBaseUnitId.FNumber",
  "FBaseUnitId.FName",
  "FIsSale",
  "FIsPurchase",
  "FIsProduce",
  "FIsSubContract",
  "FIsInventory",
  "FDocumentStatus",
  "FForbidStatus",
  "FCreateOrgId.FNumber",
  "FCreateDate",
].join(",");

const api = new K3CloudWebAPI();
await api.login();

const PAGE = 2000;
const all = [];
const seen = new Set();
for (let start = 0; start < 200000; start += PAGE) {
  const res = await api.post("DynamicFormService.ExecuteBillQuery", {
    data: {
      FormId: "BD_MATERIAL",
      FieldKeys: FIELDS,
      FilterString: "",
      OrderString: "FMATERIALID",
      TopRowCount: 0,
      StartRow: start,
      Limit: PAGE,
    },
  });
  const rows = Array.isArray(res) ? res : res?.Result?.Rows ?? [];
  if (rows.length === 0) break;
  for (const r of rows) {
    const id = String(r[0] ?? "");
    if (seen.has(id)) continue; // 防重复行
    seen.add(id);
    all.push(r);
  }
  process.stderr.write(`已取 ${all.length} 行\n`);
  if (rows.length < PAGE) break;
}

const t = (v) => String(v ?? "").trim();
const data = all
  .map((r) => ({
    物料内码: t(r[0]),
    物料编码: t(r[1]),
    物料名称: t(r[2]),
    规格型号: t(r[3]),
    物料分组编码: t(r[4]),
    物料分组名称: t(r[5]),
    物料属性: ERPCLS_LABEL[r[6]] ?? `未验证(码=${t(r[6])})`,
    物料属性码: t(r[6]),
    基本单位编码: t(r[7]),
    基本单位: t(r[8]),
    可销售: yesNo(r[9]),
    可采购: yesNo(r[10]),
    可生产: yesNo(r[11]),
    可委外: yesNo(r[12]),
    参与库存: yesNo(r[13]),
    单据状态: `${t(r[14])}${DOC_LABEL[r[14]] ? `(${DOC_LABEL[r[14]]})` : ""}`,
    禁用状态: `${t(r[15])}${FORBID_LABEL[r[15]] ? `(${FORBID_LABEL[r[15]]})` : ""}`,
    创建组织: t(r[16]),
    创建日期: t(r[17]).slice(0, 10),
  }))
  .sort((a, b) => a.物料编码.localeCompare(b.物料编码, "zh-Hans-CN"));

const dateStr = new Date().toISOString().slice(0, 10).replaceAll("-", "");
const outPath = path.resolve(process.argv[2] ?? `output/material_list_${dateStr}.xlsx`);

const ws = XLSX.utils.json_to_sheet(data);
ws["!cols"] = [
  { wch: 10 }, { wch: 14 }, { wch: 22 }, { wch: 26 }, { wch: 10 }, { wch: 14 },
  { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 7 }, { wch: 7 },
  { wch: 7 }, { wch: 7 }, { wch: 7 }, { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 12 },
];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "物料列表");
XLSX.writeFile(wb, outPath);

const byLabel = (key) =>
  data.reduce((m, r) => ((m[r[key]] = (m[r[key]] || 0) + 1), m), {});
console.log(
  JSON.stringify(
    {
      count: data.length,
      outPath,
      fileExists: fs.existsSync(outPath),
      物料属性分布: byLabel("物料属性"),
      禁用状态分布: byLabel("禁用状态"),
      单据状态分布: byLabel("单据状态"),
    },
    null,
    2,
  ),
);
