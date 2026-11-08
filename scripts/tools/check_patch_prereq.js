#!/usr/bin/env bun
/**
 * 补丁前基线快照（只读）
 *
 * 用途：打补丁前先跑一次，把版本、数据中心、补丁记录、模块、单据量记录下来，
 *       存成 output/patch_baseline_<时间戳>.json，供 verify_after_patch.js 对比。
 *
 * 用法：
 *   bun run scripts/tools/check_patch_prereq.js
 *
 * 注意：本脚本只做查询，不写任何业务数据。
 *       文件系统层（二开程序集、fastjson jar、磁盘空间）需在服务器上按
 *       .agents/skills/kingdee-system-admin/references/system/k3cloud-patch-v9-upgrade.md 附录执行。
 */
import sql from "mssql";
import { writeFileSync, mkdirSync } from "fs";
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

/** 一条 SQL 查询一组计数，返回 {标签: 数量} */
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

// ---------- 1. WebAPI 版本与版别 ----------
const api = new K3CloudWebAPI();
const login = await api.login();
const ctx = login.Context ?? {};
const version = {
  DisplayVersion: ctx.DisplayVersion,
  ProductEdition: ctx.ProductEdition,
  DataCenterName: ctx.DataCenterName,
  DataCenterNumber: ctx.DataCenterNumber,
  DBid: ctx.DBid,
  Edition判断: ctx.ProductEdition === 1 ? "标准版" : "企业版",
};

// ---------- 2. 定位管理中心库 ----------
const dbList = await q("master", `SELECT name FROM sys.databases WHERE name LIKE 'K3DBConfiger%'`);
const CFG = dbList[0]?.name ?? null;

// ---------- 3. 数据中心登记信息 ----------
const dataCenters = CFG
  ? await q(CFG, `SELECT FNUMBER, FDATABASENAME, FVISION, FPRODUCTTYPE, FACCTTYPE, FBACKUPDATETYPE = FBACKUPTYPE, FBACKUPDATE, FDATACENTERID FROM T_BAS_DATACENTER ORDER BY FNUMBER`)
  : [];

// ---------- 4. 补丁记录表（打补丁前应为空）----------
const majorVer = CFG ? await q(CFG, `SELECT * FROM T_BAS_DATACENTERMAJORVER`) : [];
const verInfo = CFG ? await q(CFG, `SELECT * FROM T_BAS_DATACENTERVERINFO`) : [];

// ---------- 5. 账套注册与注册历史 ----------
const register = await q(K3_DB_NAME, `SELECT FBOSVERSION, FPRODUCTEDITION, FPTNO, FUPLOADDATE, FDATACENTERID FROM T_BOS_REGISTER`);
const registerHistory = await q(K3_DB_NAME, `SELECT TOP 5 FPTNO, FDATE FROM T_BOS_REGISTERPKGHISTORY ORDER BY FDATE DESC`);

// ---------- 6. 模块使用抽样（决定业务补丁是否要装）----------
const modules = await counts(K3_DB_NAME, [
  ["零售·序列号 CMK_LS_SERIALNO", "CMK_LS_SERIALNO"],
  ["零售·门店收货 CMK_LS_StoreReceiptSerial", "CMK_LS_StoreReceiptSerial"],
  ["零售·门店发货 CMK_LS_StoreShipSerial", "CMK_LS_StoreShipSerial"],
  ["条码·生产汇报序列 T_SFC_OPTRPTENTRYPRDSERIAL", "T_SFC_OPTRPTENTRYPRDSERIAL"],
]);
try {
  const r = await q(K3_DB_NAME, `SELECT COUNT(*) AS c FROM sys.tables WHERE name LIKE 'BBC%'`);
  modules["BBC 相关表数量"] = r[0]?.c ?? null;
} catch (e) {
  modules["BBC 相关表数量"] = `查询失败: ${e.message}`;
}

// ---------- 7. 关键单据量抽样（补丁后对比）----------
const bills = await counts(K3_DB_NAME, [
  ["生产订单 T_PRD_MO", "T_PRD_MO"],
  ["工序计划 T_SFC_OPERPLANNING", "T_SFC_OPERPLANNING"],
  ["工序汇报 T_SFC_OPTRPT", "T_SFC_OPTRPT"],
  ["应付单 T_AP_PAYABLE", "T_AP_PAYABLE"],
  ["物料 T_BD_MATERIAL", "T_BD_MATERIAL"],
  ["BOM T_ENG_BOM", "T_ENG_BOM"],
]);

const snapshot = {
  采集时间: new Date().toISOString(),
  采集主机: K3_DB_HOST,
  账套库: K3_DB_NAME,
  管理中心库: CFG,
  版本: version,
  数据中心: dataCenters,
  补丁记录: { T_BAS_DATACENTERMAJORVER: majorVer, T_BAS_DATACENTERVERINFO: verInfo },
  账套注册: register,
  注册历史: registerHistory,
  模块抽样: modules,
  单据量抽样: bills,
};

const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
mkdirSync("output", { recursive: true });
const file = `output/patch_baseline_${stamp}.json`;
writeFileSync(file, JSON.stringify(snapshot, null, 2), "utf-8");

// ---------- 输出 ----------
console.log("========== 补丁前基线快照 ==========");
console.log(`账套库     : ${K3_DB_NAME}   （采集主机 ${K3_DB_HOST}）`);
console.log(`管理中心库 : ${CFG}`);
console.log("");
console.log("【版本】");
console.log(`  DisplayVersion : ${version.DisplayVersion}`);
console.log(`  版别判断       : ${version.Edition判断}（ProductEdition=${version.ProductEdition}，=1 才是标准版）`);
console.log(`  数据中心       : ${version.DataCenterName}（${version.DataCenterNumber}）`);
console.log("");
console.log("【数据中心登记（管理中心库）】");
for (const d of dataCenters) {
  console.log(`  ${d.FNUMBER}  ${d.FDATABASENAME}  版本=${d.FVISION}  产品类型=${d.FPRODUCTTYPE}  账套类型=${d.FACCTTYPE}  最近备份=${d.FBACKUPDATE?.toISOString?.() ?? d.FBACKUPDATE}`);
}
console.log("");
console.log("【补丁记录】（打补丁前应为空）");
console.log(`  T_BAS_DATACENTERMAJORVER : ${majorVer.length} 行`);
console.log(`  T_BAS_DATACENTERVERINFO  : ${verInfo.length} 行`);
console.log("");
console.log("【账套注册】");
for (const r of register) console.log(`  FBOSVERSION=${r.FBOSVERSION}  FPRODUCTEDITION=${r.FPRODUCTEDITION}  上传=${r.FUPLOADDATE?.toISOString?.() ?? r.FUPLOADDATE}`);
console.log("  注册历史（最近 5 条）:");
for (const h of registerHistory) console.log(`    ${h.FPTNO}  ${h.FDATE?.toISOString?.() ?? h.FDATE}`);
console.log("");
console.log("【模块使用抽样】");
for (const [k, v] of Object.entries(modules)) console.log(`  ${k} : ${v}`);
console.log("");
console.log("【关键单据量抽样】");
for (const [k, v] of Object.entries(bills)) console.log(`  ${k} : ${v}`);
console.log("");
console.log(`基线已保存: ${file}`);
