# 工序汇报「合格数量合计不超过工序数量的 N 倍」二开规格（比例上限控制）

## 目录

- 一、为什么必须二开
- 二、数据口径（实测，务必照抄）
- 三、校验规则
- 四、参考实现（C# 服务插件）
- 五、注册与部署
- 六、参数化与开关（强烈建议）
- 七、必须提醒业务确认的边界
- 八、存量数据与上线顺序
- 九、测试用例
- 十、参考
- 十一、在 BOS 校验规则里加"生效起点"（2026-09-17 实证，先看这节再动手）

> 目标：同一道工序（工序计划工序行）的**所有工序汇报单合格数量合计**不允许超过该工序「工序数量」的 **190%**，用于防止重复交料。
> 本文的字段、表名、状态码与口径均已在本账套账套 `<K3_MAIN_DB>` 实测验证（2026-09-17），可直接交给二开人员。

配套只读工具：`scripts/tools/check_over_report.js`（默认近 90 天、比例 1.9；支持 `--ratio --days --plan --top --out`）。历史取数耗时不作为性能保证。

先查当前分布再建议开关：2026-09-17 样本中 `100%~150%` 有两万多条，直接切换 100% 严格控制会拦正常报工。比例和是否启用须按当前业务确认。

## 一、为什么必须二开

| 方案 | 能力 | 结论 |
| --- | --- | --- |
| 工序计划单据类型参数 `FRptQtyControl`「报工数量允许大于订单」 | 只有 `A 不控制 / B 警告 / C 严格控制` 三档，**无比例** | 做不到 190% |
| BOS 校验规则（ConditionValidation） | 只能比较**本单字段**，无法跨单汇总 | 做不到 |
| **二开插件（本文）** | 可查库汇总同一工序全部汇报单 | ✅ 唯一可行 |

补充：全账套元数据（10,614 个表单）中「报工数量」只出现在工序计划单据类型参数与两个 PDA 表单，含「超汇报」的表单为 0 个——标准产品确实没有比例字段。

## 二、数据口径（实测，务必照抄）

### 关联链路

```sql
T_SFC_OPTRPTENTRY e            -- 工序汇报单分录（FOPTPLANOPTID 指向工序行）
  JOIN T_SFC_OPTRPT h          ON h.FID = e.FID                      -- 汇报单表头
  JOIN T_SFC_OPTRPTENTRY_A a   ON a.FENTRYID = e.FENTRYID            -- 数量在 _A 表
  JOIN T_SFC_OPERPLANNINGDETAIL d ON d.FDETAILID = e.FOPTPLANOPTID   -- 工序数量在这里
```

> ⚠️ **不要用 `T_SFC_OPERPLANNINGDETAIL.FENTRYID = 工序计划表头 FID` 关联工序行**。明细必须经 `T_SFC_OPERPLANNINGSEQ`：`SEQ.FID = 表头.FID`，`DETAIL.FENTRYID = SEQ.FENTRYID`。按直觉关联会静默取到**别的工序计划**的工序行，数量全错（2026-09-17 实测踩过）。

### 字段表

