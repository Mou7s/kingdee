// 301 设备备件组建料专用：Save -> Submit -> Audit -> 与同组样板逐字段 diff
// 适用模板（30103/30104/30105/30107/30108/30109 实测统一）：
//   CHLB10_SYS 设备配件 / ERP1 外购 / Pcs / 购是·存是·销否·产否 / 批号否 / 计划策略1 / SL02_SYS
//   默认仓按该组最近 10 条实际值（30108 现为 CTK05 设备配件仓，旧数据为 CTK03 辅材仓），仓位 0
// 用法（默认 dry-run，加 --apply 才写）：
//   bun scripts/tools/create_equipment_part_material.js --name "白色进口硅胶" --spec "ZP-03S" --group 30108
//   [--number N301080162] [--stock CTK05] [--unit Pcs] [--category CHLB10_SYS] [--erp 1] [--sale] [--batch]
//   [--sample N301080160] [--apply]
// 编号规则：不给 --number 时按 N<组号> 段最大流水 +1 自动取号，写入前精确查占用。

import { K3CloudWebAPI } from "../../lib/k3/index.js";

const args = process.argv.slice(2);
const get = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const apply = args.includes("--apply");
const isSale = args.includes("--sale"); // 默认销否（设备备件口径）
const isBatch = args.includes("--batch"); // 默认批号否

let number = get("--number");
const name = get("--name");
const spec = get("--spec") ?? " ";
const group = get("--group");
let stock = get("--stock");
const unit = get("--unit") ?? "Pcs";
const category = get("--category") ?? "CHLB10_SYS";
const erpClass = get("--erp") ?? "1";
const taxRate = get("--tax") ?? "SL02_SYS";
let sample = get("--sample");

if (!name || !group) {
  console.error("缺少必填参数: --name <名称> --group <分组，如 30108>");
  process.exit(1);
}

const api = new K3CloudWebAPI();
await api.login();

const FIELDS =
  "FNumber,FName,FSpecification,FMaterialGroup.FNumber,FMaterialGroup.FName,FBaseUnitId.FNumber,FDocumentStatus,FForbidStatus,FCreateDate,FStockId.FNumber,FStockId.FName,FIsBatchManage,FPlanningStrategy,FCategoryID.FNumber,FErpClsID,FIsSale,FIsPurchase,FIsInventory,FIsProduce";

// ===== 自动取号 + 定仓 + 定样板 =====
const groupRows = await api.executeBillQuery(
  "BD_MATERIAL",
  FIELDS,
  `FMaterialGroup.FNumber='${group}'`,
  500,
);
if (groupRows.length === 0) {
  console.error(`分组 ${group} 下没有现役物料，无法取模板，终止。`);
  process.exit(1);
}
const recent = groupRows
  .slice()
  .sort((a, b) => String(a[8]).localeCompare(String(b[8])))
  .slice(-10);
if (!stock) {
  const cnt = {};
  for (const r of recent) cnt[r[9]] = (cnt[r[9]] ?? 0) + 1;
  stock = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
}
if (!sample) sample = recent[recent.length - 1][0];
const sampleRow = groupRows.find((r) => r[0] === sample);
if (!sampleRow) throw new Error(`样板 ${sample} 不在分组 ${group} 查询结果中`);

if (!number) {
  const all = await api.executeBillQuery(
    "BD_MATERIAL",
    "FNumber",
    `FNumber like 'N${group}%'`,
    500,
  );
  const nums = all
    .map((r) => r[0])
    .filter((n) => new RegExp(`^N${group}\\d+$`).test(n))
    .sort();
  const max = nums[nums.length - 1];
  number = "N" + group + String(Number(max.slice(1 + group.length)) + 1).padStart(max.length - 1 - group.length, "0");
}

console.log("=== 建料参数 ===");
console.log(`编码: ${number}${get("--number") ? "（指定）" : "（按 " + group + " 段最大号顺延）"}`);
console.log(`名称: ${name}`);
console.log(`规格: ${spec}`);
console.log(`分组: ${group}  存货类别: ${category}  ERP分类: ${erpClass}  税率: ${taxRate}`);
console.log(`单位: ${unit}  批号: ${isBatch}  默认仓: ${stock}  允许销售: ${isSale}`);
console.log(`对标样板: ${sample} (${sampleRow[1]} / ${sampleRow[2]})`);
console.log(`该组近 10 条默认仓分布: ${JSON.stringify(
  recent.reduce((m, r) => ((m[r[9]] = (m[r[9]] ?? 0) + 1), m), {}),
)}`);
console.log(apply ? "模式: APPLY（真实写入）" : "模式: DRY-RUN（仅预览，加 --apply 执行）");
if (!apply) process.exit(0);

// ===== 预检 1：编码占用 =====
const dup = await api.executeBillQuery(
  "BD_MATERIAL",
  "FNumber,FName,FDocumentStatus",
  `FNumber='${number}'`,
  5,
);
if (dup.length > 0) {
  console.error(`编码已占用: ${dup.map((r) => r.join(" | ")).join("; ")}，终止。`);
  process.exit(1);
}
console.log("预检1 通过：编码未被占用");

