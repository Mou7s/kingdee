# 连接与脚本运行约定

从技能入口移入（2026-10-13），环境状态复用前重新查询。安全与凭据管理以仓库 AGENTS.md 和 .agents/skills/kingdee-k3cloud/references/system/project-conventions.md 为准。

## Connectivity (prove, don't claim)

用户问「能连上吗 / 能取到数据吗」时：

1. **立刻实测**，不要先讲目录约定或「新脚本推荐写法」
2. 最短路径：

```bash
bun run login  # 在仓库根目录执行
```

3. 再跑 **一条** 真实业务查询（例如物料），用返回行证明能取数
4. 回复：**能/不能 + 一行环境摘要 + 可选样例数据**；等用户给单据号或业务场景

```js
// 最小取数示例（在 kingdee 根目录 bun -e 或临时脚本）
import { K3CloudWebAPI, FORMS } from "./lib/k3/index.js";
const c = new K3CloudWebAPI();
await c.login();
const rows = await c.executeBillQuery(
  FORMS.BD_MATERIAL,
  "FNumber,FName,FDocumentStatus",
  "FDocumentStatus = 'C'",
  5
);
console.log(rows);
```

登录后从当前响应核对数据中心、组织、用户与版本；本地历史环境快照见 `.agents/private/kingdee-system-admin/references/system/environment-historical-snapshot.md`（不纳入公开 Git），不能代替本次连接验证。

## Runtime

- **运行时**：Bun（`bun`），优先 JS/TS，尽量不用 Python
- **WebAPI**：`K3CloudWebAPI` 内网/外网并行探测后 `AuthService.ValidateUser`
- **凭据**：保存在本地未跟踪的 `k3cloud.local.json`（参考 `k3cloud.local.example.json`），由 `k3cloud.js` 加载；严禁将真实凭据硬编码进公开脚本或文档，也不要在聊天里复述密码
- **DB**：SQL Server 常量由 `lib/k3/index.js`（底层 `k3cloud.js`）统一导出（`K3_DB_*`）；正式单据禁止擅自 SQL 写（见 `AGENTS.md`）。只读脚本连库用 `mssql.connect({ server: K3_DB_HOST, user: K3_DB_USER, password: K3_DB_PASS, database: K3_DB_NAME, options: { encrypt: false, trustServerCertificate: true }, requestTimeout: 60000 })`——**不要开 `encrypt: true`**：tls 要求 `options.serverName` 而不能是 IP，直接报 `Setting the TLS ServerName to an IP address is not permitted` 连不上（除非另传 `options.serverName`）。传参必须用 `new mssql.Request().input(...)`——`mssql.query(sql, [params])` 会报 `Must declare the scalar variable`；库内查到的 GUID/编码可直接内联拼接（值不来自用户输入）。

## 数据库连接失败与外网复测（2026-11-07）

- 调查所需的数据库连接失败时，立即告知用户具体失败环节和对结论的影响，再继续检查现有外网配置；不要到最终报告才披露，也不要仅因内网失败就结束可继续的调查。
- WebAPI 外网地址与 SQL Server 外网映射是不同服务。读取既有配置核实 SQL 主机和端口；当默认内网 `K3_DB_HOST`（`<K3_INTRA_HOST>`）在外网环境不可达时，可优先尝试外网备用地址 `<K3_ALT_HOST>`（SQL Server 端口 `1433`，WebAPI `http://<K3_ALT_HOST>/k3cloud`），但**不修改 `k3cloud.local.json` 的默认内网配置**（用户明确约定 `<K3_ALT_HOST>` 为外网备用地址）。
- 注意本机开启 `Meta`（Clash TUN）虚拟网卡时，其会对不可达的局域网 IP（如 `<K3_INTRA_HOST>:80` / `1433`）秒回本地假 TCP 握手，之后在 HTTP 请求或 TDS 握手阶段报 `ECONNRESET` / `ETIMEOUT`。TCP 建连成功只证明传输层接受了连接；必须完成 SQL 登录并执行 `SELECT DB_NAME(),GETDATE()` 及一条真实只读业务查询后，才能称数据库已连通。记录尝试时间、端点、客户端、错误码与是否执行查询，不记录密码。
- 2026-11-07 实测验证：外网环境默认 `<K3_INTRA_HOST>:1433` 与 `<K3_EXTRA_HOST>:1433` 均不可达；用户提供的外网备用地址 `<K3_ALT_HOST>:1433` 在 VPN/内网路由未就绪时会报 `ESOCKET / ETIMEOUT`（见 `db-10-2-3-30-connection.json`、`direct-route-db-connection.json`），待网络路由就绪后通过 `<K3_ALT_HOST>:1433`（`encrypt: false, trustServerCertificate: true`）成功登录 `<SQL_SERVER_HOST>` / `<K3_MAIN_DB>` 并完成 `SELECT DB_NAME(),GETDATE()` 与 `T_CB_ACCTGPERFORMANCE` 只读查询，`http://<K3_ALT_HOST>/k3cloud` WebAPI 同样验证连通。注意 `<K3_ALT_HOST>` 仅作为外网备用候选端点，不改为全局默认值；复用前仍须先实测连通性。

## New scripts

续查时效说明（2026-11-07）：8月利润差额调查在10:09通过上述备用端点取得核算记录、实际分配过程等业务数据（`output/aug-profit-review-20261107/db-retry-latest.json`、`db-current-quantify.json`）；10:14起新连接再次超时，10:16复测仍为ETIMEOUT（`db-after-allocation-recheck.json`）。本调查未验证网络恢复或断开的具体原因；历史连通过不代表当前持续可用，连接中断须及时告知并保留已取得的证据，不将查询失败解释为无库存或无成本。

- 稳定工具 → `scripts/tools/`
- 一次性探测 → `scripts/scratch/YYYY-MM/`
- 导入：`import { K3CloudWebAPI, FORMS, ... } from "../../lib/k3/index.js"`（按深度调整相对路径）。相对深度按目录固定：`scripts/tools/` 下用 `../../`（`../../k3cloud.js` 或 `../../lib/k3/index.js`），`scripts/scratch/YYYY-MM/` 下多一层、用 `../../../`——把 tools 脚本（含 `lib/k3` 导入）的 import 原样贴进 scratch 会报 Cannot find module，改导入路径前先数目录层数。
- package 脚本：`bun run login` | `search-bill` | `delete-sfc` | `unfreeze-customer`

仅在用户要**写/改脚本**时展开约定；能力确认场景不要主动长讲。

