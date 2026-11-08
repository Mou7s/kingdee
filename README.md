# kingdee — 金蝶 K3 Cloud 运维脚本与领域技能工作台

本仓库使用 Bun + JavaScript/TypeScript 调用金蝶 K3 Cloud WebAPI，并在明确授权的范围内执行数据库只读诊断、生产与工序核对、库存/基础资料处理和外发对账。仓库采用**公开方法论层 + 本地私有数据层**双层架构：通用工具与 8 个领域技能（`.agents/skills/`）随 Git 公开维护；连接凭据（`k3cloud.local.json`）、公司特定业务档案（`.agents/private/`）与历史个案脚本（`scripts/cases/`）仅保存在本地环境（`.gitignore` 忽略）。

仓库连接真实账套。任何涉及写入、删除、反审核、提交或审核的操作，都必须先读取当前数据、确认业务范围，再执行预览和结果复核。完整硬性规则见 `AGENTS.md`。

## 快速开始

运行环境需要 Bun、能够访问金蝶内网或外网地址的网络，以及已有的项目访问权限。凭据不写入 README、示例和运行输出；连接配置沿用项目现有私有配置，具体约定见 `.agents/skills/kingdee-k3cloud/references/system/project-conventions.md`。

```bash
bun install
bun run test:safety
bun run login
bun run search-bill -- MO260428041
```

`login` 只验证连接和登录；`search-bill` 是只读查单。首次接触一个单据或业务问题时，先用查询和 dry-run 确认目标，不要直接加 `--apply`。

## 稳定入口

下面的命令由 `package.json` 暴露，是优先使用的稳定入口：

| 命令 | 用途 | 默认行为 |
| --- | --- | --- |
| `bun run login` | 登录金蝶并验证连接 | 不修改业务数据 |
| `bun run search-bill -- <关键词>` | 跨采购、应付、生产、工序、销售、库存等表单查单 | 只读 |
| `bun run delete-sfc -- <生产订单号>` | 预览指定生产订单下的工序计划 | dry-run |
| `bun run delete-sfc -- <生产订单号> --apply` | 按已确认范围删除工序计划 | 写入/删除 |
| `bun run unfreeze-customer -- <客户编码>` | 查看客户冻结状态及拟修改内容 | dry-run |
| `bun run unfreeze-customer -- <客户编码> --apply` | 执行客户解冻工具的更新 | 写入 |
| `bun run uncancel-report -- <工序汇报单号>` | 查看工序汇报单作废状态及拟反作废内容 | dry-run |
| `bun run uncancel-report -- <工序汇报单号> --apply` | 执行工序汇报单反作废（`UnCancel`，B→A，不改单据状态） | 写入 |
| `bun run test:safety` | 校验 `AP_PAYABLE` 的客户端安全拦截 | 本地测试 |
| `bun run check-patch` | 打补丁前采集版本/补丁记录/单据量基线，存 `output/patch_baseline_*.json` | 只读 |
| `bun run verify-patch` | 打补丁后与基线对比，逐项判定补丁是否生效 | 只读 |
| `bun run backup-foshan` | 查看/创建分厂账套账套的每日备份作业（含保留 15 天清理） | dry-run（`--apply` 才创建） |
| `bun run optimize-backup` | 查看/执行备份体系优化（压缩、清理频率、system 库备份、备份体检作业） | dry-run（`--apply` 才执行） |

`scripts/tools/` 保存可重复使用的工具；固定单号、固定期间和历史修复脚本归入 `scripts/cases/`。目录归类不代表脚本已经通过业务安全验证。使用前先阅读脚本头部、确认目标单据和写入方式；带有固定单号、SQL `UPDATE/INSERT/DELETE` 或无 dry-run 的脚本，按个案工具处理。

## 安全边界

- `AP_PAYABLE` 财务应付单只能通过 `Save` 保存为草稿，禁止 `Submit`、`Audit`、启动工作流或执行同类提交审核操作；由用户在金蝶前端复核后处理。`k3cloud.js` 已在客户端层拦截相关请求。
- 写操作工具默认 dry-run，只有显式 `--apply` 才进入执行分支；`--apply` 不是业务授权的替代品。
- 对正式业务单据不得擅自用 SQL 修改、插入或物理删除。SQL 查询可用于取证；SQL 写入仅能在明确的、逐案授权的历史脏数据处理场景中进行，并须记录范围、前值、后值和复核结果。
- 不根据单据号、物料名称或历史案例臆造固定的物料转换、仓位、仓库、供应商或数量映射。业务规则有分歧时，先取得业务确认和可审计的原因。

## 推荐处理顺序

1. 明确单号/物料/供应商/仓库/期间、预期结果和实际物料流向。
2. 通过 WebAPI 和必要的数据库只读查询获取当前状态；字段不确定时先查金蝶元数据和代码库参考，不猜字段名。
3. 对查询结果按 `FID`、`FEntryID` 等真实主键去重，检查单据状态、上下游关联、数量、金额和供应商等约束。
4. 先运行 dry-run，审阅将要影响的精确对象；确认授权后才执行写入。
5. 执行后重新查询 WebAPI/数据库，核对状态和数量，保存必要的输出证据，并说明仍未验证的部分。

## 目录

