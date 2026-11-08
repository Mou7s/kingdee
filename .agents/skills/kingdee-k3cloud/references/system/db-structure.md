# 金蝶账套数据库结构速查（已实测）

来源：2026-08 对本账套账套的只读统计（sys.tables / sys.partitions）。数字会漂移，量级和结构规律稳定。

## 账套概况

- 服务器 `<SQL_SERVER_HOST>`，账套库 `<K3_MAIN_DB>`（本账套，2024-09 建账）
- SQL Server 2016；数据文件约 183 GB；用户表约 12,000 张
- 连接复用 `lib/k3/index.js` 导出的 `K3_DB_*`（mssql），只读调查优先

## 为什么 1.2 万张表

每类单据一套表 × 头/分录/多语言/扩展拆分。表名前缀 = 模块缩写：

| 前缀 | 模块 |
|---|---|
| `T_BD_` | 基础资料（客户/物料/仓库） |
| `T_SAL_` / `T_PUR_` | 销售 / 采购 |
| `T_PRD_` / `T_SFC_` | 生产 / 车间作业 |
| `T_STK_` | 库存 |
| `T_AP_` / `T_AR_` | 应付 / 应收 |
| `T_GL_` / `T_HS_` | 总账 / 核算 |
| `T_CB_` | 成本 |
| `T_BF_` | 单据转换/下推 |
| `T_BAS_` | 平台公共（操作日志等） |

## 单据存储套路

- 一张单 = 头表 + 分录表（分录表名常带 `ENTRY`，如凭证明细 `T_BAS_VOUCHERENTRY`）
- 后缀 `_L` = 多语言名称表（按 FCUSTID 关联，`FLOCALEID=2052` 为简体中文）
- 后缀 `_EXT` = 扩展属性表（低频字段单独放，与主表一对一）
- 例：客户 = 主表 `T_BD_CUSTOMER` + 名称 `T_BD_CUSTOMER_L` + 扩展 `T_BD_CUSTOMEREXT`

## 大小分布（2026-08 TOP，行数/占用）

- 成本过程表占大头：`T_CB_COSTALLO*REC*_H` 4 张各约 9,000 万行（合计 ~28 GB）；`T_CB_COSTMATTERIAL(_DETAIL)_H` 各约 6,900 万行（~38 GB）
- 操作日志 `T_BAS_OPERATELOGBK(+_S)` 约 2,256 万行（~14 GB）
- 结论：库大不是业务单据多，是成本模块逐物料逐期算过程账滚出来的

## 只读 SQL 的列名与类型坑（物料 / BOM / 单位）

（原 SKILL.md 正文，因触及 10 万字符上限归档，内容未改写）

- `T_BD_MATERIAL_L` 的键是 `FMATERIALID`（写 `FID` 报 Invalid column name 'FID'）；`T_BD_MATERIALCATEGORY_L` 只有 `FCATEGORYID/FLOCALEID/FNAME`（无 `FNUMBER`）；**账套没有 `T_BD_BATCHRULE` 表**，批号规则编码不能靠 SQL 关联取，用 `DynamicFormService.View` 的 `MaterialStock[0].BatchRuleID.Number` 回查。
- BOM 与委外用料清单同样有专有列名：`T_ENG_BOMCHILD` 的子项物料是 `FMATERIALID`、单位 `FUNITID`、头关联 `FID`（`FMATERIALIDCHILD`/`FCHILDUNITID` 只是 `View` 的键名，不是列名）；`T_SUB_PPBOM` 用 `FSUBBILLNO` 关联委外订单号、`FBOMID` 指向 `ENG_BOM.FID`，**没有 `FMOBillNo`（生产 PPBOM 才有）/`FCUSTOMERID`**，分录 `T_SUB_PPBOMENTRY` 没有 `FQTY`/`FPICKEDQTY`（在 `_Q` 表）。
- **`T_BD_MATERIALBASE` 的 `FISPURCHASE/FISINVENTORY/FISSALE/FISPRODUCE` 经 mssql 返回字符串 `'0'/'1'` 而不是布尔**：写 `x.FISPRODUCE ? 1 : 0` 会把 `'0'` 判为真，让外购料误报「产是」；判断必须 `=== '1'` 或 `Number()`，购/存/销/产口径优先用 WebAPI 的 `FIsProduce` 等字段核对。
- 同族表名/列名不能类推：销售出库 / 采购入库分录是 `T_SAL_OUTSTOCKENTRY` / `T_STK_INSTOCKENTRY`（**`T_STK_OUTSTOCKENTRY` 不存在**，写它会报 Invalid object name）；**入库分录没有 `FQTY`**，实收量是 `FREALQTY`（`FQTY` 只有 `T_PUR_POORDERENTRY` 有）；`T_SFC_OPERPLANNING` **没有 `FMATERIALID`**，不能拿它统计某物料的引用面。单位编码只在主表 `T_BD_UNIT.FNUMBER`，`T_BD_UNIT_L` 只有名称。

