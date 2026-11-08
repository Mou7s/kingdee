# 销售出库下游应收排查 SAL_OUTSTOCK → AR_Receivable（本账套 K3）

## 目录

- 结论先行
- 1. 出库单本体判定（SAL_OUTSTOCK）
- 2. 应收侧反查（AR_Receivable）
- 3. 诊断步骤（固定顺序）
- 4. 常见坑
- 5. 参考单据
- 6. 已下推无剩余量（点下推无反应/报无可下推分录）


会话 TK202608271197 实测沉淀：为什么销售出库单查不到下游应收单。

## 结论先行

多数「查不到下游」不是丢失，是**还没下推生成应收**。以出库单本体开票字段为准，再以应收分录反查交叉验证。

## 1. 出库单本体判定（SAL_OUTSTOCK）

```js
import { K3CloudWebAPI } from "../../lib/k3/index.js";
const api = new K3CloudWebAPI(); await api.login();
const fid = 134987; // TK202608271197
const bill = await api.viewBill("SAL_OUTSTOCK", fid);
```

关键字段：

| 位置 | 字段 | 未开票表现 | 已开票对照 |
|------|------|------------|------------|
| 表头 | `ARStatus` | `" "` 空白 | `C` |
| 分录 `SAL_OUTSTOCKENTRY[]` | `InvoicedQty` | 0 | 0 但 `SumInvoicedQty>0` 也算已关联 |
| | `SumInvoicedQty` | 0 | >0 |
| | `BaseInvoicedQty` / `FBaseARJoinQty` / `BASEARQTY` | 0 | >0 |
| | `FullyJoined` / `JoinStatus` | false / 空 | true / 已关联 |
| 表头 | `OutStockTrace` / `BOS_ConvertTakeDataInfo` | `[]` / `null` | 有下游时非空 |
| 表头 | `SAL_OUTSTOCKFIN.BillAllAmount` 等 | 金额正常，不代表已开票 | 同左 |

本单实测（23行）：`Total RealQty=2003.808`，`InvoicedQty` 全 0，`ARStatus=" "`，`OutStockTrace=[]` → 未开票。
对照单 `TK202608200845`：`ARStatus=C`，`SumInvoicedQty=270` → 已开票。

> 注意：`executeBillQuery` 查 SAL_OUTSTOCK 若带分录字段会**一行一分录**需按 `FID` 去重；`FDocumentStatus=C` 只代表出库已审核，不代表已开票。

## 2. 应收侧反查（AR_Receivable）

本账套账套实测：`AR_Receivable` 的分录实体名是 `AP_PAYABLEENTRY`（非 `AR_ReceivableEntry`），关联出库单靠两个字段：

```
AP_PAYABLEENTRY.SourceBillNo = SAL_OUTSTOCK.FBillNo
AP_PAYABLEENTRY.FSOURCETYPE = 'SAL_OUTSTOCK'
```

验证：

```js
// 正例：已开票客户的应收可查到
const rows = await api.executeBillQuery("AR_Receivable",
  "FID,FBillNo,FDocumentStatus,FDate", "FCUSTOMERID=132853", 10);
const v = await api.viewBill("AR_Receivable", rows[0][0]);
console.log(v.AP_PAYABLEENTRY[0].SourceBillNo, v.AP_PAYABLEENTRY[0].FSOURCETYPE);
// => "TK20241021021" "SAL_OUTSTOCK"

// 反例：未开票单查不到
const hit = await api.executeBillQuery("AR_Receivable",
  "FID,FBillNo,FDocumentStatus", "FSOURCEBILLNO='TK202608271197'", 5);
// => []
```

可用 `FieldKeys`：`FID,FBillNo,FDocumentStatus,FDate,FCustomerId,FCustomerId.FName` 实测可用；`FSETTLECURRID` / `FSaleBillNo` / `FSourceBillNo`（大小写敏感）等在 `AR_Receivable` 上不存在，不要直接当表头字段查。

辅助筛选：按客户 `FCUSTOMERID=132853`（CTK000009 客户Y）+ 日期窗口缩小范围，再逐张 `viewBill` 看 `SourceBillNo`。

## 3. 诊断步骤（固定顺序）

1. `executeBillQuery("SAL_OUTSTOCK", "FID,FBillNo,FDocumentStatus,FDate,FCustomerId.FNumber,FCustomerId.FName", "FBillNo='TK...'" )` 拿 FID
2. `viewBill("SAL_OUTSTOCK", fid)` 看 `ARStatus` + 分录开票字段 + `OutStockTrace`
3. `executeBillQuery("AR_Receivable", "FID,FBillNo,FDocumentStatus", "FSOURCEBILLNO='TK...'")` 反查（注意字段为分录级但可用此写法过滤）
4. 另查该客户近期 AR 交叉验证链路是否通（选一个已知已开票单作正对照）
5. 若第2步全0且第3步空 → 结论「未下推」；指导前端：销售出库单 → 下推 → 应收单

## 4. 常见坑

- 把 `FDocumentStatus=C` 当已开票 —— 错，需看 `ARStatus` 与分录开票量
- 在 `AR_Receivable` 上用 `FSETTLECURRID/FSaleBillNo/FSourceBillNo` 当表头字段查 —— 报「元数据不存在」
- 误用 `SAL_Invoice/AR_Invoice` 等不存在的 FormId
- 忽略 `AP_PAYABLEENTRY` 是 AR 的实际分录实体名

## 5. 参考单据

- 未开票：`TK202608271197` FID 134987，CTK000009，2026-08-27，ARStatus 空
- 已开票对照：`TK202608200845` FID 134620，ARStatus C
- 客户 AR 正例：`AR00000583` SourceBillNo `TK20241021021` FSOURCETYPE `SAL_OUTSTOCK`
- 已下推无剩余（不可再推）：`TK202608311374` FID 135169 → `AR00042919` FID 176422，见 §6

## 6. 已下推无剩余量（点下推无反应/报无可下推分录）

`TK202608311374`（2026-09-04 实证）：用户问“为什么不能下推应收”，实测不是状态问题，是**已全量关联**。

出库分录实测值：`ARJoinQty=200`、`SalBaseARJoinQty=StockBaseARJoinQty=FBaseARJoinQty=BASEARQTY=200`、`SumInvoicedQty=200`、`ARJOINAMOUNT=38000`、`ARNOTJOINQTY=0`、`JoinedQty=0/UnJoinQty=0/FullyJoined=false/JoinStatus=" "`（后四个不可信，以 ARJoin/ARNOTJOIN 为准）。

下游发现路径：`AR_Receivable` 不支持表头 `FSaleBillNo/FSourceBillNo` 直接过滤（报“元数据中标识不存在”），按客户+日期查再逐张 View：

```js
const rows = await api.executeBillQuery("AR_Receivable",
  "FID,FBillNo,FDocumentStatus,FDate,FCustomerID.FNumber,FCustomerID.FName",
  "FCustomerID.FNumber = 'CTK000999' AND FDate >= '2026-08-01'", 30);
const v = await api.viewBill("AR_Receivable", 176422); // AR00042919
// v.AP_PAYABLEENTRY[0]: FSOURCETYPE='SAL_OUTSTOCK', SourceBillNo='TK202608311374',
// PriceQty/SalQty=200, FALLAMOUNTFOR_D/ALLAMOUNT=38000, FDocumentStatus=C
```

下游与出库同秒（2026-08-31 16:24:25）即下推当时生成。结论话术：“已下推过，无剩余可推（ARJoin=200/未关联=0），下游 AR00042919 已审核；要重推先反审核删除该应收”。
