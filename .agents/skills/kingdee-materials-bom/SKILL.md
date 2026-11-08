---
name: kingdee-materials-bom
description: >-
  维护金蝶物料、分组、规格、晶圆蓝膜配对和 BOM。用于建料、改料、BOM 检查与授权修改。
---

# 金蝶物料与 BOM

## 任务与完成条件

1. 遵守仓库 `AGENTS.md`。先确定对象、目标、实际物料流向和允许动作，读取当前状态及上下游。
2. 只读取本任务涉及的下列参考。历史案例用于定位，不代替当前查询或本次授权。
3. 写操作默认 dry-run；核对主键、前值和目标值后在授权范围内 apply。失败、部分成功或结果不确定时停止扩散。
4. 独立回查状态、数量、金额和关联；以简体中文区分事实、推断、未完成项，证据写仓库 `output/`。

## 本领域关键判断

先读 material-scope-invariants.md。黑胶名称须带已确认封装，缺少封装不得建料；NB 新成品须确认单芯或双芯。配对建料核对蓝膜 BOM；成品 BOM 仅在用户明确要求时处理，按模板完整性门槛逐字段核对。

## 优先阅读

- `references/materials/material-scope-invariants.md`
- `references/materials/material-create.md`
- `references/materials/bom-create-template-completeness.md`

## 相邻能力

- `../kingdee-k3cloud/SKILL.md` — 金蝶共用查询与连接。按任务需要读取。
- `../kingdee-production/SKILL.md` — 金蝶生产与工序。按任务需要读取。
- `../kingdee-procurement/SKILL.md` — 金蝶采购与委外。按任务需要读取。
- `../kingdee-sales-inventory/SKILL.md` — 金蝶销售、库存与客户。按任务需要读取。
- `../kingdee-finance/SKILL.md` — 金蝶财务、对账与成本。按任务需要读取。
- `../kingdee-system-admin/SKILL.md` — 金蝶系统、权限与运维。按任务需要读取。

共用接口脚本使用 Bun，从仓库 `lib/k3/index.js` 导入；状态映射见 `lib/k3/status.js`。跨技能 reference 路径相对当前技能根目录，仓库代码路径相对仓库根。

## 参考索引

- `references/materials/10104-chip-die-spec-lookup.md` — 10104 自采塑封芯片
- `references/materials/ad-smcg-and-external-batch.md` — AD- 车规前缀保留、SMCG 独立分组 `DA031`
- `references/materials/assembly-spec-to-material.md` — 从封装规格书/装配图建「成品 + 客供晶圆对 + 蓝膜 BOM」
- `references/materials/b-oem-product-type-grouping.md` — B(OEM成品)按产品类型分组
- `references/materials/bom-change-record-export.md` — BOM 批量修改后的留痕与 Excel 交付
- `references/materials/bom-group-discovery.md` — ENG_BOM 分组字段发现
- `references/materials/bom-modification-completion.md` — BOM 批量修改的分组覆盖与完成门槛
- `references/materials/bom-scope-discovery.md` — 跨产品族 BOM 范围发现与分类
- `references/materials/bom-unaudit-and-delete.md` — BOM 反审核与删除流程及下游安全检查
- `references/materials/bom-usage-and-batch-update.md` — BOM 用量修改流程与 PDFN3 分类
- `references/materials/bom_webapi_queries.md` — `ENG_BOM` WebAPI 分录平铺字段查询、子件筛选与禁用统计
- `references/materials/bom-create-template-completeness.md` — 按参照新建成品 BOM 的表头/子件/替代关系完整性核对门槛
- `references/materials/hardware-group-disambiguation.md` — 五金/厂务类物料分组判定
- `references/materials/lead-frame-10501-pattern.md` — 10501 铜框架建料
- `references/materials/lm-bom-health-scan.md` — 蓝膜 BOM 体检
- `references/materials/lm-bom-parent-requirements.md` — 蓝膜 BOM 父项主产品与属性要求
- `references/materials/material-aux-property.md` — 物料辅助属性
- `references/materials/material-batch-fix-external.md` — 外购 N 料批号补齐
- `references/materials/material-classification.md` — 物料分类核对参考
- `references/materials/material-create.md` — 通用与分品类建料流程及重码预检
- `references/materials/material-group-selection.md` — 物料分组选择
- `references/materials/material-master-data-edits.md` — 修改规格时读取
- `references/materials/material-pair-rules.md` — 成对物料与前缀分类核对
- `references/materials/material-rename.md` — 物料改名/改规格最小字段 Save
- `references/materials/material-scope-invariants.md` — 建料时必读的范围与前置不变量（黑胶封装、单双芯等）
- `references/materials/material-spec-batch-rename.md` — 物料规格批量改名
- `references/materials/package-diagram-material-boundary.md` — 封装结构图与建料边界
- `references/materials/pdfn-copper-batch-write-boundaries.md` — PDFN 铜线批量修改边界与验证清单

## 本地私有档案（不纳入公开 Git）

- `.agents/private/kingdee-materials-bom/INDEX.md` — 厂内特定客户/晶圆厂配对建料模式（17 篇）、料号谱系与历史入口摘录索引，仅供本地环境读取。
