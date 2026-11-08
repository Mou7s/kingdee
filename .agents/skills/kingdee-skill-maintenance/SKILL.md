---
name: kingdee-skill-maintenance
description: >-
  整理 kingdee 项目的技能职责、参考归属、重复流程和跨技能引用，并验证任务选路。用于技能拆分、流程沉淀、失效引用修复与技能组织审计；业务操作使用对应领域技能。
---

# 技能维护

## 职责与组织

- AGENTS.md 保存全仓库规则；七个业务技能按 README 职责划分；公开方法与通用字段放 `.agents/skills/<skill>/references/`，公司专属配对模式/画像与未脱敏原始案例放 `.agents/private/<skill>/`（gitignore 忽略）；稳定工具放 `scripts/tools/`，个案脚本放 `scripts/cases/`（gitignore 忽略），本地测试放 `scripts/tests/`；产物统一放 `output/`。
- 共用连接、查单和元数据归 kingdee-k3cloud；物料/BOM、生产、采购委外、销售库存客户、财务、系统运维分别归对应技能。
- 按任务完成流程及风险边界归属，不按每个客户、单据或案例创建技能。跨领域任务组合读取技能，共用资料只维护一份。
- SKILL.md 只写触发、必要步骤、关键判断及带适用条件的索引；每个公开 reference 从所属技能直接可达，私有档案在「本地私有档案」段指向 `.agents/private/<skill>/`。历史案例标明日期与现行流程入口。

## 维护步骤

1. 检查 git 状态及相关规则；只读评估时交付问题与建议，不执行迁移或删除。
2. 修改前逐字节备份将改文件到 output/，记录哈希和原路径；未经授权不提交或推送。
3. 建立原路径→目标路径映射；纯搬移验证正文除引用更新外一致，改写入口逐项核对原有安全边界和独特约束。
4. 同主题确定一份现行流程；历史证据保留并指向现行流程。修改归属同时更新全部调用路径和 README，跨技能 reference 相对技能根解析。
5. 运行结构和选路审计、辅助工具回归、安全测试与 diff 检查。审计不能证明业务事实或生产操作已验证。
6. 说明职责变化、迁移数量、备份及验证限制。用户纠正或可复用新流程应同步更新所属技能，不能只记在本入口。

## 验证

```bash
bun scripts/tools/audit_skill_routes.js
bun test ./scripts/tests/audit_skills.test.js ./scripts/tests/skill_helpers.test.js
bun run test:safety
git diff --check
```

典型任务须检查：普通查单选择共用技能；晶圆配对建料选择物料技能并检查蓝膜 BOM；跨月对账选择财务技能且财务应付保留草稿；客户解冻选择销售客户技能且不扩展 SQL 字段；只读任务不执行写入，写入不确定时停止。

## 按需参考

- `references/migration-history.md` — 机械拆分、逐字节校验、历史清理及 2026-10-17 文档迁移的证据与限定条件。
- `references/restructure-20261101.md` — 本次职责拆分、迁移验证和典型任务选路依据。

- `references/directory-layout-20261101.md` — 脚本、测试与产物目录迁移及核验方法。
