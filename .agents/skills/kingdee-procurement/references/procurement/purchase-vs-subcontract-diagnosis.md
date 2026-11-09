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

## 标准采购订单 vs 费用/资产采购订单与收料/入库链路区分（2026-11-09 用户规范与实测）

1. **三类采购订单的单据链路、物料属性（`FErpClsID`）与存货类别（`FCategoryID`）对应规范**：

   | 采购订单类型 | 单据链路 | 允许的物料属性 (`FErpClsID`) | 允许的存货类别 (`FCategoryID`) |
   |---|---|---|---|
   | **标准采购订单** (`CGDD01_SYS` / `CG`) | 标准采购订单 → 收料通知单 (`SLD01_SYS` 标准收料单) → 验收入库单 (`STK_InStock`, `RKD01_SYS`) → 暂估应付单 (`AP_PAYABLE` 类型 `2`) → 财务应付单 (类型 `3`) | 外购 (`1`) / 自制 (`2`) / 委外 (`3`)（须勾选允许库存 `FIsInventory=true`） | 原材料 (`CHLB01_SYS`)、辅料 (`CHLB02_SYS`)、自制半成品 (`CHLB03_SYS`)、委外半成品 (`CHLB04_SYS`)、产成品 (`CHLB05_SYS`)、库存商品 (`CHLB09_SYS`)、办公材料 (`CHLB08_SYS`)、设备配件 (`CHLB10_SYS`)、劳保用品 (`CHLB14_SYS`)、低值易耗品 (`CHLB16_SYS`) |
   | **费用采购订单** (`CGDD05_SYS` / `FYCG`) | 费用采购订单 → 收料通知单 (`SLD05_SYS` 费用物料接收单) → 财务应付单 (`AP_PAYABLE` 类型 `3`)（**无验收入库单与暂估应付单**） | 费用 (`11`)（`FIsInventory=false`） | 办公材料 (`CHLB08_SYS`)、设备配件 (`CHLB10_SYS`)、制造费用-气体 (`CHLB11_SYS`)、制造费用-机物料消耗 (`CHLB12_SYS`)、维修费 (`CHLB13_SYS`)、劳保用品 (`CHLB14_SYS`)、福利费 (`CHLB15_SYS`)、低值易耗品 (`CHLB16_SYS`)、玻封电镀费 (`CHLB17_SYS`)<br>（实例：`N407000003` 打印机维护服务费用、`N407000004` 网络维护服务费用为 `维修费 + 费用`；`N407000005` 钢化玻璃（更换）为 `办公材料 + 费用`） |
   | **资产采购订单** (`CGDD04_SYS` / `ZCCG`) | 资产采购订单 → 收料通知单 (`SLD04_SYS` 资产接收单) → 财务应付单 (`AP_PAYABLE` 类型 `3`)（**无验收入库单与暂估应付单**） | 资产 (`10`)（`FIsAsset=true`） | 资产 (`CHLB07_SYS`)<br>（实例：`NGB0010002` 华为手机、`NGB0010003` 组装电脑（台式）均为 `资产 + 资产`） |

   - **重叠存货类别注意**：`办公材料 (CHLB08_SYS)`、`设备配件 (CHLB10_SYS)`、`劳保用品 (CHLB14_SYS)`、`低值易耗品 (CHLB16_SYS)` 四类存货类别既可配 `外购 (1)` 走**标准采购订单**（经入库与暂估应付），也可配 `费用 (11)` 走**费用采购订单**（收料直接下推财务应付）；建料及下单时必须以物料主数据的 `物料属性 (FErpClsID)` 与实际管理流程为准。

2. **错位异常识别与修复（`TK20260919014` / `TK20260922025` / `TK20261005007` 案例）**：
   - **现象**：对外购库存件（`FErpClsID=1, FIsInventory=true`）下达了 `标准采购订单 (CG)`，却只下推了 `标准收料单 (PUR_ReceiveBill, SLD01_SYS)`，未继续下推 `STK_InStock`（导致订单 `FReceiveQty>0, FStockInQty=0` 长期未关闭），甚至直接由 `标准收料单` 下推了类型 `3` 财务应付单（如 `AP00156679`、`AP00166261`）。
   - **修复顺序**：若收料单下游已挂直接生成的类型 `3` 财务应付单（`BaseAPJoinQty > 0`），须先删除该财务应付单（草稿直接删；已审核且已关账结账的由财务删凭证、反结账、反审核后删除），再由收料通知单（`PUR_ReceiveBill`）按转换规则 `PUR_ReceiveBill-STK_InStock` 下推 `标准采购入库单 (STK_InStock)`。入库单审核后自动更新收料单 `InStockQty`、关闭采购订单，并自动生成类型 `2` 暂估应付单。
3. **采购入库常用仓库编码核对（`BD_STOCK` 2026-11-09 实测，切勿混淆编码）**：
   - `CTK05` = **`设备配件仓`**（`30101 委外维修配件`、`30104 焊线`、`30105 模压`、`30107 冲切` 等设备配件入此仓）
   - `CTK06` = **`费用仓`**（`409 杂项/厂务` 等实物杂项入此仓；**注意 `CTK08` 是 `现场仓`，不是 `费用仓`**）
   - `CTK03` = **`辅材仓`**，`CTK07` = **`资产仓`**
   - 报出仓库编码前必须先查 `BD_STOCK`（`FNumber, FName`）或参考同物料历史 `STK_InStock`，严禁凭记忆猜编码。证据：`output/2026-11-09-tk20260919014-diagnosis/evidence.json`。
