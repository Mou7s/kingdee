# 发货通知单自动锁库（商务员A下推触发）

> 2026-09-02 实测：商务员A下推发货通知单自动销售锁库（按通知单全锁，仅外贸跟单员试点），以 FHTZD056589 为样例完成端到端取证。

## 1. 金蝶里"锁库"的两种含义（必须先问清）

| 类型 | 实质 | 关键表/字段 | 说明 |
|------|------|-------------|------|
| 销售锁库/预留（本案=1） | 将仓库存量硬分配给销售订单行，防抢料 | `T_SAL_ORDERENTRY.FLOCKQTY / FLOCKFLAG` + `T_STK_LOCKSTOCKLOG(FLOCKTYPE=SaleOrder)` | 官方《销售订单锁库和预留》；本案按发货通知单 FQty 全锁源 SO 行 |
| 库存锁定单 | 把库存状态改为锁定，其他单据不能出库 | `STK_LockStock` / `STK_StockLock`（账套差异大，需 `GetFormMetaData` 实测） | 库存管理下的锁定/解锁单，与本案无关 |

两种 API 完全不同，下推触发前必须确认用哪一种。

## 2. 样例实证（FHTZD056589）

- 发货通知单 FID 176739，FBillNo FHTZD056589，状态 C，创建人 商务员A(111677)，客户 CTK000977 Good-Ark，仓库 玻封成品仓 CTK12(111218/100040)，FDate 2026-09-02T15:22:58
- 分录1: Seq1 37.5K BAV103 NAD0010173 来源 SO XSDD034351 FID144638 ( qty 100, FLOCKQTY 0 FLOCKFLAG 0 ) — 未锁
- 分录2: Seq2 20K BAV103 来源 SO XSDD034350 FID144637 ( qty 50, FLOCKQTY 20 FLOCKFLAG 1 ) — 已锁 20K，T_STK_LOCKSTOCKLOG FID104603 FOPERATETYPE Lock FQTY20 FLOT494494 FSTOCKID111218 2026-09-02T15:23:58 操作人 111677
- 发货通知单自身锁标志：`T_SAL_DELIVERYNOTICEENTRY.FLOCKSTOCKFLAG=0 FLOCKSTOCKBASEQTY=0` 两个分录均为 0；ViewBill 字段 `LockStockFlag/LockStockBaseQty/LockStockLeftBaseQty` 同为 false/0
- 库存：`STK_Inventory FMaterial=NAD0010173 FStock=CTK12 FBaseQty 57.5K` 恰好等于通知单总量 57.5，可全锁
- 关联链：`T_SAL_DELIVERYNOTICEENTRY_LK (FENTRYID 237583/237584 -> FSBILLID 144638/144637 FSID 218259/218258 FRULEID SaleOrder-DeliveryNotice FSTABLENAME T_SAL_ORDERENTRY)`

## 3. 物理落地机制（已验证，2026-09-02 端到端打通 FHTZD056589 37.5+20）

- 销售锁库不走 `DynamicFormService.ExcuteOperation`（对 SAL_SaleOrder 和 SAL_DeliveryNotice 试 Lock/LockStock/Reserve/UnLockStock 等均报“没有此接口”）
- **发货通知单自身锁（本次实测通路）**：`SAL_DeliveryNotice` 已审核单必须 `UnAudit(C→D)` 后 `Save` 才能改锁，实体键必须用 `FEntity`（不是 `SAL_DELIVERYNOTICEENTRY`），字段 `FLockStockFlag` 必须传字符串 `"1"/"0"`（布尔 true 不落地），数量字段 `FLockStockBaseQty` 按通知单 `FQTY/FBaseUnitQty` 全量传入。`NeedUpDateFields=["FLockStockFlag","FLockStockBaseQty"]`。验证：`Save FEntity {FEntryID:237583,FLockStockFlag:"1",FLockStockBaseQty:37.5}` 返回 `IsSuccess:true` 但 `SAL_DELIVERYNOTICEENTRY.LockStockFlag` 写会静默忽略；改用 `FEntity.FLockStockFlag="1"` 则 DB `T_SAL_DELIVERYNOTICEENTRY.FLOCKSTOCKFLAG="1" FLOCKSTOCKBASEQTY=37.5` 真落地，View 回查 `LockStockFlag=true LockStockBaseQty=37.5`，走 `Submit→Audit` 后仍保持。回滚用 `"0"/0` 同路径。
- **销售订单源头锁（备选）**：`T_SAL_ORDERENTRY.FLOCKQTY/FLOCKFLAG` + `T_STK_LOCKSTOCKLOG(FLOCKTYPE=SaleOrder)` 为另一套销售锁库，`Save SAL_SaleOrder` 需同样 `UnAudit` 但会触发“价格来源检查”需前端确认，`ViewBill SaleOrderEntry` 不暴露 `LockQty/LockFlag`，联查需直读 `T_SAL_DELIVERYNOTICEENTRY_LK(FENTRYID→FSBILLID/FSID)` 拿源 SO 行。本案发货通知单锁已满足“按通知单全锁”语义，优先用前者；若财务要求锁在销售订单上再切此路径。
- `T_STK_LOCKSTOCK` 本账套为空，`T_PLN_RESERVEBILL` 为空，勿猜 `T_META_FORM`；`T_SAL_DELIVERYNOTICEENTRY.FLOCKSTOCK*` 与 `T_SAL_ORDERENTRY.FLOCK*` 是两套字段，需按触发对象区分

