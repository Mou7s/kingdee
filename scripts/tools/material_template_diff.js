#!/usr/bin/env bun
/**
 * 建料后模板比对：取 BD_MATERIAL 的 View 关键字段快照，传两个料号时逐字段 diff。
 *
 * 用途：新建料与「同组最新样板」比对，仅对所列字段与库存属性集合做辅助比对；不证明完整模板一致。
 * 未列字段及自定义实体仍须按业务模板独立核对。
 *
 * 用法：
 *   bun scripts/tools/material_template_diff.js <料号>
 *   bun scripts/tools/material_template_diff.js <样板料号> <新料号>
 * 例：
 *   bun scripts/tools/material_template_diff.js NDZ0040061 NDZ0040062
 */
const pick = (arr, key) => arr?.find?.((x) => x.Key === key)?.Value;

export function projectMaterial(d) {
  if (!d?.Number) throw new Error("View 缺少物料编码，不能比对");
  for (const key of ["MaterialBase", "MaterialStock", "MaterialSale", "MaterialPurchase", "MaterialPlan", "MaterialProduce", "MaterialInvPty"]) {
    if (!Array.isArray(d[key]) || (key !== "MaterialInvPty" && !d[key].length)) throw new Error(`View 缺少 ${key}，不能判为一致`);
  }
  const b = d.MaterialBase?.[0] ?? {};
  const s = d.MaterialStock?.[0] ?? {};
  const sa = d.MaterialSale?.[0] ?? {};
  const pu = d.MaterialPurchase?.[0] ?? {};
  const pl = d.MaterialPlan?.[0] ?? {};
  const pr = d.MaterialProduce?.[0] ?? {};
  return {
    库存属性: d.MaterialInvPty.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "Id"))).sort((a,b) => String(a.InvPtyId?.Number).localeCompare(String(b.InvPtyId?.Number))),
    编码: d.Number,
    名称: pick(d.Name, 2052),
    规格: pick(d.Specification, 2052),
    状态: d.DocumentStatus,
    禁用: d.ForbidStatus,
    分组: d.MaterialGroup?.Number,
    ERP分类: b.ErpClsID,
    存货类别: b.CategoryID?.Number,
    基本单位: b.BaseUnitId?.Number,
    税率: b.TaxRateId?.Number,
    购: b.IsPurchase,
    存: b.IsInventory,
    销: b.IsSale,
    产: b.IsProduce, // 注意：外购 D 段应为 false；不要看 MaterialProduce 数组是否有行
    委外: b.IsSubContract,
    批号管理: s.IsBatchManage,
    批号规则: s.BatchRuleID?.Number,
    默认仓: s.StockId?.Number,
    默认仓位Id: s.StockPlaceId_Id,
    锁库: s.IsLockStock,
    盘点周期: s.CountCycle,
    盘点天数: s.CountDay,
    币别: s.CurrencyId?.Number,
    序列号管理: s.SNManageType,
    序列号生成: s.SNGenerateTime,
    单位转换方向: s.UnitConvertDir,
    销售单位: sa.SaleUnitId?.Number,
    销售计价单位: sa.SalePriceUnitId?.Number,
    退货: sa.IsReturn,
    售后: sa.ISAFTERSALE,
    产品文件: sa.ISPRODUCTFILES,
    出库上限单位: sa.OutLmtUnit,
    采购计价单位: pu.PurchasePriceUnitId?.Number,
    退料: pu.IsReturnMaterial,
    打印次数: pu.PrintCount,
    最小包装数: pu.MinPackCount,
    计划策略: pl.PlanningStrategy,
    最大订货量: pl.MaxPOQty,
    核销数量: pl.WriteOffQty,
    EOQ: pl.EOQ,
    生产单位: pr.ProduceUnitId?.Number,
    领料仓: pr.PickStockId?.Number,
    领料仓位Id: pr.PickBinId_Id,
    完工超收率: pr.FinishReceiptOverRate,
    完工短收率: pr.FinishReceiptShortRate,
    发料方式: pr.IssueType,
    最小发料数量: pr.MinIssueQty,
    最小发料单位: pr.MinIssueUnitId?.Number,
    标准工时单位: pr.StandHourUnitId,
    倒冲类型: pr.BackFlushType,
  };
}

export function compareSelected(a, b) {
  const skip = new Set(["编码", "名称", "规格"]);
  return Object.keys(a).filter(key => !skip.has(key)).map(key => ({ key, known: a[key] !== undefined && b[key] !== undefined, same: a[key] !== undefined && b[key] !== undefined && JSON.stringify(a[key]) === JSON.stringify(b[key]), before: a[key], after: b[key] }));
}
if (import.meta.main) {
  const nums = process.argv.slice(2);
  if (nums.length < 1 || nums.length > 2) {
    console.error("用法: bun scripts/tools/material_template_diff.js <样板料号> [新料号]");
    process.exit(2);
  }
  const { K3CloudWebAPI } = await import("../../lib/k3/index.js");
  const api = new K3CloudWebAPI();
  await api.login();
  async function snapshot(num) {
    const v = await api.post("DynamicFormService.View", { formid: "BD_MATERIAL", data: { Number: num } });
    return projectMaterial(v?.Result?.Result);
  }
  const a = await snapshot(nums[0]);
  console.log("范围：所列字段与库存属性集合；不覆盖完整物料模型。缺值为未验证，不能判为一致。");
  if (nums.length === 1) console.log(JSON.stringify(a, null, 2));
  else {
    const b = await snapshot(nums[1]);
    const result = compareSelected(a,b);
    result.forEach(row => console.log(JSON.stringify(row)));
    if (result.some(row => !row.same)) process.exitCode = 1;
  }
}
