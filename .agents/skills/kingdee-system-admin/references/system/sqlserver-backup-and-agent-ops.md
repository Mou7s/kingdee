# 星空的备份体系核查与 SQL Agent 作业维护

用途：上线/补丁前回答「到底有没有备份、备份还在不在跑」，以及给某个账套补上每日自动备份并证明它真的能用。

## 1. 判断备份的真实状态（只认 msdb）

- 真实备份历史只在 `msdb.dbo.backupset`：`SELECT database_name, MAX(backup_finish_date), COUNT(*) FROM msdb.dbo.backupset WHERE type='D' GROUP BY database_name`。**必须按库分别看**——多数据中心环境常见「主账套每天备、其他账套几年没备」（同一实例上并存 `<K3_MAIN_DB>` 天天备、`<K3_SUB_DB>` 一年多只有 1 条记录）。
- 备份文件是否还在：目录里的 `*.bak` 列表 ＋ `msdb.dbo.backupmediafamily.physical_device_name` 记录的路径。「有备份记录」≠「有可还原的文件」——记录指向的目录可能已被清空。
- 作业是否在跑：`sysjobs` / `sysjobsteps` / `sysjobschedules` / `sysschedules`，结果看 `sysjobhistory`（`step_id=0` 是作业级汇总，`run_status` 1=成功 0=失败）。**失败原因只在 step 消息里，且取 `LEFT(h.message, 3000)`**——截到 250~300 字会把真正的 SQL 报错切掉，只剩包执行器的头部样板。
- ⚠️ **不要用管理中心 `T_BAS_DATACENTER.FBACKUPDATE` 判断「最近备份时间」**：那是管理中心里的登记/配置时间，与真实备份作业无关。按它下结论会出现「报告说一年没备份、实际每天 00:00 都在备」的误判，还得当场向用户更正。
- 恢复模式决定可恢复粒度：`sys.databases.recovery_model_desc` 为 `SIMPLE` 就没有日志备份、**做不到时间点恢复**，回滚只能回到最近一次完整备份；补丁前的即时手动备份因此不可替代。
- 备份与数据库常在**同一块物理盘**。先查 `Win32_LogicalDisk` / `Win32_DiskDrive` 再谈方案：本机只有 C:/D: 两个卷时，「异机/异盘保存」只能靠外接盘或别的机器，要直接说清，别默认有第二块盘。

## 2. 给某个账套补每日完整备份（T-SQL，实测可用）

用脚本建，不要手拼 SQL：`scripts/tools/setup_backup_job_foshan.js` 是可复制样板（改库名/目录/保留天数即可），已注册为 `bun run backup-foshan`，默认 dry-run、`--apply` 才写。

配方：`sp_add_job` → 步骤1 `sp_add_jobstep`（`BACKUP DATABASE [库] TO DISK = @变量 WITH INIT, COMPRESSION, CHECKSUM, STATS=10`）→ 步骤2（`EXEC master.sys.xp_delete_file 0, N'目录\', N'bak', @old`，`@old = DATEADD(DAY,-N,CAST(GETDATE() AS DATE))`）→ `sp_add_schedule`（`freq_type=4` 每天、`active_start_time=000000`）→ `sp_attach_schedule` → `sp_add_jobserver`。

坑（都实测踩过）：

