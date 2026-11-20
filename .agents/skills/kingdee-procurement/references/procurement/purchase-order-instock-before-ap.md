# 标准采购订单"先入库再下推应付"的卡控核查

> 来源：2026-11-09 用户问「标准采购订单要做入库才能下推应付单 可以实现吗」。以下为当日本账套只读实测。

## 目录

- [结论](#结论)
- [现状证据](#现状证据)
- [为什么仍可能被绕过](#为什么仍可能被绕过)
- [三种落地方式与取舍](#三种落地方式与取舍)
- [费用/资产采购不要误伤](#费用资产采购不要误伤)
- [复现查询](#复现查询)

## 结论

可以实现，而且本账套的标准采购业务**已经按此配置运行**：业务流程 `Pur_Order01` 中，应付单节点只与入库单（和退料单）相连，采购订单、收料单都没有直连应付单的流程线。2026 年也没有出现来源为采购订单或收料单的应付单。

但"业务流程图"只约束前端下推/选单链路，**单据转换规则仍启用**，接口按 `RuleId` 下推或某些选单入口仍可绕过。要"硬卡死"需再处理转换规则或加校验。

## 现状证据

1. 标准采购订单 = `PUR_PurchaseOrder` + 单据类型 `CGDD01_SYS` + 业务类型 `CG`。`T_PUR_POORDER` 中该单据类型 16210 张，`FBUSINESSTYPE` 全部为 `CG`。
2. 已发布业务流程 `Pur_Order01`（`T_BF_PUBLISH.FID=80044`，`FDOCUMENTSTATUS=A`、`FFORBIDSTATUS=A`），对 `CGDD01_SYS` 有两个版本，节点与连线（`T_BF_DEFVERSION.FKERNELXML`）：

   | 版本 | 节点 | 连线 |
   |---|---|---|
   | `a6d79725-…` | 1 采购订单、53 收料单、54 入库单、55 应付单、56 退料单 | 1→53、53→54、**54→55**、56→55、1→54、1→56 |
   | `5e877141-…` | 1 采购订单、40 收料单、41 入库单、42 应付单、43/44 退料 | 1→40、40→41、**41→42**、1→43、43→44、44→42 |

   两个版本都**没有** 1→应付、收料→应付的连线；应付只能从入库单或退料单进入。`a6d79725` 版另有 1→54（采购订单直接下推入库单），即收料环节可跳，但入库仍在前。
3. 转换规则（`T_META_CONVERTRULE`，`FSTATUS='1'` 启用）：
   - `AP_PurOrderToPayable`、`AP_PurOrderToPayableZT`：`PUR_PurchaseOrder → AP_Payable`
   - `AP_ReceiveToPayableMap`、`c79b5096-…`：`PUR_ReceiveBill → AP_Payable`
   - `AP_InStockToPayableMap`、`13be37be-…`：`STK_InStock → AP_Payable`
   - 采购订单还有 `PUR_PurchaseOrder-STK_InStock`（订单直接入库）。
4. 实际发生量：`T_AP_PAYABLE` 2026-01-01～2026-11-30，`FSOURCEBILLTYPE` 为 `PUR_PurchaseOrder` 或 `PUR_ReceiveBill` 的应付单为 **0 张**；类型 3 财务应付 1489 张，来源多为空（暂估转财务、结算/手工生成）。

## 为什么仍可能被绕过

- 业务流程控制的是"下推/选单"的节点链；`DynamicFormService.Push` 显式带 `RuleId`（如 `AP_PurOrderToPayable`）仍可生成应付，绕过流程图。
- 应付单"新增→选单"是否受流程约束取决于单据类型与流程绑定；转换规则启用时，选单来源里仍可能出现采购订单/收料单。
- 因此"图上没有连线"≠"数据库层面不可能生成"。

## 三种落地方式与取舍

| 方式 | 做法 | 效果 | 代价 |
|---|---|---|---|
| A. 停用转换规则（最直接） | 将 `AP_PurOrderToPayable`、`AP_PurOrderToPayableZT` 置 `FSTATUS='0'` | 采购订单不能再生成应付；前端下推与接口同时失效 | 影响所有采购订单业务类型，需确认无"货到票到/直运"场景 |
| B. 业务流程 + 单据类型区分（推荐组合） | 保留 A，再确认 `Pur_Order01` 为启用流程且应付单节点唯一前驱为入库单 | 前端与流程一致，可审计 | 仍需处理选单入口；费用/资产另走各自流程 |
| C. 表单/转换插件校验（最硬） | 应付单保存校验：来源为 `PUR_ReceiveBill` 且上游采购订单业务类型 `CG` 时拒绝 | 任何入口都拦得住 | 需二开维护，升级前要评估 |

推荐 A+B，C 仅在需要"绝对不允许"时加。改动是元数据写操作，须先在测试账套验证，并取得用户对具体规则的授权。

## 费用/资产采购不要误伤

- 费用采购订单 `CGDD05_SYS`（`FYCG`）流程 `81ed256a-…`：1→125 收料、**125→126 应付**、125→127 入库。收料直接下推应付是合法路径。
- 资产采购订单 `CGDD04_SYS` 流程 `02445845-…`：1→88 收料、**88→89 应付**、88→98 入库。
- 因此**不能**简单停用 `AP_ReceiveToPayableMap`（收料→应付）；该规则被费用/资产采购共用。若标准采购也要禁止收料直推应付，只能走方式 C 或按单据类型拆分规则。

## 复现查询

```sql
-- 流程节点与连线
SELECT FID, CAST(FKERNELXML AS NVARCHAR(MAX)) AS X
FROM T_BF_DEFVERSION
WHERE FID IN ('a6d79725-e25a-482a-a449-a867367c2b97','5e877141-92dd-497b-b654-255e40775d0d');

-- 流程绑定单据类型
SELECT p.FID, p.FNUMBER, e.FBILLTYPEID, e.FBFVERSIONID
FROM T_BF_PUBLISH p JOIN T_BF_PUBLISHENTRY e ON e.FID = p.FID
WHERE p.FENTRYFORMID = 'PUR_PurchaseOrder';

-- 应付来源规则
SELECT FID, FSOURCEFORMID, FTARGETFORMID, FSTATUS, FISDEFAULT
FROM T_META_CONVERTRULE
WHERE FTARGETFORMID = 'AP_Payable' AND FSOURCEFORMID IN ('PUR_PurchaseOrder','PUR_ReceiveBill','STK_InStock');

-- 实际来源分布
SELECT FSOURCEBILLTYPE, FSETACCOUNTTYPE, COUNT(*) cnt
FROM T_AP_PAYABLE WHERE FDATE >= '2026-01-01'
GROUP BY FSOURCEBILLTYPE, FSETACCOUNTTYPE;
```

证据文件：`output/2026-11-09-ap-push-flow/flow-*.xml`；探针脚本：`scripts/scratch/2026-11/probe-ap-push-flow*.js`。
