// 晶圆 BOM 建单（成品 → 晶圆片，一条材料、1:1、单位 K），分组必须显式指定
//
// 适用：委外/蓝膜这类"父项成品 → 子项晶圆片"的一条材料 BOM。与 scripts/tools/create_lm_bom.js
// 的区别：本脚本不预设分组，必须用 --group 显式传入**实查到的分组编码**（不是分组名称），
// 并在 dry-run 里打印该分组的名称与归属证据，避免照抄样板分组。
//
// 默认 dry-run（只做预检、不写库）；加 --apply 才写库：Save → Submit → Audit → 独立回查。
// 用法：
//   bun scripts/tools/create_wafer_bom.js --parent NDZ0530004 --child N101030451 --group a-LL41 [--apply]
//
// 报文形状来自 .agents/skills/kingdee-materials-bom/references/materials/bom-usage-and-batch-update.md §12（2026-09-11 已验证）与 2026-09-24 成功样板
// NDZ0530018_V1.0（FID 907535）的落库结构；字段键只用该表单实测可用的写法。

import { K3CloudWebAPI } from "../../lib/k3/index.js";

const args = process.argv.slice(2);
const get = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const apply = args.includes("--apply");
const parent = get("--parent");
const child = get("--child");
const group = get("--group");
if (!parent || !child || !group) {
  console.error("缺少必填参数: --parent <成品编码> --child <晶圆编码> --group <BOM分组编码，如 a-LL41>");
  process.exit(1);
}

console.log("=== 晶圆 BOM 建单参数 ===");
console.log(`父项(成品): ${parent}`);
console.log(`子项(晶圆): ${child}`);
console.log(`BOM 分组:   ${group}（必须是分组编码，不是名称）`);
console.log(`用量:       1:1，子项单位 K`);
console.log(apply ? "模式: APPLY（Save → 提交 → 审核）" : "模式: DRY-RUN（仅预检，不写库）");

const api = new K3CloudWebAPI();
await api.login();
const rowsOf = (r) => (Array.isArray(r) ? r : r?.Result?.Rows ?? []);
const q = async (form, fields, filter, top = 20) =>
  rowsOf(await api.post("DynamicFormService.ExecuteBillQuery", {
    data: { FormId: form, FieldKeys: fields, FilterString: filter, TopRowCount: top, StartRow: 0 },
  }));
const errOf = (r) => (r?.Result?.ResponseStatus?.Errors ?? []).map((e) => `${e.FieldName ?? "-"}:${e.Message}`).join("; ");

// ===== 预检 =====
let failed = false;
const mats = await q("BD_MATERIAL",
  "FMATERIALID,FNumber,FName,FSpecification,FDocumentStatus,FForbidStatus,FErpClsID,FIsMainPrd,FIsSubContract,FBaseUnitId.FNumber",
  `FNumber in ('${parent}','${child}')`);
const pm = mats.find((r) => r[1] === parent);
const cm = mats.find((r) => r[1] === child);
console.log("\n=== 预检 1：父子项物料现状 ===");
for (const [tag, r] of [["父项", pm], ["子项", cm]]) {
  if (!r) { console.log(`${tag}: 未找到！`); failed = true; continue; }
  console.log(`${tag} ${r[1]} ${r[2]} | 规格=${r[3]} | 单据状态=${r[4]} 禁用=${r[5]} | 属性=${r[6]} 主产品=${r[7]} 允许委外=${r[8]} 基本单位=${r[9]}`);
}
if (pm) {
  if (pm[4] !== "C") { console.error("✗ 父项未审核（需 C）"); failed = true; }
  if (pm[5] !== "A") { console.error("✗ 父项已禁用"); failed = true; }
  if (pm[7] !== true) { console.error("✗ 父项未勾选「可为主产品」，金蝶会拒绝保存"); failed = true; }
}
if (cm) {
  if (cm[4] !== "C" || cm[5] !== "A") { console.error("✗ 子项需已审核且未禁用"); failed = true; }
  if (cm[9] !== "K") { console.error(`✗ 子项基本单位是 ${cm[9]}，不是 K，与 1:1 K 口径不符`); failed = true; }
}

