import { test, expect } from "bun:test";
import { probeFields } from "../tools/probe_fieldkeys.js";
import { projectMaterial, compareSelected } from "../tools/material_template_diff.js";

test("字段探针不注入 FID，空结果独立标记", async () => {
  const calls = [];
  const api = { executeBillQuery: async (...args) => { calls.push(args); return []; } };
  const results = await probeFields(api, "BD_CUSTOMER", ["FNumber", "FNumber"]);
  expect(calls).toEqual([["BD_CUSTOMER", "FNumber", "", 3]]);
  expect(results[0].status).toBe("accepted_empty");
});
test("点名候选的字段错误可继续，权限错误停止", async () => {
  const calls = [];
  const api = { executeBillQuery: async (_, key) => {
    calls.push(key);
    if (key === "Bad") throw new Error("元数据中标识为 Bad 的字段不存在");
    throw new Error("无权限");
  } };
  const results = await probeFields(api, "X", ["Bad", "Good", "Later"]);
  expect(results.map(r => r.status)).toEqual(["field_error", "request_error"]);
  expect(calls).toEqual(["Bad", "Good"]);
});
function material(affectCost) {
  return { Number: "M", MaterialBase: [{}], MaterialStock: [{}], MaterialSale: [{}], MaterialPurchase: [{}], MaterialPlan: [{}], MaterialProduce: [{}], MaterialInvPty: [{ Id: 1, InvPtyId: { Number: "04" }, IsAffectCost: affectCost }] };
}
test("模板比较识别批号影响出库成本差异", () => {
  const results = compareSelected(projectMaterial(material(false)), projectMaterial(material(true)));
  expect(results.find(r => r.key === "库存属性").same).toBe(false);
});
test("库存属性分录内码差异不作为业务差异", () => {
  const a = material(true), b = material(true); b.MaterialInvPty[0].Id = 2;
  expect(compareSelected(projectMaterial(a), projectMaterial(b)).find(r => r.key === "库存属性").same).toBe(true);
});
test("缺失实体失败，双方缺值也不能算一致", () => {
  const a = material(true); delete a.MaterialInvPty;
  expect(() => projectMaterial(a)).toThrow("MaterialInvPty");
  expect(compareSelected({ 名称: "a", 税率: undefined }, { 名称: "b", 税率: undefined })[0].same).toBe(false);
});
