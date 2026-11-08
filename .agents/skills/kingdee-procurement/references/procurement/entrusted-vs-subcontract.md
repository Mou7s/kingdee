# 受托加工 vs 委外加工 vs 普通采购（entrusted-vs-subcontract）

> 来源：2026-09-01会话，TK20260901027 排查 + 受托/委外单据实测。

## 三者方向一句话

- **委外加工 SUB_SUBREQORDER**：你是委托方，你的芯片/晶圆发给供应商（如G026供应商X）加工，货权是你的，只付加工费。
- **受托加工 STK_OEMReceive / STK_OEMInStock**：你是受托方，客户（如上海鑫维 CTK000194）的晶圆发给你加工，货权是客户的，进客供料仓，不计入你的存货成本。
- **普通采购 PUR_PurchaseOrder**：直接向供应商买成品/原材料，货权转移，无“发出去再回来”。

## 本账套实测表单与实例

| 类型 | FormId（executeBillQuery可用） | 表头表/明细表 | 实例 |
|------|--------------------------------|---------------|------|
| 受托收料 | `STK_OEMReceive` / `STK_OEMRECEIVE` 大小写均可 | `T_STK_OEMRECEIVE` / `T_STK_OEMRECEIVEENTRY` | `STCLSL000004 上海鑫维-晶圆片ESD0455V0 102010036` 进`客供料仓CTK04/芯片仓` |
| 受托入库 | `STK_OEMInStock` | `T_STK_OEMINSTOCK` / `T_STK_OEMINSTOCKENTRY` | `STCLRK000002 江苏格瑞宝` |
| 受托BOM | `SAL_OEMBOM` | `T_SAL_OEMBOM` | 本账套当前0行 |
| 委外订单 | `SUB_SUBREQORDER`（注意不是 SUB_REQORDER/PUR_SubContract） | `T_SUB_REQORDER` / `T_SUB_REQORDERENTRY` | `SUB00000009` |
| 委外发料/收料 | `SUB_PPBOM` / `T_SUB_PICKMTRLDATA`(WWLL)、`T_SUB_FEEDMTRL` | 按表名区分 | 需View确认 |

> 坑：`SUB_REQORDER`、`PUR_SubContract` 在本账套不存在，ExecuteBillQuery 会抛“业务对象不存在”，捕获后换 `SUB_SUBREQORDER` 重试。

## 诊断模板（按单号判断）

```js
import { K3CloudWebAPI } from './k3cloud.js';
const k3 = new K3CloudWebAPI(); await k3.login();
const no = 'TK20260901027';
// 1. 同时查三类
const po = await k3.executeBillQuery('PUR_PurchaseOrder','FID,FBillNo,FDocumentStatus',`FBillNo='${no}'`,5).catch(()=>[]);
let sub=[]; try{ sub = await k3.executeBillQuery('SUB_SUBREQORDER','FID,FBillNo,FDocumentStatus',`FBillNo='${no}'`,5);}catch(e){/* form不存在 */}
let oem=[]; try{ oem = await k3.executeBillQuery('STK_OEMReceive','FID,FBillNo,FDocumentStatus,FCustId.FName',`FBillNo='${no}'`,5);}catch(e){}
console.log({po,sub,oem}); // 命中谁就是谁
// 2. 命中后 viewBill 看业务实质
if(po.length) console.log((await k3.viewBill('PUR_PurchaseOrder',po[0][0])).POOrderEntry[0]);
if(oem.length) console.log(await k3.viewBill('STK_OEMReceive',oem[0][0]));
```

## 表单发现技巧（未知FormId时）

1. 先扫 `sys.tables`：`WHERE name LIKE 'T_SUB%' OR name LIKE 'T_STK_OEM%' OR name LIKE 'T_SAL_OEM%'` 拿到物理表。
2. 物理表 `T_STK_OEMRECEIVE` 对应 FormId 通常为 `STK_OEMReceive`，用 `executeBillQuery` 试大小写变体验证。
3. 再扫 `STK_OEMRECEIVE` 实例的 `FOWNERTYPEID=BD_Customer`、`FSTOCKORGID`、`FCUSTID`，确认是受托收料单。
4. 数据库直连配置：`server <K3_ALT_HOST> / sa / <K3_MAIN_DB>`，与 `k3cloud.js` 的 `K3_DB_*` 一致。

## 分支决策

- 用户说“芯片发出去给供应商加工成成品”→ 走 **委外**，新建 `SUB_SUBREQORDER`，不要用 `STK_OEMReceive`，也不要从 `PUR_PurchaseOrder` 下推委外发料（本账套 `T_META_CONVERTRULE` 无此规则，实测下推报 `未启用默认转换规则 RuleId必填`）。
- 用户说“客户把芯片发给我们加工”→ 走 **受托**，新建 `STK_OEMReceive` 进 `CTK04客供料仓`。
- 单号已存在为 `PUR_PurchaseOrder` 且需改委外时，需先与用户确认关闭采购单再重建委外订单，并确认晶粒所在仓和加工费口径；重建前检查成品物料 `IsSubContract` 是否为 true（`N101030363` 为 false 需先改料）。
