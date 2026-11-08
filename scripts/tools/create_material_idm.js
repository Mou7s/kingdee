// IDM 自制成品建料（默认模板 AD004 · SOD-323 开关管）
// 用法:
//   bun scripts/tools/create_material_idm.js --number NAD0040029 --name "TKBAV3004WS" --spec "SOD-323/3K盘/无/4P"
//   ... --apply 真实写入
// 默认 dry-run 只做预检与预览。写入流程：重码预检 -> Save(带批号规则/默认仓+仓位/领料仓+仓位/完工超短收率) -> Submit -> Audit -> 独立 View 回查。

import { K3CloudWebAPI } from "../../k3cloud.js";

const args = process.argv.slice(2);
const get = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : dflt;
};
const apply = args.includes("--apply");
const allowSameName = args.includes("--allow-same-name"); // 同型号不同印字时名称必然重复，显式放行

const number = get("--number");
const name = get("--name");
const spec = get("--spec", " ");
const group = get("--group", "AD004");
const unit = get("--unit", "K");
const category = get("--category", "CHLB05_SYS"); // 存货类别：产成品
const erp = get("--erp", "2"); // ERP 分类：2=自制
const stock = get("--stock", "CTK10");
const place = Number(get("--place", "100034")); // 默认仓位/领料仓位数值 ID
const batchRule = get("--batch-rule", "PHBM004");
const over = Number(get("--over", "500"));
const short = Number(get("--short", "5"));
const taxRate = get("--tax", "SL02_SYS");

if (!number || !name) {
  console.error("缺少必填参数: --number <编码> --name <名称>");
  process.exit(1);
}

console.log("=== 建料参数（IDM 自制成品） ===");
console.log(`编码: ${number}`);
console.log(`名称: ${name}`);
console.log(`规格: ${spec}`);
console.log(`分组: ${group}  单位: ${unit}  存货类别: ${category}  ERP: ${erp}`);
console.log(`默认仓: ${stock} / 仓位 ${place}  领料仓: ${stock} / 仓位 ${place}`);
console.log(`批号管理: 是  批号规则: ${batchRule}  完工超收/短收: ${over}/${short}`);
console.log(`购/存/销/产: 否/是/是/是   税率: ${taxRate}`);
console.log(apply ? "模式: APPLY（真实写入）" : "模式: DRY-RUN（仅预览，加 --apply 执行）");

const api = new K3CloudWebAPI();
await api.login();

// ===== 预检：编码 / 名称 / 规格占用 =====
const chk = async (label, filter) => {
  const raw = await api.post("DynamicFormService.ExecuteBillQuery", {
    data: {
      FormId: "BD_MATERIAL",
      FieldKeys: "FNumber,FName,FSpecification,FDocumentStatus,FForbidStatus",
      FilterString: filter,
      TopRowCount: 20,
    },
  });
  const rows = raw?.Result?.Result ?? raw?.Result?.Rows ?? raw;
  console.log(`\n--- ${label} -> ${Array.isArray(rows) ? rows.length : "?"} 行`);
  if (Array.isArray(rows)) rows.forEach((r) => console.log("  " + r.join(" | ")));
  return Array.isArray(rows) ? rows : [];
};

await chk("自检 N401000288", "FNumber='N401000288'");
const dupNo = await chk(`编码 ${number}`, `FNumber='${number}'`);
const dupName = await chk(`名称 ${name}`, `FName='${name}'`);
const dupSpec = await chk(`同分组内规格 ${spec}`, `FSpecification='${spec}' and FMaterialGroup.FNumber='${group}'`);
if (dupNo.length || (dupName.length && !allowSameName)) {
  console.error("\n预检不通过：编码已被占用" + (dupName.length && !allowSameName ? "，名称也已被占用" : "") + "，终止。");
  process.exit(1);
}
if (dupName.length && allowSameName) {
  console.log(`\n提示：名称 ${name} 已有 ${dupName.length} 条现存料（同型号不同印字属正常），已按 --allow-same-name 放行；请人工确认印字/规格确为变体。`);
}
if (dupSpec.length) console.log("\n提示：同分组已存在相同规格，请人工确认是否为不同丝印/变体。");

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
  FCategoryID: { FNumber: category }, // 存货类别必须放 Model 顶层
  SubHeadEntity: {
    FErpClsID: erp,
    FFeatureItem: "1",
    FCategoryID: { FNumber: category },
    FTaxType: { FNumber: "WLDSFL01_SYS" },
    FTaxRateId: { FNumber: taxRate },
    FBaseUnitId: { FNumber: unit },
    FIsPurchase: false,
    FIsInventory: true,
    FIsSale: true,
    FIsProduce: true,
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
    FFinishReceiptOverRate: over,
    FFinishReceiptShortRate: short,
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

// ===== 独立回查 =====
const v = await api.post("DynamicFormService.View", { formid: "BD_MATERIAL", data: { Number: number } });
const d = v?.Result?.Result;
const mb = d?.MaterialBase?.[0] ?? {};
const ms = d?.MaterialStock?.[0] ?? {};
const mp = d?.MaterialProduce?.[0] ?? {};
console.log("\n=== 独立 View 回查 ===");
console.log(`编码/名称/规格: ${d?.Number} | ${d?.Name?.find((x) => x.Key === 2052)?.Value} | ${d?.Specification?.[0]?.Value}`);
console.log(`状态: ${d?.DocumentStatus}  禁用: ${d?.ForbidStatus}  分组: ${d?.MaterialGroup?.Number}`);
console.log(`存货类别: ${mb.CategoryID}  ERP: ${mb.ErpClsID}  基本单位: ${mb.BaseUnitId}  税率: ${mb.TaxRateId}`);
console.log(`购/存/销/产/资产: ${mb.IsPurchase}/${mb.IsInventory}/${mb.IsSale}/${mb.IsProduce}/${mb.IsAsset}`);
console.log(`批号管理: ${ms.IsBatchManage}  批号规则: ${ms.BatchRuleID}  默认仓: ${ms.StockId}  默认仓位: ${ms.StockPlaceId_Id}`);
console.log(`领料仓: ${mp.PickStockId}  领料仓位: ${mp.PickBinId_Id}  完工超收/短收: ${mp.FinishReceiptOverRate}/${mp.FinishReceiptShortRate}`);
console.log(`BOM单位: ${mp.BOMUnitId}  生产单位: ${mp.ProduceUnitId}  计划策略: ${d?.MaterialPlan?.[0]?.PlanningStrategy}`);

const q = await api.post("DynamicFormService.ExecuteBillQuery", {
  data: {
    FormId: "BD_MATERIAL",
    FieldKeys: "FNumber,FName,FSpecification,FDocumentStatus,FForbidStatus,FIsProduce,FIsPurchase,FIsInventory,FIsSale,FMaterialGroup.FNumber",
    FilterString: `FNumber='${number}'`,
    TopRowCount: 5,
  },
});
const rows = q?.Result?.Result ?? q?.Result?.Rows ?? q;
console.log("\n=== executeBillQuery 回查 ===");
for (const r of rows ?? []) console.log("  " + r.join(" | "));
