/**
 * 为主账套建立每日差异备份作业（06:00 / 12:00 / 18:00）。
 *
 * 默认 dry-run（只打印将执行的 T-SQL 与当前状态核对结果）；
 * 加 --apply 才真正创建作业、调度与作业步骤。
 *
 * 安全边界：
 * - 只创建/维护名为【主账套-每日差异备份】的作业，不改动 KD-MAIN 维护计划；
 * - 差异备份写在独立目录 D:\正式数据备份\主账套差异\，清理步骤只删该目录的 .bak，
 *   不会碰主账套 ALL 目录里的完整备份；
 * - 差异备份以每天 00:00 的完整备份为基线；全备失败时差异仍以更早的全备为基线。
 */
import sql from "mssql";
import { K3_DB_HOST, K3_DB_USER, K3_DB_PASS, K3_DB_NAME } from "../../lib/k3/index.js";

const APPLY = process.argv.includes("--apply");
const JOB = "主账套-每日差异备份";
const DB = K3_DB_NAME || process.env.K3_MAIN_DB || "";
const DIR = process.env.K3_DIFF_BACKUP_DIR || "D:\\正式数据备份\\主账套差异";
const KEEP_DAYS = 3;
const TIMES = ["060000", "120000", "180000"];
if (!DB) {
  throw new Error("未配置主账套数据库名（K3_DB_NAME / K3_MAIN_DB）");
}

const pool = await new sql.ConnectionPool({
  user: K3_DB_USER, password: K3_DB_PASS, server: K3_DB_HOST, database: "msdb",
  options: { encrypt: false, trustServerCertificate: true, connectTimeout: 15000, requestTimeout: 300000 },
}).connect();
const one = async (text) => (await pool.request().query(text)).recordset;

console.log(`模式: ${APPLY ? "★ 实际执行（--apply）" : "dry-run（仅打印，不写入）"}`);
const SERVER = (await one(`SELECT CONVERT(sysname, SERVERPROPERTY('ServerName')) AS s`))[0].s;
console.log(`服务器: ${SERVER}`);

// ---- 1) 前置检查 ----
const info = await one(`
  SELECT (SELECT COUNT(*) FROM sys.databases WHERE name = N'${DB}') AS 目标库存在,
         (SELECT CONVERT(VARCHAR(30), state_desc) FROM sys.databases WHERE name = N'${DB}') AS 目标库状态,
         (SELECT CONVERT(VARCHAR(20), recovery_model_desc) FROM sys.databases WHERE name = N'${DB}') AS 恢复模式,
         (SELECT CONVERT(VARCHAR(19), MAX(backup_finish_date), 120) FROM msdb.dbo.backupset
            WHERE database_name = N'${DB}' AND type = 'D') AS 最近完整备份`);
console.log("\n### 前置检查");
console.log(`  目标库存在=${info[0].目标库存在} (${info[0].目标库状态})   恢复模式=${info[0].恢复模式}   最近完整备份=${info[0].最近完整备份}`);

const existing = await one(`SELECT job_id, enabled FROM msdb.dbo.sysjobs WHERE name = N'${JOB}'`);
console.log(`  目标作业【${JOB}】: ${existing.length ? "已存在（--apply 时会先删除再重建，不会重复堆积）" : "不存在，可创建"}`);

const dupJobs = await one(`SELECT name FROM msdb.dbo.sysjobs WHERE name LIKE N'%差异备份%'`);
console.log(`  已存在的差异备份类作业: ${dupJobs.length} 个${dupJobs.length ? " → " + dupJobs.map(d => d.name).join(" / ") : ""}`);

const dirExists = await one(`DECLARE @r INT; EXEC master.dbo.xp_fileexist N'${DIR}', @r OUTPUT; SELECT @r AS 存在`);
console.log(`\n### 目标目录 ${DIR}`);
console.log(`  存在=${dirExists[0].存在}（1=目录已存在，0=需要创建）`);

// ---- 2) 将执行的 T-SQL ----
const tsqlBackup = `DECLARE @p NVARCHAR(400) = N'${DIR}\\${DB}_diff_'
        + CONVERT(NVARCHAR(20), GETDATE(), 112) + N'_'
        + REPLACE(CONVERT(NVARCHAR(8), GETDATE(), 108), ':', '') + N'.bak';
BACKUP DATABASE [${DB}] TO DISK = @p
  WITH DIFFERENTIAL, INIT, COMPRESSION, CHECKSUM, STATS = 10,
       NAME = N'${DB}-差异备份';
PRINT N'差异备份文件: ' + @p;`;

const tsqlCleanup = `
DECLARE @old DATE = DATEADD(DAY, -${KEEP_DAYS}, CAST(GETDATE() AS DATE));
PRINT N'清理 ' + CONVERT(NVARCHAR(12), @old, 120) + N' 之前的差异备份';
EXEC master.sys.xp_delete_file 0, N'${DIR}\\', N'bak', @old;`;

console.log("\n### 将执行的作业步骤");
console.log(`步骤1【差异备份】:\n${tsqlBackup.split("\n").map((l) => "   " + l).join("\n")}`);
console.log(`\n步骤2【清理 ${KEEP_DAYS} 天前的差异备份】:\n${tsqlCleanup.split("\n").map((l) => "   " + l).join("\n")}`);
console.log(`\n调度: 每天 ${TIMES.map(t => t.slice(0, 2) + ":" + t.slice(2, 4)).join(" / ")}（各自独立的每日调度）`);
console.log(`基线: 每天 00:00 的完整备份（KD-MAIN）；最坏数据丢失从 24 小时缩短到约 6 小时`);