## 时间与经办人：金蝶时间一律在 SQL 端格式化

- 账套里存的是**北京时间**，但 mssql/tedious 把 `datetime` 读成带 `Z` 的 JS Date（按 UTC 解释）：直接 `.toISOString()` 或打印会平移 8 小时，报给用户的时间就是错的。
- 正确写法（让 SQL Server 自己格式化，取回原文串）：

```sql
SELECT FNUMBER,
       CONVERT(varchar(19), FCREATEDATE, 120)  AS 建档,
       CONVERT(varchar(19), FAPPROVEDATE, 120) AS 审核,
       CONVERT(varchar(19), FMODIFYDATE, 120)  AS 修改,
       FCREATORID AS 建单人ID
FROM T_BD_MATERIAL WHERE FNUMBER IN ('N111020003','N111020030');
```

- 时区自证：拿单据号里的日期与 `FDATE` 的原始串比对（`TK20250609023` → `2025-06-09 00:00:00`），一致即可把原文串直报给用户。
- 物料的时间/经办人列：`T_BD_MATERIAL` 有 `FCREATEDATE/FCREATORID`、`FAPPROVEDATE/FAPPROVERID`、`FMODIFYDATE/FMODIFIERID`、`FFORBIDDATE`（禁用日期）。用 `INFORMATION_SCHEMA.COLUMNS` 查含 `DATE|CREA|MODIF|AUDIT` 的列比猜名字快。
- **用户姓名只在 `T_SEC_USER`**（`FUSERID`/`FNAME`/`FUSERACCOUNT`/`FFORBIDSTATUS`），`T_BD_USER`、`T_BD_USER_L` 都不存在；由 `FCREATORID/FAPPROVERID` 反查经办人姓名走这张表。只取需要的列，别 `SELECT *`——该表含口令散列。

## 客户冻结字段（T_BD_CUSTOMEREXT）

- `FFREEZESTATUS`：`A`=正常，`B`=冻结
- `FFREEZELIMIT`：`OutStock`=禁止出货（其余取值未逐一验证）
- `FFREEZEOPERATOR` / `FFREEZEDATE`：冻结人 / 冻结日期
- 标准解冻：`bun run unfreeze-customer -- <CUST> [--apply]`（先 dry-run）；SOP 见仓库 `.agents/skills/kingdee-sales-inventory/references/customers/customer-unfreeze-by-name.md`
- 按中文名查客户（只读模板）：

```sql
SELECT c.FNUMBER, cL.FNAME, ext.FFREEZESTATUS, ext.FFREEZELIMIT, ext.FFREEZEDATE
FROM T_BD_CUSTOMER c
JOIN T_BD_CUSTOMER_L cL ON c.FCUSTID=cL.FCUSTID AND cL.FLOCALEID=2052
LEFT JOIN T_BD_CUSTOMEREXT ext ON c.FCUSTID=ext.FCUSTID
WHERE cL.FNAME LIKE @name;
```

## 背景：2026-07-03 批量冻结事件

当天出现一次性批量冻结约 478 家客户（全部 `OutStock`、同一操作员 100081），对应 `scripts/bun_test/batch_freeze_no_increase.ts`（对无订单增长客户禁发货）。个别解冻只动该客户一行，不影响批内其他人。