| 含义 | 表/字段 | 说明 |
| --- | --- | --- |
| 合格数量（工序单位） | `T_SFC_OPTRPTENTRY_A.FQUAQTY` | 界面「合格数量」 |
| 合格数量（基本单位） | `_A.FBASEQUAQTY` | 建议比较时用基本单位 |
| 合格数量（生产单位） | `_A.FPRDQUAQTY` | |
| 工序行 | `T_SFC_OPTRPTENTRY.FOPTPLANOPTID` | = `T_SFC_OPERPLANNINGDETAIL.FDETAILID` |
| 工序计划表头 / 序列 | `FOPTPLANID` / `FOPTPLANSEQID` | |
| 工序计划号 / 工序号 | `FOPTPLANNO` / `FOPERNUMBER` | |
| 是否返修汇报 | `FISREWORKRPT` | 本账套近 3 个月全为 `0`（无返修汇报） |
| 汇报类型 | `FREPORTTYPE` | `HBLX01_SYS` 正常生产 |
| **工序数量（基数）** | `T_SFC_OPERPLANNINGDETAIL.FOPERQTY` | 界面「工序数量」，非表头 `FMOQTY` |
| 工序单位 | `T_SFC_OPERPLANNINGDETAIL.FOPERUNITID` | 与汇报分录单位一致时可直接比 |
| 已审核反写台账 | `T_SFC_OPERPLANNINGDETAIL_B.FREPORTQTY / FQUALIFIEDQTY` | 可作为交叉校验，**不要**作为唯一来源（未审核单不计入） |
| 单据状态 | `T_SFC_OPTRPT.FDOCUMENTSTATUS` | `A` 草稿 / `B` 审核中 / `C` 已审核 / `D` 重新审核 |
| 作废状态 | `T_SFC_OPTRPT.FCANCELSTATUS` | `A` 正常 / `B` 已作废（作废单**不计入**） |

### 取值方式

WebAPI 侧（用于取数核对）：`viewBill("SFC_OperationReport", fid).OptRptEntry[]`，字段名 `QuaQty / BaseQuaQty / OptPlanOptId / OperNumber / OptPlanNo / IsReworkRpt`。
写侧（Save）：分录实体键是 **`FEntity`**。

## 三、校验规则

对本次操作涉及的每一张工序汇报单：

1. 按 `FOptPlanOptId` 汇总**本单**各分录的合格数量 → `Local[optId]`
2. 对每个 `optId`：
   - `Q` = 工序数量（`FOPERQTY`）
   - `S` = 同一 `optId` 下**其它有效汇报单**的合格数量合计
     - 有效 = `FCANCELSTATUS <> 'B'` 且 `FDOCUMENTSTATUS IN ('A','B','C')`
     - 且 `FID <> 当前单据 FID`（修改/反审核重提交时不能把自己算两遍）
   - `Limit = Q × 比例`（比例默认 `1.9`）
   - 若 `S + Local[optId] > Limit` → 抛业务异常，整单不保存/不提交/不审核

异常文案建议（带出证据，便于车间自查）：

```
工序【{工序名称}】合格数量合计 {S+Local} 将超过上限 {Limit}（工序数量 {Q} × 190%），
已汇报 {S}、本单 {Local}；工序计划 {计划号} 第 {工序号} 工序，请核对是否重复交料。
```

### 校验点

| 操作 | 是否校验 | 理由 |
| --- | --- | --- |
| 保存 Save | 建议只做**提示**（或同样拦截） | 草稿也占额度时必须在保存就拦，否则两人各存 100% 再提交 |
| 提交 Submit | **必须** | 进入有效状态即占额度 |
| 审核 Audit | **必须**（兜底） | 防并发：两人同时提交都通过，审核时再比一次 |

## 四、参考实现（C# 服务插件）

以下为待联调骨架，不代表已编译、已部署或并发正确性已验证。示例使用显示单位；存在换算时须统一基本单位（`FBASEQUAQTY` 与 `FOPERHEADBASEQTY`），再在测试环境验证。

插件类型：`AbstractOperationServicePlugIn`（服务插件），注册到工序汇报的 保存/提交/审核 操作。

