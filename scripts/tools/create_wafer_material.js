// 客供晶圆对建料（102011 N客供晶圆片 / 102012 N客供蓝膜片）——Save → Submit → Audit → 独立 View 回查
// 默认 dry-run：只做编码/名称/规格预检并打印参数；加 --apply 才写库。
// 实测模板（样板 N102011664 SJS40N10KAR / N102011665 SJS40N10KAR-L）：
//   晶圆片 102011：CHLB01_SYS / ERP1 / K / 购是·存是·销是·产否·委外否 / 批号是 PHBM004
//                  默认仓 CTK04 + 仓位 100015，领料仓同，超收0 短收0，计划策略1 EOQ1，主产品否
//   蓝膜片 102012：CHLB04_SYS / ERP3 / K / 购是·存是·销是·产否·委外是 / 批号是 PHBM004
//                  默认仓 CTK01 + 仓位 100001，领料仓同，超收0 短收0，计划策略1 EOQ1，主产品是
// 用法：
//   bun scripts/tools/create_wafer_material.js --number N102012312 --name "SJS40P6000PAA" \
//       --spec "4.100*2.628(含划片道)" --group 102011 --stock CTK04 --bin 100015 [--apply]
//   bun scripts/tools/create_wafer_material.js --number N102012313 --name "SJS40P6000PAA-L" \
//       --spec "4.100*2.628(含划片道)" --group 102012 --stock CTK01 --bin 100001 \
//       --category CHLB04_SYS --erp 3 --sub-contract --main-prd [--apply]
//
// 仓位与批号规则随族不同，必须照同族最近完整对：
//   --bin 100015 / 100001 + 默认 PHBM004      → SJS40 系（2026-04）
//   --bin 0（不传仓位）+ --no-batch-rule      → APMT/CRMTU/PD620 等族（2026-08 之后）

import { K3CloudWebAPI } from "../../lib/k3/index.js";

const args = process.argv.slice(2);
const get = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const apply = args.includes("--apply");

const number = get("--number");
const name = get("--name");
const spec = get("--spec") ?? " ";
const group = get("--group");
const unit = get("--unit") ?? "K";
const category = get("--category") ?? "CHLB01_SYS"; // 存货类别：原材料/芯片
const erp = get("--erp") ?? "1"; // ERP 分类：1=外购
const stock = get("--stock");
// 仓位：>0 才写 FStockPlaceId/FPickBinId；`--bin 0`（或同族样板仓位为 0 时）一律不传，
// 因为部分客供晶圆族（APMT/CRMTU 等）尽管仓库开了仓位管理，物料默认仓位仍留空(0)。
const binRaw = get("--bin");
const bin = binRaw !== undefined && Number(binRaw) > 0 ? Number(binRaw) : undefined;
const pickStock = get("--pick-stock") ?? stock;
const pickBinRaw = get("--pick-bin") ?? binRaw;
const pickBinId = pickBinRaw !== undefined && Number(pickBinRaw) > 0 ? Number(pickBinRaw) : undefined;
// 批号规则：同族样板规则为空时必须显式 --no-batch-rule，不能默认塞 PHBM004
const noBatchRule = args.includes("--no-batch-rule");
const batchRule = noBatchRule ? undefined : (get("--batch-rule") ?? "PHBM004");
const over = get("--over") ?? "0";
const short = get("--short") ?? "0";
const planStrategy = get("--plan") ?? "1";
const eoq = get("--eoq") ?? "1";
const isSubContract = args.includes("--sub-contract");
const isMainPrd = args.includes("--main-prd");
const taxRate = get("--tax") ?? "SL02_SYS";
const taxType = get("--tax-type") ?? "WLDSFL01_SYS";

if (!number || !name || !group || !stock) {
  console.error("缺少必填参数: --number <编码> --name <名称> --group <102011|102012> --stock <默认仓>");
  process.exit(1);
}
if (!["102011", "102012"].includes(group)) {
  console.error(`分组 ${group} 不在客供晶圆对口径内（应为 102011 或 102012），如确需请改脚本；终止。`);
  process.exit(1);
}
if (bin === undefined && !args.includes("--bin")) {
  console.log("提示: 未传 --bin，默认仓位/领料仓位留空(0)，与近期 APMT/CRMTU 等族口径一致。");
}
if (binRaw !== undefined && bin === undefined) console.log(`提示: --bin ${binRaw} 非正数，按「不写仓位（留空 0）」处理。`);

