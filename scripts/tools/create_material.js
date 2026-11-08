// 通用建料脚本：Save -> Submit -> Audit，最后回查验证
// 用法: bun run create-material -- --number N401000288 --name "示例品牌C168/300s 标签打印机" \
//         --spec "300dpi 热转印标签打印机" --group 401 --unit Pcs [--erp 10] [--apply]
// 默认 dry-run 只打印参数不写库；加 --apply 才真正执行。

import { K3CloudWebAPI } from "../../k3cloud.js";

// ===== 参数解析 =====
const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const apply = args.includes("--apply");
const isProduct = args.includes("--product");
const isSale = !args.includes("--no-sale");

const number = get("--number");
const name = get("--name");
const spec = get("--spec") ?? " ";
const group = get("--group") ?? "401";
const unit = get("--unit") ?? "Pcs";
const category = get("--category") ?? "CHLB08_SYS"; // 存货类别：办公材料
const taxRate = get("--tax") ?? "SL02_SYS"; // 13%增值税专票
const erpClass = get("--erp") ?? "1"; // ERP分类：1=外购，10=资产
const stock = get("--stock");
const isBatchManage = args.includes("--batch") || isProduct || /^(N101|N102)/.test(number ?? "");

if (!number || !name) {
  console.error("缺少必填参数: --number <编码> --name <名称>");
  process.exit(1);
}

console.log("=== 建料参数 ===");
console.log(`编码: ${number}`);
console.log(`名称: ${name}`);
console.log(`规格: ${spec}`);
console.log(`分组: ${group}  单位: ${unit}  存货类别: ${category}  ERP分类: ${erpClass}  税率: ${taxRate}`);
console.log(apply ? "模式: APPLY（真实写入）" : "模式: DRY-RUN（仅预览，加 --apply 执行）");

if (!apply) process.exit(0);

// ===== 重码预检 =====
const api = new K3CloudWebAPI();
await api.login();

const dup = await api.executeBillQuery("BD_MATERIAL", "FNumber,FName", `FNumber='${number}'`, 1);
if (dup.length > 0) {
  console.error(`编码已存在: ${dup[0].join(" | ")}，终止。`);
  process.exit(1);
}
console.log("重码预检通过");

// ===== Save =====
// BD_MATERIAL 的基本资料、库存、销售、采购等字段使用标准 SubHeadEntity
// 结构；直接把它们写成 FMaterialBase/FMaterialStock 等键时，接口可能
// 返回成功但静默使用默认值。ERP 分类 10 的物料按资产类明确关闭库存/销售。
const isAsset = erpClass === "10";
const model = {
  FCreateOrgId: { FNumber: "100" },
  FUseOrgId: { FNumber: "100" },
  FNumber: number,
  FName: name,
  FSpecification: spec,
  FMaterialGroup: { FNumber: group },
  SubHeadEntity: {
    FErpClsID: erpClass,
    FFeatureItem: "1",
    FCategoryID: { FNumber: category },
    FTaxType: { FNumber: "WLDSFL01_SYS" },
    FTaxRateId: { FNumber: taxRate },
    FBaseUnitId: { FNumber: unit },
    FIsPurchase: !isProduct,
    FIsInventory: true,
    FIsSale: isSale,
    FIsAsset: isAsset,
    FIsProduce: isProduct,
    FWEIGHTUNITID: { FNumber: "kg" },
    FVOLUMEUNITID: { FNumber: "m" },
  },
  SubHeadEntity1: {
    FStoreUnitID: { FNumber: unit },
    FIsBatchManage: isBatchManage,
    ...(stock ? { FStockId: { FNumber: stock } } : {}),
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
  ...(isAsset || isProduct
    ? {
        SubHeadEntity4: {
          FPlanningStrategy: isAsset ? "2" : "1",
          FPlanIntervalsDays: 1,
          FMaxPOQty: 100000,
          FWriteOffQty: 1,
        },
      }
    : {}),
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
const save = await api.post("DynamicFormService.Save", {
  formid: "BD_MATERIAL",
  data: { Model: model },
});
const rs = save?.Result?.ResponseStatus;
if (!rs?.IsSuccess) {
  console.error("保存失败:", (rs?.Errors ?? []).map((e) => e.Message).join("; "));
  process.exit(1);
}
const fid = String(save.Result.Id);
console.log(`保存成功: Id=${fid}, Number=${save.Result.Number}`);

// ===== Submit =====
console.log("正在提交...");
const submit = await api.post("DynamicFormService.Submit", {
  formid: "BD_MATERIAL",
  data: { Ids: fid },
});
if (!submit?.Result?.ResponseStatus?.IsSuccess) {
  console.error("提交失败:", (submit?.Result?.ResponseStatus?.Errors ?? []).map((e) => e.Message).join("; "));
  process.exit(1);
}
console.log("提交成功");

// ===== Audit =====
console.log("正在审核...");
const audit = await api.post("DynamicFormService.Audit", {
  formid: "BD_MATERIAL",
  data: { Ids: fid },
});
if (!audit?.Result?.ResponseStatus?.IsSuccess) {
  console.error("审核失败:", (audit?.Result?.ResponseStatus?.Errors ?? []).map((e) => e.Message).join("; "));
  process.exit(1);
}
console.log("审核成功");

// ===== 执行后复查 =====
const check = await api.post("DynamicFormService.ExecuteBillQuery", {
  data: {
    FormId: "BD_MATERIAL",
    FieldKeys:
      "FNumber,FName,FSpecification,FDocumentStatus,FMaterialGroup.FName,FBaseUnitId.FName",
    FilterString: `FNumber='${number}'`,
  },
});
console.log("=== 执行后复查 ===");
for (const r of check) console.log(r.join(" | "));