// ===== 预检 2：同组同名同规格 =====
const same = await api.executeBillQuery(
  "BD_MATERIAL",
  "FNumber,FName,FSpecification,FDocumentStatus,FForbidStatus",
  `FName='${name}' and FMaterialGroup.FNumber='${group}'`,
  50,
);
const exact = same.filter((r) => ((r[2] ?? "").trim() || " ") === (spec.trim() || " "));
console.log(
  `预检2：同组同名 ${same.length} 条${same.length ? " -> " + same.map((r) => r.join(" | ")).join("; ") : ""}`,
);
if (exact.length > 0) {
  console.error(`同组同名同规格已存在: ${exact.map((r) => r.join(" | ")).join("; ")}，终止。`);
  process.exit(1);
}
if (same.length > 0) console.log("预检2 通过：同名但规格不同，按设备备件口径允许新条");

// ===== 预检 3：全库名称/规格兜底 =====
const wide = await api.executeBillQuery(
  "BD_MATERIAL",
  "FNumber,FName,FSpecification,FMaterialGroup.FNumber,FDocumentStatus",
  `FName like '%${name}%' or FSpecification like '%${spec.trim()}%'`,
  50,
);
console.log(`预检3：全库名称/规格模糊命中 ${wide.length} 条`);
for (const r of wide) console.log("   " + r.join(" | "));

const model = {
  FCreateOrgId: { FNumber: "100" },
  FUseOrgId: { FNumber: "100" },
  FNumber: number,
  FName: name,
  FSpecification: spec,
  FMaterialGroup: { FNumber: group },
  FCategoryID: { FNumber: category },
  SubHeadEntity: {
    FErpClsID: erpClass,
    FFeatureItem: "1",
    FCategoryID: { FNumber: category },
    FTaxType: { FNumber: "WLDSFL01_SYS" },
    FTaxRateId: { FNumber: taxRate },
    FBaseUnitId: { FNumber: unit },
    FIsPurchase: true,
    FIsInventory: true,
    FIsSale: isSale,
    FIsAsset: false,
    FIsProduce: false,
    FIsSubContract: false,
    FWEIGHTUNITID: { FNumber: "kg" },
    FVOLUMEUNITID: { FNumber: "m" },
  },
  SubHeadEntity1: {
    FStoreUnitID: { FNumber: unit },
    FIsBatchManage: isBatch,
    FStockId: { FNumber: stock },
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
    FMaxPOQty: 100000,
    FWriteOffQty: 1,
  },
  SubHeadEntity5: {
    FBOMUnitId: { FNumber: unit },
    FProduceUnitId: { FNumber: unit },
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

// ===== 执行后复查：与样板逐字段 diff =====
const snap = async (n) => {
  const v = (await api.post("DynamicFormService.View", { formid: "BD_MATERIAL", data: { Number: n } })).Result.Result;
  const b = v.MaterialBase?.[0] ?? {};
  const s = v.MaterialStock?.[0] ?? {};
  const p = v.MaterialProduce?.[0] ?? {};
  const sale = v.MaterialSale?.[0] ?? {};
  return {
    Number: v.Number,
    Name: v.Name?.find((x) => x.Key === 2052)?.Value,
    Spec: v.Specification?.find((x) => x.Key === 2052)?.Value,
    Group: v.MaterialGroup?.Number,
    DocStatus: v.DocumentStatus,
    ForbidStatus: v.ForbidStatus,
    CategoryID: b.CategoryID?.Number,
    ErpClsID: String(b.ErpClsID),
    BaseUnit: b.BaseUnitId?.Number,
    StoreUnit: s.StoreUnitID?.Number,
    IsPurchase: b.IsPurchase,
    IsInventory: b.IsInventory,
    IsSale: b.IsSale,
    IsProduce: b.IsProduce,
    IsBatchManage: s.IsBatchManage,
    StockId: s.StockId?.Number,
    StockPlaceId_Id: s.StockPlaceId_Id,
    TaxRate: b.TaxRateId?.Number,
    PlanningStrategy: String(v.MaterialPlan?.[0]?.PlanningStrategy),
    Over: String(p.FinishReceiptOverRate),
    Short: String(p.FinishReceiptShortRate),
    PickStockId: p.PickStockId?.Number ?? null,
    PickBinId_Id: p.PickBinId_Id,
    SaleIsReturn: sale.IsReturn,
  };
};
const mine = await snap(number);
const ref = await snap(sample);
console.log("\n=== 执行后复查：新料 vs 同组样板 ===");
let diff = 0;
for (const k of Object.keys(ref)) {
  const a = JSON.stringify(mine[k]);
  const b2 = JSON.stringify(ref[k]);
  const expected = k === "Number" || k === "Name" || k === "Spec";
  if (a !== b2 && !expected) diff++;
  console.log(`${k}: 新=${a} 样板=${b2} [${a === b2 ? "一致" : expected ? "预期不同" : "差异"}]`);
}
console.log(`\n除编号/名称/规格外的差异项数: ${diff}`);
