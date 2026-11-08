#!/usr/bin/env bun
/**
 * 按客户编码解冻（写 T_BD_CUSTOMEREXT）
 * 默认 dry-run，加 --apply 才更新。
 *
 * Usage:
 *   bun scripts/tools/unfreeze_customer.js <CUST编码>
 *   bun scripts/tools/unfreeze_customer.js <CUST编码> --apply
 *   bun run unfreeze-customer -- CUST0281 --apply
 *
 * FreezeStatus: B=冻结, A=正常
 */
import sql from "mssql";
import {
  K3_DB_HOST,
  K3_DB_USER,
  K3_DB_PASS,
  K3_DB_NAME,
} from "../../lib/k3/index.js";

const args = process.argv.slice(2).filter((a) => a !== "--");
const apply = args.includes("--apply");
const fnumber = args.find((a) => !a.startsWith("--"));

if (!fnumber) {
  console.log("用法: bun scripts/tools/unfreeze_customer.js <CUST编码> [--apply]");
  console.log("  默认 dry-run 只预览；加 --apply 才解冻");
  process.exit(1);
}

const pool = await sql.connect({
  server: K3_DB_HOST,
  user: K3_DB_USER,
  password: K3_DB_PASS,
  database: K3_DB_NAME,
  options: { encrypt: false, trustServerCertificate: true },
});

const before = await pool
  .request()
  .input("no", sql.NVarChar, fnumber)
  .query(`
    SELECT c.FCUSTID, c.FNUMBER, cL.FNAME, ext.FFREEZESTATUS, ext.FFREEZELIMIT, ext.FFREEZEDATE
    FROM T_BD_CUSTOMER c
    JOIN T_BD_CUSTOMER_L cL ON c.FCUSTID = cL.FCUSTID AND cL.FLOCALEID = 2052
    LEFT JOIN T_BD_CUSTOMEREXT ext ON c.FCUSTID = ext.FCUSTID
    WHERE c.FNUMBER = @no
  `);

const row = before.recordset[0];
if (!row) {
  console.log("未找到客户:", fnumber);
  await pool.close();
  process.exit(1);
}

const freezeLabel = { A: "正常", B: "冻结" };
console.log("客户:", {
  FCUSTID: row.FCUSTID,
  FNUMBER: row.FNUMBER,
  FNAME: (row.FNAME || "").trim(),
  FFREEZESTATUS: `${row.FFREEZESTATUS} (${freezeLabel[row.FFREEZESTATUS] || "?"})`,
  FFREEZELIMIT: row.FFREEZELIMIT,
  FFREEZEDATE: row.FFREEZEDATE,
});
console.log(apply ? "⚠ 模式: APPLY" : "ℹ 模式: dry-run（加 --apply 执行）");

if (row.FFREEZESTATUS !== "B") {
  console.log(`当前非冻结状态 (${row.FFREEZESTATUS})，跳过`);
  await pool.close();
  process.exit(0);
}

if (!apply) {
  console.log("\n将执行: FFREEZESTATUS=A, 清空 limit/operator/date");
  console.log("（dry-run 结束）");
  await pool.close();
  process.exit(0);
}

await pool
  .request()
  .input("no", sql.NVarChar, fnumber)
  .query(`
    UPDATE ext
    SET ext.FFREEZESTATUS = 'A',
        ext.FFREEZELIMIT = ' ',
        ext.FFREEZEOPERATOR = 0,
        ext.FFREEZEDATE = NULL
    FROM T_BD_CUSTOMEREXT ext
    JOIN T_BD_CUSTOMER cust ON ext.FCUSTID = cust.FCUSTID
    WHERE cust.FNUMBER = @no
  `);

const after = await pool
  .request()
  .input("no", sql.NVarChar, fnumber)
  .query(`
    SELECT c.FNUMBER, cL.FNAME, ext.FFREEZESTATUS, ext.FFREEZELIMIT, ext.FFREEZEDATE
    FROM T_BD_CUSTOMER c
    JOIN T_BD_CUSTOMER_L cL ON c.FCUSTID = cL.FCUSTID AND cL.FLOCALEID = 2052
    JOIN T_BD_CUSTOMEREXT ext ON c.FCUSTID = ext.FCUSTID
    WHERE c.FNUMBER = @no
  `);
const a = after.recordset[0];
console.log("解冻后:", {
  FNUMBER: a.FNUMBER,
  FNAME: (a.FNAME || "").trim(),
  FFREEZESTATUS: a.FFREEZESTATUS,
  FFREEZELIMIT: a.FFREEZELIMIT,
  FFREEZEDATE: a.FFREEZEDATE,
});

await pool.close();
console.log("✅ 完成");