console.log("=== 客供晶圆建料参数 ===");
console.log(`编码: ${number}`);
console.log(`名称: ${name}`);
console.log(`规格: ${spec}`);
console.log(`分组: ${group}  存货类别: ${category}  ERP: ${erp}  单位: ${unit}`);
console.log(`购/存/销/产/委外/主产品: 是/是/是/否/${isSubContract ? "是" : "否"}/${isMainPrd ? "是" : "否"}`);
console.log(`批号: 是  规则: ${noBatchRule ? "（留空）" : batchRule}`);
console.log(`默认仓: ${stock} 仓位: ${bin ?? "（留空0，不传）"}   领料仓: ${pickStock} 仓位: ${pickBinId ?? "（留空0，不传）"}`);
console.log(`计划策略: ${planStrategy}  EOQ: ${eoq}  完工超收/短收: ${over}/${short}  税: ${taxRate}/${taxType}`);
console.log(apply ? "模式: APPLY（真实写入）" : "模式: DRY-RUN（仅预览）");

const api = new K3CloudWebAPI();
await api.login();

// ===== 预检 =====
const rowsOf = (r) => Array.isArray(r) ? r : (r?.Result?.Rows ? (Array.isArray(r.Result.Rows) ? r.Result.Rows : Object.values(r.Result.Rows)) : Object.values(r ?? {}).filter(Array.isArray).flat());
const chk = async (label, filter) => {
  const rows = rowsOf(await api.post("DynamicFormService.ExecuteBillQuery", {
    data: { FormId: "BD_MATERIAL", FieldKeys: "FNumber,FName,FSpecification,FDocumentStatus,FForbidStatus", FilterString: filter, TopRowCount: 20, StartRow: 0 },
  }));
  console.log(`\n--- 预检 ${label} -> ${rows.length} 行`);
  rows.forEach((r) => console.log("  " + r.join(" | ")));
  return rows;
};
const dupNo = await chk(`编码 ${number}`, `FNumber='${number}'`);
const dupName = await chk(`名称 ${name}`, `FName='${name}'`);
const dupSpec = await chk(`同分组内规格 ${spec}`, `FName='${name}' and FMaterialGroup.FNumber='${group}'`);
if (dupNo.length) { console.error("\n编码已被占用，终止。"); process.exit(1); }
if (dupName.length || dupSpec.length) console.log("\n提示：名称/规格已有现存料，请人工确认是否确实要另建一条（如确为同名不同尺寸，可继续）。");

if (!apply) {
  console.log("\nDRY-RUN 结束（未写库）。");
  process.exit(0);
}

// ===== Save =====
const model = {
  FCreateOrgId: { FNumber: "100" },
  FUseOrgId: { FNumber: "100" },
  FNumber: number,
  FName: name,
  FSpecification: spec,
  FMaterialGroup: { FNumber: group },
  FCategoryID: { FNumber: category },
  SubHeadEntity: {
    FErpClsID: erp,
    FFeatureItem: "1",
    FCategoryID: { FNumber: category },
    FTaxType: { FNumber: taxType },
    FTaxRateId: { FNumber: taxRate },
    FBaseUnitId: { FNumber: unit },
    FIsPurchase: true,
    FIsInventory: true,
    FIsSale: true,
    FIsAsset: false,
    FIsProduce: false,
    FIsSubContract: isSubContract,
    FWEIGHTUNITID: { FNumber: "kg" },
    FVOLUMEUNITID: { FNumber: "m" },
  },
  SubHeadEntity1: {
    FStoreUnitID: { FNumber: unit },
    FIsBatchManage: true,
    ...(batchRule ? { FBatchRuleID: { FNumber: batchRule } } : {}),
    FStockId: { FNumber: stock },
    ...(bin !== undefined ? { FStockPlaceId: bin } : {}),
    FUnitConvertDir: "1",
    FIsLockStock: true,
    FCountCycle: "1",
    FCountDay: 1,
    FCurrencyId: { FNumber: "PRE001" },
    FSNManageType: "1",
    FSNGenerateTime: "1",
  },
  SubHeadEntity2: {
    FSaleUnitId: { FNumber: unit },
    FSalePriceUnitId: { FNumber: unit },
    FIsReturn: true,
    FISAFTERSALE: true,
    FISPRODUCTFILES: true,
    FWARRANTYUNITID: "D",
    FOutLmtUnit: "SAL",
  },
  SubHeadEntity3: {
    FPurchaseUnitId: { FNumber: unit },
    FPurchasePriceUnitId: { FNumber: unit },
    FIsReturnMaterial: true,
    FPrintCount: 1,
    FMinPackCount: 1,
  },
  SubHeadEntity4: {
    FPlanningStrategy: planStrategy,
    FPlanIntervalsDays: 1,
    FMaxPOQty: 100000,
    FWriteOffQty: 1,
    FEOQ: eoq,
  },
  SubHeadEntity5: {
    FBOMUnitId: { FNumber: unit },
    FProduceUnitId: { FNumber: unit },
    FPickStockId: { FNumber: pickStock },
    ...(pickBinId !== undefined ? { FPickBinId: pickBinId } : {}),
    FIsMainPrd: isMainPrd,
    FFinishReceiptOverRate: over,
    FFinishReceiptShortRate: short,
    FIssueType: "3",
    FMinIssueQty: 1,
    FMinIssueUnitId: { FNumber: unit },
    FStandHourUnitId: "3600",
    FBackFlushType: "1",
  },
};

