# 生产订单业务状态机：执行/反执行、反审核与状态机阻塞

## 目录

- 1. 读分录业务状态
- 2. 从表单元数据枚举业务操作（任何表单通用）
- 3. 反审核 MO 的链路与已知阻塞
- 4. 失败是否落日志（判“有没有做过”时）
- 5. `FDATETIME` 时间口径自检
- 6. 并发写风险
- 7. 结案（状态 6）的前置、强制结案与拆分行
- 8. 交料被状态过滤：TX035783（2026-10-26，只读）
- 9. 反执行至计划确认报错仍可能退到下达（2026-10-30）


## 1. 读分录业务状态

- `viewBill("PRD_MO", fid).TreeEntity[].Status` 是分录业务状态；`T_PRD_MO` 与 `T_PRD_MOENTRY` 都**没有** `FSTATUS` 列（写进 SQL 或 FieldKeys 直接报 `Invalid column name 'FSTATUS'`）。表头单据状态仍是 `T_PRD_MO.FDOCUMENTSTATUS`。
- 实测分录业务状态枚举：`1 计划`、`2 计划确认`、`3 下达`、`4 开工`、`5 完工`、`6 结案`、`7 结算`（7 由 2026-10-26 实时元数据验证）。
- `executeBillQuery("PRD_MO", …)` 不支持 `FCloseStatus`（报“元数据中标识为FCloseStatus的字段不存在”），可用字段 `FID,FBillNo,FDocumentStatus,FDate`。

## 2. 从表单元数据枚举业务操作（任何表单通用）

```sql
SELECT CAST(FKERNELXML AS NVARCHAR(MAX)) AS X FROM T_META_OBJECTTYPE WHERE FID='PRD_MO';
SELECT FID, FNAME FROM T_META_OBJECTTYPE_L WHERE FID='PRD_MO';   -- 2052 中文名
```

在 JS 里正则抓 `<Operation>编码</Operation>`，取其位置后约 1200 字符窗口内的 `<OperationName>` 与 `<ConvertStatusValue>`：

- **不要用 `(?=<AfterOpFailedInfo|…)` 之类的 lookahead 截断块**：`OperationName` 排在 `<AfterOpFailedInfo/>` **之后**，截断后每个操作的中文名都是空串，白跑一轮。
- `<ConvertStatusValue>` 是**目标**业务状态：执行 `ToPlanConfirm→2`、`ToRelease→3`、`ToStart→4`、`ToFinish→5`、`ToClose→6`；反执行 `UndoToPlan→1`、`UndoToPlanConfirm→2`、`UndoToRelease→3`、`UndoToStart→4`、`UndoToFinish→5`。即「反执行至X」= 退回到 X，不是退一级。
- 同一份 XML 里还能读到状态转换的业务校验原文（`ConditionValidation` / `ErrorMessage`，如“已关联发料通知单,无法反执行至计划确认” 对应 `FIssueQty>0`）。**服务端插件 DLL 里的校验不在元数据里**，别在 XML 里徒劳搜它的报错原文。
- `T_MDL_FORMOPERATIONTYPE` 是全局操作类型字典（Audit/Copy/…），**不是按表单业务操作**，别拿它当某表单的操作清单。

## 3. 反审核 MO 的链路与已知阻塞

1. 分录业务状态 ∈ {1,2} 才允许 `UnAudit`（C→D）；处于 `3 下达` 会报“第N行分录，分录的业务状态为‘计划确认’、‘计划’时，允许反审核”。
2. 先 `executeOperation("PRD_MO","UndoToPlanConfirm",{Ids:String(fid)})`（前端按钮“撤销下达/反执行至计划确认”）。
3. 该操作可能被服务端插件按**工序计划状态**拦下：`生产订单XXX第N行分录，因工序计划状态受限造成反执行不成功！`。这条是**笼统结论**：元数据无此条件，失败不落 `T_BAS_OPERATELOG`，不能当成“必须删工序计划”的证明。只能只读比对现场：按 `FMONumber` 查该分录名下的 `SFC_OperationPlanning`（`FMOENTRYID` 对应分录），记录它的 `FDocumentStatus`（A/C/D）、工序明细（`viewBill` → **`Entity[0].SubEntity[]`**，不是顶层 `SubEntity`）的 `OperStatus`/`ReportQty`/`QualifiedQty`/`OutSrcFlag`。
4. **候选验证顺序（未验证成功的假设，按可逆性排序，每步都要用户确认）**：① 把工序计划补提交+审核回 `C` 再试反执行；② 删除工序计划（`D` 状态 + 工序全“计划” + 零汇报时删除不丢生产数据，MO 重新下达会重建）；③ 退回“计划确认”后再 `UnAudit`。讲清哪一步是实测、哪一步是推断；不要直接断言“不删就不能反审核”。
5. 下游单据查法：`PRD_PPBOM`/`PRD_PickMtrl`/`PRD_INSTOCK`/`PRD_RetStock` 都按 **`FMOBillNo like '%MO号%'`** 过滤（这些表单没有 `FMONumber`，写了报“列名无效”）；工序计划则按 `FMONumber`。