- **`@category_name` 不要传**：`N'[未分类(本地)]'` 在中文实例上报 `The specified @category_name ... does not exist`（分类名按语言本地化），省略即落到默认分类。
- **`sp_add_jobserver` 的 `@server_name` 不能是子查询**：`@server_name = (SELECT CONVERT(sysname, SERVERPROPERTY('ServerName')))` 报 `Incorrect syntax near '('`；先取出来再用变量/字面量传。
- **同名调度会堆叠**：`sp_add_schedule` 能建出多条同名调度，之后 `sp_attach_schedule @schedule_name=...` 报 `There are two or more schedules named ...`。绑定一律用 `@schedule_id`；清理残留用 `sp_delete_schedule @schedule_id=<id>, @force_delete=1`，并在建之前先按 name 列出全部 id 逐个删。
- **作业可删重建保幂等**：`sp_delete_job @job_name=..., @delete_unused_schedule=1, @delete_history=1` 后再建；脚本里先删旧作业、再删同名残留调度。
- 备份文件名必须带时间戳（`CONVERT(...,112)` ＋ `REPLACE(CONVERT(...,108),':','')`），否则「保留 N 天」无意义；`SET @p = <拼接表达式>;` 后用 `TO DISK = @p` 是允许的，但**把拼接直接写在 `TO DISK = N'前缀' + CONVERT(...)` 里会被拒**（`“+”附近有语法错误`）——多库备份用一个 `@p` 变量逐条 `SET` 再 `BACKUP`。
- 目录存在性检查写 `DECLARE @r INT; EXEC master.dbo.xp_fileexist N'路径', @r OUTPUT; SELECT @r AS 存在`；直接 `EXEC xp_fileexist` 在中文实例上列名是「文件存在」，按英文列名取会拿到 `undefined`。建目录用 `master.dbo.xp_create_subdir`。
- **多步作业最后一步的 `@on_success_action` 必须是 1**：每步都写 3（转到下一步）会让最后一步去找不存在的下一步，作业报「JobManager 试图为以下作业运行不存在的步骤(N+1)」——**步骤本身成功、作业整体失败**，很容易误判成备份失败。只有一步的作业同理。
- 步骤里的 T-SQL 先在客户端用仓库的 mssql 连接原样跑通再建进作业：一次踩齐的 `TO DISK` 拼接、`FROM (VALUES ...) v(a,b)` 列数不匹配（`'v' 中的列少于列列表中指定的列`，值列表只有一列时别名只能给一列）都属这类。
- **清理范围 = 目录 ＋ 扩展名，无法按库名过滤**：新账套的备份放**独立目录**，否则它的清理步骤会把同目录里别的库的备份一并删掉、改变既有保留策略（主账套继续留在原 `ALL` 目录由原维护计划管）。

## 3. 建完必须实跑验证（不能只报「已创建」）

1. `EXEC msdb.dbo.sp_start_job @job_name = N'...'`，轮询 `EXEC msdb.dbo.sp_help_job @job_name=N'...', @job_aspect=N'JOB'` 的 `current_execution_status`（1=执行中、4=空闲），再用 `sysjobhistory`（`step_id=0`）确认「该作业成功」以及最后执行的是清理步骤。
2. 核对产物：`msdb.dbo.backupset` 新记录（原大小/压缩后大小/耗时）＋ `backupmediafamily.physical_device_name` 的实际路径，并与目录列表对上。
3. **`RESTORE VERIFYONLY FROM DISK = N'<bak>' WITH CHECKSUM;`** —— 只有它能证明备份文件真能用于还原（实测样例：数据 4.43GB → 压缩 0.73GB、39 秒、校验通过）。
4. 回复与文档里写实测数字（体积、耗时、保留天数、目录、校验结果），不要只列配置项。
5. 时间较长的手动触发/校验命令（备份 30~60 分钟、VERIFYONLY 读全文件）会超过前台超时：直接按后台进程跑再取结果，不要在前台反复重试。

## 4. 常见故障

- 备份失败的报错 `不可恢复的 I/O 错误: 112(磁盘空间不足)` = 目标盘满：备份文件与数据文件抢同一块盘时最先撞这一条。排查口径：`.bak` 目录总体积 ＋ 库文件体积 vs 卷剩余空间；保留天数 × 单份体积就是长期占用。
- 备份跑得慢（主账套全备 28~62 分钟 / 190~210GB）时，它与补丁安装、其他大批量作业抢 IO，排期上要给足窗口。

## 5. 与补丁窗口的相互作用

- 补丁会改写账套库和**管理中心库**（数据中心版本、补丁包历史），两者都要有备份。
- 窗口开始前禁用自动备份与清理作业（SSMS 右键禁用或 `sp_update_job @enabled=0`），**补完立刻重新启用**；漏了启用就等于第二天没有备份。
- 理由要在执行单里写明：备份若落在「补丁改到一半」的时刻，产出的是半成品状态的备份、**不能用于回滚**；清理作业还可能把刚做的手动备份删掉。
- 补丁前的手动备份**不要放进自动备份目录**（会被保留策略删掉），并尽量异机/异盘保存。

## 6. 优化现有备份体系（先量化，再逐项给收益）

