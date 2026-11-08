#!/usr/bin/env bun
/**
 * 蓝膜料建料（10102 蓝膜组）—— 默认 dry-run
 *
 * 实测模板（View 101021005 稳压管芯片15V 逐字段）：
 *   ERP 分类 3 / 存货类别 CHLB01_SYS / 单位 K / 税种 WLDSFL01_SYS + 税率 SL02_SYS
 *   购是 · 存是 · 销否 · 产否 · 资产否 · 委外是
 *   批号是 + 规则 PHBM004 / 默认仓 CTK01 + 仓位 100001 / 领料仓同 / 超收0·短收0
 *   计划策略 1 / EOQ 1 / MaxPOQty 100000
 *
 * 编号：10102 组内数字空间取 max+1，加 N 前缀（组内现有两段 0xxx/1xxx 共用数字空间）。
 *
 * 用法：
 *   bun scripts/tools/create_bluefilm_material.js --name "稳压管11VS-L JJ" \
 *     --spec "0.33*0.33(JWC033110NXC-B)" [--number N101021029] [--group 10102] [--apply]
 */

import { K3CloudWebAPI } from "../../k3cloud.js";

const args = process.argv.slice(2);
const get = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : dflt;
};
const apply = args.includes("--apply");

const name = get("--name");
const spec = get("--spec", " ");
const group = get("--group", "10102");
const unit = get("--unit", "K");
const category = get("--category", "CHLB01_SYS");
const erp = get("--erp", "3");
const stock = get("--stock", "CTK01");
const place = Number(get("--place", "100001"));
const batchRule = get("--batch-rule", "PHBM004");
const taxRate = get("--tax", "SL02_SYS");
let number = get("--number");

if (!name) {
  console.error("缺少必填参数: --name <名称> [--spec <规格>]");
  process.exit(1);
}

const api = new K3CloudWebAPI();
await api.login();

const q = async (label, filter, top = 20) => {
  const raw = await api.post("DynamicFormService.ExecuteBillQuery", {
    data: {
      FormId: "BD_MATERIAL",
      FieldKeys: "FNumber,FName,FSpecification,FMaterialGroup.FNumber,FDocumentStatus,FForbidStatus",
      FilterString: filter,
      TopRowCount: top,
    },
  });
  const rows = raw?.Result?.Result ?? raw?.Result?.Rows ?? raw;
  console.log(`\n--- ${label} -> ${Array.isArray(rows) ? rows.length : "?"} 行`);
  if (Array.isArray(rows)) rows.forEach((r) => console.log("  " + r.join(" | ")));
  return Array.isArray(rows) ? rows : [];
};

// ===== 自动取号：组内数字空间 max+1 =====
if (!number) {
  const all = await api.executeBillQuery("BD_MATERIAL", "FNumber", `FMaterialGroup.FNumber='${group}'`, 500);
  const max = all
    .map((r) => String(r[0]).replace(/^N/, ""))
    .filter((n) => new RegExp(`^${group}\\d+$`).test(n))
    .sort()
    .pop();
  const next = String(Number(max.slice(group.length)) + 1).padStart(max.length - group.length, "0");
  number = "N" + group + next;
  console.log(`组内现有最大编码: ${max} -> 取号 ${number}`);
}

console.log("=== 建料参数（蓝膜） ===");
console.log(`编码: ${number}${get("--number") ? "（指定）" : "（自动）"}`);
console.log(`名称: ${name}`);
console.log(`规格: ${spec}`);
console.log(`分组: ${group}  单位: ${unit}  存货类别: ${category}  ERP: ${erp}`);
console.log(`默认仓: ${stock} / 仓位 ${place}  领料仓同  批号规则: ${batchRule}`);
console.log(`购/存/销/产: 是/是/否/否  委外: 是   税率: ${taxRate}`);
console.log(apply ? "模式: APPLY（真实写入）" : "模式: DRY-RUN（仅预览，加 --apply 执行）");

// ===== 预检 =====
const dupNo = await q(`编码 ${number}`, `FNumber='${number}'`);
const dupNameSpec = await q(
  "同分组内名称+规格",
  `FName='${name}' and FSpecification='${spec}' and FMaterialGroup.FNumber='${group}'`,
);
const wide = await q(
  "全库规格模糊",
  `FSpecification like '%${spec.replace(/^\d+\.\d+\*\d+\.\d+\(/, "").replace(/\)$/, "")}%'`,
  30,
);
if (dupNo.length) {
  console.error("\n预检不通过：编码已被占用，终止。");
  process.exit(1);
}
if (dupNameSpec.length) {
  console.error("\n预检不通过：同分组内已有相同名称+规格，终止。");
  process.exit(1);
}

if (!apply) {
  console.log("\nDRY-RUN 结束（未写库）。");
  process.exit(0);
}

// ===== Save（按样板 101021005 模板） =====
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
    FTaxType: { FNumber: "WLDSFL01_SYS" },
    FTaxRateId: { FNumber: taxRate },
    FBaseUnitId: { FNumber: unit },
    FIsPurchase: true,
    FIsInventory: true,
    FIsSale: false,
    FIsProduce: false,
    FIsAsset: false,
    FIsSubContract: true,
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

// ===== 独立 View 回查 + 与样板逐字段 diff =====
const snap = async (n) => {
  const v = await api.post("DynamicFormService.View", { formid: "BD_MATERIAL", data: { Number: n } });
  const d = v?.Result?.Result;
  const b = d?.MaterialBase?.[0] ?? {};
  const s = d?.MaterialStock?.[0] ?? {};
  const p = d?.MaterialProduce?.[0] ?? {};
  const pl = d?.MaterialPlan?.[0] ?? {};
  return {
    Number: d?.Number,
    Name: d?.Name?.find((x) => x.Key === 2052)?.Value,
    Spec: d?.Specification?.find((x) => x.Key === 2052)?.Value,
    Group: d?.MaterialGroup?.Number,
    Status: d?.DocumentStatus,
    Forbid: d?.ForbidStatus,
    ErpCls: String(b?.ErpClsID),
    Category: b?.CategoryID?.Number ?? b?.CategoryID,
    Unit: b?.BaseUnitId?.Number ?? b?.BaseUnitId,
    购: b?.IsPurchase, 存: b?.IsInventory, 销: b?.IsSale, 产: b?.IsProduce,
    委外: b?.IsSubContract,
    批号: s?.IsBatchManage,
    批号规则: s?.BatchRuleID?.Number ?? s?.BatchRuleID,
    默认仓: s?.StockId?.Number ?? s?.StockId,
    仓位: s?.StockPlaceId_Id,
    领料仓: p?.PickStockId?.Number ?? p?.PickStockId,
    领料仓位: p?.PickBinId_Id,
    超收: p?.FinishReceiptOverRate, 短收: p?.FinishReceiptShortRate,
    策略: pl?.PlanningStrategy, EOQ: pl?.EOQ,
  };
};
const mine = await snap(number);
const ref = await snap("101021005");
console.log("\n=== 回查：新料 vs 样板 101021005 ===");
let diff = 0;
for (const k of Object.keys(ref)) {
  const a = JSON.stringify(mine[k]);
  const b2 = JSON.stringify(ref[k]);
  const expected = k === "Number" || k === "Name" || k === "Spec";
  if (a !== b2 && !expected) diff++;
  console.log(`${k}: 新=${a} 样板=${b2} [${a === b2 ? "一致" : expected ? "预期不同" : "差异"}]`);
}
console.log(`\n除编号/名称/规格外的差异项数: ${diff}`);
