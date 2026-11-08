# kingdee/ project map (本账套 K3 Cloud)

Root: `<REPO_ROOT>`

## Layout

```
kingdee/
├── AGENTS.md                 # hard rules (AP_PAYABLE, SQL ban, 写操作与调查方法)；领域 SOP 在本 skill references/（包含人工执行单）
├── k3cloud.js                # WebAPI client + credentials + DB constants
├── login_k3cloud.js          # connectivity smoke test
├── k3_utils.js / k3_*.js     # helpers / domain modules
├── lib/k3/                   # preferred import surface for new scripts
│   ├── index.js
│   ├── forms.js
│   └── status.js
├── scripts/tools/            # stable CLIs
├── scripts/scratch/YYYY-MM/  # one-off probes
├── scripts/bun_test/         # legacy hard-coded scripts
├── .agents/skills/           # business and skill-maintenance workflows
├── input/  output/ # 对账单 in / run artifacts out
└── package.json
```

## package.json scripts

| npm/bun script | Purpose |
|----------------|---------|
| `bun run login` | WebAPI login smoke test |
| `bun run search-bill -- <no>` | Find bill by number |
| `bun run delete-sfc -- <MO>` | Delete SFC plan (dry-run; `--apply` to run) |
| `bun run unfreeze-customer -- <code>` | Customer unfreeze (dry-run default) |
| `bun run test:safety` | AP_PAYABLE safety guard tests |

## Client API surface (k3cloud.js)

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

Credentials and DB passwords live in `k3cloud.js`. Point to field names (`K3_USERNAME`, `K3_BASE_URL`, …) when debugging; do not paste secrets into messages or new skills beyond “stored in k3cloud.js”.

## 参考与辅助工具治理（2026-10-13）

现行参考按 materials、customers、production、procurement、finance、inventory-sales、system 分目录；history/entry-extracts 保存旧入口摘录。目录是检索分类，不授予执行权限。案例仍在所属领域，保留日期、原对象和证据；不能把案例目标值当成通用默认值。

四个原技能辅助脚本已统一迁至仓库 scripts/tools/：material_template_diff.js、probe_fieldkeys.js、verify_kdpkg_packages.ps1、md_to_docx.py。命令在仓库根执行，不依赖技能工作目录。模板比对只覆盖投影字段和库存属性，缺值是未验证；探针不注入 FID，非明确候选字段错误时停止；补丁核对会创建临时提取目录但不修改源包；文档转换依赖 python-docx，交付仍需布局与内容核对。

本地回归：bun test ./scripts/tests/skill_helpers.test.js ./scripts/tests/audit_skills.test.js。模拟 API 验证不等于真实账套字段验证；测试报告必须区分本地与实时结果。
