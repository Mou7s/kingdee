# 受托加工材料：收料 → 入库 → 退料

客户把客供料送来加工（受托），料进仓、投产、要不要退回客户，全在这三张单上。用户问「为什么关闭/能不能反关闭」见 `bill-close-and-reopen.md`；本文件管**退料怎么走**。

## 一、单据、FormId 与表

| 单据 | FormId | 单号前缀 | 表 |
|---|---|---|---|
| 受托加工材料收料单 | `STK_OEMReceive` | `STCLSL…` | `T_STK_OEMRECEIVE` / `_ENTRY` / `_ENTRY_S` / `_BOM` / `_ENTRY_LK` |
| 受托加工材料入库单 | `STK_OEMInStock` | `STCLRK…` | `T_STK_OEMINSTOCK` / `_BOM` / `_ENTRY` / `_BOM_LK` |
| 受托加工材料**退料单** | `STK_OEMInStockRETURN` | `STCLTL…` | `T_STK_OEMINSTOCKRTN` / `_ENTRY` / `_ENTRY_LK` |

FormId 靠试不靠猜：对候选跑一条 `executeBillQuery`，不存在的会明确报「标识为X的业务对象不存在，或者被删除」（`STK_OEMINSTOCKRTN`、`STK_OEMReturn` 都无效，正确写法是全大写的 `STK_OEMInStockRETURN`）。**不要查 `T_META_OBJECTTYPE` 找表单名**：该表只有 `FID/FMODELTYPEID/FKERNELXML…`，没有 `FNAME/FNUMBER`，名称埋在 `FKERNELXML` 里。

## 二、退料有两条下推规则，用途不同（两条都在启用）

| 下推来源 | 转换规则（`FRULEID`） | 本账套历史口径 |
|---|---|---|
| **入库单** → 退料单 | `STK_OEMInStock-STK_OEMInStockRETURN` | **库存退料 + 退料不补料**，整批退（几十~数千 K） |
| 收料单 → 退料单 | `STK_OEMReceive-STK_OEMInStockRETURN` | **检验退料 + 退料不补料**，基本每张 1K 抽检小量 |

**客户要退回整批客供料 → 从受托加工材料入库单下推，退料类型选「库存退料」。** 从收料单下推会把整批退料做成 1K 抽检口径，不要用它退大批。判断下推来源不必猜：退料单分录的 LK 行 `FRULEID` 就是转换规则名，`FSTABLENAME` 指明来源表。

枚举值（`T_META_FORMENUMITEM` join `_L.FCAPTION`，`FLOCALEID=2052`）：

- `FRETURNTYPE` 退料类型：`StockReMat` = 库存退料，`TestReMat` = 检验退料
- `FRETURNSTYLE` 退料方式：`ReturnNoFeed` = 退料不补料，`ReturnFeed` = 退料补料

## 三、下推前必须查的三件事

1. **源单分录是否已下推过退料**：按 `FSTABLENAME='T_STK_OEMINSTOCKENTRY' AND FSID=<入库单分录 FENTRYID>` 查 `T_STK_OEMINSTOCKRTNENTRY_LK`；两个条件都要带（见坑）。
2. **现存量**：`T_STK_INVENTORY` 按物料内码看各仓余量。退料是从仓库出库，量不够会直接报「库存不足/可用量不足」。
3. **料去哪了**：客供料进 `CTK01` 后常被 `STK_TransferDirect` 整批调拨到现场仓 `CTK08`，再被 `PRD_PickMtrl` 领用挂 MO。现存量 0 而客户要退，先走现场/生产退料把未耗用部分退回仓库；**已投产进工序的部分退不回来**，只能按损耗/报废或补料处理，要现场与业务确认。

退料单还要选仓库/仓位/批号（按入库单带出，取当前有库存的那个 Lot）和货主（客户）。

## 四、收料单「已关闭」不影响退料

收料单入满后系统自动整单关闭（业务关闭）**不需要先反关闭**——退料是独立的反向出库业务，不在关闭状态的校验范围内。回复顺序：先讲清关闭是正常的自动业务关闭、不是异常，再讲退料路径与库存约束，避免用户为了退料去动关闭状态。

## 五、字段与坑

