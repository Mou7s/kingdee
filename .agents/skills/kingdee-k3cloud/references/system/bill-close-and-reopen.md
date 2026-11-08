# 单据「关闭 / 反关闭」判定（业务关闭 vs 手工关闭）

用户问「这单为什么关闭了 / 能不能反关闭」时，先定性是**业务关闭**还是**手工关闭**，再回答能不能放开。不要凭单据状态猜，也不要直接去点反关闭。

## 一、字段与判据

| 字段 | 位置 | 取值 |
|---|---|---|
| `FCLOSESTATUS` | 表头 | `A` 未关闭 / `B` 已关闭 |
| `FCLOSEFLAG` | 表头 | `0` 业务关闭（系统自动）/ `1` 手工关闭 |
| `FCLOSERID` / `FCLOSEDATE` | 表头 | 关闭人 / 关闭时间 |
| `FBUSINESSCLOSED` | 分录 | `B` 即该行业务关闭（如 `T_STK_OEMRECEIVEENTRY`） |

`FCLOSEFLAG` 决定能不能反关闭，优先看它，不要只看 `FCLOSESTATUS`。受托加工材料收料单全账套实测：已关闭 2271 张中手工关闭仅 1 张——本类单据的「已关闭」几乎都是下游执行完成的业务关闭。

## 二、系统只给手工关闭的单反关闭

对业务关闭的单执行反关闭，金蝶会直接拒绝并**把规则原文写进操作日志**：

> 单据编号为「XXX」的……单，非业务关闭（手工关闭标识为是）才允许整单反关闭！

所以判断「能不能反关闭」最快的只读方法不是试探写操作，而是扫操作日志看该对象历史上有没有同类尝试：

```sql
SELECT TOP 40 l.FDATETIME, l.FOBJECTTYPEID, l.FOPERATENAME, l.FDESCRIPTION, u.FNAME AS uname
FROM T_BAS_OPERATELOG l LEFT JOIN T_SEC_USER u ON u.FUSERID = l.FUSERID
WHERE l.FOBJECTTYPEID = 'STK_OEMRECEIVE'   -- 或目标 FormId 的大写形式
ORDER BY l.FDATETIME DESC;
```

列名坑：`T_BAS_OPERATELOG` 的操作人是 **`FUSERID`**（没有 `FOPERATORID`），用户名取 `T_SEC_USER.FNAME`（没有 `FU_NAME`）。`FDATETIME` 是 UTC，+8h 才是北京时间。日志会同时留下「打开单据 / 列表查询 / 审核 / 反关闭」等动作，可用来还原是谁在什么时候操作的。

## 三、业务关闭的触发机制（受托加工材料收料单）

金蝶官方手册：**「受托加工材料收料全部入库后，系统会自动将物料明细行置为行关闭；所有明细行都为行关闭时，会自动整单关闭；也可以手工执行整单关闭。」**

实证对法：把收料单的关闭时间与下游入库单的审核时间对齐——同一秒、关闭人 = 入库单审核人，即反写自动关闭。

| 单据 | FormId | 单号前缀 | 表 |
|---|---|---|---|
| 受托加工材料收料单 | `STK_OEMReceive` | `STCLSL…` | `T_STK_OEMRECEIVE` / `_ENTRY` / `_BOM` / `_ENTRY_S` / `_ENTRY_LK` |
| 受托加工材料入库单 | `STK_OEMInStock` | `STCLRK…` | `T_STK_OEMINSTOCK` / `_BOM` / `_ENTRY` / `_BOM_LK` |

**收料单分录表没有 `FQty` / `FReceiveQty`**（WriteAPI 查会报「元数据中标识为FQty的字段不存在」）。真实列是 `FACTLANDQTY`（实到）/ `FACTRECEIVEQTY`（实收）/ `FREJECTQTY`（拒收），检验类数量在 `_S` 表（`FCHECKQTY` / `FRECEIVEQTY` / `FREFUSEQTY`），已关联入库基数看 `FSTOCKJOINBASEQTY`。入库单的分录表 `T_STK_OEMINSTOCKENTRY` 也**没有 `FSRCBILLNO`**，源单在 `T_STK_OEMINSTOCKBOM`（`FSRCBILLNO` / `FSRCENTRYID`），下游链接查 `_BOM_LK` / `_ENTRY_LK`（用 `FSBILLID`，无 `FID` 列）。

判定「是否已全部入库」用一句 SQL 拉对照表，比逐单看界面快：

```sql
SELECT r.FBILLNO, r.FCLOSESTATUS, r.FDOCUMENTSTATUS,
       SUM(e.FACTLANDQTY) AS 应收, SUM(e.FACTRECEIVEQTY) AS 实收,
       ISNULL((SELECT SUM(b.FQTY) FROM T_STK_OEMINSTOCKBOM b WHERE b.FSRCBILLNO=r.FBILLNO),0) AS 已入库
FROM T_STK_OEMRECEIVE r JOIN T_STK_OEMRECEIVEENTRY e ON e.FID=r.FID
GROUP BY r.FBILLNO, r.FCLOSESTATUS, r.FDOCUMENTSTATUS;
```

入满的转 `B`、未入满的（含只差 1K 的）仍是 `A`，这个对照本身就是「自动关闭」的证明，回复时可以直接引用。

## 四、要放开只能从下游倒推，先查料去哪了

自动业务关闭不提供反关闭入口；让「已入库数量 < 应收数量」才有机会解除——即反审核（必要时删除）下游受托加工材料入库单。**动手前必须先查实物流向**，否则会撞库存不足或已领用：

1. 下游入库单状态与数量：`STCLRK…` 是否已审核、是否被作废、数量是否等于收料数量。
2. 库存流向：`T_STK_INVENTORY` 按物料内码看各仓余量；再用 `STK_TransferDirect`（客供料常 `CTK01 → CTK08`）和领料确认是否已被现场消耗。
3. 只有「料仍在库、未被耗用」时，反审核入库单才可能干净回退；已消耗则要业务与现场确认，并提示替代路径（委托加工材料退料单「退料补料」或新开收料单，而不是硬反关闭）。

这类反审核/删除属于写操作，必须取得对具体单据的明确授权后再执行，并把「关闭是正常的业务关闭、不是异常」这一点先讲清楚，避免用户为改状态而触发不必要的库存回退。

## 五、输出模板

1. 一句话定性：`A/B` 状态 + `FCLOSEFLAG` 归属（业务关闭 / 手工关闭）。
2. 表：单号 / FID / 单据状态 / 关闭状态 / 数量 / 关闭时间 / 关闭人。
3. 原因：入满 → 下游入库单在什么时间被谁审核 → 关闭时间与之一致；引官方手册原句。
4. 能不能反关闭：给系统拒绝的**原文**（日志里就有），不要只说「不能」。
5. 真要做怎么走 + 现状约束（料已消耗多少），并问清用户目的再动手。
