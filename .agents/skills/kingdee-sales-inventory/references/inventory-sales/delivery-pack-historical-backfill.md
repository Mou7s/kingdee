# 发货通知单历史包装类型补填（2026-10-12）

## 适用范围与授权边界

用户新增发货通知单包装类型并配置销售订单下推携带，要求补历史单据。本次用户明确指定全部范围，并两次要求直接数据库补填，说明有下游不能反审核；这是当前会话对单一新增字段的特定操作授权，不是以后 SQL 写入的常规许可。复用脚本须重新取得具体授权，遵守 AGENTS.md。

不能反审核不代表已审核单必然不能直接 Save。字段权限、服务端校验须单独核实。本次没有调用 Save 或 UnAudit，不能把“接口不能修改包装类型”记为已验证结论。

## 已验证字段和来源关系

- 表单 `SAL_DeliveryNotice`；字段键和 View 属性均为 `F_ADKB_Combo_PackType`。
- 物理列 `T_SAL_DELIVERYNOTICEENTRY.F_ADKB_COMBO_PACKTYPE`，类型 varchar；销售订单对应 `T_SAL_ORDERENTRY.F_ADKB_COMBO_PACKTYPE`。
- 来源关联在通知单侧 `T_SAL_DELIVERYNOTICEENTRY_LK`：`FENTRYID` 为通知单明细主键，`FSBILLID/FSID` 为订单 FID/分录主键，来源表必须为 `T_SAL_ORDERENTRY`。
- 不按物料或源单号单独匹配；同时校验来源订单分录的 FID、分录主键及物料一致，关联去重后必须唯一。
- 包装类型元数据为明细下拉字段，枚举标识 `1e03294d-457c-4abc-ada9-f7d5387af735`；本次仅出现已核实的来源值 `1/2`。

## 执行与验证

1. 先通过接口核对字段可查询，再只读查列结构与全量来源关系，区分空值、来源空值、无关联、已有值及冲突。
2. 明确确认清单后固定分录主键；实时查询新增候选不得悄悄扩入原清单。本次原清单 2323 行，执行前新增 65 行未纳入。
3. 工具 `scripts/cases/backfill_delivery_pack.js` 默认预检；本次以 `output/delivery-pack-audit-2026-10-12.json` 为范围文件。运行前重新审阅工具和当前授权，不盲目复用旧输出。
4. 保存完整明细前值；串行化事务仅修改包装类型，守卫当前空值、精确前值、来源值、物料和唯一关联；影响行数必须与预检一致。
5. 提交前逐字段比较完整明细和单据状态，只有目标列可变；提交后独立数据库查询及接口批次查询覆盖每条目标分录。
6. 本次 1623 张、2323 行均数据库和接口复核通过；状态、其他明细字段保持不变。

## 兼容性与证据

- 本账套本次不接受 OPENJSON WITH 语法；不要把 JSON 解析支持当作默认。
- mssql 的 XML 参数不能假定服务端为 xml 类型；本次改为 NVarChar(MAX) 传参、SQL 显式 CAST 到 xml 变量再调用 nodes，先做只读解析行数核对。
- 首两次事务发生语法/参数类型错误，没有提交；自动中止的事务再次 rollback 可返回 EABORT，须保留最初错误，不能被回滚错误覆盖。
- 成功证据：`output/delivery-pack-2026-10-12T02-21-54-072Z-before.json`、同前缀 `-transaction-after.json`、`-result.json`；最终接口覆盖 2323/2323。
- 余额与候选数量为 2026-10-12 的快照，后续必须重新查询。

## 销售出库单延伸补填（2026-10-12）

- 用户新增销售出库单同名包装类型后，明确要求数据库补填来源发货通知单已有值；本次授权仅限此新增字段及空值，不延伸到其他 SQL 修改。
- 实时扩展元数据确认 `SAL_OUTSTOCK` 字段键、View 属性均为 `F_ADKB_Combo_PackType`，实体 `FENTITY`，物理列 `T_SAL_OUTSTOCKENTRY.F_ADKB_COMBO_PACKTYPE`（varchar），枚举与通知单一致。
- 精确来源：`T_SAL_OUTSTOCKENTRY_LK.FENTRYID` 对应出库分录；`FSBILLID/FSID` 对应通知单 FID/分录主键；`FSTABLENAME='T_SAL_DELIVERYNOTICEENTRY'`。不得用出库源单号猜匹配，也不纳入直接来源订单的明细。
- 工具 `scripts/cases/backfill_outstock_pack.js` 默认实时预检；执行必须带 `--apply --scope <本次预检快照>`。执行前重新比对范围、当前空值、来源主键、来源值与物料，变化即停止；事务前值守卫、全明细比对、数据库与接口逐行覆盖沿用上文。
- 本次完成 880 张、2252 行，提交后数据库与接口均覆盖 2252/2252，出库明细其他列及单据状态事务内比对一致。
- 证据：`output/outstock-pack-2026-10-12T02-33-39-517Z-before.json`、同前缀 `-transaction-after.json`、`-result.json`。此为有日期的案例，不能将行数、前值文件或授权用于以后执行。

## 单据转换映射只读确认（2026-10-12）

- 从 `T_META_CONVERTRULE` 实时查询来源/目标表单、状态、默认标记、扩展继承链和 `FKERNELXML`。字段映射在 `FieldMap` 块的 `SourceFieldKey/TargetFieldKey`；只查基础规则会漏扩展新增映射，须同时检查 `FBASEOBJECTID` 的扩展。
- 本次两段扩展规则均包含同名 `F_ADKB_Combo_PackType → F_ADKB_Combo_PackType`：销售订单→通知单规则 `173b65e1-7f03-4e72-af10-2c8cd7de719a`；通知单→出库规则 `8d0db6fc-e907-45b3-b467-a4a19c996d7e`。两段扩展均 `FSTATUS=1/FISDEFAULT=1`，基础规则均 `FISDEFAULTCUST=1`。
- 销售订单直接→出库的扩展 `cba01d20-2742-4cfa-94a2-6f4dc0c0cb79` 本次没有包装类型映射；这条旁路与经过通知单的两段链路须分开说明。
- 配置可确认，不等于实际下推结果已测试。本次仅只读查询，没有新增或下推单据。
- 探针 `scripts/scratch/2026-10/probe_pack_conversion.js`，证据 `output/pack-conversion-current.json`。配置会变，复用前重查；选列查询，不导出元数据密码列。
