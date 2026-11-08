import { K3CloudWebAPI } from "../../k3cloud.js";

const args = process.argv.slice(2);
const get = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const apply = args.includes("--apply");
const number = get("--number");
const targetName = get("--name");
const expectName = get("--expect");

if (!number || targetName === undefined) {
  console.error("用法: bun scripts/tools/update_material_name.js --number <物料编码> --name <新名称> [--expect <旧名称>] [--apply]");
  process.exit(1);
}

const api = new K3CloudWebAPI();
await api.login();

async function view(n) {
  const r = await api.post("DynamicFormService.View", {
    formid: "BD_MATERIAL",
    data: { Number: n },
  });
  return r?.Result?.Result;
}

const pick = (d) => ({
  Id: d?.Id,
  MasterId: d?.MasterId,
  Number: d?.Number,
  Name: d?.Name?.find?.((x) => String(x.Key) === "2052")?.Value || d?.Name?.[0]?.Value,
  Spec: d?.Specification?.find?.((x) => String(x.Key) === "2052")?.Value || d?.Specification?.[0]?.Value,
  Group: d?.MaterialGroup?.Number,
  GroupName: d?.MaterialGroup?.Name?.find?.((x) => String(x.Key) === "2052")?.Value || d?.MaterialGroup?.Name?.[0]?.Value,
  DocStatus: d?.DocumentStatus,
  Forbid: d?.ForbidStatus,
});

const currentData = await view(number);
if (!currentData || !currentData.Id) {
  console.error(`未找到物料: ${number}`);
  process.exit(1);
}

const info = pick(currentData);
console.log("【物料当前现状】");
console.log(JSON.stringify(info, null, 2));

// 旧值守卫
if (expectName !== undefined && info.Name !== expectName) {
  console.error(`旧值守卫失败：期望旧名称为「${expectName}」，当前实际名称为「${info.Name}」，终止执行！`);
  process.exit(1);
}

// 目标名称占用/重名检查
const occ = await api.post("DynamicFormService.ExecuteBillQuery", {
  data: {
    FormId: "BD_MATERIAL",
    FieldKeys: "FMATERIALID,FNumber,FName,FSpecification,FMaterialGroup.FNumber,FDocumentStatus,FForbidStatus",
    FilterString: `FName = '${targetName.replace(/'/g, "''")}'`,
    TopRowCount: 20,
  },
});
const occRows = (occ?.Result?.Result ?? occ?.Result?.Rows ?? occ) ?? [];
console.log(`\n【目标名称占用检索】名称「${targetName}」现有使用情况 (命中 ${occRows.length} 条)：`);
if (occRows.length > 0) {
  for (const row of occRows) {
    console.log(`  - 编码: ${row[1]}, 名称: ${row[2]}, 规格: ${row[3]}, 状态: ${row[5]}, 禁用: ${row[6]}, 分组: ${row[4]}`);
  }
} else {
  console.log("  (暂无其他物料使用此名称，无重名冲突)");
}

console.log("\n【变更方案】");
console.log(`物料编码: ${info.Number}`);
console.log(`当前名称: ${info.Name}`);
console.log(`目标名称: ${targetName}`);
console.log(`规格型号: ${info.Spec}`);
console.log(`物料分组: ${info.Group} (${info.GroupName ?? ""})`);
console.log(`当前状态: ${info.DocStatus === "C" ? "已审核(C)" : info.DocStatus}`);

if (!apply) {
  console.log("\n>>> 当前为 DRY-RUN 预览模式，未做任何修改。如确认修改，请添加 --apply 参数执行。<<<");
  process.exit(0);
}

// 状态守卫
if (info.DocStatus !== "C") {
  console.error(`当前状态为 ${info.DocStatus}，非已审核(C)状态，停止自动写入！`);
  process.exit(1);
}

const fid = String(info.Id);
console.log(`\n开始写入更新: FMATERIALID=${fid}...`);

// 1. 反审核
const un = await api.unAuditBill("BD_MATERIAL", [fid]);
const unStatus = un?.Result?.ResponseStatus;
console.log("1. 反审核(unAudit):", unStatus?.IsSuccess ? "成功" : "失败", JSON.stringify(unStatus?.Errors ?? []));
if (!unStatus?.IsSuccess) {
  console.error("反审核失败，终止！");
  process.exit(1);
}

const curAfterUn = pick(await view(info.Number));
if (curAfterUn.DocStatus !== "D") {
  console.error(`反审核后状态为 ${curAfterUn.DocStatus}，非重新审核(D)，终止！`);
  process.exit(1);
}

// 2. 保存新名称
const save = await api.post("DynamicFormService.Save", {
  formid: "BD_MATERIAL",
  data: {
    NeedUpDateFields: ["FName"],
    IsDeleteEntry: false,
    Model: {
      FMATERIALID: fid,
      FName: targetName,
    },
  },
});
const saveOk = save?.Result?.ResponseStatus?.IsSuccess;
console.log("2. 保存名称(Save):", saveOk ? "成功" : "失败", (save?.Result?.ResponseStatus?.Errors ?? []).map((e) => e.Message).join("; "));
if (!saveOk) {
  console.error("保存失败，终止！");
  process.exit(1);
}

// 3. 提交
const sub = await api.submitBill("BD_MATERIAL", [fid]);
const subOk = sub?.Result?.ResponseStatus?.IsSuccess;
console.log("3. 提交(Submit):", subOk ? "成功" : "失败", (sub?.Result?.ResponseStatus?.Errors ?? []).map((e) => e.Message).join("; "));
if (!subOk) {
  console.error("提交失败，终止！");
  process.exit(1);
}

// 4. 审核
const aud = await api.auditBill("BD_MATERIAL", [fid]);
const audOk = aud?.Result?.ResponseStatus?.IsSuccess;
console.log("4. 审核(Audit):", audOk ? "成功" : "失败", (aud?.Result?.ResponseStatus?.Errors ?? []).map((e) => e.Message).join("; "));
if (!audOk) {
  console.error("审核失败，终止！");
  process.exit(1);
}

// 5. 双通道独立回查
console.log("\n【双通道回查验证】");
// 通道1: View
const finalView = pick(await view(info.Number));
console.log("通道1 (DynamicFormService.View):", JSON.stringify(finalView, null, 2));

// 通道2: ExecuteBillQuery
const finalQuery = await api.executeBillQuery(
  "BD_MATERIAL",
  "FMATERIALID,FNumber,FName,FSpecification,FDocumentStatus,FForbidStatus,FMaterialGroup.FNumber",
  `FNumber = '${info.Number}'`,
  1
);
console.log("通道2 (ExecuteBillQuery):", JSON.stringify(finalQuery, null, 2));

const queryName = finalQuery?.[0]?.[2];
const queryDocStatus = finalQuery?.[0]?.[4];
const queryForbid = finalQuery?.[0]?.[5];

if (
  finalView.Name === targetName &&
  queryName === targetName &&
  finalView.DocStatus === "C" &&
  queryDocStatus === "C" &&
  finalView.Forbid === info.Forbid &&
  queryForbid === info.Forbid
) {
  console.log("\n✅ 修改完成且双通道回查验证通过！");
} else {
  console.error("\n❌ 回查校验存在不符，请人工介入核对！");
  process.exit(1);
}
