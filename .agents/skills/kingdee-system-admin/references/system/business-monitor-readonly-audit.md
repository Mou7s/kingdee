# 业务监控消息超量只读调查

适用：监控方案 JKFA 类方案出现“每人接收监控消息条数超出了上限1000”。遵守用户 WebAPI-only 约定，不使用 SQL 或浏览器绕过接口限制，不手工执行方案（可能发送消息）。

## 已验证读取路径（2026-10-19）

- 用 `BOS_ObjectType` 的 `FID,FName` 按名称查询真实表单标识。
- `BAS_WARNSOLUTION`：查询 `FID,FBillNo,FRun`；View 返回完整名称、运行状态、周期、`WCPKId`、`FWARNMSGID`。
- `BAS_WarnCondition`：View 报“没有此接口”，但 ExecuteBillQuery 可读取 `FID,FXML`，按方案返回的条件内码筛选。View 不支持不代表查询也不支持。
- `BAS_WarnExecRemind`：查询 `FID,FWarnBillNo,FWarnName,FExecuteTime,FNote,FIsRead,FUserId.FName`，用方案号和执行日期限定范围；View 也支持。
- `BAS_WarnMessageSet`：本次仅验证 `FID` 可查询；View 不支持。物理列 `FReceiver/FInsideMessage/FMailMessage/FQYWXDDMessage` 不能直接当作已验证的 WebAPI 字段键。
- `GetFormMetaData` 本次返回 `response_error` 导致 JSON 解析失败，不把它理解为表单不存在。
- 正确元数据入口：`api.post("DynamicFormService.QueryBusinessInfo", {data:{FormId}})`；实时返回 `Result.NeedReturnData.Entrys[].Fields`，其中 `Key` 是 API 字段键、`FieldName` 是物理列，`Extends` 含内置枚举。不要因旧 `GetFormMetaData` 失败就停止发现。传入 FieldKey 本次仍返回完整元数据，需本地筛选。
- `BAS_WarnMessageSet` 进一步验证字段：`FID,FReceiverValue,FResultMaxNum,FTotalResultMaxnum,FAuthSeparated,FSendModes,FMailMessage,FQywxDdMessage,FTitle,FContent,FMergeTitle`。接收人值可 base64 解码成 XML；按其中用户内码用 `SEC_User` View 重新查当前姓名，缓存姓名可能过时。
- `BAS_WarnExecuteResult` 进一步验证字段：`FWarnBillNo,Fexecutestarttime,FEXECUTEENDTIME,FEXECUTESTATUS,FEXECUTEINFO`；发送明细 `FReceiverId,FSendStatus,FRemark,FKeyValue,FTitle`。执行结果主键物理列是 `FEXECUTERESULTID`，不能套用 FID。状态 Extends：0成功、1失败、2超时、3数据正常、4缺失设置、5缺失接收人、6监控数超上限、7发送消息数超上限。

## 判断边界

- XML 同时有 `FilterString` 和 `FilterSetting`。前者可能保留保存时展开的旧日期；后者保留相对日期比较码和值。未核验运行时解析前，不宣称旧日期固定执行，也不猜比较码含义。
- `FQualifiedQty<=0` 表示合格数量条件，不能直接等同未交料；需结合工序汇报、转移、实际完成、上游到料和生产订单状态验证。
- 单据 `FDocumentStatus=C` 只表示已审核，不能证明工序有效或正在生产。未知工序状态先报告原始码，状态映射以 `lib/k3/status.js` 为准。
- 候选查询明确起止时间，不能冒充方案执行命中结果。工序统计至少按计划内码和工序号核对；实际写入必须取得真实分录主键。
- 超量提醒的计数本身不能证明实际发送数量或截断行为；需执行日志、消息明细或官方实现依据。提醒中的 `FUserId` 也不能证明方案完整接收人范围。

## 本次证据与后续

2026-10-19 WebAPI：JKFA0002“工序计划固晶3天未交料预警”和 JKFA0003“工序计划焊线3天未交料预警”均运行，每天08:00；当天异常均记录在07:58:34.463，分别1018、1192条。周期配置时间与实际记录时间应分别报告，不猜时差原因。

条件均为已审核、创建日期比较码281值3及比较码3值7、对应部门、合格数量≤0；没有显式工序状态或转出数量条件。不能据此断言一定误报。

证据目录 `output/monitor-audit-20261019/`。候选范围10月12日含至19日不含，共3175条工序，去重前后相同；固晶1478、焊线1697，各18条状态5/6。仅是当时排查快照。未确认接收人配置、比较码精确定义、实际命中明细、消息截断或漏发，未修改任何生产配置。

接口不足时，交接对象为两个方案的“监控条件”“监控消息（接收人、按权限发送、高级设置）”以及对应日期的“监控执行情况”。先请用户提供这些页面显示内容，再按可用 WebAPI 独立核验，不扩大到数据库直读。

## 2026-10-19 继续调查补充（替代上述部分未确认项）

- 两方案 `FResultMaxNum=1000`、`FTotalResultMaxnum=100000`、`FAuthSeparated=false`、`FSendModes=1`，邮件及企微钉钉关闭；已配置合并标题。
- 接收人内码实时核对：固晶为运维员A、黄椿旋、财务员A、跟单员A；焊线为运维员A、黄椿旋。XML 中100081仍显示旧名“管理员A”，SEC_User当前名称为运维员A，应以实时账号为准。
- 当天执行结果：两个方案08:00:02开始、08:00:04结束，状态均6“监控数超上限”；关联发送明细为空（查询返回每方案一个外连接空明细行，不是两条发送记录）。异常提醒时间07:58与执行日志08:00分别保留，未解释差异。
- 官方《监控方案》“高级设置/监控数量”说明超过上限则不执行方案并发送提示：https://help.open.kingdee.com/dokuwiki/doku.php?id=%E7%9B%91%E6%8E%A7%E6%96%B9%E6%A1%88 。结合实时状态6和无发送明细，判断本次未正常生成业务提醒，不能当作已发送前1000条；不声称已在用户客户端逐条验证。
- 工序实时元数据确认0创建、1计划、2计划确认、3下达、4开工、5完工、6关闭；已纠正 `lib/k3/status.js` 的3并补齐0/5/6。上述各18条是1完工+17关闭，属于宽日期候选，不是精确当天误报数。
- 尚未确认相对日期比较码的精确运行时定义，也未完整复原当日1018/1192条命中清单；调整后的精确数量不能据宽日期候选推算。未改生产配置。

## 用户授权停用（2026-10-19）

用户随后明确要求关闭上述两个方案。使用 `scripts/scratch/2026-10/disable-requested-monitors.js` 默认 dry-run、显式 `--apply` 执行 `Disable`，先查询唯一对象及当前 Run，再逐个操作并 View 回读，最终 ExecuteBillQuery 独立确认两方案 Run 均由1变为0。证据：`output/monitor-disable-20261019-1792398719904/evidence.json`。未删除历史消息或修改工序单据。

复用时重新取得本次对象授权并实时核对，不照搬历史脚本硬编码范围；旧 `scripts/cases/stop_warn_solution.js` 固定方案004且含数据库复查，不符合本用户 WebAPI-only 约定，不直接运行。