```csharp
using System;
using System.Collections.Generic;
using Kingdee.BOS;
using Kingdee.BOS.App.Data;
using Kingdee.BOS.Core.DynamicForm.PlugIn;
using Kingdee.BOS.Core.DynamicForm.PlugIn.Args;
using Kingdee.BOS.Orm.DataEntity;

namespace TK.MFG.SFC.PlugIn
{
    public class OptRptOverRateControl : AbstractOperationServicePlugIn
    {
        private const decimal DefaultRatio = 1.9m;   // 建议改为读自定义参数/基础资料

        public override void OnPreparePropertys(PreparePropertysEventArgs e)
        {
            base.OnPreparePropertys(e);
            // 缺一行就会取到 null —— 最常见的坑
            e.FieldKeys.Add("FBillNo");
            e.FieldKeys.Add("FOperNumber");
            e.FieldKeys.Add("FOptPlanNo");
            e.FieldKeys.Add("FOptPlanOptId");
            e.FieldKeys.Add("FQuaQty");
            e.FieldKeys.Add("FBaseQuaQty");
            e.FieldKeys.Add("FIsReworkRpt");
        }

        public override void BeginOperationTransaction(BeginOperationTransactionArgs e)
        {
            base.BeginOperationTransaction(e);
            decimal ratio = GetRatio(this.Context);   // 默认 1.9

            foreach (DynamicObject bill in e.DataEntitys)
            {
                var entries = bill["OptRptEntry"] as DynamicObjectCollection;
                if (entries == null || entries.Count == 0) continue;
                long curFid = Convert.ToInt64(bill["Id"]);

                // 1) 本单按工序行汇总
                var local = new Dictionary<long, decimal>();
                foreach (DynamicObject row in entries)
                {
                    if (row["IsReworkRpt"] != null && Convert.ToBoolean(row["IsReworkRpt"])) continue; // 返修口径按业务确认
                    if (row["OptPlanOptId"] == null) continue;
                    long optId = Convert.ToInt64(row["OptPlanOptId"]);
                    decimal q = Convert.ToDecimal(row["QuaQty"]);
                    local[optId] = local.ContainsKey(optId) ? local[optId] + q : q;
                }

                // 2) 逐工序比对
                foreach (var kv in local)
                {
                    decimal operQty = QueryDecimal(this.Context, string.Format(@"
                        /*dialect*/SELECT ISNULL(FOPERQTY,0) FROM T_SFC_OPERPLANNINGDETAIL WHERE FDETAILID={0}", kv.Key));

                    if (operQty <= 0) continue;   // 工序数量为 0/空 的历史单不拦，避免误杀

                    decimal reported = QueryDecimal(this.Context, string.Format(@"
                        /*dialect*/SELECT ISNULL(SUM(A.FQUAQTY),0)
                        FROM T_SFC_OPTRPTENTRY E
                        JOIN T_SFC_OPTRPT H ON H.FID = E.FID
                        JOIN T_SFC_OPTRPTENTRY_A A ON A.FENTRYID = E.FENTRYID
                        WHERE E.FOPTPLANOPTID = {0} AND H.FID <> {1}
                          AND H.FDOCUMENTSTATUS IN ('A','B','C')
                          AND ISNULL(H.FCANCELSTATUS,'A') <> 'B'", kv.Key, curFid));

                    decimal limit = operQty * ratio;
                    if (reported + kv.Value > limit + 0.000001m)
                    {
                        throw new KDBusinessException("OptRptOverRate",
                            string.Format("工序行 {0} 合格数量合计 {1} 将超过上限 {2}（工序数量 {3} × {4:P0}），已汇报 {5}、本单 {6}，请核对是否重复交料。",
                                kv.Key, reported + kv.Value, limit, operQty, ratio, reported, kv.Value));
                    }
                }
            }
        }

        private static decimal QueryDecimal(Context ctx, string sql)
        {
            object v = DBServiceHelper.ExecuteScalar(ctx, sql);
            return (v == null || v == DBNull.Value) ? 0m : Convert.ToDecimal(v);
        }

        private static decimal GetRatio(Context ctx)
        {
            // TODO: 从自定义基础资料/自定义参数读取；读不到时返回 DefaultRatio
            return DefaultRatio;
        }
    }
}
```

要点：

- **SQL 必须带 `/*dialect*/` 前缀**，`DBServiceHelper` 才会做数据库方言转换。
- `OnPreparePropertys` 不注册字段 → 取值得到 `null`，校验会静默失效（第一次联调必查这一项）。
- 用 `BeginOperationTransaction`（事务内、可回滚）；不要放到 `EndOperationTransaction`。
- 异常类型用 `KDBusinessException`，前端会弹中文提示；`ValidationException` 也能用。

