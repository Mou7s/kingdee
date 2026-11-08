# 采购订单删除与变更锁死

## 标准删除链

1. 先定 FID 与状态：`executeBillQuery("PUR_PurchaseOrder", "FID,FBillNo,FDocumentStatus,FCloseStatus", "FBillNo='单号'")`。只有暂存/创建/重新审核（A/D/Z）可删；C 必须先反审核。
2. 下游检查：`PUR_ReceiveBill` 与 `STK_InStock` 都用 `FSRCBILLNO='单号'` 查；有行先处理下游，不直接动原单。
3. `unAuditBill → deleteBill →` 按单号回查 0 行才算删掉。

## 反审核报“存在下游变更单【原单号_Vxxx】”

- 变更单编号规则是原单号 + `_V` + 原单头 `T_PUR_POORDER.FVERSIONNO`；先读原单头确认版本，再按完整编号查变更单。
- 变更单的 FormId 是 `PUR_POXChange`（表 `T_PUR_XPOORDER`），不是 `PUR_POChange`——后者在本账套几乎无数据，按它查会误判“无变更单”。用 `FBillNo='原单号_Vxxx'` 精确查 `PUR_POXChange`，再 `View` 核对 DocumentStatus/CloseStatus。
- `T_BAS_OPERATELOG`（每次同时限定 `FOBJECTTYPEID`，再以单据号/`FINTERID` 交叉）可核对用户在前端的反审核/删除失败记录，先区分操作问题与状态锁死再动手。

## 退场：整单关闭（已验证）

- 删除链死锁后，正规退场是整单关闭，不再试删除：`executeOperation("PUR_PurchaseOrder", "BillClose", { Ids: "<FID>" })`，成功后回查 `FCloseStatus: A→B`（`FDocumentStatus` 仍为 C，单据保留、后续收不了料）。
- 可逆：同表单注册了 `BillUnClose`（整单反关闭），误关可回退；关闭不删审计链，语义弱于删除，执行前按删除授权时的同一目的确认（退掉不需要的订单）。
- 操作编码不要猜：从 `T_META_OBJECTTYPE.FKERNELXML`（`WHERE FID='PUR_PurchaseOrder'`）提取全部 `<Operation>/<OperationName>` 对再选；本单已确认可用 `BillClose/整单关闭、BillUnClose/整单反关闭、Cancel/作废、Uncancel/反作废、MRPClose/业务关闭、Freeze/业务冻结`。XML 约 785KB，只取操作片段，不要输出或落盘全文。

## 停止线

- 已生效的变更单（已审核+已关闭）：反审核报“变更单已生效，不能反审核”，且该表单无反关闭接口——标准 WebAPI 流程到此为止，停下报给用户。
- 此时原单同样不能反审核、不能直接删。不要试 `deleteBill` 删变更单（删掉只丢审计链，原单版本回不去）；不要 SQL 改版本/状态（正式单据写，需单独授权方案）。
- 给用户选项：关闭结案代替删除，或升级走授权的后台处理。

## 只读核对变更前后价格（2026-10-17 WebAPI实证）

- PUR_POXChange不仅用于删除链调查，也可用于订单价格异常追踪；按原单号前缀查询FID/FBillNo，再View逐行核对PKIDX（原订单分录ID）。
- 已验证查询键FQtyX/FQty（原/新数量）、FTaxPriceX/FTaxPrice（原/新含税单价）；View键QtyX/Qty、TaxPriceX/TaxPrice。自定义字段不保证有原值快照，不凭变更原因推定改过的具体字段。
- TK20260901032_V001第三行原新均6.589K、34.147822，证明异常价格先于本次变更已存在。完整证据与界限见references/finance/purchase-pricelist-lookup.md中同案纠正条目。

## 资产订单误选类型且已预付：只读调查案例（2026-11-02）

