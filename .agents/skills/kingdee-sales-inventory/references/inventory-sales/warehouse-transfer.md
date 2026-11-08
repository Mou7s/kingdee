# 仓库取消与库存调拨（外贸仓→CK成品仓；塑封成品仓1→塑封成品仓）

## 目录

- 仓库台账（BD_STOCK）
- 即时库存（STK_Inventory）
- 调拨单据（STK_TRANSFERDIRECT / STK_TransferDirect）
- 禁用仓库（BD_STOCK Forbid）
- 同维度仓位平移（CTK20→CTK10，2026-09-03 全链路已完成）
- 仓库存量溯源（回答“这仓是干什么的 / 货怎么进来的”，2026-09-03 CTK20 实测）
- 禁用≠锁死（CTK20 回流实证）
- 工具约定
- 混合调拨单删除分录的反审核阻挡（2026-10-30）


> 2026-09-02 实测：外贸仓 CTK19 取消，库存整体移至 CK成品仓 CTK13。脚本 `scripts/cases/transfer_wm_to_ck.js`（dry-run→--apply --confirm）+ `scripts/cases/forbid_wm_stock.js` 全链路验证。
> 2026-09-03 完成：塑封成品仓1 CTK20 → 塑封成品仓 CTK10 全链路（147 行 → 3 单 Save → Submit → Audit → CTK20 清零 → Forbid），见“同维度仓位平移”一节。

## 仓库台账（BD_STOCK）

| 编码 | 名称 | FStockId | FIsOpenLocation | 状态 |
|------|------|----------|-----------------|------|
| CTK19 | 外贸仓 | 853636 | false | C 已审核 / A 正常 |
| CTK13 | CK成品仓 | 111219 | true (仓位=外购仓/1, Flex FF100010, Entry 100047) | C / A |
| CTK10 | 塑封成品仓 | 111217 | true（与 CTK20 共用 Flex CTK10/FF100008，条目 ID 相同） | C / A |
| CTK12 | 玻封成品仓 | 111218 | - | C / A |
| CTK09 | 半成品仓 | 111231 | - | C / A |
| CTK11 | OEM成品仓 | 129248 | - | C / A |
| CTK20 | 塑封成品仓1 | 853793 | true（与 CTK10 共用 Flex CTK10/FF100008，条目 ID 相同） | C / A |

查询：
```js
await api.executeBillQuery('BD_STOCK','FStockId,FNumber,FName,FDocumentStatus,FForbidStatus',"FName like '%外贸%' or FName like '%CK%'",50)
await api.viewBill('BD_STOCK', 111219) // 看 IsOpenLocation + StockFlexItem[].FlexId.Number==CTK13 + FlexEntry 1/外购仓
```

## 即时库存（STK_Inventory）

- 外贸仓当时 **45 行 FBaseQty≠0**（例：NDB0320002 3000K、NDF0270001 2004K、NDB0320001 600K…），全部 `KCZT01_SYS 可用`、单位K、无批次/保质期特殊维度，`FStockLocId=0`。
- CK成品仓 279 行有数，`FStockLocId=100042`（对应外购仓）。
- 查询：`FStockId=853636 and FBaseQty !=0`，FieldKeys `FMaterialId.FNumber,FMaterialId.FName,FMaterialId.FSpecification,FStockId.FName,FBaseQty,FBaseUnitId.FName`；DB 侧 `T_STK_INVENTORY.FBASEQTY` 全量，`FBASEAVBQTY` 本账套常为 0（不能作为可用量判断依据）。
- 排序后导出 45 行供用户勾选范围；总量 8702.488K。

## 调拨单据（STK_TRANSFERDIRECT / STK_TransferDirect）

正道用 **直接调拨单**，不是其他出入库：保留成本、批次、即时库存联动。