if (!APPLY) {
  console.log("\n※ dry-run 结束，未做任何写入。确认无误后加 --apply 执行。");
  await pool.close(); await sql.close(); process.exit(0);
}

// ---- 3) 实际执行 ----
if (existing.length) {
  console.log(`\n  目标作业已存在，先删除重建：sp_delete_job @delete_history=1`);
  await pool.request().query(`EXEC msdb.dbo.sp_delete_job @job_name = N'${JOB}', @delete_unused_schedule = 1, @delete_history = 1;`);
  console.log("  已删除旧作业 ✓");
}
const schedNames = TIMES.map((t) => `${JOB}-${t}`);
const dupSched = await one(`SELECT schedule_id, name FROM msdb.dbo.sysschedules WHERE name LIKE N'${JOB}%'`);
for (const d of dupSched) {
  await pool.request().query(`EXEC msdb.dbo.sp_delete_schedule @schedule_id = ${d.schedule_id}, @force_delete = 1;`);
}
if (dupSched.length) console.log(`  已清理同名残留调度 ${dupSched.length} 个 ✓`);

console.log("\n### 开始执行");
if (!dirExists[0].存在) {
  await pool.request().query(`EXEC master.dbo.xp_create_subdir N'${DIR}'`);
  console.log(`  已创建目录 ${DIR}`);
}

await pool.request().query(`
  EXEC msdb.dbo.sp_add_job @job_name = N'${JOB}',
       @enabled = 1, @notify_level_eventlog = 2, @notify_level_email = 0,
       @description = N'主账套 ${DB} 每日差异备份（06/12/18），以 00:00 完整备份为基线，保留 ${KEEP_DAYS} 天。由 kingdee 项目脚本创建，勿随意删除。',
       @owner_login_name = N'sa';`);
console.log("  创建作业 ✓");

await pool.request().query(`
  EXEC msdb.dbo.sp_add_jobstep @job_name = N'${JOB}', @step_id = 1,
       @step_name = N'差异备份 ${DB}', @subsystem = N'TSQL', @database_name = N'master',
       @command = N'${tsqlBackup.replace(/'/g, "''")}',
       @on_success_action = 3, @on_fail_action = 2, @retry_attempts = 0;`);
console.log("  创建步骤1（差异备份）✓");

await pool.request().query(`
  EXEC msdb.dbo.sp_add_jobstep @job_name = N'${JOB}', @step_id = 2,
       @step_name = N'清理 ${KEEP_DAYS} 天前的差异备份', @subsystem = N'TSQL', @database_name = N'master',
       @command = N'${tsqlCleanup.replace(/'/g, "''")}',
       @on_success_action = 1, @on_fail_action = 2, @retry_attempts = 0;`);
console.log("  创建步骤2（清理）✓");

for (const t of TIMES) {
  const name = `${JOB}-${t}`;
  await pool.request().query(`
    EXEC msdb.dbo.sp_add_schedule @schedule_name = N'${name}',
         @freq_type = 4, @freq_interval = 1, @freq_subday_type = 1,
         @active_start_time = ${t}, @enabled = 1;`);
  const sid = (await one(`SELECT schedule_id FROM msdb.dbo.sysschedules WHERE name = N'${name}'`))[0].schedule_id;
  await pool.request().query(`EXEC msdb.dbo.sp_attach_schedule @job_name = N'${JOB}', @schedule_id = ${sid};`);
  console.log(`  创建并绑定调度 ${t.slice(0, 2)}:${t.slice(2, 4)} ✓ schedule_id=${sid}`);
}

await pool.request().query(`EXEC msdb.dbo.sp_add_jobserver @job_name = N'${JOB}', @server_name = N'${SERVER}';`);
console.log("  绑定目标服务器 ✓");

// ---- 4) 回查 ----
console.log("\n### 回查结果");
console.log(await one(`
  SELECT j.name AS 作业, j.enabled AS 启用,
         (SELECT COUNT(*) FROM msdb.dbo.sysjobsteps s WHERE s.job_id = j.job_id) AS 步骤数,
         (SELECT COUNT(*) FROM msdb.dbo.sysjobschedules js WHERE js.job_id = j.job_id) AS 调度数,
         (SELECT COUNT(*) FROM msdb.dbo.sysjobservers v WHERE v.job_id = j.job_id) AS 目标服务器数
  FROM msdb.dbo.sysjobs j WHERE j.name = N'${JOB}'`));
console.log(await one(`
  SELECT sch.name, sch.enabled,
         RIGHT('000000'+CAST(sch.active_start_time AS varchar(6)),6) AS 每日时刻
  FROM msdb.dbo.sysschedules sch
  JOIN msdb.dbo.sysjobschedules js ON js.schedule_id = sch.schedule_id
  JOIN msdb.dbo.sysjobs j ON j.job_id = js.job_id
  WHERE j.name = N'${JOB}' ORDER BY sch.active_start_time`));
console.log(`\n手动试跑: EXEC msdb.dbo.sp_start_job @job_name = N'${JOB}'`);

await pool.close(); await sql.close();
