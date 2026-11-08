# 工序计划机台号筛查（全部工序带机台号）

用于用户说“给我一个工序计划号，这个计划里所有工序都有机台号”。只读查询，不写操作。

## 0. 先登录（否则报会话丢失）

`new K3CloudWebAPI()` 后必须先 `await api.login()`，再做任何 `executeBillQuery` / `viewBill`。
不登录直接查会报 `会话信息已丢失，请重新登录`（本会话 2026-09-03 实测）。

```js
import { K3CloudWebAPI } from "./lib/k3/index.js";
const api = new K3CloudWebAPI();
await api.login();
```

## 1. 列工序计划（取 FID + 单号）

```js
const rows = await api.executeBillQuery(
  "SFC_OperationPlanning",
  "FID,FBillNo,FMONumber,FDocumentStatus",
  "",
  50
);
```

- 无 `OrderString` 时默认约等于最旧数据；要最近/指定范围时用 `post("DynamicFormService.ExecuteBillQuery", { data: { …, OrderString: "FBillNo DESC" } })`。
- `TopRowCount` 会截断，大范围筛查时放大并按 `FID` 去重。

## 2. 机台号字段位置（2026-09-03 纠正：不在计划上，在汇报上）

用户口中的“机台号”实测为工序汇报 `T_SFC_OPTRPTENTRY.F_MECHINE_NUM`（注意拼写 MECHINE，非 MACHINE），伴生 `F_PAN_NUM`。例 `TX083735` 仅 `90 测试分选` 有 `F_MECHINE_NUM='4'/F_PAN_NUM=4`，其余工序为空串/0。

不要再按 `SFC_OperationPlanning.SubEntity.ResourceId/EquipmentId` 筛查：该账套 `T_SFC_OPERPLANNINGDETAIL_A.FRESOURCEID/FEQUIPMENTID` 全库 125,443 张全 0（`FResourceId>0` 查询 0 行），`View` 也全 0。旧流程（dump SubEntity 找机台键）已证伪，保留仅作排除证据。

正确关联键：汇报用 `FOPTPLANID = 计划FID`，**不用 `FOPTPLANNO=FBillNo`**。`T_SFC_OPERPLANNING.FBILLNO` 不唯一（`TW010385` 同时对应 `FID 116647/MO250118011` 与 `FID 180038/MO260103025`），按单号关联会串户。

```sql
-- 某计划每工序机台（只读）
SELECT FOPERNUMBER, F_MECHINE_NUM, F_PAN_NUM
FROM T_SFC_OPTRPTENTRY WHERE FOPTPLANID=<FID> ORDER BY FOPERNUMBER;
-- 全覆盖判定：计划明细数 = 去重非空机台工序数
-- 全库实测（2026-09-03）：全覆盖 0 张；最多 2 道有机台
-- 例 TW124053(fid177252/MO251218090, 计划13道)仅100/110有机台3
```

## 3. 筛查“全部工序都有机台号”（按汇报 F_MECHINE_NUM）

- 分母：`T_SFC_OPERPLANNINGDETAIL WHERE FENTRYID=<FID>` 的工序数。
- 分子：`T_SFC_OPTRPTENTRY WHERE FOPTPLANID=<FID> AND LTRIM(RTRIM(ISNULL(F_MECHINE_NUM,'')))<>''` 的去重 `FOPERNUMBER` 数。
- 分子 == 分母且 >0 → 全覆盖命中；否则报告覆盖最多的那张（当前全库最多 2 道）。
- 不要用 `viewBill` 逐单扫计划 `Resource/Equipment`（全 0，成本高且无结果）。

## 4. 回复

给：工序计划号 + 生产订单号 + 每道工序的工序号/工序名/机台号。并注明“已验证：该计划 N 道工序机台号均非空；本次仅查询、未写入”。

## 5. 本账套实测坑位（2026-09-03）

- `SFC_OperationPlanning.SubEntity` 的机台相关键为 `ResourceId_Id`/`ResourceId` 和 `EquipmentId_Id`/`EquipmentId`，其余候选如 `F_LL`/`F_FD`/`F_UNW_*`/`BarCode` 经 dump 验证不含机台号。
- **大范围实测为空**：对 `TX0900882~TX0900853`（最新 30 张）、`OP000461~OP000463`（最旧）、`OP000618~OP000622`（中间偏移）、以及 `FID DESC TOP 100` 均匀抽样 34 张共 60+ 张逐单 `viewBill`，全部工序的 `ResourceId_Id=0` 且 `EquipmentId_Id=0`（`anyRes/anyEq` 均为 `false`）；`executeBillQuery` 带 `FilterString "FResourceId>0" / "FEquipmentId>0"` 也返回 0 行。
- **结论**：当前本账套账套未维护工序计划的资源/设备机台字段，"全部工序都有机台号"的命中率为 0。不要据此编造单号；需先与用户确认机台号的真实字段定义（Resource vs Equipment vs WorkCenter vs 自定义 `F_*` vs 汇报/转移单上的机台），再按确认后的字段重扫。
- 若用户坚持按 `Resource/Equipment` 筛查，应如实报告上述抽样范围与空结果，并提供 `WorkCenterId`（每工序均有值，如 `WC000001 固晶部`）作为对照，证明筛查逻辑本身已生效。
