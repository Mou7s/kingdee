# 采购订单 vs 委外订单诊断（purchase-vs-subcontract）

> 来源：2026-09-01会话 TK20260901027 排查。用户问“芯片发出去给供应商加工成成品 做什么单？是否从采购订单下推？”

## 结论
TK20260901027 是普通采购订单，不是委外订单，不能下推委外发料。

## 实测证据链
1. `executeBillQuery('PUR_PurchaseOrder', ..., "FBillNo='TK20260901027'")` → 命中 1行 FID116713 状态C
2. `executeBillQuery('SUB_SUBREQORDER', ..., same Filter)` → 0行
3. `viewBill('PUR_PurchaseOrder',116713).POOrderEntry[0]`：
   - Material N101030363 开关管BAV103 RJ 0.38*0.38，组“晶粒”，仓“玻封原材料仓”
   - Qty 393 / Price 6.017699 / TaxPrice 6.8 / AllAmount 2672.4
   - RemainReceiveQty=393 RemainStockInQty=393，ProductType=1 RowType=Standard
   - 物料 FERPClsid=1（外购）

## 诊断步骤（复用模板）
```js
import { K3CloudWebAPI } from './k3cloud.js';
const k3 = new K3CloudWebAPI(); await k3.login();
const billNo = 'TK20260901027';
const po = await k3.executeBillQuery('PUR_PurchaseOrder','FID,FBillNo,FDocumentStatus',`FBillNo='${billNo}'`,5);
const sub = await k3.executeBillQuery('SUB_SUBREQORDER','FID,FBillNo,FDocumentStatus',`FBillNo='${billNo}'`,5);
if (po.length) {
  const v = await k3.viewBill('PUR_PurchaseOrder', po[0][0]);
  console.log(v.POOrderEntry[0]); // 看Qty/Price/TaxPrice/RemainQty/Group
}
```
- 需同时查 PUR_SubContract? 本账套该FormId不存在，捕获异常即可。
- 物料组/ERPClsid 用 `BD_MATERIAL` 再查：`FMaterialGroup.FName`, `FERPClsid`

## 分支决策
- **A 直接买成品**：供应商已加工好送货。保留 PUR_PurchaseOrder，走 PUR_ReceiveBill → STK_InStock（或PUR_InStock），无发料动作，芯片所有权转移。
- **B 来料委外（只付加工费）**：芯片/晶圆是本账套的，发出去加工。应关闭当前 PUR_PurchaseOrder，新建 SUB_SUBREQORDER → SUB_PPBOM（用料清单）→ SUB_Delivery（委外发料）→ SUB_ReceiveBill/SUB_InStock（委外收料/入库）→ 结算加工费。工序级外发则用 SFC_OperOutGroupSend/Receive（本账套上锡场景）。

## 常见坑
- 单号前缀 TK 易误认为委外；必须以 FormId 命中为准。
- POOrderEntry 字段名为 Qty/Price/TaxPrice/Amount（非FQty），viewBill 结构为 POOrderEntry 数组。
- 已审核C的采购单有下游校验，反审核前需确认无收料/入库；委外重建前先与用户确认晶粒所在仓和加工费口径。
- 不要把“采购订单下推”直接当作“委外发料”的入口，两者表单链完全不同。
- **采购订单不可下推委外订单（本账套实测2026-09-01）**：`k3.pushBill('PUR_PurchaseOrder','SUB_SUBREQORDER',[116713])` 返回 `未启用默认转换规则，转换规则内码（RuleId）必填！`；`T_META_CONVERTRULE WHERE FSOURCEFORMID='PUR_PurchaseOrder'` 的 FTARGET 只有 `AP_Payable/CMK_RSM_StoreReceipt/CN_PAYAPPLY/IV_PURCHASEIC/IV_PURCHASEOC/PLN_MPSCOMPUTEBILL/PUR_MRAPP/PUR_MRB/PUR_POChange/PUR_ReceiveBill/SAL_SaleOrder/STK_InitInStock/STK_InStock` 共13个，**无 SUB_SUBREQORDER**；反向 `SUB_SUBREQORDER→PUR_PurchaseOrder` 才有规则。前端“下推”按钮也不会出现委外选项，须关闭采购单后新建委外订单。
- **物料委外标志卡控**：`N101030363 开关管BAV103` 的 `T_BD_MATERIAL` 为 `ErpClsID=1 IsSubContract=false`（外购件），不可直接作委外订单成品；对比模板 `102020061 蓝膜片` 为 `ErpClsID=3 IsSubContract=true` 才允许委外。建委外前先 `viewBill('BD_MATERIAL',fid)` 看 `MaterialBase.IsSubContract`，false 时先改物料主数据勾上委外再建单。
