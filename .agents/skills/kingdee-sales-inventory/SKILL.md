---
name: kingdee-sales-inventory
description: >-
  查询和维护金蝶销售链、锁库、库存、调拨及客户基础资料。用于发货异常、库存维度、客户编码迁移和客户解冻。
---

# 金蝶销售、库存与客户

## 任务与完成条件

1. 遵守仓库 `AGENTS.md`。先确定对象、目标、实际物料流向和允许动作，读取当前状态及上下游。
2. 只读取本任务涉及的下列参考。历史案例用于定位，不代替当前查询或本次授权。
3. 写操作默认 dry-run；核对主键、前值和目标值后在授权范围内 apply。失败、部分成功或结果不确定时停止扩散。
4. 独立回查状态、数量、金额和关联；以简体中文区分事实、推断、未完成项，证据写仓库 `output/`。

## 本领域关键判断

核对订单至出库的上下游及库存完整维度。客户解冻只适用 AGENTS.md 明确限定的字段与范围，必须唯一对象、事务前值守卫及数据库/WebAPI 独立复查。

## 优先阅读

- `references/inventory-sales/sales-order-status-investigation.md`
- `references/inventory-sales/inventory-availability-check.md`
- `references/customers/customer-unfreeze-by-name.md`

## 相邻能力

- `../kingdee-k3cloud/SKILL.md` — 金蝶共用查询与连接。按任务需要读取。
- `../kingdee-materials-bom/SKILL.md` — 金蝶物料与 BOM。按任务需要读取。
- `../kingdee-production/SKILL.md` — 金蝶生产与工序。按任务需要读取。
- `../kingdee-procurement/SKILL.md` — 金蝶采购与委外。按任务需要读取。
- `../kingdee-finance/SKILL.md` — 金蝶财务、对账与成本。按任务需要读取。
- `../kingdee-system-admin/SKILL.md` — 金蝶系统、权限与运维。按任务需要读取。

共用接口脚本使用 Bun，从仓库 `lib/k3/index.js` 导入；状态映射见 `lib/k3/status.js`。跨技能 reference 路径相对当前技能根目录，仓库代码路径相对仓库根。

## 参考索引

- `references/customers/customer-auto-numbering.md` — 客户自动编码与流水号校准
- `references/customers/customer-code-migration-group-owner.md` — 客户分组负责人映射核验
- `references/customers/customer-code-migration-recovery.md` — 客户编码批量迁移
- `references/customers/customer-code-migration-runtime.md` — 客户编码迁移运行时经验
- `references/customers/customer-code-migration-stable-mapping.md` — 客户编码迁移
- `references/customers/customer-code-migration.md` — 客户编码迁移通用流程与授权边界
- `references/customers/customer-group-create.md` — 客户分组新建（WebAPI GroupSave）
- `references/customers/customer-group-delete-safety.md` — 空客户分组删除安全核对
- `references/customers/customer-material-mapping-import.md` — 客户物料对应表导入
- `references/customers/customer-payment-shipping-consistency.md` — 客户、收款与出货名称一致性核对
- `references/customers/customer-shortname-operations.md` — 客户简称
- `references/customers/customer-shortname-scheme.md` — 客户简称命名口径
- `references/customers/customer-unfreeze-by-name.md` — 按名称解冻客户
- `references/inventory-sales/delivery-notice-lock-readonly-probes.md` — 发货通知单锁库状态只读探针
- `references/inventory-sales/delivery-pack-historical-backfill.md` — 新增包装类型历史补填
- `references/inventory-sales/inventory-availability-check.md` — 发货通知单审核卡「预计可发量不足」排查
- `references/inventory-sales/inventory-dimension-split.md` — 即时库存同物料拆行排查
- `references/inventory-sales/material-safe-stock-check.md` — 物料安全库存核对
- `references/inventory-sales/negative-stock-sop.md` — 负库存处理与 2026-07-08 案例；SQL 写入示例已标为历史禁用，不得直接运行
- `references/inventory-sales/sales-chain-rebuild-verification.md` — 销售链重建后的核验参考
- `references/inventory-sales/sales-delivery-notice-auto-lock.md` — 发货通知单自动锁库
- `references/inventory-sales/sales-delivery-notice-lock-pitfalls.md` — 发货通知单锁坑位
- `references/inventory-sales/sales-order-change-payment.md` — 销售订单收款条件变更边界
- `references/inventory-sales/sales-order-lock.md` — 销售订单锁库
- `references/inventory-sales/sales-order-note-length-fix.md` — 销售订单备注超长导致生产/工序计划保存失败
- `references/inventory-sales/sales-order-status-investigation.md` — 销售订单状况排查
- `references/inventory-sales/sales-outstock-ar-link.md` — 销售出库 SAL_OUTSTOCK 下游应收 AR_Receivable 关联排查
- `references/inventory-sales/sales-outstock-view.md` — 销售出库单 SAL_OUTSTOCK 明细查看与状态追溯
- `references/inventory-sales/stockplace-id-resolution.md` — 仓位
- `references/inventory-sales/warehouse-transfer.md` — 仓库取消与调拨
- `references/system/assembly-app-save-structure.md` — 组装拆卸单 STK_AssembledApp 写读两侧
- `references/system/assembly-bill-audit.md` — 组装拆卸单滥用诊断时读取
- `references/system/k3-write-timeout-orphan-cleanup.md` — K3 写超时孤儿单清理

## 本地私有档案（不纳入公开 Git）

- `.agents/private/kingdee-sales-inventory/` — CTK 侧载部署配置与历史入口摘录，仅供本地环境读取。
