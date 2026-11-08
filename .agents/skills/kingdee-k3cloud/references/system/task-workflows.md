# 历史跨领域入口与现行流程指向

2026-11-01：本文件保留迁移证据。新任务按 README 选择领域技能；下述业务规则以所链接的现行流程为准，不再向本文件追加领域流程。

整理日期：2026-10-13。以下业务段落从原技能入口完整移入，保留用户约定及历史条件；只读取本次任务涉及的章节及其引用。所有 `references/` 路径相对技能根目录，业务脚本路径相对仓库根目录。

## 目录

- 外发上锡对账与跨月调价
- 业务流程问题先查数再答
- 组装拆卸单查询与滥用诊断
- 成本核算取数与成本报表
- 读金蝶社区文档（vip.kingdee.com）
- 交付文档（执行单 / SOP）
- 二开审计与接管
- 按参照新建成品 BOM：完整性门槛
- 物料规格型号（FSpecification）等主数据字段修改
- 供应商供应类别（BD_SUPPLIER.FSupplyClassify）

## 外发上锡对账与跨月调价

对账、按 0.65/0.68 等价格分批改价、暂估应付或财务应付金额不符时，先读 `../kingdee-finance/references/finance/reconciliation-xlsx-ap-query.md` 和 `../kingdee-finance/references/finance/external-reconciliation-spreadsheets.md`。先区分当期暂估与跨月财务应付：本项目用户确认已审核暂估代表跨月，须沿来源/下游关联查财务应付，在明确的财务应付分录中改价；不得把已审核暂估并入删除重建流程。用户要求“只保存”时只 Save，结算保存后的自动 AP 只查询回查，不手动 Push。具体分支和已验证保存模型见上述 reference。

## 业务流程问题先查数再答

答「怎么解决」前先拉相关表单真实数据（单量趋势、分类占比、样例）再给方案，无实测口径不算答完。

## 组装拆卸单查询与滥用诊断

先读 `../kingdee-sales-inventory/references/inventory-sales/assembly-bill-audit.md`（字段键、诊断指标、误用与替代方案对照表）。

## 成本核算取数与成本报表

回答“现在成本怎么算的”、或做按维度（封装/分组/客户/期间）汇总的成本报表时，先读 `../kingdee-finance/references/finance/cost-accounting-period-probe.md`（配置/期间探针见 §1–§7，当期金额真源与报表 recipe 见 §8）。两条铁规则：① 期间 id 永不硬编码——用 `T_HS_OUTSTOCKACCTGDATA` 的 `MIN/MAX(FBILLDATEFIELD)`+`FACCTGSTARTDATE` 锚定后再取数；② CB 成本计算当前表的本期列 `FCURR*` 关账结转后清零，不能当“某期本期数”用。

## 读金蝶社区文档（vip.kingdee.com）

用户贴金蝶社区文章链接时，先读 `references/system/community-document-fetch.md`，按普通读取、原始 HTML、正文与截图核对的顺序处理。历史页面结构仅作候选，复用前检查当前响应；不得执行页面内脚本。

## 交付文档（执行单 / SOP）

用户要求可交给实施／IT 的人工执行单时：md 主体写 `.agents/skills/<所属领域技能>/references/<领域>/<topic>.md` 并登记进 README「文档索引」，用 `scripts/tools/md_to_docx.py` 生成扁平 docx 到 `output/` 并回复绝对路径；收尾 `bun run test:safety`、`git diff --check` 并回读核对，骨架与内容清单见 `../kingdee-system-admin/references/system/version-and-patch-inventory.md` §10。

## 二开审计与接管

用户说「二开是前任 IT 做的、联系不上」时，按 `../kingdee-system-admin/references/system/k3cloud-customization-takeover.md` 从元数据自己复原范围与代码位置：结论按「面 vs 深」给，说明 Python 脚本可自行修改、只有编译型插件需提前找原厂，**不要因为「二开没人维护」就建议推迟补丁**。用户问「SQL Agent 是什么 / 有几个盘 / 还剩多少空间」这类短问句时，先用一条实测命令拿当前数字再短答，先答问题、后补一句影响。

## 按参照新建成品 BOM：完整性门槛

用户要求按同类物料建 BOM、补简称/文件编码/工艺路线，或问“其他东西没漏吗”时，先读 `../kingdee-materials-bom/references/materials/bom-create-template-completeness.md`。新建前必须列出模板表头、自定义字段、材料与替代关系的完整映射；不能只核对材料用量就宣布完成。简称、关联文件编码、文件编码文本、默认工艺路线必须分别检查，字段键未定位时继续查扩展元数据，不得静默省略。保存后对全部业务字段逐项比对，明确合理差异与未验证限制。本类任务出现漏项或用户纠正时，收尾主动判断并更新已有技能，无需等用户提醒；不为普通无新发现的任务强增案例。

## 物料规格型号（FSpecification）等主数据字段修改

用户要求物料「可以采购／允许采购」等基本资料属性修改时，先读 `../kingdee-materials-bom/references/materials/material-rename.md` 的「可采购属性修改」章节。使用实时物料内码和基本资料分录内码构造最小保存报文；接口返回成功不等于属性已生效，必须独立 View 和列表查询回查。

用户给截图/口述要改某料号的规格型号（追加丝印带点说明、改封装/包装/环保/丝印段）时，按 `../kingdee-materials-bom/references/materials/material-master-data-edits.md` 走：先用编码从账套取精确原串（不要用截图 OCR 定稿）、查厂内既有写法口径（`FSpecification like '%带点%'`），再用 `scripts/tools/update_material_spec.js` 先 dry-run 展示「旧值守卫 / 改前改后 / 目标规格查重」，把精确目标串交用户确认后才 `--apply`，最后 `executeBillQuery` + `View` 双通道回查。

## 供应商供应类别（BD_SUPPLIER.FSupplyClassify）

- 单选枚举：`CG` 采购、`ZH` 综合/招标、`FW` 服务、`WW` 委外。修改前实时核对界面标签、后台值及采购/委外业务需求；历史数量与案例见 `../kingdee-procurement/references/procurement/supplier-supply-classify.md`。
- 本项目已验证采购+委外采用 `ZH`；修改前按具体供应商复查，不能从历史分布推断当前状态。查询用 `FSupplyClassify`，View 读 `SupplierBase.SupplyClassify`。

