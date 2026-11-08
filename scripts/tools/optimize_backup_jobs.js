/**
 * 备份体系优化工具（主账套 KD-MAIN + 分厂账套作业）
 *
 * 默认 dry-run；加 --apply 才执行。执行的 5 项：
 *   ① 打开服务器级备份压缩（backup compression default = 1）
 *   ② 「自动清除超15天的备份」调度：每周 → 每天 03:00
 *   ③ 新建【备份体检-数据库备份有效性检查】作业（每天 04:00，失败即作业失败）
 *   ④ 分厂账套作业调度 00:00 → 01:00（避开主账套）
 *   ⑤ 新建【管理中心库与系统库-每日完整备份】作业（每天 02:00，含 15 天清理）
 *
 * 不改动现存的 KD-MAIN 维护计划本身，只改它的清理调度与服务器级配置。
 */
import sql from "mssql";
import { K3_DB_HOST, K3_DB_USER, K3_DB_PASS, K3_DB_NAME, K3_FS_DB } from "../../lib/k3/index.js";

const APPLY = process.argv.includes("--apply");
const SYS_JOB = "管理中心库与系统库-每日完整备份";
const SYS_SCHED = "管理中心库与系统库-每日0200";
const SYS_DIR = process.env.K3_BACKUP_SYS_DIR || "D:\\正式数据备份\\系统库";
const CHK_JOB = "备份体检-数据库备份有效性检查";
const CHK_SCHED = "备份体检-每日0400";
const FS_JOB = process.env.K3_SUB_BACKUP_JOB || "分厂账套-每日完整备份";
const FS_SCHED = process.env.K3_SUB_BACKUP_SCHED || "分厂账套-每日0000";
const MAIN_DB = K3_DB_NAME || process.env.K3_MAIN_DB;
const FS_DB = process.env.K3_SUB_DB || K3_FS_DB || "";
const MC_DB = process.env.K3_MC_DB || "";
const KEEP_DAYS = 15;
const SYS_DBS = [...(MC_DB ? [MC_DB] : []), "master", "model", "msdb", "ReportServer", "ReportServerTempDB"];
const WATCH_DBS = [...(MAIN_DB ? [MAIN_DB] : []), ...(FS_DB ? [FS_DB] : []), ...SYS_DBS];
if (!MAIN_DB) {
  throw new Error("未配置主账套数据库名（K3_DB_NAME / K3_MAIN_DB）");
}

const pool = await new sql.ConnectionPool({
  user: K3_DB_USER, password: K3_DB_PASS, server: K3_DB_HOST, database: "msdb",
  options: { encrypt: false, trustServerCertificate: true, connectTimeout: 15000, requestTimeout: 600000 },
}).connect();
const one = async (t) => (await pool.request().query(t)).recordset;
const SERVER = (await one(`SELECT CONVERT(sysname, SERVERPROPERTY('ServerName')) AS s`))[0].s;

console.log(`模式: ${APPLY ? "★ 实际执行（--apply）" : "dry-run（仅打印）"}   服务器: ${SERVER}\n`);

// ============ ① 备份压缩 ============
const comp = (await one(`SELECT CAST(value AS INT) AS v, CAST(value_in_use AS INT) AS iu FROM sys.configurations WHERE name='backup compression default'`))[0];
console.log(`### ① 备份压缩：当前 value=${comp.v} value_in_use=${comp.iu}（0=关闭）`);
if (APPLY && comp.iu === 0) {
  await pool.request().query(`EXEC sp_configure 'backup compression default', 1; RECONFIGURE;`);
  const after = (await one(`SELECT CAST(value_in_use AS INT) AS iu FROM sys.configurations WHERE name='backup compression default'`))[0];
  console.log(`   → 已开启，回查 value_in_use=${after.iu} ${after.iu === 1 ? "✓" : "✗"}`);
} else if (APPLY) console.log("   → 已是开启状态，跳过");
else if (comp.iu === 1) console.log("   → dry-run：已是开启状态，无需改动");
else console.log(`   → dry-run：将执行 EXEC sp_configure 'backup compression default', 1; RECONFIGURE;`);