console.log("\n=== 预检 2：分组真实存在（按编码查，防止拿名称/样板分组硬套）===");
const gs = await q("ENG_BOM", "FGROUP.FNumber,FGROUP.FName", `FGROUP.FNumber = '${group}'`, 5);
if (!gs.length) { console.error(`✗ 分组编码 ${group} 不存在（注意：要传编码，不是名称）`); failed = true; }
else console.log(`✓ 分组 ${gs[0][0]} 名称=${gs[0][1]}`);

console.log("\n=== 预检 3：父项名下是否已有 BOM / 编号是否重号 ===");
const exist = await q("ENG_BOM", "FID,FNumber,FMaterialId.FNumber,FGROUP.FNumber,FGROUP.FName,FDocumentStatus",
  `FMaterialId.FNumber = '${parent}'`, 20);
console.log(`父项名下已有 BOM: ${exist.length ? JSON.stringify(exist) : "无"}`);
if (exist.length) { console.error("✗ 父项已有 BOM，停止（不要重复建）"); failed = true; }
const dup = await q("ENG_BOM", "FID,FNumber,FDocumentStatus", `FNumber = '${parent}_V1.0'`, 5);
console.log(`编号 ${parent}_V1.0 占用: ${dup.length ? JSON.stringify(dup) : "空闲"}`);
if (dup.length) { console.error("✗ 编号重号，停止"); failed = true; }

console.log("\n=== 预检 4：子项在其他 BOM 的用法（同类口径佐证）===");
const sib = await q("ENG_BOM", "FID,FNumber,FMaterialId.FNumber,FGROUP.FNumber,FGROUP.FName,FDocumentStatus",
  `FMATERIALIDCHILD.FNumber = '${child}'`, 20);
for (const r of sib) console.log(JSON.stringify(r));

if (failed) { console.error("\n预检未通过，终止（未写库）。"); process.exit(2); }
if (!apply) { console.log("\nDRY-RUN 结束（未写库）。加 --apply 执行 Save→提交→审核。"); process.exit(0); }

// ===== Save → Submit → Audit =====
const model = {
  FCreateOrgId: { FNumber: "100" }, FUseOrgId: { FNumber: "100" },
  FMaterialId: { FNumber: parent },
  FGroup: { FNumber: group },
  FTreeEntity: [{
    FMaterialIdChild: { FNumber: child },
    FNumerator: 1, FDenominator: 1, FChildUnitId: { FNumber: "K" },
  }],
};
const save = await api.post("DynamicFormService.Save", { formid: "ENG_BOM", data: { Model: model } });
if (!save?.Result?.ResponseStatus?.IsSuccess) {
  console.error("保存失败:", errOf(save) || JSON.stringify(save));
  process.exit(1);
}
const fid = String(save.Result.Id);
console.log(`保存成功 FID=${fid} 编号=${save.Result.Number}`);
for (const op of ["Submit", "Audit"]) {
  const r = await api.post(`DynamicFormService.${op}`, { formid: "ENG_BOM", data: { Ids: fid } });
  if (!r?.Result?.ResponseStatus?.IsSuccess) { console.error(`${op}失败:`, errOf(r)); process.exit(1); }
  console.log(`${op} 成功`);
}

// ===== 独立回查 =====
const d = (await api.post("DynamicFormService.View", { formid: "ENG_BOM", data: { Id: fid } }))?.Result?.Result;
console.log("=== 执行后复查 ===");
console.log(JSON.stringify({
  no: d?.Number, parent: d?.MATERIALID?.Number, grp: d?.GROUP?.Number, grpName: d?.GROUP?.Name?.[0]?.Value,
  status: d?.DocumentStatus, forbid: d?.ForbidStatus,
  child: (d?.TreeEntity ?? []).map((e) => [e.MATERIALIDCHILD?.Number, e.NUMERATOR, e.DENOMINATOR, e.CHILDUNITID?.Number, e.Id]),
}));
