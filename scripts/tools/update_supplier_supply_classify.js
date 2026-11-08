import { K3CloudWebAPI, escapeK3 } from "../../lib/k3/index.js";

/**
 * 供应商供货分类修改工具
 *
 * 业务背景：
 * 金蝶星空在委外订单（CGDD02_SYS 等）选单/选择供应商时，强制过滤供应商资质，
 * 仅允许供货分类为“综合”（ZH）或具备委外服务属性的供应商。
 * 若供应商原供货分类为“货品”（CG），委外订单无法选出该供应商。
 *
 * 用法：
 * bun scripts/tools/update_supplier_supply_classify.js --number GYS289 --classify ZH [--expect CG] [--apply]
 */

const args = process.argv.slice(2);
const get = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const apply = args.includes("--apply");
const number = get("--number");
const targetClassify = (get("--classify") || "ZH").toUpperCase();
const expectClassify = get("--expect");

const CLASSIFY_NAMES = {
  CG: "货品",
  WW: "委外",
  FW: "服务",
  ZH: "综合",
};

if (!number || !CLASSIFY_NAMES[targetClassify]) {
  console.error("用法: bun scripts/tools/update_supplier_supply_classify.js --number <供应商编码> --classify <CG|WW|FW|ZH> [--expect <旧分类>] [--apply]");
  process.exit(1);
}

const api = new K3CloudWebAPI();
await api.login();

// 1. 读取当前供应商状态
const currentData = await api.viewBill("BD_Supplier", { Number: number }).catch(() => null) 
  || await (async () => {
    const q = await api.executeBillQuery(
      "BD_Supplier",
      "FSupplierId,FNumber,FName,FDocumentStatus,FForbidStatus",
      `FNumber='${escapeK3(number)}'`,
      1
    );
    if (!q || !q.length) return null;
    return await api.viewBill("BD_Supplier", String(q[0][0]));
  })();

if (!currentData || !currentData.Id) {
  console.error(`未找到供应商: ${number}`);
  process.exit(1);
}

const fid = String(currentData.Id);
const sName = currentData.Name?.find?.((x) => x.Key === 2052)?.Value || currentData.Name || "";
const docStatus = currentData.DocumentStatus;
const forbidStatus = currentData.ForbidStatus;

const baseEntry = currentData.SupplierBase?.[0];
if (!baseEntry) {
  console.error(`供应商 ${number} 缺少 SupplierBase 基础信息分录！`);
  process.exit(1);
}

const currentClassify = (baseEntry.SupplyClassify || "").trim();
const baseEntryId = baseEntry.Id;

console.log("================ 供应商当前现状 ================");
console.log(`供应商编码: ${number}`);
console.log(`供应商名称: ${sName}`);
console.log(`单据主键(FID): ${fid}`);
console.log(`分录主键(FEntryID): ${baseEntryId}`);
console.log(`当前单据状态: ${docStatus} (${docStatus === "C" ? "已审核" : docStatus === "D" ? "重新审核/暂存" : docStatus})`);
console.log(`当前禁用状态: ${forbidStatus} (${forbidStatus === "A" ? "未禁用" : "已禁用"})`);
console.log(`当前供货分类: ${currentClassify} (${CLASSIFY_NAMES[currentClassify] || "未知"})`);
console.log(`目标供货分类: ${targetClassify} (${CLASSIFY_NAMES[targetClassify]})`);

// 旧值守卫
if (expectClassify !== undefined && currentClassify !== expectClassify) {
  console.error(`\n[旧值守卫失败] 期望旧供货分类为「${expectClassify}」，当前实际为「${currentClassify}」，终止执行！`);
  process.exit(1);
}

if (currentClassify === targetClassify) {
  console.log(`\n当前分类已是「${targetClassify} (${CLASSIFY_NAMES[targetClassify]})」，无需变更。`);
  process.exit(0);
}

if (!apply) {
  console.log("\n>>> 当前为 DRY-RUN 预览模式，未做任何修改。如确认修改，请添加 --apply 参数执行。<<<");
  process.exit(0);
}

// 状态守卫
if (docStatus !== "C") {
  console.error(`当前状态为 ${docStatus}，非已审核(C)状态，停止自动写入！`);
  process.exit(1);
}
if (forbidStatus !== "A") {
  console.error(`当前供应商已禁用(状态 ${forbidStatus})，停止自动写入！`);
  process.exit(1);
}

console.log(`\n================ 开始执行更新 ================\n`);

// 步骤 1: 反审核
console.log(`1. 反审核供应商 (FID: ${fid})...`);
const unRes = await api.unAuditBill("BD_Supplier", [fid]);
const unOk = unRes?.Result?.ResponseStatus?.IsSuccess;
const unErrors = (unRes?.Result?.ResponseStatus?.Errors ?? []).map((e) => e.Message).join("; ");
console.log(`   反审核结果: ${unOk ? "成功" : "失败"}${unErrors ? ` - ${unErrors}` : ""}`);
if (!unOk) {
  console.error("反审核失败，终止！");
  process.exit(1);
}

