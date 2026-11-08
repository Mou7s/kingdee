# 收款单缺失与删除追踪

用于 `AR_RECEIVEBILL` 收款单当前查询不到、用户记得以前存在、或需要判断是否被删的场景。

## 只读证据链

1. 先按银行回单/业务链路收集精确锚点：付款日期、金额、付款方、收款方、流水号/附言、应收单号、出库单号。
2. 查当前 `AR_RECEIVEBILL`：不限出库日期，至少覆盖银行日期前后及整月；检查 `FRECAMOUNTFOR`、`FREALRECAMOUNTFOR`、`FDATE`、`FBillNo`、`FCONTACTUNIT`、`FPAYUNIT`、`FREMARK`、`FKDPAYNO`、`FTHIRDBILLNO`、来源单号和核销状态。
3. 查 `AR_Match`/`AR_MATCH` 与收款来源分录；不能只用收款单表头过滤，明细实体的多段字段过滤在本账套可能不支持。必要时先取候选单再 `View` 检查明细。
4. 查操作日志：`T_BAS_OPERATELOG` 与 `T_BAS_OPERATELOGBK` 都要查。重点过滤 `FOBJECTTYPEID='AR_RECEIVEBILL'`，读取 `FDATETIME`、`FOPERATENAME`、`FDESCRIPTION`、`FINTERID`、`FUSERID`。
5. 只有日志明确出现“单据编号为‘SKD...’的收款单，删除成功”以及对应反审核/删除链，才能报告“被删除”。当前表查不到本身不是删除证据。
6. 删除后通常业务主表及收款明细已物理删除；不要直接改数据库恢复。日志只能证明操作和 FID，往往不保留删除前金额、客户、付款方，内容还原要依靠业务源单/财务凭证或用户提供的旧截图。

## 删除日志查询模板（SQL 只读）

```sql
SELECT 'current' AS LOGTABLE, FDATETIME, FUSERID, FOBJECTTYPEID,
       FOPERATENAME, FDESCRIPTION, FINTERID
FROM T_BAS_OPERATELOG
WHERE FOBJECTTYPEID = 'AR_RECEIVEBILL'
  AND FDATETIME >= 'YYYY-MM-DD'
  AND FDATETIME <  'YYYY-MM-DD'
  AND FOPERATENAME IN (N'反审核', N'删除')
UNION ALL
SELECT 'backup', FDATETIME, FUSERID, FOBJECTTYPEID,
       FOPERATENAME, FDESCRIPTION, FINTERID
FROM T_BAS_OPERATELOGBK
WHERE FOBJECTTYPEID = 'AR_RECEIVEBILL'
  AND FDATETIME >= 'YYYY-MM-DD'
  AND FDATETIME <  'YYYY-MM-DD'
  AND FOPERATENAME IN (N'反审核', N'删除')
ORDER BY FDATETIME;
```

再按删除日志里的 FID 查操作链；不要仅用 `FINTERID` 跨单据查，因为同一个内码可能出现在不同业务对象的日志中，必须同时限定 `FOBJECTTYPEID`。

## 误认与交叉核验

- 收款单号通常按建单顺序递增，但不能把单号顺序单独当作业务日期证明；用相邻现存单据的 `FDATE`、`FCREATEDATE` 和金额交叉核对。
- 若银行日是 8 月 18 日，而被删单属于 8 月 14 日编号批次，不能直接认定为该笔；若候选单是银行日后才保存的临时单，也不能认定为原收款。
- 查到同日的其他收款单不等于匹配成功；必须同时核对金额、往来单位/付款单位、流水号/备注、来源单和核销关系。
- 用户说“上次搜到过”时，优先索要或检索上次的确切收款单号/截图；拿不到原单号时，只能报告当前账套和日志能证明的范围，不要凭记忆补单号。
- “未找到直接关联”与“单据被删”是两种不同结论。前者只能说明当前查询条件下没有链路，后者必须有删除日志。

## 本账套案例的结论口径

针对银行回单金额 77.50、日期 2026-08-18 的场景，曾发现 `SKD00008988` 于 2026-08-26 删除，但其保存/审核属于 8 月 14 日批次；`SKD00009118` 于 2026-08-28 保存后立即删除。两者都不能仅凭“被删除”认定为 8 月 18 日付款。应继续报告：目标收款是否存在尚无删除证据，并保留应收单未核销事实。
