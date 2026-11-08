#!/usr/bin/env bun
/**
 * 修改用户（SEC_User）的「联系对象 FLinkObject」—— 默认 dry-run，加 --apply 才写入
 *
 * 背景（2026-09 实测）：
 *   - 用户↔员工的关联是 `T_SEC_USER.FLINKOBJECT`（用户的「联系对象」），
 *     不是 `T_SEC_USER.FEMPID`（该列为空）。
 *   - 用户表单 FormId = `SEC_User`；View 里联系对象显示为 `FLinkObject`，带的是**员工编码**。
 *   - 元数据有校验：「该联系对象已经使用过，不能再选用」——一个员工只能绑一个账号。
 *   - 更新只改 `FLinkObject`（NeedUpDateFields），不动用户名/密码/角色。
 *
 * 用法：
 *   bun scripts/tools/rebind_user_link.js --account <账号> --employee <员工编码>
 *   ... --apply
 */
import { K3CloudWebAPI } from "../../lib/k3/index.js";

const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const apply = args.includes("--apply");

const account = val("--account");
const empNumber = val("--employee");
if (!account || !empNumber) {
  console.error("用法: bun scripts/tools/rebind_user_link.js --account <账号> --employee <员工编码> [--apply]");
  process.exit(1);
}

const api = new K3CloudWebAPI();
await api.login();

// 目标员工
const empRows = await api.executeBillQuery("BD_Empinfo", "FID,FNumber,FName,FPersonId,FStaffId", `FNumber='${empNumber}'`, 5);
if (empRows.length !== 1) {
  console.error(`员工编码 ${empNumber} 无法唯一确定（命中 ${empRows.length} 条）`);
  process.exit(1);
}
const emp = { fid: empRows[0][0], number: empRows[0][1], name: empRows[0][2] };

// 目标账号
const userRows = await api.executeBillQuery("SEC_User", "FUserID,FUserAccount", `FUserAccount='${account}'`, 5);
if (userRows.length !== 1) {
  console.error(`账号 ${account} 无法唯一确定（命中 ${userRows.length} 条）`);
  process.exit(1);
}
const userId = userRows[0][0];

const before = await api.viewBill("SEC_User", userId);
console.log("=== 账号现状 ===");
console.log(`账号: ${before.UserAccount ?? account}  (FUserID=${userId})`);
console.log(`用户名: ${before.Name}`);
console.log(`当前联系对象: ${before.FLinkObject?.Number ?? "(空)"} ${before.FLinkObject?.Name?.[0]?.Value ?? ""}`);
console.log("\n=== 拟改为 ===");
console.log(`联系对象: ${emp.number} ${emp.name}`);
console.log(apply ? "模式: APPLY（真实写入）" : "模式: DRY-RUN（仅预览，加 --apply 执行）");

if (String(before.FLinkObject?.Number) === String(emp.number)) {
  console.log("\n联系对象已是目标员工，无需修改。");
  process.exit(0);
}
if (!apply) {
  console.log("\nDRY-RUN 结束（未写库）。");
  process.exit(0);
}

const res = await api.saveBill(
  "SEC_User",
  { FUserID: userId, FLinkObject: { FNumber: emp.number } },
  ["FLinkObject"],
  ["FUserID", "FUserAccount", "FLinkObject"]
);
console.log("\n保存返回:", JSON.stringify(res?.Result?.ResponseStatus?.IsSuccess));

const after = await api.viewBill("SEC_User", userId);
console.log("=== 回查 ===");
console.log(`账号: ${after.UserAccount}  用户名: ${after.Name}`);
console.log(`联系对象: ${after.FLinkObject?.Number ?? "(空)"} ${after.FLinkObject?.Name?.[0]?.Value ?? ""}`);
if (String(after.FLinkObject?.Number) !== String(emp.number)) {
  console.error("⚠ 回查未确认绑定已生效，请人工核对。");
  process.exit(2);
}
console.log("\n绑定修改成功。");
