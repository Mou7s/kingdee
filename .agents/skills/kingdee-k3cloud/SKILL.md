---
name: kingdee-k3cloud
description: >-
  验证金蝶 K3Cloud 连接、按单号查单、发现表单字段与操作元数据。用于通用查询或领域技能需要共用接口知识时；领域写入流程使用对应领域技能。
---

# 金蝶共用查询与连接

## 任务与完成条件

1. 遵守仓库 `AGENTS.md`。先确定对象、目标、实际物料流向和允许动作，读取当前状态及上下游。
2. 只读取本任务涉及的下列参考。历史案例用于定位，不代替当前查询或本次授权。
3. 写操作默认 dry-run；核对主键、前值和目标值后在授权范围内 apply。失败、部分成功或结果不确定时停止扩散。
4. 独立回查状态、数量、金额和关联；以简体中文区分事实、推断、未完成项，证据写仓库 `output/`。

## 本领域关键判断

登录后执行一条真实只读查询；按真实 FID/FEntryID 去重。字段未知先查元数据，区分查询失败与没有数据。

## 优先阅读

- `references/system/search-bill.md`
- `references/system/runtime-and-connectivity.md`
- `references/system/k3cloud-form-ids.md`

## 相邻能力

- `../kingdee-materials-bom/SKILL.md` — 金蝶物料与 BOM。按任务需要读取。
- `../kingdee-production/SKILL.md` — 金蝶生产与工序。按任务需要读取。
- `../kingdee-procurement/SKILL.md` — 金蝶采购与委外。按任务需要读取。
- `../kingdee-sales-inventory/SKILL.md` — 金蝶销售、库存与客户。按任务需要读取。
- `../kingdee-finance/SKILL.md` — 金蝶财务、对账与成本。按任务需要读取。
- `../kingdee-system-admin/SKILL.md` — 金蝶系统、权限与运维。按任务需要读取。

共用接口脚本使用 Bun，从仓库 `lib/k3/index.js` 导入；状态映射见 `lib/k3/status.js`。跨技能 reference 路径相对当前技能根目录，仓库代码路径相对仓库根。

## 参考索引

- `references/system/bill-close-and-reopen.md` — 单据关闭/反关闭判定
- `references/system/bill-export-excel.md` — 单据批量导出 Excel
- `references/system/bill-operations-and-metadata.md` — 单据操作元数据
- `references/system/community-document-fetch.md` — 金蝶社区正文、原始 HTML、插图与关联文章取证
- `references/system/database-form-discovery.md` — `search-bill` 未命中时用只读 SQL 元数据发现表单
- `references/system/db-structure.md` — 金蝶账套数据库结构速查
- `references/system/k3cloud-fields-reference.md` — 查询或构造保存模型时读取
- `references/system/k3cloud-form-ids.md` — 定位表单时读取
- `references/system/pdf-image-extraction.md` — 图片型 PDF/扫描件取字
- `references/system/project-conventions.md` — 开发及运维前按需读取
- `references/system/project-map.md` — 目录、命令、与仓库文件对照
- `references/system/runtime-and-connectivity.md` — 验证连接或编写脚本时读取
- `references/system/search-bill.md` — 跨采购/应付/生产/工序/销售/库存表单按单号模糊检索
- `references/system/task-workflows.md` — 2026-11-01 拆分前的历史跨领域入口摘录与现行流程指向

## 本地私有档案（不纳入公开 Git）

- `.agents/private/kingdee-k3cloud/INDEX.md` — 本地历史入口摘录索引（`bill-operations.md`、`common-ops.md`、`pitfalls.md`、`webapi-query-pitfalls.md`），仅供本地环境追溯。