- 表头：`FStockOrgId=1`, `FStockOutOrgId=1`, `FTransferDirect=GENERAL`, `FTransferBizType=InnerOrgTransfer`, `FBillTypeID={FNumber:"ZJDB01_SYS"}`，`FOwnerType*Head=BD_OwnerOrg`。
- 分录实体 `TransferDirectEntry[]`（视图名 `TransferDirectEntry`，保存名 `FBillEntry`）：`FMaterialId, FUnitID/FBaseUnitId, FQty, FSrcStockId/FDestStockId, FSrcStockStatusId/FDestStockStatusId(FNumber KCZT01_SYS), FKeeperType*/FOwnerType*=BD_*Org + {FNumber:"100"}`。
- **仓位坑（2026-09-02 实测）**：
  - CTK19 `IsOpenLocation=false` → 源仓位不传或 `0`。
  - CTK13 `IsOpenLocation=true` → 目标仓位必填，否则报 `调入仓位维度【CK成品仓】不能为空`（45行全报）。
  - 正确写法是数值ID：`FDestStockLocId: 100042`（库存里 `FStockLocId=100042` 实测值）。
  - 错误写法：`FDestStockLocId: {FSTOCKLOCID__FF100010:{FNumber:"1"}}` → `ResolveFiled_InnerEx 未将对象引用设置到对象的实例`；`{Id:100042}` / `{FSTOCKLOCID:{FNumber:"1"}}` → 仍报不能为空。
  - 探测方法：先对1行试 `FDestStockLocId: 100042` → 成功生成 `ZJDB2026090019`/`ZJDB2026090020`，说明数值ID是本账套可用形态。
- 建单：源 `853636` → 目标 `111219`，每行 `FQty = FBaseQty`；`FDestStockLocId: 100042` 必带。
- 流程：`Save → Submit → Audit`；`STK_Inventory` 立即扣减/增加。仅 Save 为草稿，前端复核后审核。

### 预计可发量不足重试（2026-09-02 实测 3/45）

- 症状：`Save` 报 `预计可发量不足，明细列表：行号：3,物料：MB10F【NDB0320001】；行号：10,1N4148 TB【NDD0510002】；行号：16,ES1JF【NDF0270001】；` 即使 `T_STK_INVENTORY.FBASEQTY` 还有数（600/30/2004）、`FBASELOCKQTY=0`，`FBASEAVBQTY` 本账套恒0不能作为判断。
- 根因：销售预留/锁库等可用量维度（非 FBASEAVBQTY），仅部分物料触发。
- 处置：解析错误文本 `【([^】]+)】` 取物料编码，移出该物料所在行后重试，最多 20 轮。参考 `create_dotted_ctk10_to_ctk20_transfer_draft.js` 的 `shortageMaterialNumbers` + 循环。
- 结果：42行成功 `ZJDB2026090020 FID105237`，3行写入 `wm_to_ck_transfer_skipped_shortage.json` 待前端核查预留后单独用其他出入库或解除预留后重推。重试代码已固化到 `transfer_wm_to_ck.js`。
- **二次补调（2026-09-02 解锁后）**：用户在前端解除预留后，同一脚本自动识别剩余3行（NDB0320001 600K / NDD0510002 30K / NDF0270001 2004K，合计2634K）生成 `ZJDB2026090021 FID105240`，`Save→Submit→Audit` 一次通过；`STK_Inventory CTK19` 清零（`FBaseQty<>0` 0行），CTK13对应3料分别叠加至 600/125/4005K（含原有库存）。无需临时放开 `FAllowMinusQty`（实测置1仍报同样可用量不足，确认是预留而非负库存校验）。
- **默认仓库已纠正**：`T_BD_MATERIALSTOCK` 对45个N料现均为 `FSTOCKID=111219 CTK13`，`CTK19` 计数0；`T_STK_INSTOCK` 对CTK19最后入库 `CGRK17021 2026-07-31`，之后无新增，说明45行是7月底前历史存量。仍需扫未关闭 `PUR_PurchaseOrder` 中 `FStockId=853636` 的残留，防止下次收料误回已禁用CTK19。

## 禁用仓库（BD_STOCK Forbid）

- 顺序：`审核调拨单 → STK_Inventory 剩余 0 → Forbid`。脚本 `forbid_wm_stock.js` 先查 `BD_STOCK FForbidStatus` 与 `STK_Inventory FBaseQty<>0`，有余额时阻断并提示先审核/处理剩余3行，避免负库存。
- 调用：`api.forbidBill("BD_STOCK", [FStockId])`，`ExecuteOperation Forbid`。
- 工具约定：dry-run 默认，`--apply --confirm FORBID_CTK19_20260902` 才真禁；执行后回查 `FForbidStatus=B`。

## 同维度仓位平移（CTK20→CTK10，2026-09-03 全链路已完成）

