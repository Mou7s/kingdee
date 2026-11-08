# Kingdee reconciliation and unfamiliar-form probes

## Live reconciliation

- Re-read the statement and current K3 data before every reconciliation or write; do not reuse an earlier report as current truth.
- Compare three quantities explicitly: statement quantity, `SFC_OPERPROCBALANCE.FBalanceQty`, and AP `FPRICEQTY`. If SFC and AP agree, the quantity discrepancy is between the statement and K3, not an AP-generation mismatch.
- For price-only corrections, keep quantity fields unchanged: delete the explicitly identified erroneous draft AP, un-audit the SFC settlement if needed, save only the price fields, push a replacement AP draft, and verify the new AP and settlement by `FID`/number.
- AP payable documents remain drafts; never submit or audit them.

## Unfamiliar or newly added forms

- A generic project search may omit a newer/custom form. A failed generic search is not evidence that the bill does not exist.
- First inspect repository form mappings. If the FormId is still unknown, use read-only SQL metadata (`sys.tables`/`sys.columns`) to locate likely business tables; never use metadata discovery as a reason to write SQL business data.
- In this account, verified concentrated operation-outsourcing tables are `T_SFC_OPEROUTGR` (receive header/entry) and `T_SFC_OPEROUTGS` (send header/entry). The header `FFORMID` provides the actual FormId. Verified receive FormId: `SFC_OperOutGroupReceive`.
- Once discovered, confirm through WebAPI with `executeBillQuery` and fields such as `FID,FBillNo,FDocumentStatus,FDate`; report the FormId, FID, status, date, and meaningful entry/link counts.

## Controlled deletion

- 已生成凭证且用户明确不能解除关联时，停止删除重建。2026-10-23 官方手册查得候选标准入口“财务会计→应付款管理→应付转销”：向导按结算组织及转出/转入供应商列示未付款应付，可限定转销金额，业务日期须在可用期间；完成时自动生成转出负向、转入正向的已审核应付。来源：https://open.kingdee.com/K3Cloud/help/AP_Write_Off.html 。这只是标准功能说明，尚未验证本账套此66张类型2暂估能被选入、是否需先完成财务应付确认，也未确认实际菜单权限；不得表述为已验证适用方案。只能先指导前端筛选预览，不能通过执行转销间接生成/审核类型3财务应付以绕过本项目只存草稿限制。转销改变应付往来，不代表原工序计划/转移/结算供应商已更正，不能再另建外协厂Y应付重复确认加工费；凭证方案及期间由财务确认后再决定下一步。

- 2026-10-23 外协厂Y供应商不符66组删除阻塞：用户明确授权删除G049的66张暂估与66张工序加工结算；逐张实时验证均类型2/已审、单分录、无AP下游及额外AP占用，仍不代表允许反审核。首张TX0901666的AP00157402（FID389950）反审核被API拒绝“已生成凭证，不允许反审核”，因此立即停止全部后续写入，不修改/删除凭证，不用SQL绕过。独立按FID回查确认66张AP及66张结算全部保留C状态，0张删除。对应结算GXJGJSD104020（FID204051）未触及。需另行处理关联凭证后重新预检，不能把上次dry-run或旧删除授权扩展到凭证。证据 `output/yangni-delete-wrong66/apply-preflight.json`、`progress.json`、`stop-readback.json`；此为特定时点阻塞，复用前实时重查。

- Before deleting, query the exact number, `FID`, status, and linked AP/transfer references again. Stop on duplicates or changed state.
- For a specifically authorized SFC settlement deletion: use the standard API sequence `UnAudit` (when status `C`) then `Delete`, addressed by the verified form ID and `FID`; do not change quantities unless separately authorized.
- Verify the target is absent by querying the same `FID` after deletion. Keep the AP save-only restriction and do not replace normal APIs with SQL writes.

## 2026-10-28 外协厂Y应付转销前端完成后的只读验证

用户确认已在前端转销后，WebAPI回查：原AP00165021（404594，类型3，66行，4987.20元）已审核；转出AP00166473（411256，G049，-4987.20元）及转入AP00166474（411257，GYS287，4987.20元）均类型3已审核、IsWriteOff=true，各66行SourceBillNo全部为AP00165021。以工序计划/序列/工序/物料组合唯一匹配，66行分别与原单金额反向/同向精确到分。原单及新单NOTWRITTENOFFAMOUNTFOR均0、RelateHadPayAmount均0；不能把该字段当未付款余额或据此宣称已付款。证据 output/yangni-transfer-20261028/verified.json。此为用户前端操作后的只读验证，Agent未审核或执行转销；不推断上游供应商同步更正。