// ============ ② 清理调度改每天 ============
const cleanSched = await one(`SELECT schedule_id, name, freq_type, freq_interval, RIGHT('000000'+CAST(active_start_time AS VARCHAR(6)),6) AS t
  FROM msdb.dbo.sysschedules WHERE name LIKE N'自动清除%'`);
console.log(`\n### ② 清理作业调度`);
cleanSched.forEach((s) => console.log(`   现：${s.name}  频次类型=${s.freq_type}(8=每周,4=每天) 间隔=${s.间隔 ?? s.freq_interval} 时刻=${s.t} id=${s.schedule_id}`));
if (APPLY && cleanSched.length) {
  for (const s of cleanSched) {
    await pool.request().query(`EXEC msdb.dbo.sp_update_schedule @schedule_id = ${s.schedule_id}, @freq_type = 4,
      @freq_interval = 1, @freq_subday_type = 1, @freq_subday_interval = 0, @active_start_time = 030000;`);
  }
  const after = await one(`SELECT name, freq_type, RIGHT('000000'+CAST(active_start_time AS VARCHAR(6)),6) AS t FROM msdb.dbo.sysschedules WHERE name LIKE N'自动清除%'`);
  after.forEach((s) => console.log(`   → 已改为：频次类型=${s.freq_type}(4=每天) 时刻=${s.t} ✓`));
} else if (!APPLY) console.log(`   → dry-run：将把 freq_type 改为 4（每天），时刻 030000`);

// ============ ④ 分厂账套改到 01:00 ============
const fsSched = await one(`SELECT sch.schedule_id, sch.name, RIGHT('000000'+CAST(sch.active_start_time AS VARCHAR(6)),6) AS t
  FROM msdb.dbo.sysschedules sch WHERE sch.name = N'${FS_SCHED}'`);
console.log(`\n### ④ 分厂账套作业调度`);
fsSched.forEach((s) => console.log(`   现：${s.name} 时刻=${s.t} id=${s.schedule_id}`));
if (APPLY && fsSched.length) {
  await pool.request().query(`EXEC msdb.dbo.sp_update_schedule @schedule_id = ${fsSched[0].schedule_id}, @active_start_time = 010000;`);
  const after = await one(`SELECT RIGHT('000000'+CAST(active_start_time AS VARCHAR(6)),6) AS t FROM msdb.dbo.sysschedules WHERE schedule_id = ${fsSched[0].schedule_id}`);
  console.log(`   → 已改为 ${after[0].t}（01:00）✓`);
} else if (!APPLY) console.log(`   → dry-run：将把 active_start_time 改为 010000`);

// ============ ③ + ⑤ 作业定义（共用创建逻辑）============
const tsqlSysBackup = `DECLARE @p NVARCHAR(500);
` + SYS_DBS.map((d) => `SET @p = N'${SYS_DIR}\\${d}_backup_'
   + CONVERT(NVARCHAR(20), GETDATE(), 112) + N'_' + REPLACE(CONVERT(NVARCHAR(8), GETDATE(), 108), ':', '') + N'.bak';
BACKUP DATABASE [${d}] TO DISK = @p
   WITH INIT, COMPRESSION, CHECKSUM, STATS = 10, NAME = N'${d}';
PRINT N'已备份 ${d} → ' + @p;`).join("\n");

const tsqlSysCleanup = `DECLARE @old DATE = DATEADD(DAY, -${KEEP_DAYS}, CAST(GETDATE() AS DATE));
PRINT N'清理 ' + CONVERT(NVARCHAR(12), @old, 120) + N' 之前的备份';
EXEC master.sys.xp_delete_file 0, N'${SYS_DIR}\\', N'bak', @old;`;

