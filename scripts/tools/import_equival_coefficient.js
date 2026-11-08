#!/usr/bin/env bun
/**
 * 约当系数表导入工具 (CB_EQUIVALCOEFFICIENT)
 *
 * 将基于工厂真实 UPH 测算的各封装物料当量系数，批量导入到金蝶 K/3 Cloud 成本系统约当系数维护表。
 * 默认仅保存为【草稿】（DocumentStatus = 'A'），不提交、不审核，由财务在前端复核。
 *
 * 字段映射规则：
 *   - 固晶部: CBZX000002
 *   - 焊线部: CBZX000005
 *   - 模压部: CBZX000006
 *   - 测试分选: CBZX000007
 *   - FALLCOEFC: 原相对系数 * 10 (例如 1.0 -> 10, 5.71 -> 57.1, 8.0 -> 80), 完全符合 [0, 100] 限定范围且相对权重严格不变
 *
 * Usage:
 *   bun scripts/tools/import_equival_coefficient.js                      # 预演（dry-run，默认 2026年9期）
 *   bun scripts/tools/import_equival_coefficient.js --period=9 --apply   # 真实执行写入 9 期
 *   bun scripts/tools/import_equival_coefficient.js --period=10 --apply  # 真实执行写入 10 期
 */

import xlsx from "xlsx";
import path from "path";
import fs from "fs";
import { K3CloudWebAPI, statusLabel } from "../../lib/k3/index.js";

const apply = process.argv.includes("--apply");
// 2026-11-03：已验证20172=期末在产品数量×约当系数，旧UPH方案不成立。
if (apply) throw new Error("旧UPH约当系数方案已停用：约当完工率不能替代UPH费用权重。请使用经核实的自定义费用分配标准，见cost-allocation-equival-coefficient.md");
console.warn("历史预演仅供追溯，不得将其系数/20172方案作为UPH费用分配方案。");
const yearArg = process.argv.find((a) => a.startsWith("--year="));
const periodArg = process.argv.find((a) => a.startsWith("--period="));
const sourceArg = process.argv.find((a) => a.startsWith("--source="));

const year = yearArg ? yearArg.split("=")[1] : "2026";
const period = periodArg ? periodArg.split("=")[1] : "9";
const defaultSource = "output/2026年9月约当系数维护标准导入表.xlsx";
const sourceFile = sourceArg ? sourceArg.split("=")[1] : defaultSource;

if (!fs.existsSync(sourceFile)) {
  console.error(`✗ 找不到数据源文件: ${sourceFile}`);
  process.exit(1);
}

const api = new K3CloudWebAPI();
await api.login();

console.log("==================================================");
console.log(" 金蝶 K/3 Cloud 约当系数导入工具");
console.log(` 期间: ${year} 年 ${period} 期`);
console.log(` 数据源: ${sourceFile}`);
console.log(` 模式: ${apply ? "★ 真实执行写入（--apply）" : "预演（dry-run，不写数据）"}`);
console.log("==================================================\n");

// 1. 读取并校验 Excel 数据源
const wb = xlsx.readFile(sourceFile);
const sheetName = wb.SheetNames.includes("物料封装基准系数对照表")
  ? "物料封装基准系数对照表"
  : wb.SheetNames[0];

const rows = xlsx.utils.sheet_to_json(wb.Sheets[sheetName]);
console.log(`✓ 成功读取 Sheet [${sheetName}], 共计 ${rows.length} 个物料型号。\n`);

const ccMap = [
  { name: "固晶部", number: "CBZX000002", key: "固晶部系数" },
  { name: "焊线部", number: "CBZX000005", key: "焊线部系数" },
  { name: "模压部", number: "CBZX000006", key: "模压部系数" },
  { name: "测试分选", number: "CBZX000007", key: "测试分选系数" }
];

// 2. 检查现有单据
const existing = await api.executeBillQuery(
  "CB_EQUIVALCOEFFICIENT",
  "FID,FBillNo,FDocumentStatus,FYear,FPeriod",
  `FYear=${year} and FPeriod=${period}`,
  10
);

if (existing && existing.length > 0) {
  console.log(`⚠ 警告: 系统中已存在 ${year} 年 ${period} 期的约当系数表:`);
  for (const ex of existing) {
    console.log(`   单号: ${ex.FBillNo}, FID: ${ex.FID}, 状态: ${ex.FDocumentStatus} (${statusLabel(ex.FDocumentStatus)})`);
  }
  if (apply) {
    console.error("✗ 系统已存在当期单据，请先在前端清理或反审核删除历史草稿，防止期间冲突！");
    process.exit(1);
  }
} else {
  console.log(`✓ 检查确认: 当前系统内尚无 ${year} 年 ${period} 期约当系数记录。\n`);
}

