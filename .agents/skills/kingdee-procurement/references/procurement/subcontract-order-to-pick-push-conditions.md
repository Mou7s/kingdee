# 委外订单下推委外领料单：报「不符合下推条件」的字段级排查

## 目录

- 现象
- 9 条条件 → 去哪查、通过值是什么
- 首要怀疑：选单量已被既有下游单占用
- 下游单卡在 `B`（审核中）会一次堵三件事
- 「自动审核失败」不落原因，不要在库里找
- 相关表的列分布（踩过的列名坑）
- View 取数的分录键名
- 未定性、但下次会再遇上的现象


## 现象

在委外订单 `SUB_SUBREQORDER` 界面选分录点「下推 → 委外领料单」，弹红框「不符合下推条件」。弹窗会列出 9 条**通用**条件，再补一句 `共选择了 N 行数据进行下推；有 N 行数据不满足下推数据筛选条件；受限于插件在事件(OnInitSelectedRow)中添加的条件`。

**它不会告诉你是哪一条不满足**，必须逐条用数据核对。不要因为「单据状态看起来都对」就断言系统有问题。

## 9 条条件 → 去哪查、通过值是什么

| # | 条件原文 | 查哪里 | 通过值 |
|---|---|---|---|
| 1 | 委外订单对应分录下达或完工，且未挂起 | `viewBill('SUB_SUBREQORDER')` → `TreeEntity[].Status / IsSuspend` | `Status=3`（下达）或完工；`IsSuspend=0` |
| 2 | 委外用料清单已审核 | `SUB_PPBOM.FDocumentStatus`（按 `FSubReqBillNo` 过滤，一单多张） | 全部 `C` |
| 3 | 发料方式为直接领料或调拨领料 | `PPBomEntry[].IssueType` / SQL `T_SUB_PPBOMENTRY_C.FISSUETYPE` | 本账套绝大多数行为 `3`，且大量成功下推的单都是 `3` → 见到 `3` 不要当成「不发料」而误判 |
| 4 | 子项类型不为返还件 | `PPBomEntry[].MaterialType` | — |
| 5 | 不为联副产品 | `PPBomEntry[].PPBomEntryType` | `0` |
| 6 | 有对应的采购订单 | `TreeEntity[].PurOrderNo / PurOrderEntryId / PurOrderEntrySeq` | 非空（本账套形如 `TK…`） |
| 7 | **应发数量 − 领料选单数量 + 来料不良退料数量 + 良品退料数量 > 0** | `PPBomEntry[].MustQty` 与 **`.SelPickedQty`**；SQL `T_SUB_PPBOMENTRY.FMUSTQTY` 与 `T_SUB_PPBOMENTRY_Q.FSELPICKEDQTY` | 差值 `> 0` |
| 8 | 发料组织下存在子项物料 | 子项物料主档 | 存在 |
| 9 | 发料组织下的子项物料允许库存 | `T_BD_MATERIALBASE.FISINVENTORY` | `1` |

**第 7 条是命中率最高的失败点，而且在委外订单列表上完全看不出来。**

## 首要怀疑：选单量已被既有下游单占用

委外订单列表的「领料状态 = 未领料」只反映 `FPickedQty`（**已领**量）。被下游单据占住、但尚未审核出库的量记在 **`FSELPICKEDQTY`（领料选单数量）**，列表不显示。

已经下推过一次、下游单还在（尤其是卡在 `B` 审核中）时，`应发 − 选单量 = 0`，这几行就被插件条件整行过滤，表现为「单据存在、状态也对，就是推不出 / 选不出」。

也就是说：**「下推不了」常常不是要你重新推，而是那一单已经生成过了。** 先去找那张单，别急着找订单的毛病。

先取 PPBOM 分录（一单可能多张用料清单）：

