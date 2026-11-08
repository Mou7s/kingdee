---
name: kingdee-system-admin
description: >-
  调查和维护金蝶权限、数据范围、补丁、备份、二开与系统运行问题。用于用户权限异常、版本升级准备和系统运维。
---

# 金蝶系统、权限与运维

## 任务与完成条件

1. 遵守仓库 `AGENTS.md`。先确定对象、目标、实际物料流向和允许动作，读取当前状态及上下游。
2. 只读取本任务涉及的下列参考。历史案例用于定位，不代替当前查询或本次授权。
3. 写操作默认 dry-run；核对主键、前值和目标值后在授权范围内 apply。失败、部分成功或结果不确定时停止扩散。
4. 独立回查状态、数量、金额和关联；以简体中文区分事实、推断、未完成项，证据写仓库 `output/`。

## 本领域关键判断

权限角色保存后须保存受影响 SEC_User（仅 FUserID，NeedUpDateFields=[]、IsDeleteEntry=false）；共享角色查全成员，回读并实际验证后才称生效。补丁历史清单须重新确认版本、备份和维护窗口。

## 优先阅读

- `references/system/permission-data-scope-investigation.md`
- `references/system/version-and-patch-inventory.md`
- `references/system/k3cloud-customization-takeover.md`

## 相邻能力

- `../kingdee-k3cloud/SKILL.md` — 金蝶共用查询与连接。按任务需要读取。
- `../kingdee-materials-bom/SKILL.md` — 金蝶物料与 BOM。按任务需要读取。
- `../kingdee-production/SKILL.md` — 金蝶生产与工序。按任务需要读取。
- `../kingdee-procurement/SKILL.md` — 金蝶采购与委外。按任务需要读取。
- `../kingdee-sales-inventory/SKILL.md` — 金蝶销售、库存与客户。按任务需要读取。
- `../kingdee-finance/SKILL.md` — 金蝶财务、对账与成本。按任务需要读取。

共用接口脚本使用 Bun，从仓库 `lib/k3/index.js` 导入；状态映射见 `lib/k3/status.js`。跨技能 reference 路径相对当前技能根目录，仓库代码路径相对仓库根。

## 参考索引

- `references/system/bos-extension-field-guidance.md` — BOS 标准单据字段配置
- `references/system/business-monitor-readonly-audit.md` — 业务监控消息超量
- `references/system/employee-master-query.md` — 员工主数据
- `references/system/k3cloud-customization-takeover.md` — 二开接管时读取
- `references/system/k3cloud-patch-v9-upgrade.md` — k3cloud-patch-v9-upgrade
- `references/system/permission-data-scope-inheritance.md` — K3 数据权限的基础资料联动边界
- `references/system/permission-data-scope-investigation.md` — K3 Cloud 用户权限与数据范围排查
- `references/system/permission-data-scope-supervisor-rule.md` — 主管角色与客户数据范围排查
- `references/system/prebase-data-one-query-update.md` — prebase-data-one-query-update
- `references/system/recover-deleted-bills.md` — 误删生产订单等
- `references/system/sqlserver-backup-and-agent-ops.md` — 星空的备份体系核查与 SQL Agent 作业维护
- `references/system/version-and-patch-inventory.md` — 版本补丁调查或交付执行单时读取

## 本地私有档案（不纳入公开 Git）

- `.agents/private/kingdee-system-admin/` — 环境历史快照、工厂机台解锁包逆向与历史入口摘录，仅供本地环境读取。
