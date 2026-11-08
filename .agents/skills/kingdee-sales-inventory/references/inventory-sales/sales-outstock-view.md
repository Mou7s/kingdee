# 销售出库单 SAL_OUTSTOCK 明细查看与状态追溯
## 目录

- 入口与 View 取数
- 状态时间线与 SQL 列名
- 分录备注追加与字段定位
- 打印人名与页面不一致的只读诊断


用户给一个单号说「查询销售出库单 X」时，交付的是**会话内的表头表 + 明细分录表 + 合计 + 状态时间线**（内容直接展示，不只给文件路径）；`search-bill` 只给表头（FID/状态/日期），必须再 `viewBill` 拉明细。

## 入口

```bash
bun run search-bill -- TK202608311374
# -> SAL_OUTSTOCK FID:135169 已审核 2026/8/31
```

```js
import { K3CloudWebAPI } from "./lib/k3/index.js";
const api = new K3CloudWebAPI();
await api.login();
const v = await api.viewBill("SAL_OUTSTOCK", 135169);
const e = v.SAL_OUTSTOCKENTRY || []; // 正确分录键
```

## View 取数

- 分录键是 `SAL_OUTSTOCKENTRY`，用 `FEntity` / `SaleOutStockEntry` 取到 0 行。
- 数量看 `RealQty` / `MustQty`，`Qty` 可能取不到；金额看 `Price`（不含税）/ `TaxPrice`（含税）/ `Amount` / `AllAmount`（价税合计）。**税率 0 时含税单价 = 不含税单价**，合计按 `RealQty` 与 `AllAmount` 求和。
- 物料名称/规格是**多语言数组**，直接拼字符串会打成 `[object Object]`，必须 `Name.find(x=>x.Key===2052)?.Value` 取：`MaterialID.Number` 料号、`MaterialID.Name` 名称、`MaterialID.Specification` 规格。
- 仓库 `StockID.Number`、仓位 `StockLocID.Number`（或 `StockLocID_Id`）、批号 `Lot.Number` / `Lot_Text`、来源 `SrcBillNo`/`SrcType`——**这些只是 View 键，不是数据库列名**（见下）。
- 表头：客户 `CustomerID.Number/Name`、销售部门 `SaleDeptID`、销售组 `SalesGroupID`、销售员 `SalesManID`、单据类型 `BillTypeID`、备注 `Note`、`CancelStatus`（作废是独立于 `DocumentStatus` 的另一条轴）。
- 币别/汇率等在 `SAL_OUTSTOCKFIN`（人民币 `SettleCurrID=PRE001`、`ExchangeRate`）；表头自定义字段（如 `F_UNW_Qty_83g`）可直接读，用来交叉校验明细合计数量。

## 「为什么是重新审核 D」——状态时间线

`FDocumentStatus`：`A` 未审核/草稿、`C` 已审核、`D` 重新审核（已被反审核）。看到 `D` 不要猜原因，直接把操作日志按单号拉成时间线：

```sql
SELECT l.FDATETIME, l.FOBJECTTYPEID, l.FOPERATENAME, l.FINTERID,
       u.FNAME AS USERNAME, l.FCLIENTTYPE, l.FIPADDRESS, LEFT(l.FDESCRIPTION,200) AS D
FROM T_BAS_OPERATELOG l LEFT JOIN T_SEC_USER u ON u.FUSERID = l.FUSERID
WHERE l.FOBJECTTYPEID = 'SAL_OUTSTOCK' AND l.FDESCRIPTION LIKE '%<单号>%'
ORDER BY l.FDATETIME;
```

- 保存→提交→审核→打印预览都会落日志；`打开单据` 行带 `EDIT`/`VIEW` 与操作人 IP/主机名，可判断「谁此刻在动这张单」。
- **本组织审核销售出库会自动同步生成应收单**：审核那一秒日志里先出现「对应组织 XXX 设置是否自动生成应收单为 True 生成方式为 1:Sync」与「编号为 TK… 的销售出库单，生成应收单」，紧跟着同一批时间戳出现该应收单的保存/提交/审核（`FOBJECTTYPEID='AR_receivable'`、`FINTERID` 是应收 FID），并另有一条 `FOBJECTTYPEID='SAL_OUTSTOCK'`、`FINTERID='0'` 的重复行写该应收单号。
- **反审核出库单前必须先把这张自动应收单反审核并删除**，否则出库单反不掉；因此看 `D` 状态的出库单时，库里按来源单号查应收常常是 **0 行——这是正常的**，不等于「从来没生成过」。判定有无生成过一律用日志，不用当前表。
- `T_BAS_OPERATELOG` 现表按单号 `LIKE` 查可行；**`T_BAS_OPERATELOGBK` 全表扫会超时**，归档日志必须加 `FDATETIME` 时间段 + `FOBJECTTYPEID` 限定。
- `FDATETIME` 存的是服务器本地时间：先与该库 `SELECT GETDATE()` 对一次口径再换算时间线。

