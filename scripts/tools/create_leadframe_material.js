#!/usr/bin/env bun
/**
 * 框架类原材料建料（10501 铜框架 / 10502 铁镍框架 等）—— 默认 dry-run
 *
 * 实测模板（N105010017/019/021/022 与 N105020001~006 完全一致）：
 *   存货类别 CHLB01_SYS 原材料 / ERP 1 外购 / 单位 K
 *   购是 · 存是 · 销否 · 产否 · 资产否 · 委外否
 *   批号是 + 规则 PHBM004 / 默认仓 CTK01 + 仓位 100002 / 领料仓同 / 完工超收0·短收0
 *   计划策略 1 / EOQ 1 / 税率 SL02_SYS + 税种 WLDSFL01_SYS
 *
 * 用法：
 *   bun scripts/tools/create_leadframe_material.js --number N105020007 --name "铁镍框架" --spec "SOT-23-3L(27R)(32x36)-A(Ni)" --group 10502
 *   ... --apply 真实写入（Save → Submit → Audit → 独立 View 回查）
 */

import { K3CloudWebAPI } from "../../lib/k3/index.js";

const args = process.argv.slice(2);
const get = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : dflt;
};
const apply = args.includes("--apply");

const number = get("--number");
const name = get("--name");
const spec = get("--spec", " ");
const group = get("--group", "10502");
const unit = get("--unit", "K");
const category = get("--category", "CHLB01_SYS");
const erp = get("--erp", "1");
const stock = get("--stock", "CTK01");
const place = Number(get("--place", "100002"));
const batchRule = get("--batch-rule", "PHBM004");
const taxRate = get("--tax", "SL02_SYS");

if (!number || !name) {
  console.error("缺少必填参数: --number <编码> --name <名称> [--spec <规格>] [--group <分组>]");
  process.exit(1);
}

console.log("=== 建料参数（框架类原材料） ===");
console.log(`编码: ${number}`);
console.log(`名称: ${name}`);
console.log(`规格: ${spec}`);
console.log(`分组: ${group}  单位: ${unit}  存货类别: ${category}  ERP: ${erp}`);
console.log(`默认仓: ${stock} / 仓位 ${place}  领料仓: ${stock} / 仓位 ${place}`);
console.log(`批号管理: 是  批号规则: ${batchRule}  完工超收/短收: 0/0`);
console.log(`购/存/销/产: 是/是/否/否   税率: ${taxRate}`);
console.log(apply ? "模式: APPLY（真实写入）" : "模式: DRY-RUN（仅预览，加 --apply 执行）");

const api = new K3CloudWebAPI();
await api.login();

const q = async (label, filter) => {
  const raw = await api.post("DynamicFormService.ExecuteBillQuery", {
    data: {
      FormId: "BD_MATERIAL",
      FieldKeys: "FNumber,FName,FSpecification,FMaterialGroup.FNumber,FDocumentStatus,FForbidStatus",
      FilterString: filter,
      TopRowCount: 20,
    },
  });
  const rows = raw?.Result?.Result ?? raw?.Result?.Rows ?? raw;
  console.log(`\n--- ${label} -> ${Array.isArray(rows) ? rows.length : "?"} 行`);
  if (Array.isArray(rows)) rows.forEach((r) => console.log("  " + r.join(" | ")));
  return Array.isArray(rows) ? rows : [];
};

await q("自检 N105020001", "FNumber='N105020001'");
const dupNo = await q(`编码 ${number}`, `FNumber='${number}'`);
const dupSpec = await q(`同分组内规格 ${spec}`, `FSpecification='${spec}' and FMaterialGroup.FNumber='${group}'`);
const dupNameSpec = await q(`同分组内名称+规格`, `FName='${name}' and FSpecification='${spec}' and FMaterialGroup.FNumber='${group}'`);
if (dupNo.length) {
  console.error("\n预检不通过：编码已被占用，终止。");
  process.exit(1);
}
if (dupNameSpec.length) {
  console.error("\n预检不通过：同分组内已有相同名称+规格，终止（如需并行版本请人工确认后另议）。");
  process.exit(1);
}
if (dupSpec.length) console.log("\n提示：同分组已存在相同规格，请人工确认是否为不同镀层/变体。");

if (!apply) {
  console.log("\nDRY-RUN 结束（未写库）。");
  process.exit(0);
}