- **LK 归属必须同时限定 `FSTABLENAME`**：不同表的 `FENTRYID` 会撞号，只按 `FSID` 匹配会把别家单据的下推量算到目标单头上，直接答错「本单是否已下推过退料」。各 LK 表列名也不统一（`FBASEQTY` vs `FBASEUNITQTY`，`T_STK_OEMINSTOCKBOM_LK` 连 `FID` 列都没有），查前先列列名。
- 收料单分录**没有** `FQty`/`FReceiveQty`（报「元数据中标识为FQty的字段不存在」），用 `FACTLANDQTY` / `FACTRECEIVEQTY` / `FREJECTQTY`，已关联入库基数看 `_S.FSTOCKJOINBASEQTY`；入库单与退料单的分录用 `FQTY`。
- 来源单号不在分录里：入库单看 `T_STK_OEMINSTOCKBOM.FSRCBILLNO/FSRCENTRYID`；退料单看 `_ENTRY_LK`。
- 退料单大表里大量检验退料长期停在 `FDOCUMENTSTATUS='A'` 草稿；回复退料方案时主动提示目标客户/物料是否存在未审核的退料草稿，避免重复退料。

## 六、输出模板

1. 直接答「整批退料 = 从入库单下推」+ 类型/方式取值，并说明收料单那条规则的口径差异。
2. 列源单（入库单号 / 数量 / 是否已下推过退料）。
3. 讲清**库存卡点**：收货 → 调拨 → 领用的时间与数量链，现存各仓余量，能退多少 / 退满还缺什么。
4. 提醒未审核的退料草稿。
5. 问清「退多少、退哪张」，先做只读预检，再给前端一步一动作的指引或按授权执行。

## TX1003112 错料更正范围检查（2026-11-02，只读）

- STCLSL003254仅1行客供材料NC00000007/131.75K；STCLRK002014共3行，目标第2行105134，同单另外两行NC00000006为12.648/126.480K。ZJDB2026100313共4行，目标第4行123414/131.75K；另外三行06为139.128/145.452/50.592K，均CTK11到CTK08。
- 06现场库存当前全零；已审领料SOUT261028050/261031094/261031095/261031096/261031098可按同客户、批号核对合计335.172K，与调拨前三行合计一致。不能为改目标行直接整单反审调拨，再倒推撤销其他工单领料；本次未尝试反审，不能把库存关联风险说成已取得的API反审失败报错。
- 目标07现场库存131.75K，客户CTK000400、批号1、可用状态KCZT01_SYS、基本预留量0；查询FBaseAVBQty返回0，不能仅凭预留0保证审核可用量。10月以来07生产领/退、受托退、委外领、其他出库查询均空。同料存在销售出库，但TK202610160461的122.8K等行属组织100/OEM仓，与客户材料库存维度不同，不能混算。
- WebAPI发现STK_InvBal并查询库存组织1按FBalDate倒序，最新结存日期2026-09-30。结合库存关账生成余额的官方说明可作为未见10月库存关账的证据；STK_Account/HS_AccountOpenClose的QueryBusinessInfo返回Entrys空，未直接取得库存关账配置及成本关账日期，不可据余额日期声称所有财务期间均开放。
- 建议评估当前期间仅对131.75K进行有依据的错料更正：同客户/现场玻封上带/批号1/状态，07出库、06入库，再原清单正常工序领料。沿用closed-period-oem-correction.md已验证的其他出入库流程，但本案例未新增、保存或审核更正单；需明确本次动作授权，不变货主、不改销售产品/生产订单/共用BOM。原单链保留并在更正备注交叉引用，按财务确认的更正业务类型办理。
- 证据output/tx1003112-check-*.json；探针scripts/scratch/2026-11/check-tx1003112-correction.js、check-tx1003112-close.js。所有状态仅为当次快照。

- 2026-11-02用户明确授权上述其他出入库更正后，实时预检无TX1003112更正单、07客户现场库存131.75K/预留0、06非零库存空，PPBOM仍C/06/131.75K/已领0。部门取TX1003112工序50实时WorkCenterId.DeptID=BM000039，而非猜整单车间部门。
- 默认dry-run后创建并逐单Submit/Audit：其他出库QTCK2026110012（106866），07/131.75K；其他入库QTRK001157（101180），06/131.75K。两单日期2026-11-02、状态C，客户货主CTK000400、CTK08/玻封上带100053、批号1、KCZT01_SYS均回查一致。出库后两料非零库存空，入库后06同维度131.75K、07非零库存空，总量守恒。
- 新登录独立查询确认两单列表/View均C，原收料103297、入库102047、调拨105959完整View与预检快照逐字段一致。PPBOM00174062仍C，06/应发131.75K/已领0/金诚信货主；未生成领料，用户自行工序领料，不能称已领用或现场实物新增加。
- 执行脚本scripts/scratch/2026-11/correct-tx1003112-misc.js默认dry-run并按备注查重，已完成后不可重跑apply；证据output/tx1003112-misc-correction/含execution、草稿/审核View、independent-verification。此为本次明确授权个案，不推广为无需授权的通用库存换料动作。