## 反审核后 `FApproveDate` 不可信

反审核会把 `FAPPROVEDATE` 刷成**反审核那一刻**（本单审核在 00:26、反审核在 01:25，`FAPPROVEDATE` 落在 01:25）。所以 `D` 状态单据的 `FApproveDate` 不是审核时间——单据日期/创建时间看 `FDATE`/`FCREATEDATE`，审核与反审核的先后、时间、操作人一律以操作日志为准。

## SQL 列名坑（写只读查询前先核 `INFORMATION_SCHEMA`）

- `T_SAL_OUTSTOCK` 客户列是 **`FCUSTOMERID`**（写 `FCUSTID` 报 Invalid column name）；`T_SAL_ORDER` 才是 `FCUSTID`，同族表不统一。
- `T_SAL_OUTSTOCKENTRY` **没有来源单号列**（View 的 `SrcBillNo` 不是物理列），只有 `FINSTOCKBILLNO`/`FRECEIVEBILLNO` 与 `FSRCENTRYID`。来源链在 **`T_SAL_OUTSTOCKENTRY_LK`**：`FSBILLID`（源单 FID）/`FSID`/`FSTABLENAME`/`FRULEID`（如 `SaleOrder-OutStock`），按 `FID` 关联本单分录。
- `T_AR_RECEIVABLEENTRY` 的来源单号列是 **`FSOURCEBILLNO`**（写 `FSRCBILLNO` / `FSRCENTRYID` 报 Invalid column name）；`T_AR_RECEIVABLE` 用 `FBILLNO`/`FCUSTOMERID`/`FDATE`。应收侧完整排查口径见 `references/inventory-sales/sales-outstock-ar-link.md`。
- `T_SAL_OUTSTOCKENTRY` 没有 `FROWARSTATUS`（`RowARStatus` 只是 View 键）；AR 关联列用 `FARJOINQTY/FBASEARQTY/FJOINSTATUS` 等。
- 任何「没查到 / 0 行」的结论先自检：同表不带条件 `COUNT(*)` 一次（`T_AR_RECEIVABLEENTRY` 30 万行以上），再按一张已知来源单号抽样一次；自检为空立即停，不把空结果当结论。

## 分录备注追加（`FEntrynote`）

用户说「某几行的备注后面加上 X」时改的是**分录备注**，不是表头备注——两者在 View 里都叫 `Note`，Save 字段键却不是同一个：

| 位置 | Save 字段键 | View 属性 | 库列 | Editlen |
|---|---|---|---|---|
| 表头备注 | `FNote` | `Note` | `T_SAL_OUTSTOCK.FNOTE` | 1000 |
| 分录备注 | `FEntrynote`（`EntityKey=FENTITY`） | `SAL_OUTSTOCKENTRY[].Note` | `T_SAL_OUTSTOCKENTRY.FNOTE` | 255 |

- 动手前先按账套既有写法定格式（本账套是 `<年号>/<代码>`，如 `26年/A-1-3`、`26年/B-1-1`），不要自己挑分隔符：
  `SELECT TOP 20 h.FBILLNO, '['+e.FNOTE+']' AS N FROM T_SAL_OUTSTOCKENTRY e JOIN T_SAL_OUTSTOCK h ON h.FID=e.FID WHERE e.FNOTE LIKE '%A-1-3%'`。
- 分录内码 **`executeBillQuery` 查不出来**：FieldKeys 里写 `FEntryID` 直接报「输出的字段FEntryID其在指定实体tempObject上的属性没有找到映射或不是简单属性」——一律用 `viewBill` 读 `SAL_OUTSTOCKENTRY[].Id` 当 `FEntryID`（`FID`/`FBillNo` 仍可用 `executeBillQuery` 取）。
- `D`（反审核）状态可以直接保存，保存后仍是 `D`；不需要先反审核，也不要顺手 Submit/Audit（应收单会随审核重新生成）。

```js
await api.post("DynamicFormService.Save", { formid: "SAL_OUTSTOCK", data: {
  Creator: "", NeedUpDateFields: ["FEntrynote"], IsDeleteEntry: false,
  Model: { FID, FEntity: [{ FEntryID, FEntrynote: "26年/A-1-3" }, /* ... */] },
}});
```

**`IsDeleteEntry: false` 必须显式传**，否则模型里没列出的分录会被当成删除对象。

稳定工具 `scripts/tools/append_outstock_entry_note.js`：`--bill <单号>`（默认 dry-run 打「原备注 -> 目标备注 + 动作」表）、`--rule "关键词=后缀,..."`（按规格大小写不敏感命中）、`--apply`。已含目标后缀则跳过（幂等），只允许 `A/B/D/Z` 状态，保存后重新 `viewBill` 逐行比对，符合预期才退出 0。执行完再用 SQL 独立回查一遍数量/单价/税率/金额/仓库/仓位/批号未变、分录数未变。

