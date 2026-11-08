// 蓝膜 BOM 建单：父项 -L 蓝膜片 → 子项不带 L 晶圆片，1:1、单位 K、分组 0-lm（蓝膜）
// 模板：N102012246_V1.0（.agents/skills/kingdee-materials-bom/references/materials/bom-usage-and-batch-update.md §12）
// 默认 dry-run（做父项状态/主产品/已有 BOM 预检）；加 --apply 才写库：Save → Submit → Audit → View 回查
// 用法：bun scripts/tools/create_lm_bom.js --parent N102012313 --child N102012312 [--apply]

import { K3CloudWebAPI } from "../../lib/k3/index.js";

const args = process.argv.slice(2);
const get = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const apply = args.includes("--apply");
const parent = get("--parent");
const child = get("--child");
if (!parent || !child) { console.error("缺少必填参数: --parent <L蓝膜片> --child <晶圆片>"); process.exit(1); }

console.log("=== 蓝膜 BOM 参数 ===");
console.log(`父项: ${parent}（应为 -L 蓝膜片）  子项: ${child}（应为不带 L 晶圆片）  分组: 0-lm  用量: 1:1 K`);
console.log(apply ? "模式: APPLY（Save→提交→审核）" : "模式: DRY-RUN（仅预览）");

const api = new K3CloudWebAPI();
await api.login();
const rowsOf = (r) => Array.isArray(r) ? r : (r?.Result?.Rows ? (Array.isArray(r.Result.Rows) ? r.Result.Rows : Object.values(r.Result.Rows)) : Object.values(r ?? {}).filter(Array.isArray).flat());
const q = async (form, fields, filter, top = 10) => rowsOf(await api.post("DynamicFormService.ExecuteBillQuery", { data: { FormId: form, FieldKeys: fields, FilterString: filter, TopRowCount: top, StartRow: 0 } }));

// ===== 预检 =====
const pv = await api.post("DynamicFormService.View", { formid: "BD_MATERIAL", data: { Number: parent } });
const pd = pv?.Result?.Result;
const cv = await api.post("DynamicFormService.View", { formid: "BD_MATERIAL", data: { Number: child } });
const cd = cv?.Result?.Result;
if (!pd || !cd) { console.error("父项或子项物料不存在，终止。"); process.exit(1); }
const pms = pd.MaterialProduce?.[0] ?? {}, cms = cd.MaterialProduce?.[0] ?? {};
console.log(`\n父项 ${pd.Number} ${pd.Name?.find?.(x => x.Key === 2052)?.Value} 状态=${pd.DocumentStatus} 禁用=${pd.ForbidStatus} 分组=${pd.MaterialGroup?.Number} 主产品=${pms.IsMainPrd}`);
console.log(`子项 ${cd.Number} ${cd.Name?.find?.(x => x.Key === 2052)?.Value} 状态=${cd.DocumentStatus} 分组=${cd.MaterialGroup?.Number}`);
if (pd.DocumentStatus !== "C") { console.error("父项未审核（需 C），终止。"); process.exit(1); }
if (pms.IsMainPrd !== true) { console.error("父项未勾选「可为主产品」，金蝶会报父项错误，终止。"); process.exit(1); }
const exist = await q("ENG_BOM", "FID,FNumber,FMaterialId.FNumber,FDocumentStatus", `FNumber like '${parent}%'`);
console.log(`父项已有 BOM: ${exist.length ? JSON.stringify(exist) : "无"}`);
if (exist.length) { console.error("父项已有 BOM，终止（不要重复建）。"); process.exit(1); }

if (!apply) { console.log("\nDRY-RUN 结束（未写库）。"); process.exit(0); }

// ===== Save → Submit → Audit =====
const model = {
  FCreateOrgId: { FNumber: "100" }, FUseOrgId: { FNumber: "100" },
  FMaterialId: { FNumber: parent },
  FGroup: { FNumber: "0-lm" },
  FTreeEntity: [{
    FMaterialIdChild: { FNumber: child },
    FNumerator: 1, FDenominator: 1, FChildUnitId: { FNumber: "K" },
  }],
};
const save = await api.post("DynamicFormService.Save", { formid: "ENG_BOM", data: { Model: model } });
if (!save?.Result?.ResponseStatus?.IsSuccess) {
  console.error("保存失败:", (save?.Result?.ResponseStatus?.Errors ?? []).map((e) => e.Message).join("; "));
  process.exit(1);
}
const fid = String(save.Result.Id);
console.log(`保存成功 FID=${fid} 编号=${save.Result.Number}`);
for (const op of ["Submit", "Audit"]) {
  const r = await api.post(`DynamicFormService.${op}`, { formid: "ENG_BOM", data: { Ids: fid } });
  if (!r?.Result?.ResponseStatus?.IsSuccess) { console.error(`${op}失败:`, (r?.Result?.ResponseStatus?.Errors ?? []).map((e) => e.Message).join("; ")); process.exit(1); }
  console.log(`${op}成功`);
}

// ===== 独立回查 =====
const v = await api.post("DynamicFormService.View", { formid: "ENG_BOM", data: { Id: fid } });
const d = v?.Result?.Result;
console.log("=== 执行后复查 ===");
console.log(JSON.stringify({ no: d?.Number, parent: d?.MATERIALID?.Number, grp: d?.GROUP?.Number, status: d?.DocumentStatus, forbid: d?.ForbidStatus, child: (d?.TreeEntity ?? []).map((e) => [e.MATERIALIDCHILD?.Number, e.NUMERATOR, e.DENOMINATOR, e.CHILDUNITID?.Number, e.Id]) }));