```sql
SELECT h.FBILLNO PPBOM, e.FSUBREQENTRYSEQ Seq, m.FNUMBER 子项,
       e.FMUSTQTY 应发, q.FSELPICKEDQTY 已选单, q.FPICKEDQTY 已领, q.FNOPICKEDQTY 未领
FROM T_SUB_PPBOMENTRY e
JOIN T_SUB_PPBOM h        ON h.FID = e.FID
LEFT JOIN T_SUB_PPBOMENTRY_Q q ON q.FENTRYID = e.FENTRYID
LEFT JOIN T_BD_MATERIAL m ON m.FMATERIALID = e.FMATERIALID
WHERE h.FSUBBILLNO = '<委外订单号>'
ORDER BY e.FSUBREQENTRYSEQ;
```

再反查是哪张单占的：

```sql
SELECT h.FBILLNO 领料单, h.FDOCUMENTSTATUS 状态, h.FDATE, h.FCANCELSTATUS,
       p.FSEQ, p.FAPPQTY 申请量, p.FACTUALQTY 实发量, p.FLOT_TEXT 批号, s.FNUMBER 仓
FROM T_SUB_PICKMTRLDATA p
JOIN T_SUB_PICKMTRL h     ON h.FID = p.FID
LEFT JOIN T_BD_STOCK s    ON s.FSTOCKID = p.FSTOCKID
WHERE p.FPPBOMENTRYID IN (
  SELECT e.FENTRYID FROM T_SUB_PPBOMENTRY e
  JOIN T_SUB_PPBOM b ON b.FID = e.FID
  WHERE b.FSUBBILLNO = '<委外订单号>')
ORDER BY h.FBILLNO, p.FSEQ;
```

`T_SUB_PICKMTRLDATA.FSUBREQBILLNO` / `FPPBOMBILLNO` 可直接按委外订单号或 PPBOM 号过滤，更省事。

## 下游单卡在 `B`（审核中）会一次堵三件事

1. 重新下推（选单量被占，条件 7 不成立）；
2. 委外订单「执行至完工」——日志原文：`关联的下游单据存在未作废且未审核的委外领料单XXX、委外补料单、委外退料单`；
3. 该委外订单分录的反审核 / 删除。

`B` 的单据**不能直接删除**。标准路径二选一：

- 前端打开那张领料单补「审核」——成功则领料业务本身已完成，订单无需再下推；
- 反提交（`B→A`）→ 删除 → 释放选单量 → 重新下推。

判断「只有这一张异常的 B」而不是系统常态：

```sql
SELECT FDOCUMENTSTATUS, COUNT(*) FROM T_SUB_PICKMTRL GROUP BY FDOCUMENTSTATUS;
```

本账套实测 1282 张里仅 1 张 `B`。

## 「自动审核失败」不落原因，不要在库里找

委外领料单的单据类型勾了自动审核时，操作日志只有一行、**没有失败原因**：

```
单据编号为XXX的委外领料单，自动审核失败！
```

`T_BAS_OPERATELOG` / `_BK` 都没有更细的信息，也没有别的异常表接住它。不要花一轮去全库搜原因。

正确做法：请用户在前端点「审核」复现、把红字报错发回来；同时按下面这类可疑点自查。

### 自查项：同单同一批号被多行重复占用

批号级在库量只够一行，两行却都挑了同一批号（例如两行各 `263.4` 都用同一批号，而该批号在库只有 `263.4`），合计超库存 → 审核校验不通过。

```sql
SELECT m.FNUMBER 子项, p.FLOT_TEXT 批号, COUNT(*) 行数, SUM(p.FACTUALQTY) 合计需求
FROM T_SUB_PICKMTRLDATA p
JOIN T_SUB_PICKMTRL h     ON h.FID = p.FID
LEFT JOIN T_BD_MATERIAL m ON m.FMATERIALID = p.FMATERIALID
WHERE h.FBILLNO = '<领料单号>'
GROUP BY m.FNUMBER, p.FLOT_TEXT
HAVING COUNT(*) > 1;
```

