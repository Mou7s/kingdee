# 项目约定与优化决策

> 2026-10-17 迁移说明：文档统一归入 .agents/skills/。以下优化记录保留其原始日期；安全语义以 AGENTS.md 为准，AP_PAYABLE 必须按实时 FSETACCOUNTTYPE 区分，类型 3 财务应付只能保存草稿，不能把旧文案理解为禁止所有暂估应付提交审核。

## 项目性质与公开/私有分层（2026-11-07 更新）

本仓库采用**公开方法论 + 本地私有数据**双层架构：

- **公开层（纳入 Git）**：8 个领域技能（`.agents/skills/` 下的 `SKILL.md` 与脱敏后的通用方法论/系统 `references/`）、通用客户端与工具库（`k3cloud.js`、`lib/k3/`）、稳定可复用 CLI（`scripts/tools/`）和本地安全测试（`scripts/tests/`）。
- **私有层（`.gitignore` 忽略，仅保留本地磁盘）**：连接凭据（`k3cloud.local.json`）、公司特定晶圆配对/成本/客户档案与原始未脱敏案例（`.agents/private/`）、固定单号历史修复脚本（`scripts/cases/`、`scripts/bun_test/`）以及运行输入输出（`input/`、`output/`）。

### 明确约定

| 决策 | 说明 |
|------|------|
| **凭据走本地未跟踪配置** | 真实连接凭据与内网/外网地址统一放在 gitignore 的 `k3cloud.local.json`（参考 `k3cloud.local.example.json`）或环境变量中，严禁硬编码进 `k3cloud.js`、`scripts/tools/` 或文档。 |
| **方法公开、特定业务数据本地化** | 通用排障方法、表单字段、元数据探针保留在 `.agents/skills/`；特定客户/供应商配对模式、公司经营画像与个案脚本放在 `.agents/private/` 与 `scripts/cases/`，本地 Agent 可直接读取，但不进入公开 Git。 |

---

## 目录约定

```
kingdee/
├── k3cloud.js / k3_utils.js   # 根级兼容入口（从 k3cloud.local.json 或环境变量读取凭据）
├── lib/k3/                                        # 新脚本优先从此导入
├── scripts/
│   ├── tools/                                     # 稳定 CLI（可重复使用，纳入 Git）
│   ├── tests/                                     # 不连接账套的本地测试（纳入 Git）
│   ├── cases/                                     # 固定对象/期间的历史个案脚本（本地保留，gitignore）
│   ├── bun_test/                                  # 历史业务脚本（本地保留，gitignore）
│   └── scratch/YYYY-MM/                           # 一次性探测（本地保留，gitignore）
├── .agents/
│   ├── skills/                                    # 公开技能入口、通用流程、表单/字段参考（纳入 Git）
│   └── private/                                   # 公司特定业务档案、晶圆配对模式与原始案例（本地保留，gitignore）
├── input/  output/                                # 输入对账单 / 运行输出（本地保留，gitignore）
```

| 路径 | 用途 |
|------|------|
| `lib/k3/` | 统一导出客户端、状态码、常用 formId |
| `scripts/tools/` | 稳定工具：查单、删工序计划、解冻客户等 |
| `scripts/scratch/` | 临时 probe；默认 gitignore 月度目录产物可选 |
| `scripts/bun_test/` | 既有脚本，新逻辑优先写到 `tools/` 或 `lib/` |

运行日志、查询快照、导出与对账工件统一写入仓库根目录 `output/`，按任务分子目录；历史 `tmp/`、`outputs/` 产物保留在 `output/archive/`，不纳入 Git。脚本读写路径和文档示例使用同一目录。

固定对象、固定期间、直接 SQL 修复或依赖历史前值的脚本放 `scripts/cases/`，受版本管理；归档不表示获得业务执行授权。测试放 `scripts/tests/`，真实账套探测不作为本地测试执行。

### 命名

- **稳定工具**：`verb_domain.js`，如 `search_bill.js`、`delete_sfc_plan.js`
- **临时探测**：`scripts/scratch/YYYY-MM/_probe_xxx.ts`，不要堆在仓库根目录
- 同一逻辑跑过 3 次以上 → 晋升到 `scripts/tools/` 或 `lib/k3/`

---

## 安全规则（代码强制）

- **`AP_PAYABLE` 按实时 `FSETACCOUNTTYPE` 区分安全边界**
  类型 3 财务应付在客户端拦截提交、审核及相关工作流，只能保存草稿；类型 2 暂估可按明确授权处理，未知或混合类型不得提交审核。
  见 `AGENTS.md`。

- 写操作类 CLI 默认 **`--dry-run`**，加 **`--apply`** 才真正执行。

---

## 推荐入口（package.json）

```bash
bun run login
bun run search-bill -- MO260428041
bun run delete-sfc -- MO260626026          # dry-run
bun run delete-sfc -- MO260626026 --apply
bun run unfreeze-customer -- CUST0281      # dry-run
bun run unfreeze-customer -- CUST0281 --apply
```

---

## 文档索引

| 文件 | 内容 |
|------|------|
| `.agents/skills/kingdee-k3cloud/references/system/k3cloud-form-ids.md` | 常用表单 ID |
| `.agents/skills/kingdee-k3cloud/references/system/k3cloud-fields-reference.md` | 常用字段 |
| `.agents/skills/kingdee-k3cloud/` | 共用查询流程；领域流程见 README 技能导航 |
| `.agents/skills/kingdee-k3cloud/references/` | 共用接口参考；领域资料归各自技能 |
| `.agents/skills/kingdee-skill-maintenance/SKILL.md` | 技能维护、流程整理与本地审计 |
| `.agents/skills/kingdee-sales-inventory/references/inventory-sales/negative-stock-sop.md` | 负库存 SOP |
| `AGENTS.md` | Agent 硬性规则 |

---

## 优化执行记录

| 日期 | 项 | 状态 |
|------|-----|------|
| 2026-07-09 | 凭据 env 化 | **跳过**（private） |
| 2026-07-09 | gitignore + scratch 约定 | 已做 |
| 2026-07-09 | AP_PAYABLE 客户端拦截 | 已做 |
| 2026-07-09 | lib/k3 统一导出 | 已做 |
| 2026-07-09 | 稳定 CLI ×3 | 已做 |
| 2026-07-09 | README + runbook | 已做 |