const model = {
  FCreateOrgId: { FNumber: "100" },
  FUseOrgId: { FNumber: "100" },
  FNumber: number,
  FName: name,
  FSpecification: spec,
  FMaterialGroup: { FNumber: group },
  FCategoryID: { FNumber: category }, // 存货类别必须放 Model 顶层
  SubHeadEntity: {
    FErpClsID: erp,
    FFeatureItem: "1",
    FCategoryID: { FNumber: category },
    FTaxType: { FNumber: "WLDSFL01_SYS" },
    FTaxRateId: { FNumber: taxRate },
    FBaseUnitId: { FNumber: unit },
    FIsPurchase: true,
    FIsInventory: true,
    FIsSale: false,
    FIsProduce: false,
    FIsAsset: false,
    FIsSubContract: false,
    FWEIGHTUNITID: { FNumber: "kg" },
    FVOLUMEUNITID: { FNumber: "m" },
  },
  SubHeadEntity1: {
    FStoreUnitID: { FNumber: unit },
    FIsBatchManage: true,
    FBatchRuleID: { FNumber: batchRule },
    FStockId: { FNumber: stock },
    FStockPlaceId: place,
    FUnitConvertDir: "1",
    FIsLockStock: true,
    FCountCycle: "1",
    FCountDay: 1,
    FCurrencyId: { FNumber: "PRE001" },
  },
  SubHeadEntity2: {
    FSaleUnitId: { FNumber: unit },
    FSalePriceUnitId: { FNumber: unit },
  },
  SubHeadEntity3: {
    FPurchaseUnitId: { FNumber: unit },
    FPurchasePriceUnitId: { FNumber: unit },
    FIsReturnMaterial: true,
    FPrintCount: 1,
    FMinPackCount: 1,
  },
  SubHeadEntity4: {
    FPlanningStrategy: "1",
    FPlanIntervalsDays: 1,
    FEOQ: 1,
    FMaxPOQty: 100000,
    FWriteOffQty: 1,
  },
  SubHeadEntity5: {
    FBOMUnitId: { FNumber: unit },
    FProduceUnitId: { FNumber: unit },
    FPickStockId: { FNumber: stock },
    FPickBinId: place,
    FIssueType: "3",
    FMinIssueQty: 1,
    FMinIssueUnitId: { FNumber: unit },
    FStandHourUnitId: "3600",
    FBackFlushType: "1",
    FFinishReceiptOverRate: 0,
    FFinishReceiptShortRate: 0,
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

const submit = await api.post("DynamicFormService.Submit", { formid: "BD_MATERIAL", data: { Ids: fid } });
if (!submit?.Result?.ResponseStatus?.IsSuccess) {
  console.error("提交失败:", (submit?.Result?.ResponseStatus?.Errors ?? []).map((e) => e.Message).join("; "));
  process.exit(1);
}
console.log("提交成功");

const audit = await api.post("DynamicFormService.Audit", { formid: "BD_MATERIAL", data: { Ids: fid } });
if (!audit?.Result?.ResponseStatus?.IsSuccess) {
  console.error("审核失败:", (audit?.Result?.ResponseStatus?.Errors ?? []).map((e) => e.Message).join("; "));
  process.exit(1);
}
console.log("审核成功");

const v = await api.post("DynamicFormService.View", { formid: "BD_MATERIAL", data: { Number: number } });
const d = v?.Result?.Result;
const mb = d?.MaterialBase?.[0] ?? {}, ms = d?.MaterialStock?.[0] ?? {}, mp = d?.MaterialProduce?.[0] ?? {}, pl = d?.MaterialPlan?.[0] ?? {};
console.log("\n=== 独立 View 回查 ===");
console.log(JSON.stringify({
  Number: d?.Number,
  Name: d?.Name?.find?.((x) => x.Key === 2052)?.Value,
  Spec: d?.Specification?.find?.((x) => x.Key === 2052)?.Value,
  Group: d?.MaterialGroup?.Number, Status: d?.DocumentStatus, Forbid: d?.ForbidStatus,
  Category: mb?.CategoryID?.Number, ERP: mb?.ErpClsID,
  购: mb?.IsPurchase, 存: mb?.IsInventory, 销: mb?.IsSale, 产: mb?.IsProduce,
  单位: mb?.BaseUnitId?.Number, 库存单位: ms?.StoreUnitID?.Number,
  批号: ms?.IsBatchManage, 批号规则: ms?.BatchRuleID?.Number,
  默认仓: ms?.StockId?.Number, 默认仓位: ms?.StockPlaceId_Id,
  领料仓: mp?.PickStockId?.Number, 领料仓位: mp?.PickBinId_Id,
  超收: mp?.FinishReceiptOverRate, 短收: mp?.FinishReceiptShortRate,
  计划策略: pl?.PlanningStrategy, EOQ: pl?.EOQ, 税率: mb?.TaxRateId?.Number,
}, null, 1));
