#!/usr/bin/env bun
/**
 * 工序汇报单「反作废」（SFC_OperationReport → UnCancel）
 *
 * 操作定义来自账套元数据 T_META_OBJECTTYPE：
 *   <Operation>UnCancel</Operation> <OperationName>反作废</OperationName>
 *   FCancelStatus: B → A；校验仅「FCancelStatus = 'A' 时不允许」（即未作废不能反作废）
 *   插件：Kingdee.K3.MFG.SFC.App.ServicePlugIn.OptRpt.UnCancel
 *
 * 反作废只把作废标记还原为正常，不改单据状态（D 重新审核 仍是 D），
 * 也不会自动提交/审核 —— 需要进台账的还要单独走 submit + audit。
 *
 * Usage:
 *   bun scripts/tools/uncancel_operation_report.js GXHB548524            # 预演（默认）
 *   bun scripts/tools/uncancel_operation_report.js GXHB548524 --apply    # 执行
 */
import {
  K3CloudWebAPI,
  DOC_STATUS_SHORT,
  statusLabel,
} from "../../lib/k3/index.js";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const apply = process.argv.includes("--apply");
const billNos = args.flatMap((a) => a.split(",")).map((s) => s.trim()).filter(Boolean);

if (!billNos.length) {
  console.log("用法: bun scripts/tools/uncancel_operation_report.js <工序汇报单号[,单号2]> [--apply]");
  process.exit(1);
}

const FORM = "SFC_OperationReport";
const api = new K3CloudWebAPI();
await api.login();
console.log(`模式: ${apply ? "★ 执行（--apply）" : "预演（dry-run，不写数据）"}\n`);

const targets = [];
for (const billNo of billNos) {
  const rows = await api.executeBillQuery(
    FORM,
    "FID,FBillNo,FDocumentStatus,FCancelStatus,FCancelDate,FTOTALRPTQTY",
    `FBillNo='${billNo.replace(/'/g, "''")}'`,
    20
  );
  if (!rows?.length) {
    console.log(`✗ 未找到工序汇报单 ${billNo}`);
    continue;
  }
  for (const r of rows) {
    targets.push({
      fid: r[0],
      billNo: r[1],
      docStatus: r[2],
      cancelStatus: r[3],
      cancelDate: r[4],
      totalRptQty: r[5],
    });
  }
}

if (!targets.length) {
  console.log("\n没有可处理的目标。");
  process.exit(2);
}

console.log("当前状态：");
for (const t of targets) {
  const ok = t.cancelStatus === "B";
  console.log(
    `  ${ok ? "✔" : "✗"} ${t.billNo}  FID=${t.fid}  单据状态=${t.docStatus} ` +
      `${statusLabel(t.docStatus, DOC_STATUS_SHORT)}  作废状态=${t.cancelStatus} ` +
      `(${t.cancelStatus === "A" ? "正常" : t.cancelStatus === "B" ? "已作废" : "未知"})  ` +
      `作废时间=${t.cancelDate ?? "-"}  汇报总数=${t.totalRptQty}`
  );
}

const todo = targets.filter((t) => t.cancelStatus === "B");
const skip = targets.filter((t) => t.cancelStatus !== "B");
if (skip.length) {
  console.log(`\n⚠ 跳过 ${skip.length} 张（FCancelStatus 不是 B，未作废的单不允许反作废）：${skip.map((t) => t.billNo).join(", ")}`);
}
if (!todo.length) {
  console.log("\n无需执行。");
  process.exit(0);
}

console.log(`\n拟执行: executeOperation("${FORM}", "UnCancel", { Ids: "${todo.map((t) => t.fid).join(",")}" })`);
console.log(`影响单据: ${todo.map((t) => `${t.billNo}(FID ${t.fid})`).join(", ")}`);
console.log(`预期结果: FCancelStatus B → A，单据状态不变（本单为 ${todo.map((t) => t.docStatus).join("/")}）`);

if (!apply) {
  console.log("\n预演结束，未写任何数据。确认无误后加 --apply 执行。");
  process.exit(0);
}

const res = await api.executeOperation(FORM, "UnCancel", {
  Ids: todo.map((t) => t.fid).join(","),
});
const rs = res?.Result?.ResponseStatus;
console.log("\n接口返回:", JSON.stringify(rs ?? res).slice(0, 800));

console.log("\n=== 执行后回查 ===");
let allOk = true;
for (const t of todo) {
  const rows = await api.executeBillQuery(
    FORM,
    "FID,FBillNo,FDocumentStatus,FCancelStatus,FCancelDate",
    `FID=${t.fid}`,
    5
  );
  const r = rows?.[0] ?? [];
  const ok = r[3] === "A";
  allOk = allOk && ok;
  console.log(
    `  ${ok ? "✔" : "✗"} ${r[1]}  FID=${r[0]}  单据状态=${r[2]} ${statusLabel(r[2], DOC_STATUS_SHORT)}  ` +
      `作废状态=${r[3]} (${r[3] === "A" ? "正常" : r[3] === "B" ? "已作废" : "未知"})  作废时间=${r[4] ?? "-"}`
  );
}
console.log(allOk ? "\n全部反作废成功。" : "\n⚠ 存在未达到预期状态的目标，请人工复核，不要盲目重试。");
