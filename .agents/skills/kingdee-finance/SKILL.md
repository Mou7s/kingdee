---
name: kingdee-finance
description: >-
  核对金蝶应收应付、外发对账、跨月调价、核销及成本。用于金额数量差异、对账工作簿和期间成本取数。
---

# 金蝶财务、对账与成本

## 任务与完成条件

1. 遵守仓库 `AGENTS.md`。先确定对象、目标、实际物料流向和允许动作，读取当前状态及上下游。
2. 只读取本任务涉及的下列参考。历史案例用于定位，不代替当前查询或本次授权。
3. 写操作默认 dry-run；核对主键、前值和目标值后在授权范围内 apply。失败、部分成功或结果不确定时停止扩散。
4. 独立回查状态、数量、金额和关联；以简体中文区分事实、推断、未完成项，证据写仓库 `output/`。

## 本领域关键判断

AP_PAYABLE 实时区分 FSETACCOUNTTYPE：2 暂估按明确授权处理；3 财务应付只能保存草稿，禁止提交审核及间接工作流；未知或混合类型不得提交审核。跨月沿关联找财务应付，只保存时不手动下推。成本期间实时锚定，关账清零列不作历史金额；用户说成本不准时先做“结果是否用过期数据”三步排除（锚定运算时点、查运算后本期单据晚审晚作废、单独列本期订单晚审），再谈分摊口径。

## 优先阅读

- `references/finance/reconciliation-xlsx-ap-query.md`
- `references/finance/external-reconciliation-spreadsheets.md`
- `references/finance/cost-accounting-period-probe.md`

## 相邻能力

- `../kingdee-k3cloud/SKILL.md` — 金蝶共用查询与连接。按任务需要读取。
- `../kingdee-materials-bom/SKILL.md` — 金蝶物料与 BOM。按任务需要读取。
- `../kingdee-production/SKILL.md` — 金蝶生产与工序。按任务需要读取。
- `../kingdee-procurement/SKILL.md` — 金蝶采购与委外。按任务需要读取。
- `../kingdee-sales-inventory/SKILL.md` — 金蝶销售、库存与客户。按任务需要读取。
- `../kingdee-system-admin/SKILL.md` — 金蝶系统、权限与运维。按任务需要读取。

共用接口脚本使用 Bun，从仓库 `lib/k3/index.js` 导入；状态映射见 `lib/k3/status.js`。跨技能 reference 路径相对当前技能根目录，仓库代码路径相对仓库根。

## 参考索引

- `references/finance/ar-settlement-match-trace.md` — 应收单「已结算/未结算金额」来源追溯
- `references/finance/cost-allocation-equival-coefficient.md` — UPH费用权重与在产约当系数的区别、20172公式实证、固晶四层BOM自动判定规则及自定义费用分配标准流程
- `references/finance/department-retirement-cost-references.md` — 部门停用/删除前的工序在产、费用、总账维度和成本中心引用检查
- `references/finance/external-reconciliation-spreadsheets.md` — 外部对账表处理参考
- `references/finance/purchase-pricelist-lookup.md` — 采购价目表与委外目标价查询；禁用/合并、单位统一、封装覆盖统计与分批补录、物料编码必录失败回查；采购单价上限/下限
- `references/finance/receipt-deletion-trace.md` — 收款单缺失与删除追踪
- `references/finance/reconciliation-and-unfamiliar-forms.md` — 对账三量比对
- `references/finance/reconciliation-xlsx-ap-query.md` — 对账工作簿与 AP 分录核对
- `references/finance/subcontract-return-after-costclose.md` — 委外多发退料 — 关账后替代方案
- `references/finance/cost-accounting-period-probe.md` — 成本核算期间锚定、关账状态与当期金额只读探针

## 本地私有档案（不纳入公开 Git）

- `.agents/private/kingdee-finance/INDEX.md` — 公司经营画像、特定型号成本拆解、固晶 UPH 试点数据与历史入口摘录索引，仅供本地环境读取。