用户问「有没有什么能优化的」时不要凭常识列清单，先把下表指标量出来，每条结论带实测数字。

- **压缩有没有开**：`msdb.dbo.backupset` 里 `backup_size` 与 `compressed_backup_size` 相等即未压缩；服务器开关在 `sys.configurations` 的 `backup compression default`（**非高级选项**，直接 `EXEC sp_configure 'backup compression default', 1; RECONFIGURE;`）。维护计划的 BACKUP 语句没写 `NO_COMPRESSION` 就继承服务器默认值 —— **改这一行配置即可让所有既有作业立刻开始压缩，不必去动 SSIS 包**。实测压缩比 3.8~6 倍（同一份库：管理中心库 386MB→103MB、佛山 4.53GB→0.75GB），主账套 190GB 的每日全备因此可从 15×190GB 降到几百分之一量级。
- **清理频率**：维护计划的清理任务常被设成「每周」，而备份每天跑 —— 一周里六天只增不减，磁盘空间不足的失败总落在清理日之前（实测出现过「当天 00:00 备份因空间不足失败、03:00 清理跑完才腾出空间」）。把调度改成每天：`EXEC msdb.dbo.sp_update_schedule @schedule_id=<id>, @freq_type=4, @freq_interval=1, @freq_subday_type=1, @active_start_time=030000;`
- **维护计划到底备了哪些库**：读 `msdb.dbo.sysmaintplan_logdetail`（`line1`=任务名如「备份数据库(完整)」、`line3`=**库列表**、`command`=实际 BACKUP 语句、`succeeded`、`start_time`/`end_time`，无 `task_detail`/`duration` 列）。按时间对比最早与最近一行即可看出计划被人改过 —— 实测某计划从 7 个库（含管理中心库、master/model/msdb/ReportServer）被改成只剩主账套，导致管理中心库与系统库近一年无备份。**不要去解析 `sysssispackages.packagedata`**：维护计划以 UTF-16BE 的 SSIS 包存放，转字符串后匹配关键字一无所获，纯浪费轮次。
- **失败可见性**：`sysalerts`/`sysoperators` 常为 0 且 Database Mail 未启用，作业失败等于静默（实测有账套备份失败过一次、无人知晓）。补一个「备份体检」作业：逐库查 `MAX(backup_finish_date)`，超阈值即 `RAISERROR(N'...', 16, 1, @坏)` 让作业失败，明细写入自建日志表（`IF OBJECT_ID(N'msdb.dbo.xxx') IS NULL CREATE TABLE ...`，每天顺手删 60 天前的行）。没有邮件通道时，作业失败本身就是 SSMS 里可见的信号。
- **陈旧备份目录能不能删**：差异备份必须配它那天的完整备份才能还原，**基础全备一旦过期被清掉，剩下的差异备份就是不可还原的死数据** —— 这是判断依据，不是「旧了就删」。删除前：按文件名前缀分组统计数量与体积、确认目录里没有非 `.bak` 文件（有则中止）、导出清单存档；删完核对卷剩余空间的增量是否对得上。
- **统计目录体积**：`xp_dirtree` 的第三列是「是否文件」的 0/1 标记、**不是字节数**（拿它 SUM 会得到 0 或极小值），体积必须用远程 PowerShell `Get-ChildItem -Recurse -File | Measure-Object Length -Sum`。Windows PowerShell 5.1 里 `(if(...){...}else{...})` 不能当表达式（报「无法将 if 项识别为 cmdlet」），要先赋值再格式化。
- 改动顺序按「收益/风险」排：服务器级压缩 → 清理改每天 → 加体检作业 → 错开备份时段 → 缺失的库补回 → 清死数据。这套改动已固化为 `scripts/tools/optimize_backup_jobs.js`（`bun run optimize-backup`，默认 dry-run、`--apply` 才写，可重复执行保幂等），执行后**逐项实跑回查**（体检作业必须出现「全部库正常」才算收工）。
- 新建/优化作业后，把结果回写 `.agents/skills/kingdee-system-admin/references/system/k3cloud-patch-v9-upgrade.md` 的备份章节（表格化「库 → 作业 → 目录 → 保留」＋优化记录），并在 README 命令表登记新工具。
