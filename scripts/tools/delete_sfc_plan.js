#!/usr/bin/env bun
/**
 * 删除指定生产订单的工序计划（SFC_OperationPlanning）
 * 流程：已审核 → 反审核；开工 → UndoToPlan；再 delete
 * 默认 dry-run，加 --apply 才真正删除。
 *
 * Usage:
 *   bun scripts/tools/delete_sfc_plan.js <MO号>
 *   bun scripts/tools/delete_sfc_plan.js <MO号> --apply
 *   bun run delete-sfc -- MO260626026 --apply
 */
import {
  K3CloudWebAPI,
  FORMS,
  DOC_STATUS_SHORT,
  OPER_STATUS,
  statusLabel,
  escapeK3,
} from "../../lib/k3/index.js";

const args = process.argv.slice(2).filter((a) => a !== "--");
const apply = args.includes("--apply");
const moNo = args.find((a) => !a.startsWith("--"));

if (!moNo) {
  console.log("用法: bun scripts/tools/delete_sfc_plan.js <生产订单号> [--apply]");
  console.log("  默认 dry-run 只预览；加 --apply 才删除");
  process.exit(1);
}

const FORM = FORMS.SFC_PLAN;
const api = new K3CloudWebAPI();
await api.login();
console.log("➜ 登录成功");
console.log(apply ? "⚠ 模式: APPLY（将真实删除）\n" : "ℹ 模式: dry-run（预览，加 --apply 执行）\n");

console.log(`⏳ 查询工序计划 [MO=${moNo}]...`);
const plans = await api.executeBillQuery(
  FORM,
  "FID,FBillNo,FDocumentStatus,FOperStatus",
  `FMONumber='${escapeK3(moNo)}'`,
  2000
);

// 子实体 join 会多行，按 FID 去重
const plansMap = new Map();
for (const p of plans) {
  plansMap.set(p[0], {
    billNo: p[1],
    docStatus: String(p[2] ?? ""),
    operStatus: String(p[3] ?? ""),
  });
}

const entries = Array.from(plansMap.entries());
console.log(`🔍 找到 ${entries.length} 条工序计划（去重后）\n`);

if (entries.length === 0) {
  console.log("✨ 没有找到工序计划，无需操作。");
  process.exit(0);
}

for (const [fid, { billNo, docStatus, operStatus }] of entries) {
  console.log(
    `  FID:${fid}  ${billNo}  单据:${statusLabel(docStatus, DOC_STATUS_SHORT)}  工序:${statusLabel(operStatus, OPER_STATUS)}`
  );
}

const auditedFids = entries.filter(([, x]) => x.docStatus === "C").map(([fid]) => fid);
const startedFids = entries.filter(([, x]) => x.operStatus === "4").map(([fid]) => fid);
const allFids = entries.map(([fid]) => fid);

console.log("\n计划步骤:");
console.log(`  1. 反审核: ${auditedFids.length} 条`);
console.log(`  2. UndoToPlan: ${startedFids.length} 条`);
console.log(`  3. 删除: ${allFids.length} 条`);

if (!apply) {
  console.log("\n（dry-run 结束。确认无误后加 --apply 执行）");
  process.exit(0);
}

if (auditedFids.length > 0) {
  console.log(`\n🚀 Step 1: 反审核 ${auditedFids.length} 条...`);
  await api.unAuditBill(FORM, auditedFids);
  console.log("✅ 反审核成功");
}

if (startedFids.length > 0) {
  console.log(`\n🚀 Step 2: UndoToPlan ${startedFids.length} 条...`);
  for (const fid of startedFids) {
    const billNo = plansMap.get(fid)?.billNo ?? fid;
    process.stdout.write(`  回退 ${billNo}... `);
    try {
      await api.executeOperation(FORM, "UndoToPlan", { Ids: String(fid) });
      console.log("✅");
    } catch (err) {
      console.log(`❌ ${err.message}`);
    }
  }
}

console.log(`\n🚀 Step 3: 删除...`);
const result = await api.deleteBill(FORM, allFids);
const successEntities = result?.Result?.ResponseStatus?.SuccessEntitys || [];
console.log(`✅ 成功删除 ${successEntities.length}/${allFids.length} 条工序计划`);
console.log("\n🏁 完成");
