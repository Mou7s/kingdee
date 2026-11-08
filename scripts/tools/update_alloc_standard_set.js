#!/usr/bin/env bun
/**
 * 费用分配标准设置更新工具 (CB_STANDARDSET)
 *
 * 将制造中心当前要素费用分配标准方案 (Id: 154881) 从“统一设置”切换为“分成本中心设置”，
 * 并将 4 大核心车间（固晶、焊线、模压、测试）的分配标准从“完工入库数量”(20174) 切换为“约当产量”(20172)。
 *
 * 目标车间：
 *   - 固晶部 (128511 / CBZX000002) -> 约当产量 (20172)
 *   - 焊线部 (128513 / CBZX000005) -> 约当产量 (20172)
 *   - 模压部 (128514 / CBZX000006) -> 约当产量 (20172)
 *   - 测试分选 (128515 / CBZX000007) -> 约当产量 (20172)
 * 其余车间继续保持原标准 (20174)。
 *
 * Usage:
 *   bun scripts/tools/update_alloc_standard_set.js          # 预演（dry-run）
 *   bun scripts/tools/update_alloc_standard_set.js --apply  # 真实执行写入
 */

import sql from "mssql";
import {
  K3CloudWebAPI,
  K3_DB_HOST,
  K3_DB_USER,
  K3_DB_PASS,
  K3_DB_NAME
} from "../../lib/k3/index.js";

const apply = process.argv.includes("--apply");
// 2026-11-03：已验证20172=期末在产品数量×约当系数，旧UPH方案不成立。
if (apply) throw new Error("旧UPH约当系数方案已停用：约当完工率不能替代UPH费用权重。请使用经核实的自定义费用分配标准，见cost-allocation-equival-coefficient.md");
console.warn("历史预演仅供追溯，不得将其系数/20172方案作为UPH费用分配方案。");
const BILL_ID = 154881;
const TARGET_CCS = [128511, 128513, 128514, 128515];

const api = new K3CloudWebAPI();
await api.login();

console.log("==================================================");
console.log(" 金蝶 K/3 Cloud 费用分配标准设置调整工具");
console.log(` 方案 ID: ${BILL_ID}`);
console.log(` 模式: ${apply ? "★ 真实执行写入（--apply）" : "预演（dry-run，不写数据）"}`);
console.log("==================================================\n");

// 1. 读取当前设置
const bill = await api.viewBill("CB_STANDARDSET", BILL_ID);
console.log(`当前主表统一设置状态: FALLSET = ${bill.FALLSET}`);
console.log(`当前分录总行数: ${bill.CB_ALLOCSTANDARDSETENTRY?.length || 0} 行\n`);

// 2. 构建更新分录
const newEntries = bill.CB_ALLOCSTANDARDSETENTRY.map((e) => {
  const isTarget = TARGET_CCS.includes(e.FCOSTCENTERID_Id);
  return {
    Id: e.Id,
    Seq: e.Seq,
    FCOSTCENTERID: { Id: e.FCOSTCENTERID_Id },
    FSTANDARDID: { Id: isTarget ? 20172 : 20174 }
  };
});

const modifiedTargets = newEntries.filter((e) => TARGET_CCS.includes(e.FCOSTCENTERID.Id));

console.log("待更新车间明细:");
console.table(modifiedTargets.map((e) => {
  const origin = bill.CB_ALLOCSTANDARDSETENTRY.find((o) => o.Id === e.Id);
  return {
    Seq: e.Seq,
    CostCenterId: e.FCOSTCENTERID.Id,
    CostCenterName: origin.FCOSTCENTERID?.Name || "",
    原分配标准: `${origin.FSTANDARDID_Id} (${origin.FSTANDARDID?.Name || "完工入库数量"})`,
    新目标标准: `${e.FSTANDARDID.Id} (约当产量)`
  };
}));