## 4. 失败是否落日志（判“有没有做过”时）

- `UnAudit` 失败**会**落日志：`T_BAS_OPERATELOG` 中 `FOPERATENAME='反审核'`，`FDESCRIPTION` 就是业务校验原文——不必先做写操作试探就能拿到系统口径。
- `ExcuteOperation`（执行/反执行）的业务校验失败**实测完全不落日志**（现表 0 行；归档表 `T_BAS_OPERATELOGBK` 也不建议按描述 LIKE 全表扫，会超时）。
- 结论：日志查不到 ≠ 没发生；反过来，缺日志也不能当作“执行没被拒绝”的依据。

## 5. `FDATETIME` 时间口径自检

不要沿用“`FDATETIME` 是 UTC，+8h 转北京时间”的机械换算。先在同一个脚本里打三个值对比：`SELECT GETDATE() AS DB_LOCAL, GETUTCDATE() AS DB_UTC`、本机时间、目标日志的 `FDATETIME` 原值。本账套实测：DB 本地时区 UTC+8，`FDATETIME` 存的就是**服务器本地时间**，与 `GETDATE()`、`FAPPROVEDATE` 同口径——机械 +8h 会把“刚发生”的日志显示成 8 小时后。注意 mssql/tedious 默认把 datetime 当 UTC 解析，`toISOString()` 结尾的 `Z` 只是解析产物，不代表存储的是 UTC。

## 6. 并发写风险

同一张单可能同时有人在前台操作。判断依据：该单据的日志窗口（`FIPADDRESS`、`FCOMPUTERNAME`、`FOPERATENAME`，含“打开单据 EDIT”类记录）+ 两次只读查询之间分录/单据状态是否漂移。**本账套 WebAPI 调用同样以 `FCLIENTTYPE=WPF` + 本机 IP/主机名落日志**，不能用 clienttype 区分人工点击与脚本调用；也别用 pc 名等于本机就断定是人工。发现并发就停手，请前台关闭编辑页，重新只读预检后再继续。

## 7. 结案（状态 6）的前置、强制结案与拆分行

账套里 `PRD_MO` 结案相关操作（元数据实测，共 42 个操作）：`ToClose` 执行至结案、`ForceClose` 强制结案、`SplitRow` 拆分行。**没有独立的「反结案」操作**，通过 `UndoToFinish`（反执行至完工，目标状态 5）恢复；2026-10-28已实测成功，按分录数组限定范围及全单回查要求见下方“按分录反执行的接口边界”。

`ForceClose` 的校验是元数据里能读到的原文，别当万能键：

- `生产订单为审核状态且业务状态为计划、计划确认、下达、开工、完工才能强制结案!`
- `联副产品不能进行强制结案操作！`

它会绕过在制材料检查——用它等于把没退的料直接吞掉。

官方硬约束（产品手册，不在元数据里）：

1. **结案时不能存在非审核、非作废状态的下游单据**——领退补单据、生产汇报单、生产入库单。草稿/暂存的先提交审核或作废。
2. **生产订单结算后不能反结案**——单向门，必须在月结/成本核算前做完。
3. 结案控制的范围与强度在**单据类型**里设，查法见 `bill-operations-and-metadata.md` §4。本账套默认单据类型 `SCDD05_SYS` 实测：`ControlStrength=2`（≠3「不控制」→ **结案会校验在制材料**）、`ControlScope=2`（≠1「所有物料」）、`IsAutoClose=True`（**生产订单自动结案开着**，入库到下限会自己结掉，别假设时机还能由人控制）、领料走 `SCLLD02_SYS` 倒冲。

把订单改到实际数的**顺序**（颠倒了要么被拦、要么留尾巴）：

1. 先退料：做不成原型号的那部分料开 `PRD_RetStock` 退回。结案控制开着会被拦；即使不拦，料成本会永远挂在原订单在制上，新订单再领就是同一批料领两次。
2. 清下游单：草稿/暂存的领退补、汇报、入库单提交审核或作废。
3. 删工序计划：按原数量生成的工序计划要单独删，**结案不会自动删它**。
4. `ToClose` 执行至结案。
5. 再给实际型号开新订单，料走「原订单退回 → 新订单领出」，不要让新订单直接占用原订单已领的料——否则原订单的领料记录和新订单的用料记录对不上。