- 现状：CTK20 共 **147 行 FBaseQty≠0，合计 42134.118K**，全部 `KCZT01_SYS 可用`、单位 K；CTK10 共 656 行约 169397K。两仓 `IsOpenLocation` 均为 true，且 `StockFlexItem` 同为 Flex `CTK10/FF100008`、条目 ID 完全相同（如 100033 SOD-323、100036 SOT-23 等 8 个仓位，CTK20 无缺仓位行）。
- 与 CTK19→CTK13 不同：源仓有仓位，不能沿用“源不传、目标固定 100042”写法。正确写法是**原仓位平移**：每行取即时库存 `FStockLocId` 数值，同时传 `FSrcStockLocId` 与 `FDestStockLocId`（同值）。flex 嵌套/`{Id:}` 写法沿用旧坑结论，不用。
- 执行实录：用户一句“动手”= 仅 Save 草稿授权，`--apply --confirm CTK20_TO_CTK10_20260903 --batch 60` 一次建成 3 单（`ZJDB2026090038 FID105258` 60 行 / `ZJDB2026090039 FID105259` 60 行 / `ZJDB2026090040 FID105260` 27 行），0 行因可用量不足被跳过（147 行全单无预留阻塞，与 CTK19 案例的 3/45 不同）；回查 3 单均为 `A` 草稿。用户随后明确“去审核”才逐单 `submitBill → auditBill`（不可把“动手”理解为含审核的授权），回查 3 单均为 `C`。随后 `STK_Inventory CTK20 FBaseQty<>0` 回查 0 行，`forbid_ctk20_stock.js --apply --confirm FORBID_CTK20_20260903` 一次成功，回查 `FForbidStatus=B`。`test:safety` + `git diff --check` 通过。
- 禁用前必查物料默认仓库，但先看 `FForbidStatus`：本次 5 个默认仓库=CTK20 的物料（`AS0030030`、`NAD0060020`、`NAZ0050085`、`NAE0040072`、`NBQ0130298`，`BD_MATERIAL FStockId.FNumber='CTK20'` 盘点）**全部已是 `B` 禁用**，`restore_material_stock.js` dry-run 显示“可修改: 0”，无需改默认仓库。已禁用物料的默认仓不影响后续收料（源仓禁用后前端本来也选不出），不要为凑数去改禁用料。

## 仓库存量溯源（回答“这仓是干什么的 / 货怎么进来的”，2026-09-03 CTK20 实测）

- 先扫调入链：`executeBillQuery("STK_TRANSFERDIRECT","FBillNo,FSrcStockId.FNumber,FDestStockId.FNumber","FDestStockId.FNumber='XXX'",2000)`，按 `FBillNo` 去重计数来源方向（CTK20：`CTK10->CTK20` 210 行 + `SC-DJJ->CTK20` 5 行，共 22 单）；再取最早单的 `FDate` + `FNote` 定建仓用途（CTK20 首单 `ZJDB2026060098` 2026-06-15，备注“带点物料从 CTK10/塑封成品仓调入”→ 标识料分流仓）。
- 再扫直接入库：`executeBillQuery("PRD_InStock","FBillNo,FDate,FDocumentStatus","FStockId.FNumber='XXX'",2000)` 看生产是否直入（CTK20 有 600+ 张 `SCRK…` 自 2026-06-29 起直入，因当时一批物料默认仓被切到 CTK20，入库跟默认仓走）。
- 再翻仓库脚本考古：`scripts/bun_test/create_warehouse.js`（建仓参数）→ `create_dotted_*_transfer_draft.js`（分仓意图）→ `scripts/cases/restore_material_stock.js`（回填方向证明默认仓曾被改过）。三者拼出“先分流、后默认仓带偏、最终并回”的完整故事。
- 查询坑：带分录 join 的过滤条件用裸 `post("DynamicFormService.ExecuteBillQuery", {StartRow/TopRowCount 大翻页})` 曾两次返回 0 行（放大约等于放空），改走 `api.executeBillQuery` 传大 `top` 一次拉全即正常；行数统计一律按 `FBillNo` 去重后再数。

## 禁用≠锁死（CTK20 回流实证）

