# 生产订单「销售订单备注」少字或与上游不一致排查

用户反馈生产订单明细「销售订单备注」（`F_UNW_Text_qtr1`）看似“被截断/少了一截”时，不可仅凭单张截图或字段字数差异推断是单据转换规则截断。按以下四步只读核实，区分界面显示裁剪、字段长度限制与“先下推后改上游不同步”。

## 1. 核对物理存储与界面裁剪

1. 先按单号查 `PRD_MO` 详情（`viewBill` 读 `TreeEntity[].F_UNW_Text_qtr1`）及物理表 `T_PRD_MOENTRY.F_UNW_TEXT_QTR1` 实际字符数（`LEN(...)`）与列定义（`nvarchar(2000)`，元数据 `<Editlen>2000</Editlen>`）。
2. 对比截图中列宽：扩展外观默认 `<Width>150</Width>`，表格列未拉宽时单行只显示前段字符，末尾仍在库内而界面不可见。

## 2. 排除转换规则固定截断

1. 查目标为 `PRD_MO` 的有效转换规则（`T_META_CONVERTRULE` 中按 `FBFLOWID` 定位，如 `88af8564-9c86-4698-b853-85dcd78f3745` 继承自 `PRD_SALEORDER2MO`），确认映射 `<TargetFieldKey>F_UNW_Text_qtr1</TargetFieldKey>` 对应 `<SourceFieldKey>FEntryNote</SourceFieldKey>`，无 `LEFT`/`SUBSTRING` 截断公式或转换插件改写。
2. 抽样同转换规则下近期长备注记录（`LEN(T_SAL_ORDERENTRY.FNOTE) > 64`），核对 `LEN(T_PRD_MOENTRY.F_UNW_TEXT_QTR1)` 是否可完整携带至 250 字符（`T_SAL_ORDERENTRY.FNOTE` 上限 `nvarchar(255)`，字段清单见 `../kingdee-k3cloud/references/system/k3cloud-fields-reference.md`）。

## 3. 核对上下游时间线与跨单同步边界

1. 联查 `T_SAL_ORDER` 与 `T_PRD_MO` 的 `FCREATEDATE`、`FAPPROVEDATE`、`FMODIFYDATE`：重点看**`T_SAL_ORDER.FMODIFYDATE` 是否晚于 `T_PRD_MO.FCREATEDATE`**。
2. 查 `T_BAS_OPERATELOGBK`（必须带 `FDATETIME` 范围和 `FOBJECTTYPEID` 索引过滤，避免全表扫描）：
   - `SAL_SaleOrder` 元数据在「已审核 / 审核中」状态显式放开了 `FEntryNote`（`<IsControl>False</IsControl>`），操作员可在**不反审核、不生成销售变更单**的情况下直接以 `EDIT` 模式修改明细备注并保存。
   - 核查 `T_BF_WRITEBACKRULE`：`SAL_SaleOrder` → `PRD_MO` 只在**下推建单瞬间**拷贝 `FEntryNote`，没有任何反写/同步规则把后续修改的销售备注推送到已生成的生产订单（同理，在生产订单手动追加批号也不会写回销售订单）。
3. 核对同一销售订单下推的其他生产订单是否在同一时刻截在相同句尾，交叉验证“先下推、后补备注”。

## 4. 核对当前可改性与下游影响

- `PRD_MO` 及其扩展元数据中，`F_UNW_Text_qtr1` 原在已审核及分录「开工/完工」等状态锁定（2026-11-16 已在 `e06699e2` 中将单据状态 `B/C` 与分录业务状态 `2/3/4/5` 设为 `<IsControl>False</IsControl>`）。
- **下游工序计划双目标映射实况**：生产订单执行生成工序计划时，转换规则 `3a8ca3aa-ea36-4d34-a706-30aa5f8ca36b` 会把 `F_UNW_Text_qtr1` **一分为二**同时写入工序计划单据头的两个字段：
  1. 基本信息「备注」`FDescription`（`T_SFC_OPERPLANNING_L.FDESCRIPTION`，`nvarchar(255)`，基类 `MFG_BILLTEMPLATE_ENTRY` 已审核下 `IsControl=False` 可直接编辑）；
  2. 个性化「销售备注」`F_UNW_Text_qtr`（`T_SFC_OPERPLANNING.F_UNW_TEXT_QTR`，原为 `nvarchar(250)`，2026-11-16 已扩宽至 `nvarchar(2000) NOT NULL` 并在 `b6654973` 的 `B/C` 状态设为 `IsControl=False`，套打模板 `销售备注：` 绑定此字段）。
  因此若设计跨单同步，且工序计划已生成，需同时考虑更新 `FDescription` 与 `F_UNW_Text_qtr`。跨单自动同步 Python 服务插件见 `scripts/tools/sync_so_note_to_mo_sfc.py`，已于 2026-11-17 挂载至 `SAL_SaleOrder` (`69908226-8196-4f5a-b1a5-5b135f6c1172`) `Save` 操作并完成实测验证（支持在已审核状态下修改单行 `FEntryNote` 后精准同步至关联 `PRD_MO` 含 `4 开工`/`5 完工` 分录及 `SFC_OperationPlanning` 的 `FDescription` 与 `F_UNW_Text_qtr`）；注意当前 `T_SAL_ORDERENTRY.FNOTE` 与 `T_SFC_OPERPLANNING_L.FDESCRIPTION` 物理上限均为 `nvarchar(255)`，若未来扩宽销售备注仍需同步考虑 `FDescription` 截断或扩宽策略。
- 结论报告应写明：实际库内存储文本、与上游销售订单的字符差异、时间线证据，并提示用户不能依赖后续修改销售备注自动同步生产订单；若需补全已审核生产订单备注，须先评估当前分录状态及是否放开字段锁定后再决定修改路径。