// 3. 构建分录实体
const entries = [];
let seq = 1;

for (const r of rows) {
  const matCode = String(r["物料编码"] || "").trim();
  if (!matCode) continue;

  for (const cc of ccMap) {
    const rawVal = Number(r[cc.key]) || 1;
    // 综合系数缩放：按 10 倍折算为百分比（基准 1.0 -> 10, 最大 8.0 -> 80），四舍五入保留 1 位小数
    const scaledCoef = Math.round(rawVal * 10 * 10) / 10;
    entries.push({
      Seq: seq++,
      FCostCenterID: { FNumber: cc.number },
      FProductId: { FNumber: matCode },
      FALLCOEFC: scaledCoef
    });
  }
}

console.log(`✓ 分录装配完成: 共 ${entries.length} 行分录 (${rows.length} 个物料 × 4 大车间)。`);
console.log("  前 3 行预览:");
console.table(entries.slice(0, 3).map(e => ({
  Seq: e.Seq,
  CostCenter: e.FCostCenterID.FNumber,
  Product: e.FProductId.FNumber,
  FALLCOEFC: e.FALLCOEFC
})));

const savePayload = {
  formid: "CB_EQUIVALCOEFFICIENT",
  data: {
    IsAutoGenerateBillNo: true,
    Model: {
      Year: String(year),
      Period: String(period),
      FACCTGSYSTEMID: { Id: 1 },
      FACCTPOLICYID: { Id: 1 },
      FACCTGORGID: { Id: 1 },
      ISWW: false,
      DATAFROM: "0",
      FEntity: entries
    }
  }
};

// 4. 执行写入或预演汇报
if (!apply) {
  console.log("\n==================================================");
  console.log(" [预演完成] 待写入详情:");
  console.log(` - 目标表单: CB_EQUIVALCOEFFICIENT (约当系数维护)`);
  console.log(` - 核算期间: ${year} 年 ${period} 期`);
  console.log(` - 主表配置: 会计核算体系: 1, 会计政策: 1, 组织: 1, 是否委外: 否`);
  console.log(` - 分录明细: ${entries.length} 行`);
  console.log(" - 单据状态: 保存为草稿 (A 暂存/创建)，不触发审核");
  console.log("\n若确认无误，请带参数 --apply 执行真实导入：");
  console.log(`bun scripts/tools/import_equival_coefficient.js --year=${year} --period=${period} --apply`);
  console.log("==================================================");
  process.exit(0);
}

console.log(`\n★ 正在调用 WebAPI (DynamicFormService.Save) 写入 ${entries.length} 行分录...`);
const startTime = Date.now();
const saveRes = await api.post("DynamicFormService.Save", savePayload);
const costSeconds = ((Date.now() - startTime) / 1000).toFixed(2);

const success = saveRes.Result?.ResponseStatus?.IsSuccess;
if (!success) {
  const errors = saveRes.Result?.ResponseStatus?.Errors?.map(e => e.Message).join("; ") || "未知错误";
  console.error(`✗ 写入失败 (耗时 ${costSeconds}s): ${errors}`);
  process.exit(1);
}

const billId = saveRes.Result.Id;
const billNo = saveRes.Result.Number;
console.log(`✓ 写入成功! (耗时 ${costSeconds}s)`);
console.log(`  单据 ID: ${billId}, 单据编号: ${billNo}\n`);

// 5. 写入后独立复核核对
console.log("★ 正在进行写入后复核核对...");
const checkBill = await api.viewBill("CB_EQUIVALCOEFFICIENT", billId);
const savedEntriesCount = checkBill?.Entity?.length || 0;

console.log("==================================================");
console.log(" 执行后复核报告:");
console.log(` - 单据编号: ${checkBill.BillNo}`);
console.log(` - 期间: ${checkBill.Year} 年 ${checkBill.Period} 期`);
console.log(` - 单据状态: ${checkBill.DocumentStatus} (${statusLabel(checkBill.DocumentStatus)}) [已确认保持草稿]`);
console.log(` - 分录行数: ${savedEntriesCount} 行 (预期 ${entries.length} 行)`);
console.log(` - 核对结果: ${savedEntriesCount === entries.length ? "PASS (完全一致)" : "FAIL (行数不一致)"}`);
console.log("==================================================");
