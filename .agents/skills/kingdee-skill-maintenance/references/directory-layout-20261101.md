# 2026-11-01 项目目录整理

用户授权：落实目录评估提出的全部四项调整；不包含真实账套业务操作。

## 归属与迁移

- scripts/tools/ 保留可复用 CLI 和辅助工具；51 个固定对象、固定期间、历史前值或 SQL 修复脚本迁到 scripts/cases/。既有业务实现未重写，复用仍须审阅及逐案授权。
- 三个本地测试迁到 scripts/tests/，同步修正工具导入、package.json 和技能验证命令；test_db_join.js 是账套探测，归 cases/，不作为本地测试运行。
- tmp/ 的 124 个文件和 outputs/ 的 5 个文件分别保留到 output/archive/tmp/ 与 output/archive/outputs/，不删除证据。output/ 为忽略目录，原先被跟踪的产物在差异中表现为删除，目标文件仍在本地；需要共享证据时另行明确导出。
- .gitignore 补齐旧目录及 Python 缓存规则。README 和项目约定移除不存在的根级 k3_outsourcing.js、CLAUDE.md 入口；bun_test/ 作为旧环境兼容约定保留。

## 验证与证据

修改前备份到 output/structure-before-20261101/files/，before.json 保存原路径与 SHA-256，moves.json 保存 183 个文件的路径映射。逐文件比较迁移前后内容，业务脚本仅更新显式仓库路径；不运行个案脚本验证迁移。

运行技能结构和静态选路审计、scripts/tests/ 下的本地回归、bun run test:safety、git diff --check，并静态检查本地相对导入。静态检查不能证明个案脚本可安全执行业务操作。历史绝对 Windows 路径及旧业务实现不因本次迁移得到认证。

核验结果：183 个目标文件全部存在，149 个逐字节一致，34 个仅发生上述路径或测试导入替换；tools/tests/cases 的静态本地相对导入无缺失。19 项本地回归、19 项应付安全检查、全技能审计与静态选路、git diff --check 通过。未连接账套、未提交或推送。