const tsqlHealth = `
DECLARE @报告 NVARCHAR(MAX) = N'备份体检 ' + CONVERT(NVARCHAR(19), GETDATE(), 120) + CHAR(13)+CHAR(10);
DECLARE @坏 INT = 0;
DECLARE @db sysname, @阈值 INT = 26, @最近 DATETIME, @龄 INT;
DECLARE cur CURSOR FOR SELECT name FROM (VALUES
  ${WATCH_DBS.map((d) => `(N'${d}')`).join(", ")}) v(name);
OPEN cur; FETCH NEXT FROM cur INTO @db;
WHILE @@FETCH_STATUS = 0
BEGIN
  SELECT @最近 = MAX(backup_finish_date) FROM msdb.dbo.backupset WHERE database_name = @db AND type = 'D';
  SET @龄 = CASE WHEN @最近 IS NULL THEN 9999 ELSE DATEDIFF(HOUR, @最近, GETDATE()) END;
  SET @报告 = @报告 + N'  ' + @db + N'：最近完整备份 ' +
      ISNULL(CONVERT(NVARCHAR(19), @最近, 120), N'（无记录）') + N'，' +
      CASE WHEN @龄 = 9999 THEN N'从未备份' ELSE CAST(@龄 AS NVARCHAR(10)) + N' 小时前' END + CHAR(13)+CHAR(10);
  IF @龄 > @阈值 SET @坏 = @坏 + 1;

  INSERT INTO msdb.dbo.BackupHealthLog (CheckTime, DbName, LastFullBackup, AgeHours, Status)
  VALUES (GETDATE(), @db, @最近, @龄, CASE WHEN @龄 > @阈值 THEN N'异常' ELSE N'正常' END);
  FETCH NEXT FROM cur INTO @db;
END
CLOSE cur; DEALLOCATE cur;

DELETE FROM msdb.dbo.BackupHealthLog WHERE CheckTime < DATEADD(DAY, -60, GETDATE());
PRINT @报告;
IF @坏 > 0 RAISERROR(N'备份体检未通过：%d 个库的最近完整备份超过 26 小时', 16, 1, @坏);
ELSE PRINT N'备份体检通过：全部库的完整备份均在 26 小时内';`;

console.log(`\n### ③ 备份体检作业（新建，每天 04:00）`);
console.log(`   名称：${CHK_JOB}`);
console.log(`   逻辑：逐个库查 msdb 最近一次完整备份；超过 26 小时即 RAISERROR 让作业失败，结果写入 msdb.dbo.BackupHealthLog`);
console.log(`   监控库：${WATCH_DBS.join(", ")}`);

console.log(`\n### ⑤ 管理中心库与系统库作业（新建，每天 02:00）`);
console.log(`   名称：${SYS_JOB}  目录：${SYS_DIR}  保留 ${KEEP_DAYS} 天`);
console.log(`   备份：${SYS_DBS.join(", ")}`);

if (!APPLY) {
  console.log("\n※ dry-run 结束，未做任何写入。确认后加 --apply。");
  await pool.close(); await sql.close(); process.exit(0);
}

// ---- 建表（体检日志）----
await pool.request().query(`
IF OBJECT_ID(N'msdb.dbo.BackupHealthLog') IS NULL
CREATE TABLE msdb.dbo.BackupHealthLog (
  Id INT IDENTITY PRIMARY KEY, CheckTime DATETIME, DbName SYSNAME,
  LastFullBackup DATETIME NULL, AgeHours INT, Status NVARCHAR(10));`);
console.log("\n  体检日志表 msdb.dbo.BackupHealthLog 就绪 ✓");