### Python 插件替代（免编译）

BOS 设计器 → 工序汇报 → 插件 → 单据插件 → Python 插件，按 IDE 模板在对应事件函数里实现同样的逻辑，取数用
`Kingdee.BOS.App.Data.DBServiceHelper.ExecuteScalar(this.Context, sql)`（SQL 同样要 `/*dialect*/`）。
逻辑不复杂，但调试与可维护性弱于 C#；正式环境建议 C#。

## 五、注册与部署

1. BOS 设计器 → 打开【工序汇报】`SFC_OperationReport`（签出状态）
2. 单据插件/服务插件 → 新增 → 选择编译好的 `TK.MFG.SFC.PlugIn.dll` 与类 `OptRptOverRateControl`
3. 绑定操作：**保存 `Save`、提交 `Submit`、审核 `Audit`**
4. 保存 → 签入 → 部署 dll 到应用服务器 → 重启站点/应用池
5. 先在**测试账套**（或开发环境）验证，再上正式

## 六、参数化与开关（强烈建议）

- 比例、是否启用不要硬编码：建一条自定义基础资料/自定义参数（例如 `Z_OverReportParam`：`FEnable`、`FRatio`、`FRemark`），插件读取并缓存；出问题时可一键关掉校验，不必重新部署。
- 默认 `1.9`；后续业务要改成 150% 直接改参数即可。

## 七、必须提醒业务确认的边界

1. **返修汇报**：本账套近 3 个月 `FISREWORKRPT` 全部为 `0`，暂无数据。若以后启用返修汇报，返修数量是否占用 190% 额度必须单独约定（本例默认跳过返修行）。
2. **委外工序**：集中发出/接收会反写台账合格数量，但**不产生工序汇报单**。如果 190% 也要管委外接收数量，插件必须额外汇总 `T_SFC_OPEROUTGRENTRY` 等表，否则口径会漏。当前版本只管工序汇报。
3. **单位**：`FQUAQTY` 与 `FOPERQTY` 同为工序单位（实测 `K`）。若某工序存在单位换算，应改用基本单位（`FBASEQUAQTY` / `FOPERHEADBASEQTY`）比较。插件里建议直接统一用基本单位。
4. **工序数量为 0/异常小**：现存大量工序数量被写成 `0.072`、`1`（汇报却是 90+）的计划。插件对 `FOPERQTY <= 0` 跳过不拦；对"异常小"无法自动识别，只能靠存量清单人工处理（见第八节）。
5. **并发**：两人同时提交同一工序，各自校验都可能通过。审核时再校验一次可挡住绝大多数；要绝对严格需在事务里加锁（`UPDLOCK`），代价较高，一般不需要。

## 八、存量数据与上线顺序

上线前先跑只读清单（同口径）：

```bash
bun scripts/tools/check_over_report.js --ratio 1.9 --days 90 --top 100
```

- 近 3 个月（2026-06-17 起）已审核工序汇报，逐工序比率分布：`≤100% 158,753`、`100~150% 20,158`、`150~190% 869`、`190~210% 317`、`210~300% 525`、`>300% 718`。
- 用本工具跑近 90 天（含草稿口径）：区间内有汇报的工序 177,754 条，`>190%` 的 **1,524 条**（0.86%）。
- 因此建议顺序：① 出清单交业务核实 → ② 业务确认阈值与口径 → ③ 测试账套开发验证 → ④ 正式上线（带参数开关）→ ⑤ 观察 1~2 周。
- 反审核后重新提交的历史单也会被校验；上线前要明确这些单是"先处理完再上线"还是"白名单放行"。

## 九、测试用例