**改数量 vs 拆行**：要留痕（原计划 X、实做 Y、差额转产）用 `SplitRow` 拆成两行，Y 走完、差额行单独结案；前置是官方公式 `min{数量-合格品汇报选单数量, 数量-合格品入库选单数量, 数量-已备料数量} > 0`——料若已全备/全领就拆不了，只能走 `PRD_MOChange` 变更单改数量。

结案还有一条独立的日期校验（`结案日期 >= 分录 FinishDate`），见 `mo-close-date-validation.md`。

### 自动结案数量门槛核查（2026-10-28）

- 不能由 `IsAutoClose=True` 推断任意入库比例都会自动结案。先读取目标分录 `Qty/StockInLimitL/StockInLlRatio/StockInQuaQty`，并区分自动入库达标与人工执行完工后联动结案；同一用户同一时刻出现完工、结案日志，不足以证明分别点击了两个按钮。
- TW115866对应MO251119052第6行189078，实时数量102.4K、欠收比例5%、入库下限97.28K（95%）、合格入库51K（49.8046875%），不满足正常入库达标触发的数量条件。单据类型SCDD05_SYS实时自动完工、自动结案均为True，主产品入库达到下限及关联汇报点工序已完工均勾选。
- 95%是该分录当前门槛，不是账套全部物料统一比例；下限可能由物料默认带入后在订单修改。不得把物料当前默认倒套历史订单。
- 官方说明：`https://open.kingdee.com/K3Cloud/help/PRD_BOS_BillType.html` 为入库达下限触发结案；新版 `https://help.open.kingdee.com/dokuwiki/doku.php?id=生产单据类型参数` 为完工后符合结案条件自动结案。达到数量仍须核对工序、在制材料与下游状态，不能保证仅达比例即成功。
- 证据：`output/tw115866-autoclose-20261028.json`、`output/mo-type-param-meta-20261028.xml`及本次归档日志。当前数量不能单独还原历史结案时全部字段；本案日志明确为工程师A账号于2026-10-12同时执行至完工、结案。

### 按分录反执行的接口边界（2026-10-28，已纠正参数类型）

- 只读接口 `APIParamService.GetExplanByOperationNumber({formId:'PRD_MO',opNumber:'UndoToFinish'})` 可读取本账套操作参数说明；其 `PkEntryIds` 描述为单据内码/分录内码映射。
- **已验证不安全的调用组合，禁止直接复用批量执行**：`Ids:'102549'` 同时传 `PkEntryIds:JSON.stringify([{Id:'102549',EntryIds:'127678'}])`。预期仅处理第1行，实际返回第2行已财务结算不能反结案；第1行127678仍从6变5，第2行128300仍为7。接口抛错不能等同事务完全回滚。
- 后续用户明确授权跳过已结算分录继续，实测纠正：`PkEntryIds` 必须直接传数组 `[{Id:'102600',EntryIds:'133249'}]`，同时 `Ids:'102600'`。接口说明写“字符串类型”不能据此将内层数组再次JSON序列化。MO250103007第8行133249从6变5、接口成功，同单其余23条状态7均未改变，证据 `output/zouxia42-entry-scope-array-20261028/result.json`。仅传字符串形式PkEntryIds而不传Ids会报“编码值或内码值必须传其一”，状态未变。
- 正确路径：先View全单，限定用户目标分录主键，仅对状态6使用`UndoToFinish`，状态7已结算跳过、状态5已完工跳过、状态4开工保持；逐单回查全单全部分录状态及生产/入库数量，无关行必须不变。任何其他失败/部分成功立即停止，不能仅凭抛错判全回滚。状态4转5属于正向执行，不能作为“反执行”顺带操作。
- 证据：`output/zouxia42-undo-finish-20261028/attempt-102549.json`、`result-102549.json`、`final-stopped.json`。本次工具 `scripts/scratch/2026-10/undo-zouxia42-to-finish.mjs` 保留为失败调查证据，不应直接重跑。
- 纠正后的批处理工具：`scripts/scratch/2026-10/finish-zouxia42-scoped.mjs`，默认dry-run，显式`--apply`，执行后全单及全部目标复查，证据目录 `output/zouxia42-finish-scoped-20261028/`。固定目标仅属本案，不得套用其他业务范围。

## 8. 交料被状态过滤：TX035783（2026-10-26，只读）

