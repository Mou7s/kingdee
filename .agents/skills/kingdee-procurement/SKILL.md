---
name: kingdee-procurement
description: >-
  查询和处理金蝶采购、委外、受托加工、供应商及收退料。用于业务类型辨别、下推受阻和材料退回。
---

# 金蝶采购与委外

## 任务与完成条件

1. 遵守仓库 `AGENTS.md`。先确定对象、目标、实际物料流向和允许动作，读取当前状态及上下游。
2. 只读取本任务涉及的下列参考。历史案例用于定位，不代替当前查询或本次授权。
3. 写操作默认 dry-run；核对主键、前值和目标值后在授权范围内 apply。失败、部分成功或结果不确定时停止扩散。
4. 独立回查状态、数量、金额和关联；以简体中文区分事实、推断、未完成项，证据写仓库 `output/`。

## 本领域关键判断

先区分采购、委外和受托加工；退料前核对已下推数量、现存量及实际物料方向。涉及应付与对账时同时读取财务技能。

## 优先阅读

- `references/procurement/entrusted-vs-subcontract.md`
- `references/procurement/oem-receive-instock-return.md`
- `references/procurement/subcontract-order-to-pick-push-conditions.md`

## 相邻能力

- `../kingdee-k3cloud/SKILL.md` — 金蝶共用查询与连接。按任务需要读取。
- `../kingdee-materials-bom/SKILL.md` — 金蝶物料与 BOM。按任务需要读取。
- `../kingdee-production/SKILL.md` — 金蝶生产与工序。按任务需要读取。
- `../kingdee-sales-inventory/SKILL.md` — 金蝶销售、库存与客户。按任务需要读取。
- `../kingdee-finance/SKILL.md` — 金蝶财务、对账与成本。按任务需要读取。
- `../kingdee-system-admin/SKILL.md` — 金蝶系统、权限与运维。按任务需要读取。

共用接口脚本使用 Bun，从仓库 `lib/k3/index.js` 导入；状态映射见 `lib/k3/status.js`。跨技能 reference 路径相对当前技能根目录，仓库代码路径相对仓库根。

## 参考索引

- `references/procurement/closed-period-oem-correction.md` — 关账期受托入库红蓝字更正
- `references/procurement/entrusted-vs-subcontract.md` — 受托vs委外vs采购三向区分
- `references/procurement/oem-receive-instock-return.md` — 受托加工材料 收料/入库/退料
- `references/procurement/purchase-order-delete-change-lock.md` — 采购订单删除链与变更锁死
- `references/procurement/purchase-prepay-push.md` — 采购订单下推付款申请预付失败排查
- `references/procurement/purchase-vs-subcontract-diagnosis.md` — 采购vs委外诊断
- `references/procurement/subcontract-order-delete-chain.md` — 委外订单全链路逆向删除与死锁解除
- `references/procurement/subcontract-order-to-pick-push-conditions.md` — 委外订单下推委外领料单「不符合下推条件」的字段级排查
- `references/procurement/subcontract-picking-negative-stock.md` — 委外领料客供仓负库存
- `references/procurement/subcontract-return-mtrl.md` — 委外领料 SUB_PickMtrl 已审核退料
- `references/procurement/supplier-reconnaissance.md` — 供应商核查
- `references/procurement/supplier-supply-classify.md` — 供应商供应类别枚举与 G026 案例

## 本地私有档案（不纳入公开 Git）

- `.agents/private/raw-cases/kingdee-procurement/` — 采购、委外与受托加工相关的本地未脱敏原始案例备份，仅供本地环境追溯。
