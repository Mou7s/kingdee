# 关账期受托入库红蓝字更正（STCLRK001876 2026-09-02）

## 现象
- 单号 `STCLRK001876` 日期 `2026-08-27`，状态 `C` 已审核，试图反审核修改时报：
  > 库存组织已关账，单据 STCLRK001876 日期2026-08-27必须大于库存组织最后关账日期2026-08-30，或者请先反关账！
- 需求：7行 `N102012247 / MKD2M500065(GD2MD2A1)` 改为 `N102012246 / MKD2M500065(GD2MD2A1)-L`，每行 30.722 合计 215.054，批号 260523D00766。
- 关账已定，反关账不可行，用户明确不反关账。

## 已验证事实（2026-09-02 实测）
- 物料：`N102012246` (FID 893493, MKD2M500065(GD2MD2A1)-L, 1.00*0.80, Forbid A, Doc C) 与 `N102012247` (FID 893494) 均存在且可用，`BD_MATERIAL` 实测。
- 单据表：`T_STK_OEMINSTOCK` / `T_STK_OEMINSTOCKENTRY`，FID 101889，7行 FMATERIALID 893494，FLOT 893623，FQTY 30.722。
- FormId：`STK_OEMINSTOCK`（大小写不敏感，View 返回 `STK_OEMInStock`），`executeBillQuery` 验证可用；`STK_InStockEntrusted` 等猜测均不存在。
- 发现方法：`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE COLUMN_NAME='FBILLNO'` 扫 1300 表，再 `SELECT TOP 1 FID FROM [tbl] WHERE FBILLNO='STCLRK001891'` 定位到 `T_STK_OEMINSTOCK`。`.agents/skills/kingdee-k3cloud/references/system/k3cloud-form-ids.md` 未收录时勿猜。
- 关账表：`T_STK_CLOSEPROFILE` FCATEGORY='STK' 最新一条 FCLOSEDATE=2026-08-30 FORGID=1，对上报错。
- 现存量：`T_STK_INVENTORY` 错料在 CTK01(111210) FBaseQty=215.054 可用(StockStatus 10000)，CTK04(111214) 0；对料 2246 现存0。红冲前够扣，不会立刻负库存。

## 关账校验逻辑
- K3 按库存组织关账日锁定历史期间，任何会改动已关账期库存/成本的反审核、Save 都会被拦截，提示日期必须>最后关账日。不能直接 SQL 改日期或改 ENTRY.FMATERIALID（违反 AGENTS.md 一、2）。

## 标准修复：当期红蓝字（本次采用）
1. 红字冲销：在开账期（如 2026-09-02）新建 `STK_OEMINSTOCK`，表头照抄库存组织`主账套组织`、客户`客户M`，备注 `红字冲销 STCLRK001876 原N102012247错料`，明细 7行物料 `N102012247`、批号 `260523D00766`、数量 `-30.722`（或选红字类型填正数）。若界面有`业务操作-冲销`可直接选原单生成。
2. 蓝字补入：同日期再新建一张，明细改 `N102012246 -L` 同量 `+30.722`×7，备注 `蓝字补入 对应冲销STCLRK001876`。批号字符串可沿用，但 FLot 会新建绑定到新物料，原 FLot 893623 不复用。
3. 两单分别 Save→Submit→Audit，回查 FDocumentStatus C。

## 红蓝字前必查（本会话补充）
1. 现存量与负库存：先查 `T_STK_INVENTORY` 该批号错料可用量，判 FAllowMinusQty（CTK08 已改为0，CTK01/CTK04 需确认），见 `.agents/skills/kingdee-sales-inventory/references/inventory-sales/negative-stock-sop.md`。已被领用时红冲会报`库存不足/可用量不足`被拦。
2. 批号隔离：FLot 绑定物料，蓝字沿用同字符串会新建 Lot，物理标签需重贴，不要假设同一 FLotID 跨物料。
3. 下游关联：查该 OEM 入库是否已被 `PRD_PickMtrl`/`SUB_PickMtrl` 领用或委外发料，红冲可能因在制/可用量校验失败。
4. 客户对账：受托库存归属客户，红蓝新增两条流水，需在备注关联原单号并通知财务/客户，避免对账断链。

## 替代方案（未采用）
- 反关账到 2026-08-27 前再改原单：影响整月成本，需财务授权，本次明确不做。
- SQL 直改 `T_STK_OEMINSTOCKENTRY.FMATERIALID`：违反 AGENTS.md 禁止擅自 SQL 写单据，未授权不做。
- 其他出入库单盘盈/盘亏硬调：`../kingdee-sales-inventory/references/inventory-sales/negative-stock-sop.md` 严禁无依据凭空盘盈，不推荐。

## 关联
- AGENTS.md 一、2 SQL 写入需授权；三、WebAPI 优先。
- 辅助排查可用 `T_STK_INVENTORY`、`T_STK_OEMINSTOCKENTRY` 只读；关账用 `T_STK_CLOSEPROFILE`。

