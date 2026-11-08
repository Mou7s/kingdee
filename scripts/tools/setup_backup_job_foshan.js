/**
 * 为分厂账套建立每日 00:00 完整备份 + 保留 15 天的 SQL Agent 作业。
 *
 * 默认 dry-run（只打印将执行的 T-SQL 与当前状态核对结果）；
 * 加 --apply 才真正创建作业、调度与作业步骤。
 *
 * 安全边界：
 * - 只创建/维护指定名称的分厂备份作业，不改动现有 KD-MAIN 维护计划；
 * - 备份文件写在独立目录，与主账套的 ALL 目录互不影响；
 * - 清理步骤只针对该独立目录，不会碰主账套的备份。
 */
import sql from "mssql";
import { K3_DB_HOST, K3_DB_USER, K3_DB_PASS } from "../../k3cloud.js";

const APPLY = process.argv.includes("--apply");
const JOB = process.env.K3_SUB_BACKUP_JOB || "分厂账套-每日完整备份";
const SCHED = process.env.K3_SUB_BACKUP_SCHED || "分厂账套-每日0000";
const DB = process.env.K3_SUB_DB || "";
const DIR = process.env.K3_SUB_BACKUP_DIR || "D:\\正式数据备份\\分厂账套";
const KEEP_DAYS = 15;
if (!DB) {
  throw new Error("未配置分厂账套数据库名（K3_SUB_DB）");
}

const pool = await new sql.ConnectionPool({
  user: K3_DB_USER, password: K3_DB_PASS, server: K3_DB_HOST, database: "msdb",
  options: { encrypt: false, trustServerCertificate: true, connectTimeout: 15000, requestTimeout: 300000 },
}).connect();
const one = async (text) => (await pool.request().query(text)).recordset;

console.log(`模式: ${APPLY ? "★ 实际执行（--apply）" : "dry-run（仅打印，不写入）"}`);
const SERVER = (await one(`SELECT CONVERT(sysname, SERVERPROPERTY('ServerName')) AS s`))[0].s;
console.log(`服务器: ${SERVER}`);

// ---- 1) 权限与前置检查 ----
const rights = await one(`
  SELECT IS_SRVROLEMEMBER('sysadmin') AS 是否sysadmin,
         IS_ROLEMEMBER('SQLAgentOperatorRole','dbo') AS x,
         SUSER_SNAME() AS 登录账号,
         (SELECT COUNT(*) FROM sys.databases WHERE name = N'${DB}') AS 目标库存在,
         (SELECT CONVERT(VARCHAR(30), state_desc) FROM sys.databases WHERE name = N'${DB}') AS 目标库状态`);
console.log("\n### 权限与目标库");
console.log(`  登录账号: ${rights[0].登录账号}   sysadmin=${rights[0].是否sysadmin}   目标库存在=${rights[0].目标库存在} (${rights[0].目标库状态})`);

const dup = await one(`SELECT name AS 作业, enabled AS 启用 FROM msdb.dbo.sysjobs WHERE name LIKE N'%佛山%'`);
console.log(`\n### 已存在的同名/相近作业: ${dup.length} 个`);
dup.forEach((d) => console.log(`  ${d.作业} 启用=${d.启用}`));

const existing = await one(`SELECT job_id, enabled FROM msdb.dbo.sysjobs WHERE name = N'${JOB}'`);
console.log(`  目标作业【${JOB}】: ${existing.length ? "已存在（--apply 时会先删除再重建，不会重复堆积）" : "不存在，可创建"}`);

const dirExists = await one(`DECLARE @r INT; EXEC master.dbo.xp_fileexist N'${DIR}', @r OUTPUT; SELECT @r AS 存在`);
console.log(`\n### 目标目录 ${DIR}`);
console.log(`  存在=${dirExists[0].存在}（1=目录已存在，0=需要创建）`);

// ---- 2) 将执行的 T-SQL ----
const tsqlBackup = `DECLARE @p NVARCHAR(400) = N'${DIR}\\${DB}_backup_'
        + CONVERT(NVARCHAR(20), GETDATE(), 112) + N'_'
        + REPLACE(CONVERT(NVARCHAR(8), GETDATE(), 108), ':', '') + N'.bak';
BACKUP DATABASE [${DB}] TO DISK = @p
  WITH INIT, COMPRESSION, CHECKSUM, STATS = 10,
       NAME = N'${DB}-完整备份';
PRINT N'备份文件: ' + @p;`;

const tsqlCleanup = `
DECLARE @old DATE = DATEADD(DAY, -${KEEP_DAYS}, CAST(GETDATE() AS DATE));
PRINT N'清理 ' + CONVERT(NVARCHAR(12), @old, 120) + N' 之前的备份';
EXEC master.sys.xp_delete_file 0, N'${DIR}\\', N'bak', @old;`;