- `BD_STOCK ForbidStatus=B` 不拦截生产入库：搬空后 `PRD_INSTOCK` 仍可向禁用仓入已审核单（制单时下拉仍可选禁用仓），禁用后回流是常态而非异常。
- 回流排查先重查仓库现状再定性：`BD_STOCK` 的 `FForbidStatus` 可能已被人解禁回 `A`，不可沿用上次搬空时的 `B` 结论；先查 `FDocumentStatus/FForbidStatus` 再查入库链。
- 诊断固定三查：`PRD_INSTOCK` 按 `FStockId.FNumber='XXX' and FDate>='搬空日T00:00:00'` 查回流并按 `FBillNo` 去重计数；`STK_TRANSFERDIRECT` 按 `FDestStockId.FNumber='XXX'` 查调入；`BD_MATERIAL` 按现存量物料逐个查 `FStockId.FNumber` 默认仓。
- 区分默认仓带偏还是人工选仓：现存量物料默认仓若全为目标仓（如全是 CTK10），即可排除默认仓；同一张 `SCRK` 单内同时存在目标仓与禁用仓分录时，即为制单逐行人工选仓的确证，不再往默认仓或下推逻辑上查。
- 处置：禁用后仍要堵入库源头（生产下推/制单选仓习惯），不能只看 `FForbidStatus`；清仓不是一次性动作，持续入库时剩余量用同维度平移再调一次。若仓库曾被他人从 `B` 解禁回 `A`，清零后不要擅自重禁——解禁可能是故意恢复使用，先问用户再 `Forbid`。

## 工具约定

- 新脚本 `scripts/cases/transfer_wm_to_ck.js`（含仓位+可用量重试逻辑）与 `scripts/cases/forbid_wm_stock.js`，默认 dry-run，`--apply --confirm <TOKEN>` 才写；执行后回查两仓库存 + 调拨单 `viewBill`。
- 输出：`output/json/wm_to_ck_transfer_payload.json` / `*_save_result.json` / `*_skipped_shortage.json`。
- 分批建议：45 行可一单或 20 行/单分 3 单，避免单据过大前端加载慢；本次 42+3 已验证一单可行。
- 执行前确认：范围（全量/部分）、单据策略（一单/分批）、是否自动审核、是否禁用源仓。
- 参考现有探测脚本 `scripts/bun_test/_create_*_transfer.ts` 与 `lib/k3` 的 save/submit/audit 封装。


## 混合调拨单删除分录的反审核阻挡（2026-10-30）

- ZJDB2026100316（FID105962）4行中，目标MO261024014为分录123423、N102011890、2.575K，备注MO261024014 0.5片；其余3行属于其他订单。用户授权只清理目标订单，不能整单删除。
- 实时View及元数据确认明细读名TransferDirectEntry，保存实体FBillEntry、分录主键FEntryID。默认dry-run脚本`scripts/scratch/2026-10/remove_zjdb2026100316_row.js`拟UnAudit→仅保留其他行Save→Submit→Audit→逐字段回查，但本次仅执行到UnAudit即失败，未验证此单的分录删除保存步骤。
- 金蝶反审核返回库存更新失败：第1行123420的N102011824，现场仓/固晶、批号1，撤回后负库存-44.800K。说明混合单即使只拟删除第4行，整单反审核仍校验其他行库存。不得据此修改负库存开关、虚增库存或撤回其他订单领料。
- 失败后WebAPI列表与View回查仍C、4行与原数量保留；未执行Save/Submit/Audit。证据：`output/zjdb2026100316-cleanup/1793327497428/before.json`，当前View快照`output/mo261024014-cleanup/transferdirect-before.json`，反审核错误见本次工具输出。先核对该库存维度实际流向并取得具体修正范围，再处理；数量与状态仅为当日快照。

- 同日只读追查：N102011824现场仓批号1现存321.2K，原调入366K；MO261022022的SOUT261030027/048均C，各领22.4K，合计44.8K，与反审核缺口一致。目标N102011890现场仓批号1现存2.575K，塑封原材料仓121.025K。证据`output/mo261024014-cleanup/remedy-probe.json`。可讨论保留备货调拨（仅改BOM不自动要求退仓）或按实物退仓另做目标2.575K反向调拨；反向调拨保留原单且须确认实际退回方向及执行授权，不等于删除原分录。本次未建单、未验证反向调拨审核可用量。

