/**
 * 发货通知单自动锁库工具
 * 方案：按制单人轮询 -> 金蝶 SAL_DeliveryNotice FEntity.FLockStockFlag="1"
 * 全链路验证步骤：
 *   UnAudit -> Save(FEntity: FLockStockFlag="1",FLockStockBaseQty=Qty) -> Submit -> Audit
 *   回查 DB FLOCKSTOCKFLAG=1 FLOCKSTOCKBASEQTY=Qty，View LockStockFlag=true
 *
 * 用法：
 *   bun run auto-lock-dn -- --creator-id <FUserID>              # dry-run 只看会锁哪些单
 *   bun run auto-lock-dn -- --creator-id <FUserID> --apply      # 真正执行锁库
 *   bun run auto-lock-dn -- --creator-id <FUserID> --bill <FBillNo> --apply  # 只锁指定单
 */
import { K3CloudWebAPI, K3_DB_HOST, K3_DB_USER, K3_DB_PASS, K3_DB_NAME } from "../../lib/k3/index.js";
import mssql from "mssql";

const DB_CFG = {
  server: K3_DB_HOST,
  user: K3_DB_USER,
  password: K3_DB_PASS,
  database: K3_DB_NAME,
  options: { encrypt: false, trustServerCertificate: true },
};

async function getUnLockedNotices(creatorId, billNoFilter = null) {
  if (!Number.isInteger(creatorId) || creatorId <= 0) {
    throw new Error("必须通过 --creator-id <FUserID> 或环境变量 K3_LOCK_CREATOR_ID 指定正整数制单人 ID");
  }
  if (!DB_CFG.server || !DB_CFG.user || !DB_CFG.password || !DB_CFG.database) {
    throw new Error("缺少 SQL 连接配置（K3_DB_HOST / K3_DB_USER / K3_DB_PASS / K3_DB_NAME）");
  }
  const pool = await mssql.connect(DB_CFG);
  let sql = `
    SELECT h.FID, h.FBILLNO, h.FCREATORID, h.FDATE, e.FENTRYID, e.FQTY, e.FLOCKSTOCKFLAG, e.FLOCKSTOCKBASEQTY
    FROM T_SAL_DELIVERYNOTICE h
    JOIN T_SAL_DELIVERYNOTICEENTRY e ON h.FID=e.FID
    WHERE h.FCREATORID=${creatorId} AND h.FDOCUMENTSTATUS='C' AND e.FLOCKSTOCKFLAG='0'
  `;
  if (billNoFilter) {
    const safe = billNoFilter.replace(/'/g, "''");
    sql += ` AND h.FBILLNO='${safe}'`;
  }
  sql += ` ORDER BY h.FBILLNO, e.FENTRYID`;
  const r = await pool.request().query(sql);
  await pool.close();
  return r.recordset;
}

async function lockOneBill(api, fid, entries, dryRun = true) {
  // entries: [{FENTRYID, FQTY}]
  const model = {
    FID: fid,
    FEntity: entries.map((e) => ({ FEntryID: e.FENTRYID, FLockStockFlag: "1", FLockStockBaseQty: Number(e.FQTY) })),
  };
  const needFields = ["FLockStockFlag", "FLockStockBaseQty"];
  if (dryRun) {
    return { dryRun: true, model, needFields };
  }
  // 需反审核 -> 保存 -> 提交审核
  await api.unAuditBill("SAL_DeliveryNotice", [fid]);
  const saveRes = await api.saveBill("SAL_DeliveryNotice", model, needFields, [], false);
  api.raiseIfError(saveRes);
  await api.submitBill("SAL_DeliveryNotice", [fid]);
  await api.auditBill("SAL_DeliveryNotice", [fid]);
  // 回查
  const dn = await api.viewBill("SAL_DeliveryNotice", fid);
  return {
    dryRun: false,
    after: dn.SAL_DELIVERYNOTICEENTRY.map((x) => ({ Id: x.Id, Flag: x.LockStockFlag, Qty: x.LockStockBaseQty })),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const billArgIdx = args.indexOf("--bill");
  const billFilter = billArgIdx >= 0 ? args[billArgIdx + 1] : null;
  const creatorArgIdx = args.indexOf("--creator-id");
  const creatorRaw = creatorArgIdx >= 0 ? args[creatorArgIdx + 1] : process.env.K3_LOCK_CREATOR_ID;
  const creatorId = Number(creatorRaw);

  const api = new K3CloudWebAPI();
  await api.login();
  console.log(
    `login ok base=${api.baseUrl} creatorId=${creatorId} 模式=${apply ? "APPLY 真写" : "dry-run 预览"} ${billFilter ? `单号=${billFilter}` : ""}`,
  );

  const rows = await getUnLockedNotices(creatorId, billFilter);
  if (!rows.length) {
    console.log("没有找到目标制单人未锁的发货通知单分录。");
    return;
  }
  // 按 FID 分组
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.FID)) groups.set(r.FID, { FID: r.FID, FBILLNO: r.FBILLNO, entries: [] });
    groups.get(r.FID).entries.push(r);
  }
  console.log(`待锁单据 ${groups.size} 张，待锁分录 ${rows.length} 行`);
  for (const [fid, g] of groups) {
    console.log(
      `\n[${g.FBILLNO}] FID=${fid} 待锁 ${g.entries.length} 行: ${g.entries.map((e) => `Entry${e.FENTRYID} Qty=${e.FQTY}`).join(", ")}`,
    );
    if (!apply) {
      const preview = await lockOneBill(api, fid, g.entries, true);
      console.log("  dry-run model:", JSON.stringify(preview.model, null, 2));
      console.log("  NeedUpdateFields:", preview.needFields.join(","));
      console.log("  -> 加 --apply 才会执行 UnAudit/Save/Submit/Audit");
    } else {
      try {
        const res = await lockOneBill(api, fid, g.entries, false);
        console.log("  已锁，View回查:", res.after);
      } catch (e) {
        console.error("  锁库失败:", e.message.slice(0, 600));
        // 尝试回滚到已审核状态
        try {
          await api.submitBill("SAL_DeliveryNotice", [fid]);
          await api.auditBill("SAL_DeliveryNotice", [fid]);
        } catch (_) {}
      }
    }
  }

  if (!apply) console.log("\n提示：预览完成，未写入。确认后用  bun run auto-lock-dn -- --creator-id <FUserID> --apply  执行。");
  else {
    const verify = await getUnLockedNotices(creatorId, billFilter);
    console.log(`\n执行后复查：剩余未锁分录 ${verify.length} 行 ${verify.length === 0 ? "(全部已锁 ✅)" : ""}`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
