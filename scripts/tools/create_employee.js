#!/usr/bin/env bun
/**
 * 新增员工（BD_Empinfo）—— 默认 dry-run，加 --apply 才真实写入
 *
 * 背景（2026-09 实测）：
 *   - 员工表单 `BD_Empinfo` 的「任职信息」是分录 `FPostEntity`；
 *     部门/职位不在表头，必须写进该分录，否则建出来是「没有任职记录」的员工。
 *   - 分录字段键：`FPost`(职位) / `FPostDept`(部门) / `FStaffStartDate` / `FIsFirstPost` / `FWorkOrgId`。
 *   - 编码前缀 YG + 5 位流水，系统自动取号（`T_BAS_BILLCODES` 的 FNUMMAX），Save 不传 FNumber。
 *   - 流程：Save →（可选）Submit → Audit → 独立 View 回查任职分录。
 *
 * 用法：
 *   bun scripts/tools/create_employee.js --name 梁小春 --dept 测试分选 --post 生产员 --join-date 2026-09-26
 *   ... --apply                真实写入并提交审核
 *   ... --apply --no-audit     只保存（草稿），不提交审核
 */
import { K3CloudWebAPI, FORMS } from "../../lib/k3/index.js";
import { K3_DB_HOST, K3_DB_USER, K3_DB_PASS, K3_DB_NAME } from "../../lib/k3/index.js";
import sql from "mssql";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : d;
};

const name = val("--name");
const deptArg = val("--dept");
const postArg = val("--post");
const joinDate = val("--join-date", new Date().toISOString().slice(0, 10));
const orgNumber = val("--org", "100");
const apply = has("--apply");
const noAudit = has("--no-audit");

if (!name || !deptArg || !postArg) {
  console.error("用法: bun scripts/tools/create_employee.js --name <姓名> --dept <部门编码或名称> --post <职位编码或名称> [--join-date YYYY-MM-DD] [--org 100] [--apply] [--no-audit]");
  process.exit(1);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(joinDate)) {
  console.error(`入职日期格式应为 YYYY-MM-DD，收到: ${joinDate}`);
  process.exit(1);
}

const pool = await sql.connect({
  server: K3_DB_HOST, user: K3_DB_USER, password: K3_DB_PASS, database: K3_DB_NAME,
  options: { encrypt: false, trustServerCertificate: true },
  connectionTimeout: 8000, requestTimeout: 20000,
});

// 解析部门（编码 BM… 或名称）
const deptRes = await pool.request().query(
  `SELECT TOP 5 d.FDEPTID, d.FNUMBER, l.FNAME
   FROM T_BD_DEPARTMENT d JOIN T_BD_DEPARTMENT_L l ON l.FDEPTID=d.FDEPTID AND l.FLOCALEID=2052
   WHERE d.FNUMBER='${deptArg.replace(/'/g, "''")}' OR l.FNAME=N'${deptArg.replace(/'/g, "''")}'`);
if (deptRes.recordset.length !== 1) {
  console.error(`部门无法唯一确定（命中 ${deptRes.recordset.length} 条）: ${deptArg}`);
  console.error(JSON.stringify(deptRes.recordset));
  await pool.close();
  process.exit(1);
}
const dept = deptRes.recordset[0];

// 解析职位（编码 GW… 或名称），并校验属于该部门
const postRes = await pool.request().query(
  `SELECT TOP 10 p.FPOSTID, p.FNUMBER, l.FNAME
   FROM T_ORG_POST p JOIN T_ORG_POST_L l ON l.FPOSTID=p.FPOSTID AND l.FLOCALEID=2052
   WHERE (p.FNUMBER='${postArg.replace(/'/g, "''")}' OR l.FNAME=N'${postArg.replace(/'/g, "''")}')
     AND p.FDEPTID=${Number(dept.FDEPTID)}`);
if (postRes.recordset.length !== 1) {
  console.error(`职位在部门「${dept.FNAME}」下无法唯一确定（命中 ${postRes.recordset.length} 条）: ${postArg}`);
  console.error(JSON.stringify(postRes.recordset));
  await pool.close();
  process.exit(1);
}
const post = postRes.recordset[0];
await pool.close();

const api = new K3CloudWebAPI();
await api.login();

