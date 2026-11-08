---
name: kingdee-production
description: >-
  查询和处理金蝶生产订单、工序计划、工序汇报及转移。用于生产链追踪、状态受阻、反审核或删除排查。
---

# 金蝶生产与工序

## 任务与完成条件

1. 遵守仓库 `AGENTS.md`。先确定对象、目标、实际物料流向和允许动作，读取当前状态及上下游。
2. 只读取本任务涉及的下列参考。历史案例用于定位，不代替当前查询或本次授权。
3. 写操作默认 dry-run；核对主键、前值和目标值后在授权范围内 apply。失败、部分成功或结果不确定时停止扩散。
4. 独立回查状态、数量、金额和关联；以简体中文区分事实、推断、未完成项，证据写仓库 `output/`。

## 本领域关键判断

先核对实物流向、全部上下游和分录业务状态；删除、反审核从具体阻塞与下游倒推，不按历史单号套用修复。

## 优先阅读

- `references/production/operation-plan-trace.md`
- `references/production/mo-status-machine-and-reverse-audit.md`
- `references/production/delete-sfc-plan.md`

## 相邻能力

- `../kingdee-k3cloud/SKILL.md` — 金蝶共用查询与连接。按任务需要读取。
- `../kingdee-materials-bom/SKILL.md` — 金蝶物料与 BOM。按任务需要读取。
- `../kingdee-procurement/SKILL.md` — 金蝶采购与委外。按任务需要读取。
- `../kingdee-sales-inventory/SKILL.md` — 金蝶销售、库存与客户。按任务需要读取。
- `../kingdee-finance/SKILL.md` — 金蝶财务、对账与成本。按任务需要读取。
- `../kingdee-system-admin/SKILL.md` — 金蝶系统、权限与运维。按任务需要读取。

共用接口脚本使用 Bun，从仓库 `lib/k3/index.js` 导入；状态映射见 `lib/k3/status.js`。跨技能 reference 路径相对当前技能根目录，仓库代码路径相对仓库根。

## 参考索引

- `references/production/delete-sfc-plan.md` — delete-sfc-plan
- `references/production/deleted-mo-upstream-trace.md` — 已删生产订单的上游销售订单溯源
- `references/production/mo-close-date-validation.md` — 生产订单结案日期校验
- `references/production/mo-fragmentation-diagnosis.md` — 生产订单碎片化
- `references/production/mo-status-machine-and-reverse-audit.md` — 生产订单分录业务状态枚举与执行/反执行操作编码、从 `T_META_OBJECTTYPE.FKERNELXML` 枚举操作的正则坑、反审核前置与“工序计划状态受限”阻塞的只读比对与候选验证顺序、失败日志边界、`FDATETIME` 时区自检、并发写判断、反关闭被拒原文与日志查法、受托收料单 STK_OEMReceive 入满自动关闭机制、STK_OEMINSTOCK/BOM 分录字段坑、从下游倒推与库存流向核对
- `references/production/operation-control-code-mismatch.md` — 工序计划汇报控制码与工艺路线不一致
- `references/production/operation-plan-machine-query.md` — 工序计划机台号筛查
- `references/production/operation-plan-trace.md` — 按工序计划号 `TX...` 追踪生产→汇报→转移→结算→应付全链路
- `references/production/operation-report-delete-trace.md` — 工序汇报删除追踪要点
- `references/production/operation-report-over-rate-control.md` — 工序汇报「合格数量合计 ≤ 工序数量 × N」比例控制二开
- `references/production/operation-report-recreation.md` — 从包装入库汇报补做测试/分选汇报
- `references/production/operation-report-status-gates.md` — 工序汇报下推的状态门槛
- `references/production/production-forms.md` — 生产领料/用料清单等 FormId、字段与示例查询
- `references/production/production-order-delete-trace.md` — 生产订单忘号删除追踪
- `references/production/sfc-operation-sql-keys.md` — SFC 工序计划/汇报 SQL 关联键

## 本地私有档案（不纳入公开 Git）

- `.agents/private/kingdee-production/` — 厂内特定工单修复案例、公司生产交付画像与历史入口摘录，仅供本地环境读取。