console.log("\n### 将执行的作业步骤");
console.log(`步骤1【完整备份】:\n${tsqlBackup.split("\n").map((l) => "   " + l).join("\n")}`);
console.log(`\n步骤2【清理 ${KEEP_DAYS} 天前的备份】:\n${tsqlCleanup.split("\n").map((l) => "   " + l).join("\n")}`);
console.log(`\n调度: 每天 00:00（freq_type=4, freq_interval=1, active_start_time=000000）—— 与主账套 KD-MAIN 同时段`);

if (!APPLY) {
  console.log("\n※ dry-run 结束，未做任何写入。确认无误后加 --apply 执行。");
  await pool.close(); await sql.close(); process.exit(0);
}

// ---- 3) 实际执行 ----
if (existing.length) {
  console.log(`\n  目标作业已存在（上次创建未完成），先删除重建：sp_delete_job @delete_history=1`);
  await pool.request().query(`EXEC msdb.dbo.sp_delete_job @job_name = N'${JOB}', @delete_unused_schedule = 1, @delete_history = 1;`);
  console.log("  已删除旧作业 ✓");
}
// 清理同名残留调度（上次失败可能留下重复项）
const dupSched = await one(`SELECT schedule_id FROM msdb.dbo.sysschedules WHERE name = N'${SCHED}'`);
for (const d of dupSched) {
  await pool.request().query(`EXEC msdb.dbo.sp_delete_schedule @schedule_id = ${d.schedule_id}, @force_delete = 1;`);
}
if (dupSched.length) console.log(`  已清理同名残留调度 ${dupSched.length} 个 ✓`);

console.log("\n### 开始执行");
if (!dirExists[0].存在) {
  await pool.request().query(`EXEC master.dbo.xp_create_subdir N'${DIR}'`);
  console.log(`  已创建目录 ${DIR}`);
}

const addJob = async (name, cmd) => {
  const r = await pool.request().query(cmd);
  console.log(`  ${name} ✓`);
  return r;
};

await pool.request().query(`
  EXEC msdb.dbo.sp_add_job @job_name = N'${JOB}',
       @enabled = 1, @notify_level_eventlog = 2, @notify_level_email = 0,
       @description = N'分厂账套 ${DB} 每日 00:00 完整备份，保留 ${KEEP_DAYS} 天。由 kingdee 项目脚本创建，勿随意删除。',
       @owner_login_name = N'sa';`);
console.log("  创建作业 ✓");

await pool.request().query(`
  EXEC msdb.dbo.sp_add_jobstep @job_name = N'${JOB}', @step_id = 1,
       @step_name = N'完整备份 ${DB}', @subsystem = N'TSQL', @database_name = N'master',
       @command = N'${tsqlBackup.replace(/'/g, "''")}',
       @on_success_action = 3, @on_fail_action = 2, @retry_attempts = 0;`);
console.log("  创建步骤1（完整备份）✓");

await pool.request().query(`
  EXEC msdb.dbo.sp_add_jobstep @job_name = N'${JOB}', @step_id = 2,
       @step_name = N'清理 ${KEEP_DAYS} 天前的备份', @subsystem = N'TSQL', @database_name = N'master',
       @command = N'${tsqlCleanup.replace(/'/g, "''")}',
       @on_success_action = 1, @on_fail_action = 2, @retry_attempts = 0;`);
console.log("  创建步骤2（清理 15 天前）✓");

await pool.request().query(`
  EXEC msdb.dbo.sp_add_schedule @schedule_name = N'${SCHED}',
       @freq_type = 4, @freq_interval = 1, @freq_subday_type = 1,
       @active_start_time = 000000, @enabled = 1;`);
const schedId = (await one(`SELECT schedule_id FROM msdb.dbo.sysschedules WHERE name = N'${SCHED}'`))[0].schedule_id;
console.log(`  创建调度（每天 00:00）✓ schedule_id=${schedId}`);

await pool.request().query(`
  EXEC msdb.dbo.sp_attach_schedule @job_name = N'${JOB}', @schedule_id = ${schedId};
  EXEC msdb.dbo.sp_add_jobserver @job_name = N'${JOB}', @server_name = N'${SERVER}';`);
console.log("  绑定调度与目标服务器 ✓");

// ---- 4) 回查 ----
console.log("\n### 回查结果");
const verify = await one(`
  SELECT j.name AS 作业, j.enabled AS 启用,
         (SELECT COUNT(*) FROM msdb.dbo.sysjobsteps s WHERE s.job_id = j.job_id) AS 步骤数,
         (SELECT CONVERT(VARCHAR(8), sch.active_start_time) FROM msdb.dbo.sysschedules sch
            JOIN msdb.dbo.sysjobschedules js ON js.schedule_id = sch.schedule_id
           WHERE js.job_id = j.job_id) AS 每天起始时间,
         (SELECT COUNT(*) FROM msdb.dbo.sysjobservers v WHERE v.job_id = j.job_id) AS 目标服务器数
  FROM msdb.dbo.sysjobs j WHERE j.name = N'${JOB}'`);
console.log(JSON.stringify(verify, null, 1));

await pool.close(); await sql.close();