```text
k3cloud.js / k3_utils.js  # 根级兼容入口与既有辅助模块
lib/k3/                                       # 新脚本优先使用的统一导出、表单和状态常量
scripts/tools/                                # 可重复使用的 CLI 与辅助工具（纳入 Git）
scripts/tests/                                # 本地测试（不连接真实账套，纳入 Git）
scripts/cases/                                # 固定对象、固定期间与历史修复脚本（本地保留，不纳入 Git）
scripts/bun_test/                             # 旧环境历史脚本，按需保留（本地保留，不纳入 Git）
scripts/scratch/YYYY-MM/                      # 一次性探测及临时产物（本地保留，不纳入 Git）
.agents/skills/                               # 公开 Agent 技能：SKILL.md 骨架 + 通用 references/（纳入 Git）
.agents/private/                              # 本地私有业务档案、晶圆配对模式与原始案例（本地保留，不纳入 Git）
input/                                        # 对账等外部输入（本地保留，不纳入 Git）
output/                                       # 运行结果、备份和导出工件（本地保留，不纳入 Git）
output/archive/                               # 原 tmp/、outputs/ 的保留证据（本地保留，不纳入 Git）
```

新逻辑应尽量沉淀到 `lib/k3/` 或可复用的 `scripts/tools/`；一次性探测放入按月归档的 `scripts/scratch/YYYY-MM/`，不要把临时脚本和原始敏感数据堆在仓库根目录。

## 新脚本示例

位于 `scripts/tools/` 的脚本使用相对路径导入统一入口：

```js
import {
  K3CloudWebAPI,
  FORMS,
  escapeK3,
} from "../../lib/k3/index.js";

const api = new K3CloudWebAPI();
await api.login();

const billNo = "MO260428041";
const rows = await api.executeBillQuery(
  FORMS.PRD_MO,
  "FID,FBillNo,FDocumentStatus",
  `FBillNo='${escapeK3(billNo)}'`,
);
console.log(rows);
```

优先使用 `FORMS`、`DOC_STATUS`/`DOC_STATUS_SHORT`、`OPER_STATUS` 和 `escapeK3`，不要在新代码中重复手写已登记的表单 ID、状态映射或过滤值转义逻辑。

## 技能与参考索引

项目约定、字段手册、操作流程和案例统一保存在 `.agents/skills/`，由技能入口按需读取。

- [AGENTS.md](AGENTS.md)：Agent 和开发者必须遵守的安全、调查、写入和复核规则
- [项目约定与优化决策](.agents/skills/kingdee-k3cloud/references/system/project-conventions.md)：目录、脚本晋升和既有兼容约定
- [常用表单 ID](.agents/skills/kingdee-k3cloud/references/system/k3cloud-form-ids.md)：K3 Cloud 业务对象 ID
- [常用字段参考](.agents/skills/kingdee-k3cloud/references/system/k3cloud-fields-reference.md)：已验证字段及应付单限制
- [技能参考：通用查单](.agents/skills/kingdee-k3cloud/references/system/search-bill.md)
- [技能参考：删除工序计划](.agents/skills/kingdee-production/references/production/delete-sfc-plan.md)
- [技能参考：客户解冻](.agents/skills/kingdee-sales-inventory/references/customers/customer-unfreeze-by-name.md)
- [人工执行单：企业版 V9.0 补丁升级](.agents/skills/kingdee-system-admin/references/system/k3cloud-patch-v9-upgrade.md)　—— 2026-09-21 历史核查与现场清单；执行前刷新包、版本、备份及窗口
- [技能参考：BOM 用量修改](.agents/skills/kingdee-materials-bom/references/materials/bom-usage-and-batch-update.md)
- [技能参考：BOM 反审核与删除](.agents/skills/kingdee-materials-bom/references/materials/bom-unaudit-and-delete.md)
- [技能参考：预置基础资料1修改](.agents/skills/kingdee-system-admin/references/system/prebase-data-one-query-update.md)
- [技能参考：工序超报控制规格](.agents/skills/kingdee-production/references/production/operation-report-over-rate-control.md)
- [负库存 SOP](.agents/skills/kingdee-sales-inventory/references/inventory-sales/negative-stock-sop.md)
- [技能参考：生产订单状态机与反审核](.agents/skills/kingdee-production/references/production/mo-status-machine-and-reverse-audit.md)
- [共用查询与连接](.agents/skills/kingdee-k3cloud/SKILL.md)：连接、通用查单、表单字段与元数据
- [物料与 BOM](.agents/skills/kingdee-materials-bom/SKILL.md)
- [生产与工序](.agents/skills/kingdee-production/SKILL.md)
- [采购与委外](.agents/skills/kingdee-procurement/SKILL.md)
- [销售、库存与客户](.agents/skills/kingdee-sales-inventory/SKILL.md)
- [财务、对账与成本](.agents/skills/kingdee-finance/SKILL.md)
- [系统、权限与运维](.agents/skills/kingdee-system-admin/SKILL.md)
- [技能维护与合规审计](.agents/skills/kingdee-skill-maintenance/SKILL.md)：技能设计、整理、索引和本地验证

金蝶字段、表单和操作语义以实际账套元数据及[官方 WebAPI 文档](https://openapi.open.kingdee.com/ApiDoc)为准；本仓库文档只记录已在项目中验证或明确约定的内容。

## 本地检查

修改脚本或文档后至少执行：

```bash
bun run test:safety
git diff --check
# 改动技能后，先过合规审计（正文 ≤500 行、一层可达、长文档有目录、无孤儿）
bun scripts/tools/audit_skill_routes.js
bun test ./scripts/tests/audit_skills.test.js
```

涉及实时账套的变更，还必须补做执行后的查询复核；本地测试通过不代表生产数据已经正确。