SQL 回查列名：`T_SAL_OUTSTOCKENTRY` 主表**没有** `FTAXPRICE`/`FALLAMOUNT`（在分表 `T_SAL_OUTSTOCKENTRY_F`，按 `FENTRYID` join；该表还有 `FPRICE`/`FTAXRATE`/`FAMOUNT`），主表有 `FREALQTY`/`FSTOCKID`/`FSTOCKLOCID`/`FLOT_TEXT`（批号显示值）。

## 怎么找任意单据的分录实体键与字段键（不要猜）

`T_META_OBJECTTYPE`：**`FID` 就是表单标识**（`WHERE FID='SAL_OUTSTOCK'`），该表**没有 `FNUMBER`/`FNAME` 列**（写它们报 Invalid column name）；`FKERNELXML` 是 `xml`，必须 `CAST(FKERNELXML AS NVARCHAR(MAX))` 后 `indexOf` 定位。

- 分录实体键：`<EntryEntity>` 块里的 `<Key>FEntity</Key>`（`SAL_OUTSTOCK` 实测；子实体另有自己的 Key：`FTaxDetailSubEntity`/`FSerialSubEntity`）。工具栏项 `<Id>FEntity.tbArriveConfirm</Id>` 可反证分录实体键。
- 字段键：字段块（`<TextField>`/`<IntegerField>`…）里 `<Key>` 才是 Save 用的键，`<FieldName>` 是库列名、`<PropertyName>` 是 View 键——三者常两两不同名，且**同名 `PropertyName` 可在表头与分录各有一份**。查法：用 `/<TextField[^>]*>[\s\S]{0,2000}?<\/TextField>/g` 过滤出含目标 `<FieldName>` 的整块，再读其中的 `EntityKey` 与 `Key`。
- 元数据近 80 万字符，只打印命中位置前后 200~400 字符，不要整份输出。

## 本单对照

- TK202608311374：京生电子（CTK000999）/ NAM0130101 CTKD80N03 / 200K / 含税190 / 合计38000 / CTK10 / 来源 FHTZD056340 / 备注 CTK包装 CTK标签。
- TK202609180780：D栋二楼（CTK000741）/ 11 行 SOT-23(27R)+SOD-323 / 19440K / 376999.20 / 税率 0 / CTK10（SOT-23 仓位 100036、SOD-323 100034）/ 源销售订单 XSDD035913 / 审后反审：先反审核并删除自动应收 AR00043514，再反审核出库单 → `D`，当前无应收单。分录备注已在 `D` 状态下批量追加 `26年/A-1-3`（8 行 SOT-23）/`26年/B-1-1`（3 行 SOD-323），保存后仍为 `D`，数量/单价/税率/金额/仓位/批号均未变。

## 打印人名与页面不一致的只读诊断

- 页面销售员不等于打印页脚人名。先 View 核对 `SalesManID`、`FCreatorId`、`FModifierId`，再核对实际模板字段绑定。
- 模板入口：`V_BOS_PRINTTEMPLATE` 按 `FBASEOBJECTID='SAL_OUTSTOCK'` 查，名称由 `V_BOS_PRINTTEMPLATE_L` 的 2052 语言取得；模板 XML 在 `T_META_OBJECTTYPE.FKERNELXML`，仅输出目标字段附近片段。
- 2026-10-14 查询发现多张本账套固定模板页脚 `text8` 绑定 `FCreatorId.FLinkObject`，不是销售员。用户关联人员可由 `T_SEC_USER.FLINKOBJECT` 对照 `T_BD_PERSON_L.FPERSONID`；必须先查表结构。不要输出用户表整行或凭据列。
- 当单据、用户名称、关联人员均已是新名，而截图仍是旧名时，缓存只是待验证推断。必须确认本次选中模板及刷新后的实际预览，不能仅凭同类模板或数据库现值宣布原因确定、修复成功。
- 本次样本 `TK202610140360`（FID 136781）：实时 View 的销售员、制单人、修改人均刘晓丽；制单用户 111676 / TK00472，关联人员 132841 当前也刘晓丽。截图页脚刘阳锐；未取得实际模板选择和刷新复验。未修改业务数据或模板。复用前实时重查。

- 本次进一步验证用户联系对象元数据：SEC_User.FLinkObject 经 T_META_LOOKUPCLASS 指向 BD_ContactObject / V_BD_CONTACTOBJECT；中文名称实际由 V_BD_CONTACTOBJECT_L 取 T_BD_PERSON_L。132841 当前中文名称刘晓丽，员工 TK0218（FSTAFFID 132842）也刘晓丽。因此截图旧名与当前联系对象数据不一致；仍须退出重登及重新选择联系对象复验，不能断言缓存位于浏览器还是应用服务器。