const savePayload = {
  formid: "CB_STANDARDSET",
  data: {
    Model: {
      Id: BILL_ID,
      FALLSET: false, // 切换为分成本中心分别设置
      FALLOCTYPE: bill.FALLOCTYPE,
      FACCTGSYSTEMID: { Id: bill.FACCTGSYSTEMID_Id },
      ACCTGORGID: { Id: bill.ACCTGORGID_Id },
      ACCTPOLICYID: { Id: bill.ACCTPOLICYID_Id },
      FEXPENSETYPE: bill.FEXPENSETYPE,
      CB_ALLOCSTANDARDSETENTRY: newEntries
    }
  }
};

if (!apply) {
  console.log("\n==================================================");
  console.log(" [预演完成] 待更新详情:");
  console.log(` - 方案标识: CB_STANDARDSET (Id: ${BILL_ID})`);
  console.log(` - 统一设置 (FALLSET): true -> false (分车间独立配置)`);
  console.log(` - 4 大核心车间切换为: 20172 (约当产量)`);
  console.log(` - 其余 21 个车间保持为: 20174 (完工入库数量)`);
  console.log("\n若确认无误，请带参数 --apply 执行真实更新：");
  console.log("bun scripts/tools/update_alloc_standard_set.js --apply");
  console.log("==================================================");
  process.exit(0);
}

// 3. 执行写入
console.log("\n★ 正在调用 WebAPI (DynamicFormService.Save) 更新分配标准...");
const saveRes = await api.post("DynamicFormService.Save", savePayload);
const success = saveRes.Result?.ResponseStatus?.IsSuccess;

if (!success) {
  const errs = saveRes.Result?.ResponseStatus?.Errors?.map((e) => e.Message).join("; ") || "未知错误";
  console.error(`✗ 更新失败: ${errs}`);
  process.exit(1);
}

console.log("✓ WebAPI 保存成功！正在进行独立复核...\n");

// 4. 数据库独立复查
const pool = await sql.connect({
  server: K3_DB_HOST,
  user: K3_DB_USER,
  password: K3_DB_PASS,
  database: K3_DB_NAME,
  options: { encrypt: false, trustServerCertificate: true }
});

try {
  const headQ = await pool.request().query(
    `SELECT FSTANDARDSETID, FALLSET, FALLSETSTANDARDID, FDOCUMENTSTATUS FROM T_CB_ALLOCSTANDARDSET WHERE FSTANDARDSETID = ${BILL_ID}`
  );
  const head = headQ.recordset[0];

  const entriesQ = await pool.request().query(`
    SELECT e.FSEQ, c.FNUMBER as CC_CODE, cl.FNAME as CC_NAME, e.FSTANDARDID, critl.FNAME as CRIT_NAME
    FROM T_CB_ALLOCSTANDARDSETENTRY e
    JOIN T_CB_COSTCENTER c ON c.FCOSTCENTERID = e.FCOSTCENTERID
    JOIN T_CB_COSTCENTER_L cl ON cl.FCOSTCENTERID = e.FCOSTCENTERID AND cl.FLOCALEID = 2052
    JOIN T_CB_COSTALLOCCRITERIA_L critl ON critl.FSTANDARDID = e.FSTANDARDID AND critl.FLOCALEID = 2052
    WHERE e.FSTANDARDSETID = ${BILL_ID} AND e.FCOSTCENTERID IN (128511, 128513, 128514, 128515)
    ORDER BY e.FSEQ
  `);

  console.log("==================================================");
  console.log(" 执行后复核报告:");
  console.log(` - 统一设置标记 FALLSET: ${head.FALLSET} (0 = 已分成本中心独立设置)`);
  console.log(" - 核心车间当前标准:");
  console.table(entriesQ.recordset);
  const allMatch = entriesQ.recordset.every((r) => r.FSTANDARDID === 20172);
  console.log(` - 核心车间分配标准核对: ${allMatch ? "PASS (全部成功切换为约当产量)" : "FAIL (未完全切换)"}`);
  console.log("==================================================");
} finally {
  await pool.close();
}