## 4. 三套实现路径

**A. 原生 BOS 单据转换+流程**：在 `SAL_DeliveryNotice` 配转换规则，条件 `FCreatorId=111677` 自动触发锁；优点原生合规，缺点需 BOS 设计器权限、发布后才生效。

**B. 服务端插件**：监听 `DynamicFormService.Push`（source=SAL_DeliveryNotice,target=SAL_OUTSTOCK），判断创建人后 Save 源 SO 锁；最实时，需部署到 K3 服务端。

**C. 外挂轮询（推荐先用 kingdee 仓库验证，已取证）**：Bun 定时脚本每 1-2 分钟扫新增 `SAL_DeliveryNotice`，命中 `FCreatorId=111677 && FDocumentStatus='C' && 存在 FK 指向的 SO 行 FLOCKQTY < 通知单 FQTY` 则 `Save SAL_SaleOrder` 补锁。默认 `dry-run`、`--apply` 才真写，符合 `AGENTS.md` 写操作规范；常驻 `cron` 即可。伪码：

```js
import { K3CloudWebAPI } from "./k3cloud.js";
const api = new K3CloudWebAPI(); await api.login();
// 1. 扫商务员A新建通知单
const dns = await api.executeBillQuery("SAL_DeliveryNotice","FID,FBillNo","FCreatorId=111677 and FDocumentStatus='C'", 50);
// 2. 对每张查 LK 拿源 SO
// SELECT FSBILLID,FSID,FBASEUNITQTY FROM T_SAL_DELIVERYNOTICEENTRY_LK WHERE FENTRYID IN (...)
// 3. 查 SO 行 FLOCKQTY，若 < 通知单 FQty，则 dry-run 列清单：SO FID, FENTRYID, 需补 FQTY
// 4. --apply 时 Save SO: Model { FID, SaleOrderEntry:[{FEntryId:FSID, FLockQty:通知单FQty, FLockFlag:1}] } NeedUpDateFields=["FLockQty","FLockFlag"]
// 5. 回查 T_SAL_ORDERENTRY.FLOCKQTY 与 T_STK_LOCKSTOCKLOG FQTY
```

## 5. 落地前必确认 4 点（本案已确认）

1. 锁哪种：1 销售锁库 ✓
2. 锁多少：按发货通知单 FQty 全锁 ✓（37.5+20）
3. 范围：仅商务员A外贸试点 ✓
4. 仓库：通知单指定仓 CTK12，不固定仓 ✓

## 6. 授权与验证步骤（C 方案）

- 未授权前只 dry-run 列影响行数与 payload，不改库
- 授权后单行试点：对 FHTZD056589 关联 SO 144638 的 37.5K 行做一次 --apply，立即回查 `T_SAL_ORDERENTRY.FLOCKQTY` 与 `T_STK_LOCKSTOCKLOG` 是否新增一条 FQTY 37.5
- 不可用 `OrderString` 默认旧数据坑：扫通知单需显式 `OrderString:"FDate DESC"` 并放大 TopRowCount；统计单据数按 FBillNo 去重，写操作按 FID/ FENTRYID 去重