- 用户随后澄清目标为反审核生产订单，不能继续将退仓作为默认目标。实时MO261024014为C、唯一分录280023状态4开工，领料量/汇报量/入库量均0，工序计划查询为空，用料清单PPBOM00178965（278971）仍C。调拨目标行并非只有备注：OrderNo=MO261024014，FBillEntry_Link明确来源T_PRD_PPBOMENTRY、SBillId278971、SId1246787、规则PRD_PPBOM-STK_TransferDirect。因此“调拨是备料”不能证明它一定不影响上游反审/删用料清单。应先保留调拨，按生产订单状态反执行至计划确认再反审核；本次仅查未试，是否阻挡须由真实接口结果确认，若指向PPBOM下游关联再处理，不预先退料或改其他订单。证据`output/mo261024014-cleanup/mo-unaudit-precheck.json`。


### 同案用户明确授权临时负库存后的成功闭环（2026-10-30）

- 用户明确提出并授权：临时开负库存→反审核混合调拨单→仅删第4行→重新审核→关闭负库存→反审核MO。本节是本次明确授权的范围，不赋予后续任务默认改仓库配置权限；前述“不得改负库存开关”指未取得此范围授权阶段。全过程仅WebAPI。
- 现场仓BD_STOCK/111216、CTK08原AllowMinusQty=false。实测已审仓库可直接最小Save `{FStockId:111216,FAllowMinusQty:true}`、NeedUpDateFields=[FAllowMinusQty]，View确认true后执行；完成后同样Save false并列表/View双查，无需反审核仓库。不得用SQL替代。
- ZJDB2026100316 UnAudit→D；Save `{FID:105962,FBillEntry:[{FEntryID:123420},{FEntryID:123421},{FEntryID:123422}]}`、IsDeleteEntry=true仅删除123423；Submit/Audit恢复C，保留3行除Seq外全部字段与前值一致。随后立即恢复CTK08禁止负库存，并回查false。脚本finally尝试恢复设置；任何失败停止后续，回查单据及开关，不自动重跑。
- MO前值C/分录280023状态3；PPBOM子项BaseSelTranslateQty/BaseTranslateQty全部清零后UndoToPlanConfirm（PkEntryIds为数组）→状态2，再UnAudit→D。PPBOM本身仍C、BOM未改。
- 独立回查：MO261024014=D/计划确认；调拨单=C/3行；现场仓负库存开关false且FBaseQty<0记录0；N102011824现场仓321.2K恢复原值，原两张22.4K领料未改；目标N102011890现场仓2.575→0、原材料仓121.025→123.600K；PPBOM调拨占用0。这是账面调拨撤销，实物位置应由现场与仓库对齐，不宣称已物理搬回。
- 证据`output/mo261024014-final/1793329579188/`（完整前后快照、开关写入/恢复、MO与调拨响应、independent-verification.json）；脚本`scripts/scratch/2026-10/finish_mo261024014.js`默认dry-run。本案完成时间为当日快照，复用前全量刷新且逐案授权。

## 2026-10-30 客供蓝膜转现场仓尝试未完成

- 用户明确要求N102012151该批0.5K调到现场仓。实时CTK08正常、允许状态类型8；固晶仓位从现有调拨View确认为组合ID100027（Flex条目100032/3，FF100007），非直接用条目ID。
- 保留客户CTK000009、KCZT001、C00SZA.001，拟CTK04/100015→CTK08/100027。首次Save报源状态不参与核算/目标状态可用不一致；元数据确认仓库更新动作携带默认状态。后置状态并启用基础资料验证后报CTK04不存在；显式自动排序及已确认仓库主键写法亦未解决，未继续扩大写入或改状态绕过。不能将基础资料解析报错解释为仓库真实不存在，也不能宣称调拨成功。
- 实时元数据证据transfer-meta-*.xml；WebAPI GetFormMetaData返回非JSON response_error，此次改用SQL只读元数据。脚本scripts/scratch/2026-10/transfer-bluefilm-site.js默认dry-run；输出output/n102012152-stock/transfer-site.json。
- 最终独立WebAPI回查备注对应调拨单为空；库存仍CTK04/客户CTK000009/批号C00SZA.001/KCZT001为0.5K。未生成单据、未Submit/Audit、未调到现场仓。证据output/n102012152-stock/transfer-failure-verification.json。后续须先解决基础资料解析/字段服务依赖，不盲重试。