console.log("\n正在保存...");
const save = await api.post("DynamicFormService.Save", { formid: "BD_MATERIAL", data: { Model: model } });
const rs = save?.Result?.ResponseStatus;
if (!rs?.IsSuccess) {
  console.error("保存失败:", (rs?.Errors ?? []).map((e) => e.Message).join("; "));
  process.exit(1);
}
const fid = String(save.Result.Id);
console.log(`保存成功: Id=${fid}, Number=${save.Result.Number}`);

for (const [op, call] of [
  ["提交", () => api.post("DynamicFormService.Submit", { formid: "BD_MATERIAL", data: { Ids: fid } })],
  ["审核", () => api.post("DynamicFormService.Audit", { formid: "BD_MATERIAL", data: { Ids: fid } })],
]) {
  console.log(`正在${op}...`);
  const r = await call();
  if (!r?.Result?.ResponseStatus?.IsSuccess) {
    console.error(`${op}失败:`, (r?.Result?.ResponseStatus?.Errors ?? []).map((e) => e.Message).join("; "));
    process.exit(1);
  }
  console.log(`${op}成功`);
}

// ===== 独立 View 回查 =====
const v = await api.post("DynamicFormService.View", { formid: "BD_MATERIAL", data: { Number: number } });
const d = v?.Result?.Result;
if (!d) { console.error("回查失败：View 无数据"); process.exit(1); }
const b = d.MaterialBase?.[0] ?? {}, s = d.MaterialStock?.[0] ?? {}, p = d.MaterialProduce?.[0] ?? {}, pl = d.MaterialPlan?.[0] ?? {};
console.log("=== 执行后复查（View） ===");
console.log(`编码/名称/规格: ${d.Number} / ${d.Name?.find((x) => x.Key === 2052)?.Value} / ${d.Specification?.find((x) => x.Key === 2052)?.Value}`);
console.log(`状态: ${d.DocumentStatus}  禁用: ${d.ForbidStatus}  分组: ${d.MaterialGroup?.Number}`);
console.log(`ERP/类别: ${b.ErpClsID} / ${b.CategoryID?.Number}  单位: ${b.BaseUnitId?.Number}`);
console.log(`购/存/销/产/资产/委外: ${b.IsPurchase}/${b.IsInventory}/${b.IsSale}/${b.IsProduce}/${b.IsAsset}/${b.IsSubContract}`);
console.log(`批号: ${s.IsBatchManage} 规则: ${s.BatchRuleID?.Number} 仓: ${s.StockId?.Number} 仓位Id: ${s.StockPlaceId_Id}`);
console.log(`领料仓: ${p.PickStockId?.Number} 领料仓位Id: ${p.PickBinId_Id} 超短收: ${p.FinishReceiptOverRate}/${p.FinishReceiptShortRate} 主产品: ${p.IsMainPrd}`);
console.log(`计划策略: ${pl.PlanningStrategy}  EOQ: ${pl.EOQ}  税率: ${b.TaxRateId?.Number}`);