再与 `T_STK_INVENTORY` 该批号在目标仓/仓位/库存状态的 `FBASEQTY` 逐行对比。

出现重复批号往往是因为**委外订单本身有完全重复的分录**（同物料、同数量、同 BOM），两行各自生成一张用料清单，选单时每行独立取批号、没做跨行扣减。顺手核一下订单分录是否有完全重复的行，比只修领料单更有价值。

注意：历史成功单里也能见到「同单同物料同批号出现多行」，所以**重复本身不是充分条件**，必须再叠加「合计需求 > 该批号在库量」才成立；不要只凭重复就下结论。

## 相关表的列分布（踩过的列名坑）

- `T_SUB_PPBOMENTRY` 只有基础列。**数量在 `T_SUB_PPBOMENTRY_Q`**：`FPICKEDQTY / FSELPICKEDQTY / FNOPICKEDQTY / FGOODRETURNQTY / FINCDEFECTRETURNQTY / FINVENTORYQTY / FRETURNQTY / FTRANSLATEQTY` 等。**发料方式与库存维度在 `T_SUB_PPBOMENTRY_C`**：`FISSUETYPE / FSTOCKID / FSTOCKLOCID / FOWNERID / FSUPPLYORG / FSTOCKSTATUSID`。两张表都按 `FENTRYID` 关联主分录；另有 `_E`、`_L`、`_LK`。直接查 `FISSUETYPE` / `FPICKEDQTY` 写进 `T_SUB_PPBOMENTRY` 会报列名无效。
- `T_SUB_PICKMTRLDATA` **没有 `FSTOCKORGID`**（在表头 `T_SUB_PICKMTRL`，表头另有 `FSUPPLIERID / FOWNERID / FOWNERTYPEID`）；`T_SUB_PICKMTRLDATA_LK` 也没有 `FID` 列（用 `FENTRYID` / `FSBILLID`）。
- 委外订单：表头 `T_SUB_REQORDER`，分录 `T_SUB_REQORDERENTRY`（供应商字段是 `FSUPPLIERID`，另有 `FSTATUS / FISSUSPEND / FPURORGID / FBASEYIELDQTY`）；`T_SUB_REQORDER` 表头**没有** `FSUPPLIERID`。
- 批号主档 `T_BD_LOTMASTER` **没有 `FLOT_TEXT`**，批号编码是 `FNUMBER`；`FLOT_TEXT` 是单据分录自带的冗余字段，读批号文本直接读分录即可。
- `executeBillQuery('SUB_SUBREQORDER', ..., 'FSeq ...')` 报「元数据中标识为FSeq的字段不存在」——委外订单分录序号从 View 的 `TreeEntity[].Seq` 取。

## View 取数的分录键名

| 表单 | View 分录键 | 常用字段 |
|---|---|---|
| `SUB_SUBREQORDER` | `TreeEntity[]` | `Seq / Status / IsSuspend / PickMtrlStatus / PurOrderNo / BomId / Qty` |
| `SUB_PPBOM` | `PPBomEntry[]` | `MaterialID.Number / MustQty / PickedQty / NoPickedQty / SelPickedQty / IssueType / StockID / StockLocID / InventoryQty` |

## 未定性、但下次会再遇上的现象

- `CTK04 客供料仓` 里这些晶圆的库存行 `FOWNERTYPEID` 是 `BD_Customer`（货主为客户），而委外领料单表头 `FOWNERTYPEID` 是 `BD_OwnerOrg`（货主为组织）。**两者口径差异是否参与领料单审核校验，本账套尚未验证**，只作为下次排查的观察点，不要当成结论。
- 委外领料单的「自动审核」是单据类型上的设置（同批其他单提交后 0.3–0.6 秒即审核成功），因此「提交成功 + 审核失败」是同一秒内自动发生的，不是有人手工点了审核又失败。
