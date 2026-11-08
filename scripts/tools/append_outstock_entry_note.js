/**
 * 销售出库单分录备注批量追加（SAL_OUTSTOCK）
 *
 * 用途：按分录规格封装给备注追加后缀，例：`26年` -> `26年/A-1-3`
 *
 * 用法：
 *   bun scripts/tools/append_outstock_entry_note.js --bill <销售出库单号>            # dry-run
 *   bun scripts/tools/append_outstock_entry_note.js --bill <销售出库单号> --apply
 *
 * 规则：--rule "SOT-23=A-1-3,SOD-323=B-1-1"（默认值即此）
 *   - 分录规格含关键词（大小写不敏感）即命中，命中多个取第一个匹配的规则
 *   - 目标备注 = 原备注去尾空格 + "/" + 后缀；原备注已以该后缀结尾时跳过（幂等）
 *
 * 安全：默认 dry-run；只写 FEntrynote 一个字段，IsDeleteEntry=false 不动其它分录；
 *       只允许 D/A/Z/B 状态（C 已审核需先反审核），保存后独立回查。
 */
import { K3CloudWebAPI } from "../../lib/k3/index.js";

const args = process.argv.slice(2);
const get = (f, d) => {
  const i = args.indexOf(f);
  return i === -1 ? d : args[i + 1];
};
const has = (f) => args.includes(f);

const BILLNO = get("--bill");
const APPLY = has("--apply");
const RULE = get("--rule", "SOT-23=A-1-3,SOD-323=B-1-1");
if (!BILLNO) {
  console.error("缺少 --bill <销售出库单号>");
  process.exit(2);
}
const RULES = RULE.split(",").map((s) => {
  const [k, v] = s.split("=");
  return { key: String(k).trim().toUpperCase(), suffix: String(v).trim() };
});
const SAVEABLE = new Set(["A", "B", "D", "Z"]);

const api = new K3CloudWebAPI();
await api.login();

const ml = (x) => (Array.isArray(x) ? x.find((t) => t.Key === 2052)?.Value ?? x[0]?.Value ?? "" : x ?? "");

const readBill = async () => {
  const v = await api.viewBill("SAL_OUTSTOCK", fidCache);
  const entries = (v.SAL_OUTSTOCKENTRY || []).map((e) => ({
    entryId: Number(e.Id),
    no: e.MaterialID?.Number,
    name: ml(e.MaterialID?.Name),
    spec: ml(e.MaterialID?.Specification),
    note: String(e.Note ?? "").trim(),
  }));
  return {
    fid: Number(v.Id),
    billNo: v.BillNo,
    status: v.DocumentStatus,
    cancelStatus: v.CancelStatus,
    customer: `${v.CustomerID?.Number ?? ""} ${ml(v.CustomerID?.Name)}`.trim(),
    entries,
  };
};

// 先按单号取 FID
const q = await api.executeBillQuery("SAL_OUTSTOCK", "FID,FBillNo,FDocumentStatus", `FBillNo='${BILLNO}'`, 10);
if (!q.length) {
  console.error(`未找到销售出库单 ${BILLNO}`);
  process.exit(1);
}
let fidCache = Number(q[0][0]);
let cur = await readBill();
const fid = cur.fid;
const status = cur.status;
console.log(`单号 ${cur.billNo}  FID ${fid}  状态 ${status}  客户 ${cur.customer}  分录 ${cur.entries.length} 行`);
console.log(`规则: ${RULES.map((r) => `${r.key} -> ${r.suffix}`).join(" | ")}\n`);

if (!SAVEABLE.has(status)) {
  console.error(`状态 ${status} 不允许直接保存（已审核 C 需先反审核）。中止。`);
  process.exit(1);
}

const plan = [];
for (const e of cur.entries) {
  const spec = String(e.spec ?? "").toUpperCase();
  const rule = RULES.find((x) => spec.includes(x.key));
  if (!rule) {
    plan.push({ ...e, target: null, action: "跳过（规格未命中规则）" });
    continue;
  }
  const target = e.note.endsWith(rule.suffix) ? e.note : e.note ? `${e.note}/${rule.suffix}` : rule.suffix;
  plan.push({ ...e, target, action: target === e.note ? "跳过（已含后缀）" : "追加" });
}

console.log("计划：");
console.log("FEntryID | 料号 | 规格 | 原备注 -> 目标备注 | 动作");
for (const p of plan) {
  console.log(`${p.entryId} | ${p.no} | ${p.spec} | [${p.note}] -> [${p.target ?? "-"}] | ${p.action}`);
}
const todo = plan.filter((p) => p.action === "追加");
console.log(`\n合计 ${plan.length} 行，需修改 ${todo.length} 行，跳过 ${plan.length - todo.length} 行`);

if (!APPLY) {
  console.log("\n[dry-run] 未写入。确认后加 --apply 执行。");
  process.exit(0);
}
if (!todo.length) {
  console.log("\n无待修改行，已是最新状态，无需保存。");
  process.exit(0);
}

const res = await api.post("DynamicFormService.Save", {
  formid: "SAL_OUTSTOCK",
  data: {
    Creator: "",
    NeedUpDateFields: ["FEntrynote"],
    IsDeleteEntry: false,
    Model: {
      FID: fid,
      FEntity: todo.map((p) => ({ FEntryID: p.entryId, FEntrynote: p.target })),
    },
  },
});
const rsres = res?.Result?.ResponseStatus;
console.log("\n保存返回:", JSON.stringify(rsres ?? res).slice(0, 800));
if (rsres && !rsres.IsSuccess) {
  console.error("保存失败，未做任何回查假设。");
  process.exit(1);
}

// 独立回查
const after = await readBill();
const afterMap = new Map(after.entries.map((e) => [e.entryId, e.note]));
let ok = 0;
const bad = [];
for (const p of plan) {
  const got = afterMap.get(p.entryId) ?? "<缺失>";
  if (p.target ? got === p.target : got === p.note) ok++;
  else bad.push({ ...p, got });
}
console.log(`回查：${ok}/${plan.length} 行符合预期`);
for (const r of bad) console.log(`  不符: ${r.entryId} ${r.no} 期望[${r.target}] 实际[${r.got}]`);
console.log(`回查单据状态：${after.status}  分录数：${after.entries.length}  作废状态：${after.cancelStatus}`);
process.exit(bad.length ? 1 : 0);