const createJob = async (job, sched, desc, steps, startTime) => {
  const exist = await one(`SELECT name FROM msdb.dbo.sysjobs WHERE name = N'${job}'`);
  if (exist.length) {
    await pool.request().query(`EXEC msdb.dbo.sp_delete_job @job_name = N'${job}', @delete_unused_schedule = 1, @delete_history = 1;`);
    console.log(`  ${job}：已存在，删除重建 ✓`);
  }
  const dups = await one(`SELECT schedule_id FROM msdb.dbo.sysschedules WHERE name = N'${sched}'`);
  for (const d of dups) await pool.request().query(`EXEC msdb.dbo.sp_delete_schedule @schedule_id = ${d.schedule_id}, @force_delete = 1;`);

  await pool.request().query(`EXEC msdb.dbo.sp_add_job @job_name = N'${job}', @enabled = 1,
      @notify_level_eventlog = 2, @description = N'${desc}', @owner_login_name = N'sa';`);
  let id = 1;
  for (const s of steps) {
    await pool.request().query(`EXEC msdb.dbo.sp_add_jobstep @job_name = N'${job}', @step_id = ${id},
        @step_name = N'${s.name}', @subsystem = N'TSQL', @database_name = N'master',
        @command = N'${s.cmd.replace(/'/g, "''")}',
        @on_success_action = ${s.last ? 1 : 3}, @on_fail_action = 2, @retry_attempts = 0;`);
    id++;
  }
  await pool.request().query(`EXEC msdb.dbo.sp_add_schedule @schedule_name = N'${sched}',
      @freq_type = 4, @freq_interval = 1, @freq_subday_type = 1, @active_start_time = ${startTime}, @enabled = 1;`);
  const sid = (await one(`SELECT schedule_id FROM msdb.dbo.sysschedules WHERE name = N'${sched}'`))[0].schedule_id;
  await pool.request().query(`EXEC msdb.dbo.sp_attach_schedule @job_name = N'${job}', @schedule_id = ${sid};
    EXEC msdb.dbo.sp_add_jobserver @job_name = N'${job}', @server_name = N'${SERVER}';`);
  console.log(`  ${job}：作业+${steps.length}步骤+调度(${startTime}) 创建完成 ✓`);
};

if (!(await one(`DECLARE @r INT; EXEC master.dbo.xp_fileexist N'${SYS_DIR}', @r OUTPUT; SELECT @r AS x`))[0].x) {
  await pool.request().query(`EXEC master.dbo.xp_create_subdir N'${SYS_DIR}'`);
  console.log(`  已创建目录 ${SYS_DIR} ✓`);
}

await createJob(SYS_JOB, SYS_SCHED, `管理中心库与系统库每日 02:00 完整备份，保留 ${KEEP_DAYS} 天。由 kingdee 项目脚本创建。`,
  [{ name: "备份管理中心库与系统库", cmd: tsqlSysBackup }, { name: `清理 ${KEEP_DAYS} 天前的备份`, cmd: tsqlSysCleanup, last: true }], "020000");

await createJob(CHK_JOB, CHK_SCHED, "每天 04:00 检查各库最近一次完整备份是否在 26 小时内，异常则作业失败。",
  [{ name: "检查备份有效性", cmd: tsqlHealth, last: true }], "040000");

// ---- 回查 ----
console.log("\n### 回查");
const jobs = await one(`
  SELECT j.name AS 作业, j.enabled AS 启用,
         (SELECT COUNT(*) FROM msdb.dbo.sysjobsteps s WHERE s.job_id=j.job_id) AS 步骤数,
         (SELECT RIGHT('000000'+CAST(sch.active_start_time AS VARCHAR(6)),6) FROM msdb.dbo.sysschedules sch
            JOIN msdb.dbo.sysjobschedules js ON js.schedule_id=sch.schedule_id WHERE js.job_id=j.job_id) AS 时刻
  FROM msdb.dbo.sysjobs j ORDER BY j.name`);
jobs.forEach((j) => console.log(`  [${j.启用 ? "启用" : "停用"}] ${String(j.作业).padEnd(38)} 步骤${j.步骤数}  每天 ${j.时刻}`));

await pool.close();
await sql.close();
