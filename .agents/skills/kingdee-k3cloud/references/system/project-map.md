# kingdee/ project map (本账套 K3 Cloud)

Root: `<REPO_ROOT>`

## Layout

```text
kingdee/
├── AGENTS.md                 # hard rules (AP_PAYABLE, SQL ban, 写操作与调查方法)
├── README.md                 # 快速开始、稳定入口、目录与技能导航
├── k3cloud.local.example.json # 连接凭据配置模板（本地复制为 k3cloud.local.json，gitignore 忽略）
├── k3cloud.js / k3_utils.js  # WebAPI client + DB constants / 基础工具（根级兼容入口）
├── login_k3cloud.js          # connectivity smoke test
├── lib/k3/                   # 新脚本优先使用的统一导入面
│   ├── index.js              # 统一导出 K3CloudWebAPI、K3_DB_*、FORMS、状态枚举与工具函数
│   ├── forms.js              # 常用业务对象 FormId 常量
│   └── status.js             # 单据/工序/业务状态枚举映射
├── scripts/
│   ├── tools/                # 稳定可复用的 CLI 与辅助工具（纳入 Git）
│   ├── tests/                # 本地安全与技能合规测试（不连接账套，纳入 Git）
│   ├── cases/                # 固定单号、固定期间与历史修复脚本（本地保留，gitignore）
│   ├── bun_test/             # 旧环境历史脚本（本地保留，gitignore）
│   └── scratch/YYYY-MM/      # 一次性探测与临时脚本（本地保留，gitignore）
├── .agents/
│   ├── skills/               # 8 个公开领域技能（SKILL.md + 通用 references/，纳入 Git）
│   └── private/              # 公司特定业务档案、晶圆配对模式与原始未脱敏案例（本地保留，gitignore）
├── input/  output/           # 外部输入对账单 / 运行输出、备份与归档（本地保留，gitignore）
└── package.json
```

## package.json scripts

| npm/bun script | Purpose |
|----------------|---------|
| `bun run login` | WebAPI login smoke test（只读验证连接） |
| `bun run search-bill -- <no>` | 跨采购、应付、生产、工序、销售、库存等表单查单 |
| `bun run list-employees` | 员工主数据列表查询（只读） |
| `bun run create-employee` | 新增员工主数据（默认 dry-run，`--apply` 执行） |
| `bun run rebind-user-link` | 用户与员工联系对象重绑（默认 dry-run） |
| `bun run rename-user-display` | 修改用户显示名称与部门（默认 dry-run） |
| `bun run delete-sfc -- <MO>` | 删除指定生产订单下的工序计划（默认 dry-run，`--apply` 执行） |
| `bun run unfreeze-customer -- <code>` | 客户解冻（默认 dry-run，`--apply` 执行） |
| `bun run uncancel-report -- <billNo>` | 工序汇报单反作废（默认 dry-run，`--apply` 执行） |
| `bun run auto-lock-dn` | 发货通知单自动锁库（默认 dry-run，`--apply` 执行） |
| `bun run check-patch` | 打补丁前采集版本/补丁记录/单据量基线（只读） |
| `bun run verify-patch` | 打补丁后与基线对比核验（只读） |
| `bun run backup-foshan` | 查看/创建分厂账套每日完整备份作业（默认 dry-run） |
| `bun run optimize-backup` | 查看/执行备份体系优化作业（默认 dry-run） |
| `bun run test:safety` | `AP_PAYABLE` 客户端安全拦截与发送路径单测 |

## Client API surface (`lib/k3/index.js` / `k3cloud.js`)

Common methods used in-session:

- `login()` — probe intranet then extranet, `AuthService.ValidateUser`
- `executeBillQuery(formId, fieldKeys, filterString, topRowCount)`
- `viewBill(formId, billId)`
- `saveBill` / `submitBill` / `auditBill` / `unAuditBill` / `deleteBill` (plus ops as defined in file)

Service URL pattern:

`{baseUrl}/Kingdee.BOS.WebApi.ServicesStub.{ServiceName}.common.kdsvc`

## Connectivity proof (verified 2026-08)

- Login OK → 示例电子有限公司 / 管理员A / ~9.0.280.x
- `executeBillQuery("BD_MATERIAL", ...)` returns real material rows
- `PRD_PickMtrl` 今日领料可查（需 `OrderString`/`FDate` 过滤，否则默认最旧单）— 见 `../kingdee-production/references/production/production-forms.md`

## Client note: ordered queries

`K3CloudWebAPI.executeBillQuery` 不暴露 `OrderString`。要「最近/按日」用：

```js
await client.post("DynamicFormService.ExecuteBillQuery", {
  data: { FormId, FieldKeys, FilterString, OrderString, TopRowCount, StartRow, Limit },
});
```

## Do not duplicate in chat

Credentials and DB passwords live in local untracked `k3cloud.local.json` (loaded by `k3cloud.js` and re-exported via `lib/k3/index.js`). Point to field names (`K3_USERNAME`, `K3_BASE_URL`, `K3_DB_HOST`, …) when debugging; never paste real secrets or private host IPs into messages, scripts, or public skills.

## 参考与辅助工具治理（2026-11-08 更新）

现行公开参考按领域归属到各技能的 `references/` 下（`materials/`、`customers/`、`inventory-sales/`、`production/`、`procurement/`、`finance/`、`system/`）；公司特定业务档案与旧入口摘录保存在 `.agents/private/<skill>/`（含各私有目录 `INDEX.md`）。目录是检索分类，不授予执行权限。案例仍在所属领域，保留日期、原对象和证据；不能把案例目标值当成通用默认值。

四个通用技能辅助脚本位于仓库 `scripts/tools/`：`material_template_diff.js`、`probe_fieldkeys.js`、`verify_kdpkg_packages.ps1`、`md_to_docx.py`。命令在仓库根执行，不依赖技能工作目录。模板比对只覆盖投影字段和库存属性，缺值是未验证；探针不注入 FID，非明确候选字段错误时停止；补丁核对会创建临时提取目录但不修改源包；文档转换依赖 python-docx，交付仍需布局与内容核对。

本地回归：`bun test ./scripts/tests/skill_helpers.test.js ./scripts/tests/audit_skills.test.js`。模拟 API 验证不等于真实账套字段验证；测试报告必须区分本地与实时结果。