// 查重
const dup = await api.executeBillQuery(FORMS.EMPLOYEE, "FID,FNumber,FName,FDocumentStatus,FForbidStatus", `FName='${name.replace(/'/g, "''")}'`, 20);
console.log("=== 拟新增员工 ===");
console.log(`姓名: ${name}`);
console.log(`部门: ${dept.FNAME} (${dept.FNUMBER})`);
console.log(`职位: ${post.FNAME} (${post.FNUMBER})`);
console.log(`入职/任职开始: ${joinDate}`);
console.log(`任职组织: ${orgNumber}`);
console.log(`同名查重: ${dup.length ? "⚠ 已存在 " + JSON.stringify(dup) : "无"}`);
console.log(apply ? `模式: APPLY（真实写入${noAudit ? "，仅保存草稿" : "，并提交审核"}）` : "模式: DRY-RUN（仅预览，加 --apply 执行）");
if (dup.length) {
  console.error("\n预检不通过：已存在同名员工，终止。");
  process.exit(1);
}
if (!apply) {
  console.log("\nDRY-RUN 结束（未写库）。");
  process.exit(0);
}

const model = {
  FCreateOrgId: { FNumber: orgNumber },
  FUseOrgId: { FNumber: orgNumber },
  FName: name,
  FJoinDate: joinDate,
  FPostEntity: [
    {
      FPost: { FNumber: post.FNUMBER },
      FPostDept: { FNumber: dept.FNUMBER },
      FStaffStartDate: joinDate,
      FIsFirstPost: true,
      FWorkOrgId: { FNumber: orgNumber },
    },
  ],
};

console.log("\n正在保存...");
const save = await api.post("DynamicFormService.Save", { formid: FORMS.EMPLOYEE, data: { Model: model } });
const rs = save?.Result?.ResponseStatus;
if (!rs?.IsSuccess) {
  console.error("保存失败:", (rs?.Errors ?? []).map((e) => e.Message).join("; "));
  process.exit(1);
}
const fid = String(save.Result.Id);
const number = save.Result.Number;
console.log(`保存成功: FID=${fid}, 编码=${number}, 状态=${save.Result.DocumentStatus}`);

// 独立回查任职分录是否写入
const chk = await api.viewBill(FORMS.EMPLOYEE, fid);
const pe = chk?.PostEntity ?? [];
const ok = pe.length > 0 && String(pe[0]?.PostDept?.Number) === String(dept.FNUMBER);
console.log("\n=== 保存后回查 PostEntity ===");
console.log(JSON.stringify(pe.map((p) => ({
  Post: p.Post?.Number, PostName: p.Post?.Name?.[0]?.Value,
  Dept: p.PostDept?.Number, DeptName: p.PostDept?.Name?.[0]?.Value,
  Start: p.StaffStartDate, First: p.IsFirstPost,
})), null, 1));
if (!ok) {
  console.error("\n⚠ 回查未确认到正确的任职信息，已停止后续提交/审核。请人工在员工列表核对该员工，必要时删除重建。");
  process.exit(2);
}

if (!noAudit) {
  const submit = await api.post("DynamicFormService.Submit", { formid: FORMS.EMPLOYEE, data: { Ids: fid } });
  if (!submit?.Result?.ResponseStatus?.IsSuccess) {
    console.error("提交失败:", (submit?.Result?.ResponseStatus?.Errors ?? []).map((e) => e.Message).join("; "));
    console.error("单据已保存为草稿，未继续审核。");
    process.exit(1);
  }
  console.log("提交成功");
  const audit = await api.post("DynamicFormService.Audit", { formid: FORMS.EMPLOYEE, data: { Ids: fid } });
  if (!audit?.Result?.ResponseStatus?.IsSuccess) {
    console.error("审核失败:", (audit?.Result?.ResponseStatus?.Errors ?? []).map((e) => e.Message).join("; "));
    console.error("单据处于已提交未审核，未继续操作。");
    process.exit(1);
  }
  console.log("审核成功");
}

const fin = await api.executeBillQuery(FORMS.EMPLOYEE, "FID,FNumber,FName,FStaffId,FForbidStatus,FDocumentStatus", `FID=${fid}`, 5);
console.log("\n=== 最终回查 ===");
console.log("FID,FNumber,FName,FStaffId,FForbidStatus,FDocumentStatus");
console.log(JSON.stringify(fin));
