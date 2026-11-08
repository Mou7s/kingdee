// 外购（D 段）建料专用脚本：Save -> Submit -> Audit -> 独立 View 回查
// 适用模板（实测 DS003/DB041/DM006/DF028/DI071/DM013 同构）：
//   CHLB09_SYS 库存商品 / ERP1 外购 / 单位 K / 购是·存是·销是·产否 /
//   批号是 + 规则 PHBM004 / 默认仓 + 仓位 / 领料仓 + 仓位 / 计划策略1 + EOQ1 / SL02_SYS
// 用法（默认 dry-run）：
//   bun scripts/tools/create_external_material.js --number NDM0130024 --name "CTKD80P06" \
//       --spec "TO-252" --group DM013 --stock CTK13 --bin 100042 [--pick-stock CTK13] [--pick-bin 100042]
//       [--category CHLB02_SYS] [--unit Pcs] [--no-sale] [--apply]
// 通用 create_material.js 传不了仓位与批号规则，外购 D 段一律用本脚本。

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
const category = get("--category") ?? "CHLB09_SYS";
const taxRate = get("--tax") ?? "SL02_SYS";
const taxType = get("--tax-type") ?? "WLDSFL01_SYS";
const erpClass = get("--erp") ?? "1";
const stock = get("--stock");
const binId = get("--bin") ? Number(get("--bin")) : undefined;
const pickStock = get("--pick-stock") ?? stock;
const pickBin = get("--pick-bin") ?? get("--bin");
const pickBinId = pickBin !== undefined ? Number(pickBin) : undefined;
const batchRule = get("--batch-rule") ?? "PHBM004";
const noSale = args.includes("--no-sale"); // 销否类（如 11102 劈刀/备件）必须显式关闭销售
const overRate = get("--over") ?? "0";
const shortRate = get("--short") ?? "0";
const planStrategy = get("--plan") ?? "1";
const eoq = get("--eoq") ?? "1";

if (!number || !name || !group || !stock) {
  console.error("缺少必填参数: --number <编码> --name <名称> --group <分组> --stock <默认仓>");
  process.exit(1);
}

console.log("=== 外购建料参数 ===");
console.log(`编码: ${number}`);
console.log(`名称: ${name}`);
console.log(`规格: ${spec}`);
console.log(`分组: ${group}  存货类别: ${category}  ERP分类: ${erpClass}  税率: ${taxRate}/${taxType}`);
console.log(`单位: ${unit}  批号: true 规则: ${batchRule}`);
console.log(`默认仓: ${stock} 仓位: ${binId}   领料仓: ${pickStock} 仓位: ${pickBinId}`);
console.log(`计划策略: ${planStrategy}  EOQ: ${eoq}  完工超收/短收: ${overRate}/${shortRate}`);
console.log(apply ? "模式: APPLY（真实写入）" : "模式: DRY-RUN（仅预览，加 --apply 执行）");

if (!apply) process.exit(0);

const api = new K3CloudWebAPI();
await api.login();

// ===== 重码预检 =====
const dup = await api.executeBillQuery("BD_MATERIAL", "FNumber,FName,FDocumentStatus", `FNumber='${number}'`, 5);
if (dup.length > 0) {
  console.error(`编码已存在: ${JSON.stringify(dup[0])}，终止。`);
  process.exit(1);
}
console.log("重码预检通过（编码未占用）");

const model = {
  FCreateOrgId: { FNumber: "100" },
  FUseOrgId: { FNumber: "100" },
  FNumber: number,
  FName: name,
  FSpecification: spec,
  FMaterialGroup: { FNumber: group },
  FCategoryID: { FNumber: category }, // 存货类别必须放 Model 顶层
  SubHeadEntity: {
    FErpClsID: erpClass,
    FFeatureItem: "1",
    FCategoryID: { FNumber: category },
    FTaxType: { FNumber: taxType },
    FTaxRateId: { FNumber: taxRate },
    FBaseUnitId: { FNumber: unit },
    FIsPurchase: true,
    FIsInventory: true,
    FIsSale: !noSale,
    FIsAsset: false,
    FIsProduce: false,
    FIsSubContract: false,
    FWEIGHTUNITID: { FNumber: "kg" },
    FVOLUMEUNITID: { FNumber: "m" },
  },
  SubHeadEntity1: {
    FStoreUnitID: { FNumber: unit },
    FIsBatchManage: true,
    FBatchRuleID: { FNumber: batchRule },
    FStockId: { FNumber: stock },
    ...(binId !== undefined ? { FStockPlaceId: binId } : {}),
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
    FFinishReceiptOverRate: overRate,
    FFinishReceiptShortRate: shortRate,
    FIssueType: "3",
    FMinIssueQty: 1,
    FMinIssueUnitId: { FNumber: unit },
    FStandHourUnitId: "3600",
    FBackFlushType: "1",
  },
};

console.log("正在保存...");
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
if (!d) {
  console.error("回查失败：View 无数据");
  process.exit(1);
}
const b = d.MaterialBase?.[0] ?? {};
const s = d.MaterialStock?.[0] ?? {};
const p = d.MaterialProduce?.[0] ?? {};
const pl = d.MaterialPlan?.[0] ?? {};
console.log("=== 执行后复查（View） ===");
console.log(`编码/名称/规格: ${d.Number} / ${d.Name?.find((x) => x.Key === 2052)?.Value} / ${d.Specification?.find((x) => x.Key === 2052)?.Value}`);
console.log(`状态: ${d.DocumentStatus}  禁用: ${d.ForbidStatus}  分组: ${d.MaterialGroup?.Number}`);
console.log(`ERP/类别: ${b.ErpClsID} / ${b.CategoryID?.Number}`);
console.log(`购/存/销/产: ${b.IsPurchase}/${b.IsInventory}/${b.IsSale}/${b.IsProduce}  单位: ${b.BaseUnitId?.Number}`);
console.log(`批号: ${s.IsBatchManage}  规则: ${s.BatchRuleID?.Number}  仓: ${s.StockId?.Number}  仓位Id: ${s.StockPlaceId_Id}`);
console.log(`领料仓: ${p.PickStockId?.Number}  领料仓位Id: ${p.PickBinId_Id}  超短收: ${p.FinishReceiptOverRate}/${p.FinishReceiptShortRate}`);
console.log(`计划策略: ${pl.PlanningStrategy}  EOQ: ${pl.EOQ}  税: ${b.TaxRateId?.Number}`);
