# 生产订单忘号删除追踪（用户说“刚才删了一个”）

用户删除 `PRD_MO` 后忘记单号时，不要让用户回忆，直接用只读日志扫出最近删除。

## 核心表：`T_BAS_OPERATELOG`

| 列 | 含义 |
|---|------|
| `FDATETIME` | 操作时间；先按 `mo-status-machine-and-reverse-audit.md` 第5节核对服务器时间，禁止机械加8小时。2026-10-28复查本账套 DB_LOCAL 比 DB_UTC 快8小时 |
| `FUSERID` | 操作人，关联 `T_SEC_USER.FUSERID → FNAME/FUSERACCOUNT` |
| `FOBJECTTYPEID` | 固定 `PRD_MO` |
| `FOPERATENAME` | `删除`（还有一条“操作执行过程，调用删除操作：关联的单据内码:xxx”） |
| `FDESCRIPTION` | `单据编号为“MO260831041”的生产订单，删除成功！`（含单号） |
| `FINTERID` | 被删单据 FID，第二条日志该列为空只保留关联内码 |

**注意**：`BOS_OperateLog` WebAPI 的 `ExecuteBillQuery` 无法按 `FFormId/FBillNo` 常用字段查，`View` 也不支持；直接用 SQL 只读 `T_BAS_OPERATELOG` 最可靠。

### 归档日志检索（2026-10-28验证）

- 现行表缺历史记录时查 `T_BAS_OPERATELOGBK`，先核对实际索引；本次按单据内码直接筛选并排序在60秒超时。
- 本次可用索引 `IDX_BAS_OPERATELOGBK(FUSERID,FDATETIME,FOBJECTTYPEID)`：只读查询 `T_SEC_USER`，逐用户参数化筛选，时间下限取当前单据创建时间，再限定表单与 `FINTERID`。仅在已核对该索引存在时使用索引提示；该方法仍可能耗时数分钟。已删除用户不在当前用户表时可能遗漏，不能据此证明日志完整。
- 必须按日志描述的分录行号对应到当前 `MOEntryId`，不能把同一生产订单其他行的结案人套给目标行。
- TW115866→MO251119052第6行，归档日志明确记录2026-10-12 10:38:39.713工程师A执行至结案成功；证据 `output/tw115866-close-log-20261028.json`。此为历史个案，复用前实时查询。

## 只读查询模板（本账套已验证 2026-08-31）

```sql
-- 最近 50 条删除（先看全量，再收敛到 PRD_MO）
SELECT TOP 50 FDATETIME, FUSERID, FOBJECTTYPEID, FOPERATENAME, FINTERID, FDESCRIPTION
FROM T_BAS_OPERATELOG
WHERE FOPERATENAME LIKE N'%删除%'
ORDER BY FDATETIME DESC;

-- PRD_MO 删除专查
SELECT TOP 20 FDATETIME, FUSERID, FOBJECTTYPEID, FOPERATENAME, FINTERID, FDESCRIPTION
FROM T_BAS_OPERATELOG
WHERE FOBJECTTYPEID='PRD_MO' AND FOPERATENAME=N'删除'
ORDER BY FDATETIME DESC;

-- 人名
SELECT FUSERID, FNAME FROM T_SEC_USER WHERE FUSERID IN (...);

-- 验证物理删除
SELECT FID, FBILLNO, FDOCUMENTSTATUS FROM T_PRD_MO WHERE FBILLNO='MO260831041'; -- 空即已物理删
```

## 级联现象

`PRD_MO` 删除会同步物理删除 `PRD_PPBOM`（日志里紧跟 `FOBJECTTYPEID='PRD_PPBOM' FOPERATENAME='删除' FDESCRIPTION='PPBOM00163413'`），用同一 `FDATETIME` 窗口（前后 <1s）关联。

## 2026-08-31 实测窗口（北京时间 UTC+8）

- 00:58 `MO260831041` (FID 125016) 计划员A + PPBOM00163413
- 00:57 `MO260828022` (124921) 计划员A + PPBOM00162732
- 00:53 `MO260826047` (124820) 陈秋伶 + 3 条 PPBOM
- 其余 `MO260827047` / `MO260711058` 等均可在同一查询复现。

`T_PRD_MO` 对这些单号已查不到，确认物理删除。`Z_PRD_MO` 可作为删除前快照补充（需另查）。

## 回复要求

1. 按时间倒序列出今天删除，标出“最近1条≈刚才”并给出 FID/操作人。
2. 说明 `T_PRD_MO` 已物理删除无法 WebAPI 查回，不要编造数量/物料。
3. 让用户确认是哪张，再决定是否从 `Z_PRD_MO` 或同批 MO 兄弟单还原内容并从销售订单重下推（禁止 SQL 写回）。

## 上游销售订单溯源的局限（2026-08-31 MO260826047 实测）

`MO260826047` 删除后用户追问“上游是哪三个销售订单要重新下推”，已验证**现库无法直接还原**：

- `T_PRD_MOENTRY.FSALEORDERID/FSALEORDERNO` 随 `T_PRD_MO` 物理删除级联清空（`SELECT ... WHERE FID=124820` 0行）
- `T_PRD_MOENTRY_LK (FRULEID='PRD_SALEORDER2MO', FSTABLENAME='T_SAL_ORDERENTRY')` 同步清空
- `T_SAL_ORDERENTRY.FMTONO` 在本账套为空，未回写
- `Z_PRD_MO / Z_PRD_MOENTRY / Z_PRD_MOENTRY_LK` 本账套 0行，无回收站快照
- `T_BAS_OPERATELOG` 对该 MO 只有“生成工序计划/保存/审核/反审核/删除”，未记录 `XSDD` 单号
- `fn_dblog` 活跃日志在 30 分钟后已截断（最新 BEGIN_XACT 到 17:09），且 FSALEORDER 关联为整数 FK，十六进制搜 `58534444 (XSDD)` 串无效

**处置**：不要编造单号。按 `MO.FDATE`（如 `2026-08-26`）拉当天的 `T_SAL_ORDER + T_SAL_ORDERENTRY` 明细，再用 `T_PRD_MOENTRY.FSALEORDERID NOT IN` 筛出“未关联MO”的候选（如 2026-08-26 的 20 张：`XSDD034945` 等），让用户按客户/物料确认 3 张。或走金蝶前端 `销售订单列表 → 未下推生产` / `BOS_回收站` 人工确认，再用 `SAL_SaleOrder → PRD_MO (RuleId=PRD_SALEORDER2MO)` 重下推。详见 `references/production/deleted-mo-upstream-trace.md`。