## 2026-10-30 复核边界：STCLRK001781错料更正咨询

- 用户确认实物是蓝膜，且明确不反关账。原单实时仍为2026-08-01、C、N102012152、0.5K；CTK04同批C00SZA.001仍0.5K，货主CTK000009。目标蓝膜料N102012151当前无库存。
- 本次WebAPI查询 `STK_OEMInStock FQty<0` 未返回负数入库实例；没有创建或审核红蓝字单。本文件前文“本次采用/已验证事实”不得解释为已验证负数Save、审核或界面有红字/冲销按钮。前文红蓝字是更正方案，实际入口、负数支持及源单关联校验仍须本账套验证。
- 给手工步骤时可列原料号负0.5K与正确料号正0.5K的当期更正模型，但必须明确未验证负数保存；遇到不允许负数、强制选单或关联数量不足时停在保存前，不改旧单日期、不套普通退客户业务掩盖错料更正，也不将方案称为已完成。

## 2026-10-30 用户改为其他出入库更正：仅完成草稿

- 用户明确要求删除拆卸单，改做其他出库/其他入库；目标承接此前现场仓固晶备料要求，货主不变。实时单据及库存守卫后，ZZCX014211（114435）UnAudit→D→Delete成功；列表查不存在，N102012152在CTK04/芯片仓100015/批号C00SZA.001/客户CTK000009/KCZT001恢复0.5K，目标蓝膜非零库存为空。
- 已建其他出库QTCK2026100323（106845，A）：N102012152、0.5K、CTK04/100015、客户YCTK000009、C00SZA.001、KCZT001。其他入库QTRK001144（101167，A）：N102012151、0.5K、CTK08固晶100027、相同货主批号状态。均仅Save，未Submit/Audit，不称库存转换完成。最终独立回查仍旧料CTK04为0.5K。
- 实时元数据：两单保存明细均FEntity；出库View=BillEntry（MaterialId/Qty/StockId/OwnerId/StockLocId），入库View=STK_MISCELLANEOUSENTRY（MATERIALID/FQty/FSTOCKID/OWNERID/StockPlaceId）。入库备注FNOTE上限50字符，长事由放FEntryNote。其他出库要求领料部门，其他入库要求供应商与部门至少一个；本次从TX086750的10固晶WorkCenterId.DeptID实时取得固晶部BM000010，不猜部门或供应商；出库FCustId为CTK000009。
- 失败保存分别为出库缺领料部门、入库备注超长及缺部门，均返回空Id；按已确认字段修正后分别保存，未重跑拆卸删除或重复建出库。全过程WebAPI业务操作，SQL仅查元数据。
- 证据output/n102012152-stock/misc-correction.json、misc-final-verification.json、misc-meta-STK_MisDelivery.xml、misc-meta-STK_MISCELLANEOUS.xml；脚本scripts/scratch/2026-10/replace-assembly-with-misc.js、finish-misc-correction-drafts.js、finish-misc-inbound.js均默认dry-run，分阶段脚本不可从头盲重跑。

- 同日用户明确“去审核”后，实时双草稿及库存守卫通过，按其他出库→其他入库顺序分别Submit/Audit成功。QTCK2026100323（106845）、QTRK001144（101167）列表与View均C；出库后旧料非零库存清零，再审核入库。最终独立库存N102012151/CTK08/固晶仓位100027/批号C00SZA.001/客户货主CTK000009/KCZT001为0.5K，旧料N102012152非零库存为空。总量0.5K不变，8月源单未改，拆卸单仍已删。证明错料更正与现场仓账面入库完成，不代表MO货主已改或工序领料成功。证据output/n102012152-stock/misc-audit.json；脚本scripts/scratch/2026-10/audit-misc-bluefilm.js默认dry-run。

- 同日用户纠正“业务组织改成本账套入库，做其他入库的时候”，明确授权仅更正QTRK001144货主。实时C/唯一分录103368/库存客户CTK000009为0.5K守卫通过，UnAudit→D并库存归零→最小Save表头FOwnerTypeIdHead/FOwnerIdHead及FEntity分录FOwnerTypeId/FOwnerId为BD_OwnerOrg/100→逐项回查→Submit/Audit成功C。NeedUpDateFields用裸字段，IsDeleteEntry=false。物料/分录ID/数量/批号/现场固晶仓位/库存状态均保留。
- 最终列表/View均C；N102012151在CTK08/100027/C00SZA.001的0.5K货主已为BD_OwnerOrg/100，与用料清单组织货主一致，仍KCZT001不参与核算。未改用料清单、未改其他出库或8月受托入库；未验证工序领料成功，不把货主一致当成已领料。用户本次货主约定仅此单，不推广所有客供料转自有。
- 证据output/n102012152-stock/inbound-owner-before.json、inbound-owner-change.json；脚本scripts/scratch/2026-10/change-misc-inbound-owner.js默认dry-run。