| # | 场景 | 期望 |
| --- | --- | --- |
| 1 | 单张汇报 合格 = 工序数量的 100% | 通过 |
| 2 | 同一工序两张单各 100%（合计 200%） | 第二张提交/审核被拦，提示合计与上限 |
| 3 | 一张单内两行指向同一工序，合计超限 | 被拦 |
| 4 | 合计正好 190%（边界） | 通过 |
| 5 | 合计 190.001% | 被拦 |
| 6 | 反审核原单后改小数量再提交 | 通过（本单已排除，不会重复计算） |
| 7 | 作废（`FCANCELSTATUS='B'`）的单 | 不计入合计 |
| 8 | 工序数量为 0 或空的历史单 | 不拦（走跳过分支） |
| 9 | 参数开关关闭 | 不校验 |
| 10 | 多条分录跨不同工序计划 | 各工序独立判断，互不影响 |

## 十、参考

- 只读清单工具：`scripts/tools/check_over_report.js`
- SFC 表关联键与报工数量控制口径：`lib/k3` 项目内 `.agents/skills/kingdee-k3cloud/references/system/k3cloud-fields-reference.md`，以及技能 `kingdee-k3cloud` 的 `references/production/sfc-operation-sql-keys.md`

## 十一、在 BOS 校验规则里加"生效起点"（2026-09-17 实证，先看这节再动手）

用户要在 BOS 设计器「表单服务-规则设置」的单据合法性校验里给规则加时间切分（如"今天之前做的生产订单不校验"）时：

1. **切分只能写进「前置条件」**，不要拼进「表达式」。前置条件不满足时整条校验不执行；表达式里 `... AND FMoNumber` 这种把编号当布尔值的写法恒为真，等于没条件。
2. **引擎是 Python 味，但"文本字段与文本常量做范围比较"全账套零先例**：
   - 官方/社区口径：文本字段用 `=` / `<>` / `文本.find('X')>=0` / 切片 `文本[0:3]`；日期字段**不能直接与字符串常量比较**，要 `日期.ToString('yyyy-MM-dd')`（日期与日期型系统变量可直接比，如 `FDate >= @currentshortdate`、`FDate < @getstkclosedate`）；`int(x)` 把文本转整数是官方二开示例。
   - 实测：10,614 张表单元数据里带引号常量 + 范围运算符（`> < >= <=`）的 `Express/PreCondition` 共 **726 条，其中文本常量参与范围比较的 0 条**；唯一像样的 `FIntervalTimeByDay >= '01:00:00'` 是**时间字段**且 `IsUsed=False`。**别把文本 `>=` 当已确认写法。**
3. **推荐写法（只用有文档先例的构件：切片 + `int()` + 数字比较）**：生产订单号是 `MO` + `YYMMDD` + 流水，所以
   `int(FMoNumber[2:8]) >= 260917`（260917 = 2026-09-17 的 YYMMDD）；备选是文本比较 `FMoNumber >= 'MO260917'`（数据口径等价，但无先例）。
4. **数据核对（做切分前必查，本账套实测）**：
   - MO 单号日期段 == 生产订单单据日期：16,666 张 MO 只差 1 张（`MO260624026` 单号 06-24、单据日期被录成 2029-06-24 的脏数据）。
   - 汇报单分录 `T_SFC_OPTRPTENTRY.FMONUMBER` 三种格式：11 位 `MO260917051`（85.2 万行）、8 位旧格式 `MO000154`（3.9 万行）、12 位 `MO000102-001`（0.67 万行）；无空值、第 3–8 位全为数字（0 行转不了数字），三种格式切片后都落在预期分支（旧格式流水号远小于 260917 → 判老单）。
   - **口径要提醒用户**：今天录入的汇报单挂在几周前下的订单上（2026-09-17 实测当天 1,667 条分录，订单号 ≥ `MO260917` 的 **0 条**）。按生产订单切分 = 规则对在制老单几乎不触发；要拦在制老单的重复交料只能改汇报单日期口径（`FDate.ToString('yyyy-MM-dd') >= '2026-09-17'`，日期必须 `ToString`）。
5. **语法只能由用户在设计器点「表达式测试」确认**（本地无法验证）；让用户把报错原文发回再改，不要凭猜测反复给方案。2026-09-17 反馈：按第 3 条推荐写法实测通过（现场配置为准，文本比较备选是否可用未验证）。