// 步骤 2: 保存新供货分类 (FBaseInfo 为子单头对象)
console.log(`2. 保存新供货分类 FSupplyClassify = ${targetClassify}...`);
const savePayload = {
  FSUPPLIERID: fid,
  FBaseInfo: {
    FEntryId: baseEntryId,
    FSupplyClassify: targetClassify,
  },
};

const saveRes = await api.post("DynamicFormService.Save", {
  formid: "BD_Supplier",
  data: {
    NeedUpDateFields: [],
    IsDeleteEntry: false,
    Model: savePayload,
  },
});
const saveOk = saveRes?.Result?.ResponseStatus?.IsSuccess;
const saveErrors = (saveRes?.Result?.ResponseStatus?.Errors ?? []).map((e) => e.Message).join("; ");
console.log(`   保存结果: ${saveOk ? "成功" : "失败"}${saveErrors ? ` - ${saveErrors}` : ""}`);
if (!saveOk) {
  console.error("保存失败，终止！");
  process.exit(1);
}

// 步骤 3: 提交
console.log(`3. 提交供应商 (FID: ${fid})...`);
const subRes = await api.submitBill("BD_Supplier", [fid]);
const subOk = subRes?.Result?.ResponseStatus?.IsSuccess;
const subErrors = (subRes?.Result?.ResponseStatus?.Errors ?? []).map((e) => e.Message).join("; ");
console.log(`   提交结果: ${subOk ? "成功" : "失败"}${subErrors ? ` - ${subErrors}` : ""}`);
if (!subOk) {
  console.error("提交失败，终止！");
  process.exit(1);
}

// 步骤 4: 审核
console.log(`4. 审核供应商 (FID: ${fid})...`);
const audRes = await api.auditBill("BD_Supplier", [fid]);
const audOk = audRes?.Result?.ResponseStatus?.IsSuccess;
const audErrors = (audRes?.Result?.ResponseStatus?.Errors ?? []).map((e) => e.Message).join("; ");
console.log(`   审核结果: ${audOk ? "成功" : "失败"}${audErrors ? ` - ${audErrors}` : ""}`);
if (!audOk) {
  console.error("审核失败，终止！");
  process.exit(1);
}

// 步骤 5: 双通道独立回查
console.log(`\n================ 双通道回查验证 ================\n`);

// 通道 1: ViewBill
const viewAfter = await api.viewBill("BD_Supplier", fid);
const afterClassify = viewAfter.SupplierBase?.[0]?.SupplyClassify;
const afterDocStatus = viewAfter.DocumentStatus;
console.log(`通道 1 (ViewBill) 回查:`);
console.log(`  单据状态: ${afterDocStatus} (${afterDocStatus === "C" ? "已审核" : "异常"})`);
console.log(`  供货分类: ${afterClassify} (${CLASSIFY_NAMES[afterClassify] || "未知"})`);

// 通道 2: SQL 数据库直查
const { default: sql } = await import("mssql");
const { K3_DB_HOST, K3_DB_USER, K3_DB_PASS, K3_DB_NAME } = await import("../../lib/k3/index.js");
const pool = await sql.connect({
  user: K3_DB_USER,
  password: K3_DB_PASS,
  server: K3_DB_HOST,
  database: K3_DB_NAME,
  options: { encrypt: false, trustServerCertificate: true },
});
const sqlRes = await pool.request().query(`
  SELECT s.FSUPPLIERID, s.FNUMBER, s.FDOCUMENTSTATUS, s.FFORBIDSTATUS, b.FSUPPLYCLASSIFY
  FROM T_BD_SUPPLIER s
  JOIN T_BD_SUPPLIERBASE b ON s.FSUPPLIERID = b.FSUPPLIERID
  WHERE s.FNUMBER = '${escapeK3(number)}'
`);
await pool.close();

const dbRow = sqlRes.recordset[0];
console.log(`通道 2 (SQL Server) 回查:`);
console.log(`  单据状态: ${dbRow?.FDOCUMENTSTATUS}`);
console.log(`  供货分类: ${dbRow?.FSUPPLYCLASSIFY}`);

if (afterClassify === targetClassify && dbRow?.FSUPPLYCLASSIFY === targetClassify && afterDocStatus === "C") {
  console.log(`\n>>> 验证通过：供应商 ${number} 供货分类已成功更新为「${targetClassify} (${CLASSIFY_NAMES[targetClassify]})」，且单据已恢复已审核状态！<<<`);
} else {
  console.error(`\n>>> 验证失败：双通道核验不一致或未达到目标状态！<<<`);
  process.exit(1);
}