- 下推提示工序与生产订单分录必须处于下达、开工或完工时，分别查计划所有工序和精确关联的 MOEntryId，不能把表头已审核当作允许交料。
- TX035783（195686）11道工序均为6关闭；MO260122036（114615）第13行214585为7结算。计划13.44K、累计合格入库12.5K；CloseDate为2026-07-31 22:00:04，CloseType=C。
- WebAPI元数据读取：post("DynamicFormService.QueryBusinessInfo", {data:{FormId:"PRD_MO"}})。FormId必须在data内；实时FStatus枚举7=结算，FCloseType枚举C=强制结案。结案方式与当前业务状态分别陈述，不能将7误译为结案。
- 此次仅查询，未尝试反结算、反结案或反关闭；如何恢复交料仍需核对成本期间与实际余料，不能保证可恢复。
- 证据：output/tx035783-readonly-20261026.json、output/tx035783-mo-metadata-20261026.json。历史数量和状态复用前重查。


## 9. 反执行至计划确认报错仍可能退到下达（2026-10-30）

- MO261024014（FID126919、唯一分录280023）用户授权反审核。写前C/业务状态4，领料、汇报、入库数量0；WebAPI查工序计划、领料、汇报、转移、生产入库均为空。调用UndoToPlanConfirm，Ids126919、PkEntryIds数组限定280023，返回“已经存在关联的下游单据领料申请单、领料单、退料单或补料单”而失败；立即View回查仍C但业务状态已由4变3。未调用UnAudit，失败不是事务全回滚，也不可宣称反审核完成。
- 补查PRD_RetStock为空；PPBOM00178965仍C，ZJDB2026100316第4行真实关联该用料清单（规则PRD_PPBOM-STK_TransferDirect）。尚未验证服务端将哪个下游判入该错误，不能仅凭报错或关联推断必须删除调拨。领料申请、补料及其他关联尚未完整排除。证据`output/mo261024014-unaudit/1793328336585/`（before、error、final-stopped），执行脚本`scripts/scratch/2026-10/unaudit_mo261024014.js`默认dry-run。后续操作先刷新状态，不得按原4状态直接重跑。


### 同案根因补证：调拨选单数量也触发领退补通用报错

- 2026-10-30只读取得服务器当前PRD.App.Core.dll与ServicePlugIn.dll，本地ILSpy查看标准校验：Core反编译82418–82440行加载PRD_PPBOM，检查BaseSelGoodReturnQty、BaseSelIncDefectReturnQty、BaseSelPickedQty、BaseSelPrcDefectReturnQty、BaseSelPrcdReturnQty、BaseSelRePickedQty、BasePickingQty、**BaseSelTranslateQty**任一>0，即抛上述“领料申请单、领料单、退料单或补料单”通用错误。报错文字未列出调拨，不可据此排除调拨。
- WebAPI实时PPBOM00178965子项1246787/N102011890：BaseSelTranslateQty=2.575、SelTranslateQty=2.575、TranslateQty=2.575，其他受检量均0，其余5子项受检量全0。链接唯一定位ZJDB2026100316第4行123423、规则PRD_PPBOM-STK_TransferDirect、源PPBOM278971/子项1246787。至此已确认本案阻挡就是调拨选单量，取代上条“尚未定位”的阶段结论。
- WebAPI PRD_PickMtrlApp/PRD_FeedMtrl/PRD_ReturnMtrl均为空；SQL按MOID126919/MOENTRYID280023核查T_PRD_PICKMTRLAPPENTRY_A、T_PRD_PICKMTRLDATA、T_PRD_FEEDMTRLDATA、T_PRD_RETURNMTRLENTRY也为空。关联查询必须同时限定源表+源单内码+源分录，MO FID126919恰与别单PPBOM FID碰号，不可把仅FSBILLID126919的旧领料误判为该MO下游。
- 直接反向调拨只改变库存流向，不足以证明原PPBOM调拨选单量清零，不能承诺其可解除反下达阻挡；本次未执行。删除原目标分录仍须先解决整单反审核的其他行负库存阻挡，不擅自撤回其他订单领料或改控制/回写量。
- 证据：`output/mo261024014-cleanup/ppbom-blocker-current.json`、`remaining-downstream.json`、`sql-downstream.json`、`decompiled-core/Kingdee.K3.MFG.PRD.App.Core.decompiled.cs`；本轮只读，未修改正式业务数据。

- 同案后续已成功：用户明确授权临时开CTK08负库存，删除ZJDB2026100316目标行并恢复审核/关闭开关后，PPBOM调拨选单量归零，MO261024014反执行至2并反审核为D。成功步骤与边界详见`../inventory-sales/warehouse-transfer.md`“同案用户明确授权临时负库存后的成功闭环”；证据`output/mo261024014-final/1793329579188/`。此结果取代本案停在C/状态3的历史阶段结果，但不覆盖其他订单。
