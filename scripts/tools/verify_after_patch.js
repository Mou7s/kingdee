#!/usr/bin/env bun
/**
 * 补丁后回查（只读）
 *
 * 用途：打完补丁后跑一次，与补丁前基线（output/patch_baseline_*.json）对比，
 *       逐项判定补丁是否生效、业务数据量是否正常。
 *
 * 用法：
 *   bun run scripts/tools/verify_after_patch.js                 # 自动取最新基线
 *   bun run scripts/tools/verify_after_patch.js <基线json路径>   # 指定基线
 *
 * 注意：只做查询。二开程序集 / fastjson jar / 磁盘空间需在服务器上另行核查，
 *       清单见 .agents/skills/kingdee-system-admin/references/system/k3cloud-patch-v9-upgrade.md。
 */
import sql from "mssql";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "fs";
import { K3CloudWebAPI, K3_DB_HOST, K3_DB_USER, K3_DB_PASS, K3_DB_NAME } from "../../lib/k3/index.js";

const base = {
  user: K3_DB_USER,
  password: K3_DB_PASS,
  server: K3_DB_HOST,
  options: { encrypt: false, trustServerCertificate: true, connectTimeout: 15000 },
};

async function q(db, text) {
  const pool = await new sql.ConnectionPool({ ...base, database: db }).connect();
  try {
    const r = await pool.request().query(text);
    return r.recordset ?? [];
  } finally {
    await pool.close();
  }
}

async function counts(db, pairs) {
  const out = {};
  for (const [label, table] of pairs) {
    try {
      const r = await q(db, `SELECT COUNT(*) AS c FROM ${table}`);
      out[label] = r[0]?.c ?? null;
    } catch {
      out[label] = "表不存在";
    }
  }
  return out;
}

// ---------- 载入基线 ----------
const arg = process.argv[2];
let baselineFile = arg;
if (!baselineFile) {
  const files = readdirSync("output").filter((f) => f.startsWith("patch_baseline_") && f.endsWith(".json"));
  if (!files.length) {
    console.error("未找到基线文件 output/patch_baseline_*.json，请先运行 check_patch_prereq.js");
    process.exit(1);
  }
  baselineFile = "output/" + files.sort().pop();
}
const baseline = JSON.parse(readFileSync(baselineFile, "utf-8"));
console.log(`基线文件: ${baselineFile}（采集于 ${baseline.采集时间}）`);

// ---------- 重新采集 ----------
const api = new K3CloudWebAPI();
const ctx = (await api.login()).Context ?? {};
const dbList = await q("master", `SELECT name FROM sys.databases WHERE name LIKE 'K3DBConfiger%'`);
const CFG = dbList[0]?.name ?? null;

const now = {
  DisplayVersion: ctx.DisplayVersion,
  Edition判断: ctx.ProductEdition === 1 ? "标准版" : "企业版",
  ProductEdition: ctx.ProductEdition,
  数据中心: CFG ? await q(CFG, `SELECT FNUMBER, FDATABASENAME, FVISION FROM T_BAS_DATACENTER ORDER BY FNUMBER`) : [],
  补丁记录: {
    T_BAS_DATACENTERMAJORVER: CFG ? await q(CFG, `SELECT * FROM T_BAS_DATACENTERMAJORVER`) : [],
    T_BAS_DATACENTERVERINFO: CFG ? await q(CFG, `SELECT * FROM T_BAS_DATACENTERVERINFO`) : [],
  },
  注册: await q(K3_DB_NAME, `SELECT FBOSVERSION, FPRODUCTEDITION, FPTNO, FUPLOADDATE FROM T_BOS_REGISTER`),
  模块抽样: await counts(K3_DB_NAME, [
    ["零售·序列号 CMK_LS_SERIALNO", "CMK_LS_SERIALNO"],
    ["条码·生产汇报序列 T_SFC_OPTRPTENTRYPRDSERIAL", "T_SFC_OPTRPTENTRYPRDSERIAL"],
  ]),
  单据量抽样: await counts(K3_DB_NAME, [
    ["生产订单 T_PRD_MO", "T_PRD_MO"],
    ["工序计划 T_SFC_OPERPLANNING", "T_SFC_OPERPLANNING"],
    ["工序汇报 T_SFC_OPTRPT", "T_SFC_OPTRPT"],
    ["应付单 T_AP_PAYABLE", "T_AP_PAYABLE"],
    ["物料 T_BD_MATERIAL", "T_BD_MATERIAL"],
    ["BOM T_ENG_BOM", "T_ENG_BOM"],
  ]),
};
try {
  const r = await q(K3_DB_NAME, `SELECT COUNT(*) AS c FROM sys.tables WHERE name LIKE 'BBC%'`);
  now.模块抽样["BBC 相关表数量"] = r[0]?.c ?? null;
} catch {
  now.模块抽样["BBC 相关表数量"] = "查询失败";
}