- TK20260414036，FID 112345，资产采购订单 CGDD04_SYS，已审核未关闭，含税 54000 元，设备升级物料 NGS0000048。订单付款计划关联 CN_PAYAPPLY/FKSQ001166（101202）及 AP_PAYBILL/FKD00002358（102428），两单均已审核，预付 16200+27000=43200 元。
- 不能用订单 FIinstallment.ACTUALAMOUNT=0 判断没有付款：本案付款单 REALPAYAMOUNTFOR=43200，付款来源链为付款申请，再追到订单付款计划。付款分录 WRITTENOFFAMOUNTFOR=0，同时有应收票据分录、FISPOST=true；未核销不代表可以直接反审核或删除。
- 按 FSRCBILLNO 查 PUR_ReceiveBill/STK_InStock 均无行；AP_PAYABLE 不支持该查询键（报列名无效），改按供应商 G072 查询全部 13 个应付 FID，再逐单 View 搜索订单号，未命中。PUR_POXChange 按订单号前缀亦无行。这不证明不存在无来源关联的手工资产卡片或凭证。
- 后续方案必须区分已验证与拟议：保留付款并改挂新订单，或者按依赖倒退重建，都尚未验证本账套可执行性。不得为测试能力调用反审核、删除或 Save，也不得 SQL 改类型/来源链。变更单能够改价格数量，不构成可切换订单业务类型的证据。
- 证据：output/po-upgrade-TK20260414036.json、output/FKSQ001166.json、output/FKD00002358.json。仅只读查询，未修改业务单据；复用前重查状态、核销、票据、凭证和期间。


### 同案继续核实：类型锁定与已过账凭证（2026-11-02）

- 经只读 SQL 核对有效继承：PUR_POXChange→PUR_PurchaseOrder→PUR_BillTemplate→BOS_SCMBillTemplate→BOS_BusinessBillModel→BOS_BillModel。不能拿旧 PUR_POChange 手册代替新变更单控制。
- 新变更单沿用原单的 FBillTypeID/FBusinessType。原单布局中业务类型 Locked=3；新变更单未覆盖该项。新变更单状态控制明确包含 FBillTypeID，原单实体规则“关联生成,锁定单据类型”同时锁定 FBillTypeID/FBusinessType；原分录 FPKIdX<>0 时锁定 FMaterialId、FUnitId、FPriceUnitId、FSupMatId。因此现有标准配置下不能通过变更单将资产类型改为费用/标准类型。修改物料属性不会改写订单表头类型。
- 原单当前 BusinessType=ZCCG，CGDD04_SYS 参数 BusinessType=ZCCG；费用 CGDD05_SYS→FYCG，标准 CGDD01_SYS→CG。物料正确编码为 NGS0000048（764887），ErpClsID=10，IsAsset=true，IsInventory=true，IsRealTimeAccout=false。
- CN_PAYAPPLY 删除校验只允许 A/Z/D，而本单为 C；下游付款来源链仍保留。付款单反审核注册了 VoucherControlWhenUnAudit。用户前端已实证因出纳/应付结账至2026-09-30及已生成凭证失败，不能再把反审核作为未经限制的可行方案。
- T_BAS_VOUCHER 按 FSOURCEBILLKEY=AP_PAYBILL、FSOURCEBILLID=102428、FSOURCEBILLNO=FKD00002358 对应业务凭证2500063→总账凭证255751。总账2026年4期、FVOUCHERGROUPNO=216、FPOSTED=1；分录借2202.02 明细应付款16200+27000，贷1121.01 银行承兑汇票43200。业务用途虽是预付款，实际总账并非预付账款科目，不凭用途推断入账科目。
- 应付参数中 FATVYMPYLEANDPYLL=True（付款项目相同时应付/预付自动核销）；FJoinOrderHandMatchDide 字段默认True（已被订单完全关联的预付付款单仅允许自动核销），组织0及1保存的参数XML均未显式保存该键，不能把缺键认定为False，也不能仅按默认值认定本案实际手工核销不可用。新订单不等于自动承接旧订单付款。
- 正规替代方向是保留历史付款/凭证、建立正确费用业务并核实开放期间的应付付款手工核销；但新目标应付尚不存在、该付款能否在核销界面过滤出来尚未实测，不能宣称全流程已验证。不能为套用退款重付方案虚构实际退款，也不擅自调整全局核销参数或反结账。
- 只读证据：output/po-upgrade-investigation/ 中当前单据、继承、参数、凭证及科目快照。官方新变更单手册：https://help.open.kingdee.com/dokuwiki/doku.php?id=采购订单新变更单 ；手工核销手册：https://help.open.kingdee.com/dokuwiki/doku.php?id=应付付款手工核销 。本次未调用任何业务写操作。
