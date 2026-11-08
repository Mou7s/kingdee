#!/usr/bin/env bun
/**
 * 修改用户（SEC_User）的显示名（FName）—— 默认 dry-run，加 --apply 才写入
 *
 * 背景（2026-09 实测）：
 *   - 用户表单 FormId = `SEC_User`；显示名是 `FName`（单语，列 `T_SEC_USER.FNAME`）。
 *   - 登录账号是 `FUserAccount`，与显示名无关；本工具**只改显示名**，不动账号/密码/绑定/角色。
 *   - 显示名应与「联系对象(FLinkObject)」指向的员工一致，否则列表里会看起来绑错了人。
 *
 * 用法：
 *   bun scripts/tools/rename_user_display.js --account <账号> --name <显示名>
 *   ... --apply
 */
import { K3CloudWebAPI } from "../../lib/k3/index.js";

const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const apply = args.includes("--apply");

const account = val("--account");
const newName = val("--name");
if (!account || !newName) {
  console.error("用法: bun scripts/tools/rename_user_display.js --account <账号> --name <新显示名> [--apply]");
  process.exit(1);
}

const api = new K3CloudWebAPI();
await api.login();

const rows = await api.executeBillQuery("SEC_User", "FUserID,FUserAccount", `FUserAccount='${account}'`, 5);
if (rows.length !== 1) {
  console.error(`账号 ${account} 无法唯一确定（命中 ${rows.length} 条）`);
  process.exit(1);
}
const userId = rows[0][0];
const before = await api.viewBill("SEC_User", userId);
console.log("=== 现状 ===");
console.log(`登录账号: ${before.UserAccount}`);
console.log(`当前显示名: ${before.Name}`);
console.log(`联系对象: ${before.FLinkObject?.Number ?? "(空)"} ${before.FLinkObject?.Name?.[0]?.Value ?? ""}`);
console.log("\n=== 拟改为 ===");
console.log(`显示名: ${newName}（登录账号 ${before.UserAccount} 不变）`);
console.log(apply ? "模式: APPLY（真实写入）" : "模式: DRY-RUN（仅预览，加 --apply 执行）");

if (before.Name === newName) {
  console.log("\n显示名已是目标值，无需修改。");
  process.exit(0);
}
if (!apply) {
  console.log("\nDRY-RUN 结束（未写库）。");
  process.exit(0);
}

const res = await api.saveBill("SEC_User", { FUserID: userId, FName: newName }, ["FName"], ["FUserID", "FUserAccount", "FName", "FLinkObject"]);
console.log("\n保存返回:", JSON.stringify(res?.Result?.ResponseStatus?.IsSuccess));

const after = await api.viewBill("SEC_User", userId);
console.log("=== 回查 ===");
console.log(`登录账号: ${after.UserAccount}`);
console.log(`显示名: ${after.Name}`);
console.log(`联系对象: ${after.FLinkObject?.Number ?? "(空)"} ${after.FLinkObject?.Name?.[0]?.Value ?? ""}`);
if (after.Name !== newName) {
  console.error("⚠ 回查未确认显示名已生效，请人工核对。");
  process.exit(2);
}
console.log("\n显示名修改成功。");