// ---------- 对比 ----------
const checks = [];
const add = (name, before, after, pass, note = "") => checks.push({ name, before, after, pass, note });

add("版本 DisplayVersion", baseline.版本.DisplayVersion, now.DisplayVersion,
  baseline.版本.DisplayVersion !== now.DisplayVersion,
  "应当从 9.0.280.13 变为 9.0.0.20250410（或更高）");
add("版别", baseline.版本.Edition判断, now.Edition判断, baseline.版本.Edition判断 === now.Edition判断,
  "应保持企业版不变");

const beforeMajor = baseline.补丁记录.T_BAS_DATACENTERMAJORVER.length;
const afterMajor = now.补丁记录.T_BAS_DATACENTERMAJORVER.length;
add("补丁记录 T_BAS_DATACENTERMAJORVER", `${beforeMajor} 行`, `${afterMajor} 行`, afterMajor > 0,
  "打补丁前为空，打完后应有补丁号/补丁日期");
add("补丁记录 T_BAS_DATACENTERVERINFO", `${baseline.补丁记录.T_BAS_DATACENTERVERINFO.length} 行`,
  `${now.补丁记录.T_BAS_DATACENTERVERINFO.length} 行`, now.补丁记录.T_BAS_DATACENTERVERINFO.length > 0,
  "同上");

const beforeVer = (baseline.数据中心 || []).map((d) => `${d.FNUMBER}:${d.FVISION}`).join(" | ");
const afterVer = (now.数据中心 || []).map((d) => `${d.FNUMBER}:${d.FVISION}`).join(" | ");
add("数据中心登记版本 FVISION", beforeVer, afterVer, beforeVer !== afterVer, "两个数据中心都应更新");

add("账套注册 FBOSVERSION", baseline.账套注册[0]?.FBOSVERSION, now.注册[0]?.FBOSVERSION,
  baseline.账套注册[0]?.FBOSVERSION !== now.注册[0]?.FBOSVERSION, "应随补丁更新");

for (const [k, v] of Object.entries(now.单据量抽样)) {
  const before = baseline.单据量抽样?.[k];
  if (typeof before === "number" && typeof v === "number") {
    add(`单据量 ${k}`, before, v, v >= before, v === before ? "与基线一致" : "较基线增加属正常（有新增业务）");
  }
}

// ---------- 输出 ----------
console.log("\n========== 补丁后回查 ==========");
let passCnt = 0;
for (const c of checks) {
  const flag = c.pass ? "✅" : "❌";
  if (c.pass) passCnt++;
  console.log(`${flag} ${c.name}`);
  console.log(`     补丁前: ${c.before}`);
  console.log(`     补丁后: ${c.after}`);
  if (c.note) console.log(`     说明  : ${c.note}`);
}
console.log(`\n通过 ${passCnt}/${checks.length} 项`);
const fail = checks.filter((c) => !c.pass);
if (fail.length) {
  console.log("\n需人工确认的项：");
  fail.forEach((c) => console.log(`  - ${c.name}：${c.before} → ${c.after}（${c.note}）`));
} else {
  console.log("\n全部通过：补丁已生效，业务数据量正常。");
}

if (now.补丁记录.T_BAS_DATACENTERMAJORVER.length) {
  console.log("\n【补丁记录明细】");
  console.log(JSON.stringify(now.补丁记录, null, 2));
}

mkdirSync("output", { recursive: true });
const out = `output/patch_verify_${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}.json`;
writeFileSync(out, JSON.stringify({ 基线: baselineFile, 回查时间: new Date().toISOString(), checks, now }, null, 2), "utf-8");
console.log(`\n回查结果已保存: ${out}`);
