# 客户简称（FShortName）命名口径与「数字开头」分类

用户问「客户列表 简称 数字开头分类」这类请求时的完整口径、实测分布与取证方法。

## 1. 结构（实测）

```
<两位数字 01~05><等级字母 A/B/C/D><城市码><名称缩写>[-W]
01CZHSMDR  → 01 + C + ZH(珠海) + SMDR
02BJSJJ    → 02 + B + JS(江苏) + JJ
01B KO-W   → 外贸客户，尾缀 -W
```

- 数字开头 876 家；非数字开头 162 家用的是**同一套规则**，只是少了前导两位（`SZCJW`、`SZXLF`、`TI-W` 等）；简称空 2 家。
- `-W` 是外贸客户既有写法；数字开头里 96 家带 W。简称允许含空格（约 95 家，如 `01A Ane-W`、`02A ag-W`）。

## 2. 分类汇总（按前两位 × 等级位）

| 前两位 | A | B | C | D | 合计 | 其中 -W | 部门分布 |
|---|---:|---:|---:|---:|---:|---:|---|
| 01 | 16 | 59 | 133 | 44 | 252 | 26 | 内贸193 外贸26 总经办19 终端11 物控3 |
| 02 | 10 | 32 | 253 | 118 | 413 | 13 | 内贸359 总经办29 外贸13 物控10 终端2 |
| 03 | 4 | 8 | 11 | 0 | 23 | 8 | 内贸11 外贸8 总经办4 |
| 04 | 8 | 14 | 20 | 15 | 57 | 0 | 内贸28 物控22 总经办6 终端1 |
| 05 | 3 | 25 | 66 | 37 | 131 | 49 | 内贸79 外贸49 总经办3 |
| 合计 | 41 | 138 | 483 | 214 | 876 | 96 | — |

## 3. 已证伪：`01~05` 不代表任何已查过的业务维度

逐项交叉核对，**全部无对应关系**，因此不得把它当地区码/业务员号/等级档使用：

- 销售部门、销售员、客户分组（各组都横跨多个部门与销售员）；
- 城市码（`01/02` 都以 `SZ`、`DG` 为主）；
- 结算币别（`PRE001` 人民币 / `PRE007` 美元 在各组都出现）；
- 客户类别（`FCustTypeId.FNumber`，取值 `0A/0B/0C/0D` 或空，与第三位字母只弱相关）；
- 建档日期（五组都跨 2024-09-29 ~ 2026-09-16）；
- 客户编码段（`CTK0000xx` 与 `CUST0xxx` 混用）；
- 是否有销售订单（各组绝大多数客户都有订单：01 组 252 家中 221 家有单，03 组 23 家中 20 家有单）。

结论写法：给「结构 + 分布 + 样例」，明确写「这两位含义待业务确认」，**不要替用户编解释**。

## 4. 导出与交付

```bash
bun scripts/tools/export_customer_shortname_digit.js
# → output/customer_shortname_digit_YYYYMMDD.xlsx
```

四页签（xlsx 多 Sheet，扁平无筛选/表格样式，避免 Excel 修复提示）：`总览` / `分类汇总`（前两位×等级矩阵 + 部门分布 + -W 数）/ `数字开头明细`（876 行）/ `非数字开头对照`（162 行）。明细列：客户内码、客户编码、客户名称、简称、单据状态、禁用状态、销售部门、销售员、客户分组、建档日期、前缀两位数字、等级位、城市码、名称码、是否外贸后缀W。

回复形态：会话内直接给「总数 + 结构说明 + 分类汇总表 + 已证伪的负结论」，再附文件路径与 MEDIA 卡片，并问用户要不要换分组维度（部门/销售员/城市码）。

## 5. 字段与查询

- WebAPI：`FCUSTID,FNumber,FName,FShortName,FDocumentStatus,FForbidStatus,FSALDEPTID.FNumber,FSALDEPTID.FName,FSeller.FName,FGroup.FName,FCreateDate`（`FSALDEPTID.FName`、`FGroup.FName`、`FSeller.FName` 均可用；`TopRowCount` 给 20000，客户量约 1000 行，不触 1 万行上限）。
- **`FCustTypeId.FName` 不存在**：报「元数据中标识为FCustTypeId的字段上的引用字段FName不存在」；只取 `FCustTypeId.FNumber`。账套也没有 `T_BD_CUSTTYPE` 表，类别主档名未定位。
- SQL：名称/简称在 `T_BD_CUSTOMER_L`（键 `FCUSTID`，列 `FNAME`/`FSHORTNAME`），`FLOCALEID=2052`。

## 6. 「某段命名是否编码业务属性」的通用取证法

不要凭规律下结论。按前缀分组与业务表交叉计数，差异明显才是证据：

```sql
SELECT LEFT(l.FSHORTNAME,2) AS p2, SUBSTRING(l.FSHORTNAME,3,1) AS lv,
       COUNT(DISTINCT c.FCUSTID) AS cust,
       COUNT(DISTINCT CASE WHEN o.FID IS NOT NULL THEN c.FCUSTID END) AS 有订单客户,
       COUNT(DISTINCT o.FID) AS 订单数
FROM T_BD_CUSTOMER c
JOIN T_BD_CUSTOMER_L l ON l.FCUSTID=c.FCUSTID AND l.FLOCALEID=2052
LEFT JOIN T_SAL_ORDER o ON o.FCUSTID=c.FCUSTID
GROUP BY LEFT(l.FSHORTNAME,2), SUBSTRING(l.FSHORTNAME,3,1)
```

注意 `T_SAL_ORDER` 的客户列是 `FCUSTID`（`T_SAL_OUTSTOCK`/`T_AR_RECEIVABLE` 是 `FCUSTOMERID`，不统一）。
