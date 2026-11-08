# 采购价目表与委外目标价查询

## 目录

- 适用场景
- 查询顺序
- SQL 模板（只读）
- 回答格式
- 补录追加（2026-09-30 CGJM000083 实证）
- 清理、合并、单位统一与覆盖补录（2026-10-08 实证）
- 采购限价上下限与控制强度（2026-10-16 只读实证）
- 采购订单「划片费」单价上限（2026-10-17 只读实证）

## 适用场景

用户询问“采购价目表”“目标采购价”“某供应商某封装的委外单价”时，目标是读取当前有效的价格规则，不是统计历史结算单或应付单中曾经出现过的价格。

## 查询顺序

1. 先确认供应商：用 `BD_SUPPLIER` 或 `T_BD_SUPPLIER` + `_L` 按名称模糊查询，取得唯一供应商编码；名称命中多个档案时先列出编码，不混算。
2. 查询采购价目表：表单为 `PUR_PriceCategory`；SQL 主表/明细为 `T_PUR_PRICELIST`、`T_PUR_PRICELISTENTRY`。
3. 同时按物料名称和规格筛封装：封装经常只出现在 `T_BD_MATERIAL_L.FSPECIFICATION`，不能只查物料名称。
4. 按工序核对：`T_PUR_PRICELISTENTRY.FPROCESSID` 连接 `T_ENG_PROCESS_L.FID`，确认结果确属用户问的委外工序。
5. 只把当前有效规则作为目标价：核对表头 `FDOCUMENTSTATUS='C'`、`FFORBIDSTATUS='A'`，并同时检查表头与分录的生效/失效日期。分录禁用状态若需参与判断，先查当前账套枚举含义，不凭字母猜。
6. 判断价格口径：`FISINCLUDEDTAX='1'` 时，`FTAXPRICE` 是含税单价，`FPRICE` 是未税单价；同时报告 `FTAXRATE`。若价目表不含税，仍明确字段与口径，不把两者混称“单价”。
7. 最后可查 `SFC_OPERPROCBALANCE` 的近期结算价作交叉验证，但历史上出现多个价格不代表当前目标价存在多个值。

## SQL 模板（只读）

```sql
SELECT
    h.FNUMBER AS PriceListNo,
    hl.FNAME AS PriceListName,
    h.FDOCUMENTSTATUS,
    h.FFORBIDSTATUS,
    h.FEFFECTIVEDATE AS HeaderEffective,
    h.FEXPIRYDATE AS HeaderExpiry,
    h.FISINCLUDEDTAX,
    s.FNUMBER AS SupplierNo,
    sl.FNAME AS SupplierName,
    m.FNUMBER AS MaterialNo,
    ml.FNAME AS MaterialName,
    ml.FSPECIFICATION,
    e.FPRICE,
    e.FTAXPRICE,
    e.FTAXRATE,
    pl.FNAME AS ProcessName,
    e.FEFFECTIVEDATE,
    e.FEXPIRYDATE
FROM T_PUR_PRICELIST h
LEFT JOIN T_PUR_PRICELIST_L hl
  ON hl.FID = h.FID AND hl.FLOCALEID = 2052
JOIN T_PUR_PRICELISTENTRY e
  ON e.FID = h.FID
JOIN T_BD_SUPPLIER s
  ON s.FSUPPLIERID = h.FSUPPLIERID
LEFT JOIN T_BD_SUPPLIER_L sl
  ON sl.FSUPPLIERID = s.FSUPPLIERID AND sl.FLOCALEID = 2052
JOIN T_BD_MATERIAL m
  ON m.FMATERIALID = e.FMATERIALID
LEFT JOIN T_BD_MATERIAL_L ml
  ON ml.FMATERIALID = m.FMATERIALID AND ml.FLOCALEID = 2052
LEFT JOIN T_ENG_PROCESS_L pl
  ON pl.FID = e.FPROCESSID AND pl.FLOCALEID = 2052
WHERE (s.FNUMBER = @SupplierNo OR sl.FNAME LIKE N'%' + @SupplierName + N'%')
  AND (ml.FNAME LIKE N'%' + @Package + N'%'
       OR ml.FSPECIFICATION LIKE N'%' + @Package + N'%')
ORDER BY e.FEFFECTIVEDATE DESC, h.FID DESC, e.FSEQ;
```

注意多语言表的真实关联键：供应商 `_L` 用 `FSUPPLIERID`，物料 `_L` 用 `FMATERIALID`，不是统一的 `FID`。

## 回答格式

短答即可，优先给数字：

- 供应商
- 封装/工序
- 含税单价
- 未税单价与税率
- 价目表编号、状态和有效期

若同一筛选命中多个当前有效价格，按物料、数量阶梯或工序逐行列出差异，不擅自压成一个价格。

## 补录追加（2026-09-30 CGJM000083 实证）

- 分录实体键 `FPriceListEntry`，字段键以 `T_META_OBJECTTYPE`（`FID='PUR_PriceCategory'`）的 `FKERNELXML` 为准：`FMaterialId/FUnitID/FPROCESSID/FPrice/FTaxPrice/FTaxRate/FFROMQTY/FToQty/FPriceCoefficient/FUpPrice/FDownPrice/FEntryEffectiveDate/FEntryExpiryDate/FNote`。
- 基础资料引用一律用编号写法：`{FNumber: 物料编码}`、`{FNumber: 工序编号}`、`{FNumber: 单位编号}`；`{Id: 数字}` 会被当空值丢弃（工序报“作业不能为空”、单位会被物料主数据默认值覆盖）。
- 已审核单可直接 `Save` 追加（`NeedUpDateFields: []` + `IsDeleteEntry: false`，只传 `FID` + 新增分录），无需反审核；删指定分录用 `IsDeleteEntry: true` + 全量保留行（行键 `FEntryID` 取自 `View` 的 `Id`）。
- 分批最多20行。批失败先回查是否落库，并按错误行号定位具体物料；不得自动逐行反复重试。查明阻塞范围后，记录并排除已验证的拒绝项，再对其余已授权范围重新预检；不得为补录擅自改变物料主数据。`Save` 超时先重查是否已落库再定下一步。
- 门槛案例：NBM0760059 两写法均报“物料编码必录”，主数据唯一差异是 `T_BD_MATERIALBASE.FISPRODUCE=0`（正常料为 1），疑为生产属性门槛，留前端人工处理，不擅自改主数据。
- FID 必须现查现用，禁止凭记忆硬编码（曾误把 828950 当 083 用，靠 `FNote` 标记行追回）。

## 清理、合并、单位统一与覆盖补录（2026-10-08 实证）

以下为本账套当天验证的方法；单据状态、物料属性和价格均须复用前重新查询，不继承本次写入授权。

### 禁用与删除分录

- `PUR_PriceCategory` 的整单禁用操作是 `UnEffective`，取消禁用是 `Effective`；通用 `Forbid` 返回“采购价目表没有此接口”。来源：实时 `T_META_OBJECTTYPE.FKERNELXML`，禁用操作将 `FForbidStatus` 改为 `B`。
- 元数据要求整单 `FDocumentStatus=C` 才能禁用。目标在 `D/B` 时，本次在用户明确停用范围内完成必要的 Submit/Audit 后立即 UnEffective；不把此流程推广为任意未审核单的自动审核许可。
- 删指定价目表分录：实时 View 获取全量行，`IsDeleteEntry:true`，传 `FID` 和全部保留行的 `{FEntryID: Id}`；删除的是价格规则，物料档案不删。回查行数、删除对象及全部保留行的物料、单位、工序、价格、税率和有效期。

### 单位、名称与合并

- 单位“片(外发)”本次实时解析为编号 `Pian1`。仅传分录单位并使用字段更新列表曾返回成功却不生效；已验证写法是 `NeedUpDateFields:[]`、`IsDeleteEntry:false`，每行带真实 `FEntryID`、物料/单位/工序的 `FNumber` 引用，并显式保留 `FPrice/FTaxPrice/FTaxRate`，分批回查。不得把改单位等同于自动换算价格；本次用户要求保留原数值。
- 统一单位前先查同物料、辅助属性、工序、数量区间及有效期的重复行。060的 NBE0030001 原有一条片单位、一条K单位；统一后会重叠，取得用户明确授权后删除重复K行再继续。
- 改名用表头 `FName` 最小 Save，实时核对表名，并验证全部明细未变；067本次改为“PDFN5X6外协厂H委外价格”。
- 合并价目表不能只比较含税价：核对未税价、税率、单位、工序、辅助属性、数量区间和组织条件；重复物料只保留一条，追加另一表独有物料，完成后只留一张有效表。
- 088/132合并时，复制原有效期被“相同维度数据已在132存在”拒绝。回查确认失败未落库后，按用户授权禁用132，并以当天为新增分录生效日期再保存088，成功回查121行及132禁用状态。生效日期改变必须有业务依据，不用随机日期绕过校验；若保存再次失败，立即报告禁用和保存的各自结果。

### 覆盖统计与补录

- 先定义“当前成品”和每张表锁定的封装范围。本次用户排除旧编码，因此取 `FNumber LIKE 'N%'`、物料已审核且未禁用、存货类别为产成品（本账套类别ID 241，经当前资料核对）；不要仅按 NAM/NBM/NBQ，SOD等还涉及其他N前缀。
- “未覆盖”只代表符合当前筛选的成品没有该供应商该表有效规则，不自动证明需要发该供应商，也不证明是新品。用创建时间区分建表后新增与建表前已有；新增料号可能是客户/丝印/版本变化。
- 封装匹配只归一化已验证的大小写、空格、括号及乘号写法，不能用宽泛包含判断。PDFN5X6 Clip不归普通5X6；PDFN3.3X3.3统一计价是本次用户明确约定，不能自动推广给别的供应商。
- 用户删除的对象需保留供应商和表范围的排除清单，不能清理后在缺口补录中自动加回或转入另一表。本次 NBM0270060 用户明确仅保留外协厂Y088，不能补入085或其他表；废料、Clip及不允许生产的物料均按确认范围排除。
- 新增行按目标表现有模板复制价格/税率/上下限，使用物料、单位、工序编号引用，显式给数量区间、价格系数和有效期；本次新增从2026-10-08生效，不回溯覆盖历史价格。
- 每批保存前重新 View 和核对物料状态/封装，保存后独立 View 验证新增行的单位、价格、工序、行禁用状态和有效期，并逐行验证原有明细未变；最后重新统计缺口。API成功不能代替回查。
- “物料编码必录”不一定是编码不存在。本次 NBM0760059、NAM0130010/0011/0042 都存在且已审核，但 `FIsProduce=false`，对应行被拒；仅有属性差异仍不足以确定唯一原因，不擅自启用生产属性。NBM0760059曾在属性临时为true时补入成功，用户随后确认不允许生产，已撤回该次新增并回查false；本次代理未修改该属性。
- 失败行号可按“保存前明细数 + 当前批新增序号”定位（067原68行，报第80行对应该批第12项NBM0760059），再实时验证。确认该批未落库后才能排除阻塞项、重新预检并继续，不能盲目扩大操作或掩盖未完成项。

本次执行脚本：仓库根 `scripts/scratch/2026-10/complete_hanchi_prices.js` 和 `scripts/scratch/2026-10/complete_other_prices.js`。它们记录2026-10-08个案范围及排除项，默认dry-run；复用前审阅日期、供应商、封装、排除清单和当前状态，不视为通用默认业务规则。

## 采购限价上下限与控制强度（2026-10-16 只读实证）

适用：用户问“采购单价能不能设上限/下限”“超价能不能拦截”。标准产品已有限价机制，先按本节取证，不要直接建议二开。复用前重新查询；以下为 2026-10-16 当天结果。

- **上下限字段**：价目表分录 `PUR_PriceCategory` 的上限价/下限价，SQL 为 `T_PUR_PRICELISTENTRY.FUPPRICE/FDOWNPRICE`；订单分录 WebAPI 键为 `UpPrice/DownPrice`。元数据校验：下限不得大于上限；`FIsIncludedTax=false` 时单价须落在上下限之间。
- **订单行是否受控取决于关联**：`T_PUR_POORDERENTRY_F.FPRICELISTENTRY` 为 0 表示未关联价目表，限价检查不适用于该行。`FTAXPRICE/FUPPRICE/FDOWNPRICE/FSYSPRICE` 在 `_F` 表，不在 `T_PUR_POORDERENTRY`（查错表报 `Invalid column name`）。
- **校验挂载点**：以下元数据均含「采购限价控制检查」（`DoNothingValidation`，TypeId 1009）：`PUR_PurchaseOrder`、`PUR_ReceiveBill`、`STK_InStock`、`PUR_MRB`、`PUR_Contract`、`SCP_Contract`、`PUR_Requisition`。
- **强度参数**：`PUR_SystemParameter` 的 `LimitPriceControl`（Key `FLimitPriceControl`，EntityKey `FPriceEntity`，FieldName `FCOMBO1`，元数据默认值 1）。枚举 `462fccf2-a67a-4824-9a66-e86e5f164e79`（`T_META_FORMENUMITEM` 实测）：1 不予控制 / 2 预警提示 / 3 禁止交易 / 4 密码特批。该强度是全局设置，影响所有采购单据的保存、提交、审核，改动前须用户明确确认。
- **当前取值未能确认**：库内无 `FCOMBO1` 列；`T_PUR_PRICESYSPARAM` 只有 `FPRICECHECKSOURCE`（价格来源检查，PUR_PurchaseOrder 为 NONE），不是限价强度；WebAPI `executeBillQuery("PUR_SystemParameter", "FLimitPriceControl")` 报字段不存在。需在前端「采购系统参数」核对，不得据元数据默认值断定。
- **账套现状**：价目表 10717 行分录均有上限价；含税列表中上限=含税价 10533 行，上限=含税价×1.02 为 184 行。订单 36616 行分录中 1435 行关联价目表，其中 95 行含税单价超过上限（如 TK20261012016：含税 11.8 > 上限 11.22，2026-10-12），说明超限行可以保存；原因（强度档位、特批或改价顺序）未验证。
- **案例 TK20260901032**（G050 供应商J，委外订单 `CGDD02_SYS`，BusinessType=WW，已审核已关闭）：N102010873 一行 6.589K × 含税 34.147822，三行 `FPRICELISTENTRY` 均为 0；G050 对 N102010873 及规格 2.60 无任何价目行，因此该行当前无上限可比。
- **未验证**：新单选中有价目行的物料后是否自动带出 `FPriceListEntry`；95 行超限保存的原因。需测试单或前端复现，不在生产单上试写。
- **证据脚本**：`scripts/scratch/2026-10/probe_po_*.js`（均只读）。

### 不维护价目表：按物料分组的 BOS 保存校验（2026-10-16 只读实证，未配置）

适用：用户不想维护价目表，只想「某类物料含税单价不得超过 X」。方案是在采购订单「保存」操作挂单据合法性校验（见 `../kingdee-system-admin/references/system/bos-extension-field-guidance.md`「不符合条件不给保存」一节），不走价目表。

- **可行性（元数据）**：采购订单校验表达式已能引用物料子属性（同表有 `FMaterialid.FIsPR=True`、`FSTOCKUNITID.FNumber`），所以可写 `FMaterialId.FMaterialGroup.FNumber`；三层路径未在 BOSIDE 实测，须先在测试账套验证。空行须 `ISNULL(...,'')` 防护，否则空值落入「不满足」分支。
- **没有现成最高价字段**：订单行 `FMaxPrice/FMinPrice` 在 36616 行中全部为 0，`PUR_ReceiveBill` 等处的「限价控制检查」用到它但账套未用，不能直接启用。
- **分组口径**：N102010873 所在物料分组 `FNumber=102012`「N客供蓝膜片」（`T_BD_MATERIAL.FMATERIALGROUP` → `T_BD_MATERIALGROUP.FNUMBER` / `_L.FNAME`）；该分组订单行单位全部为 K。分组内 301 个物料、含税单价 0.0001–170.535，跨度大，**整组一刀切会误伤**，需用户确认范围是整组、子分组还是个别料号。
- **候选表达式（示意，上限值待定）**：`ISNULL(FMaterialId.FMaterialGroup.FNumber,'') <> '102012' OR FTaxPrice <= 34.15`，挂保存操作，「校验表达式为真时提示」**不勾**（表达式为假时阻止保存）。
- **影响面（分组 102012，2026-10-16 历史订单行，含税）**：上限 5 → 历史超限 95 行/44 物料，近12个月 78 行，已审核未关闭 3 张单；上限 10 → 18 行，未关闭 2 张；上限 20 → 8 行，未关闭 2 张；上限 34.147822 → 6 行/2 物料，未关闭 2 张单（TK20260915012、TK20260808028.，N102011382 单价 170.535，疑似录入错误，未核实）。
- **生效后果**：标准产品无「只拦新增」开关，规则对新增、修改、WebAPI Save 全部生效；已超限的未关闭单据再次保存会被拦，须先改价或关闭。规则挂在扩展元数据上，对所有采购订单和所有用户生效，产品升级可能覆盖，须先在测试账套验证（超限价报错、合规价能存）。
- **未验证**：三层字段路径能否通过 BOSIDE 校验；下推生成的订单是否也走保存校验；WebAPI Save 是否同样被拦。

## 采购订单「划片费」单价上限（2026-10-17 只读实证）

适用：用户问某张划片采购订单（供应商常见 `G050` 供应商J）能不能给「划片费/划片单价」设上限。**划片单不走标准采购价目表**，先按本节取证，再谈方案。复用前重新查询；以下为 2026-10-17 当天结果。

- **单据形态**：`TK20260901032` 是采购订单 `PUR_PurchaseOrder`（FID 116718，供应商 G050），3 行均为划片外发，含税单价 0.305556 / 0.375 / 34.147822，单位 K；源单为委外订单 `SUB_SUBREQORDER SUB00000976`（分录 `SrcBillTypeId=SUB_SUBREQORDER`）。
- **划片自定义字段**（物理列在 `T_PUR_POORDERENTRY`）：`F_HUAPIAN`（采购划片价格资料 ID）、`F_PIANNUMBER`（片数）、`F_EXTRAPRICE`、`F_XINPIANXINHAO`（芯片型号）、`F_UNW_Text_391`；View 键 `F_huapian/F_piannumber/F_extraprice/F_xinpianxinhao`。
- **「采购划片价格资料」主数据**：二开（`FSUPPLIERNAME='UNW'`）的**基础资料**，基于通用「预设基础资料」对象 `BAS_PreBaseDataTwo`（`FMODELTYPEID=400`），故物理表是共享的 **`T_BAS_PREBDTWO`**（多语言 `T_BAS_PREBDTWO_L`，名称取 `_L.FNAME`）；元数据表单 FID `c80ea12d-30a3-4118-94c4-211a3e7a51b7`。字段 `F_guige/F_chicun/F_price/F_gongyingshang/F_pricetext` 对应物理列 `F_UNW_TEXT_RE5`(=晶圆尺寸 4/5/6/8/12)、`F_UNW_TEXT_APV`(=die 尺寸区间)、`F_UNW_DECIMAL_TZK`(=`F_price`，数值，多为 0/28/48/78，含义未定)、`F_GONGYINGSHANG`(供应商简称)、`F_PRICETEXT`(=`F_pricetext`「价格文本」，行为上等于「元/片」单价)。名称格式 `晶圆尺寸/die区间/价格/供应商简称`，如 `6/2.21~3/8/SZJYW`。全表 277 行，按 尺寸×die区间×供应商 区分（如 SZJYW 6寸 2.21~3→8、6寸 0~0.24→110）。同一表单 FID 下另有 `1c965343-028e-440b-af25-de2e0129b041`「芯片外发划片」，那是基于委外订单 `SUB_SUBREQORDER` 的**单据**（`FMODELTYPEID=600`），不是这张基础资料。
- **本单不适用标准限价**：三行 `FPRICELISTENTRY/FUPPRICE/FDOWNPRICE/FMAXPRICE/FMINPRICE` 全为 0，未关联采购价目表，故上节的限价控制对该单不生效。
- **订单「元/片」并未强制绑定资料价**：用 `FAllAmount / F_PIANNUMBER` 与 HPJ `F_PRICETEXT` 历史对照，约一半相等、一半更高（如资料 8→订单 10、25→28、32→40、60→90），只能证明资料价与实际金额不一致，不能据此认定手工/协商录入；也可能涉及带价、字段事件或修改后未重算，须进一步取证。**设上限前必须让用户确认口径**（以 HPJ 单价为上限，还是另定上限值）。本单第 3 行引 `HPJ00034`（资料价 8），实际 225/3 片=75，明显偏离，需用户核实是否错价。
- **可行方案**：① 标准价目表上下限＋限价控制（须先把划片价建进价目表并让订单行关联，强度是全局设置）；② BOS 保存校验按物料/物料分组设固定上限（改动小，但一刀切易误伤）；③ 用 HPJ「尺寸×供应商」取值做校验/带价——**需服务插件**（标准校验表达式不能跨表取 HPJ），业务最贴合；④ 在账套已有 CMK 系采购订单插件上追加。
- **未验证**：订单行单价是否/如何从 HPJ 取数（现有二开插件行为）；`F_UNW_DECIMAL_TZK` 含义；BOS 校验跨表取数能力。
- **证据脚本**：`scripts/scratch/2026-10/probe_huapian_pricelist*.js`（均只读）。

### 2026-10-17 WebAPI 复核：TK20260901032 单价换算差异

- 当前 View 第3行：N102010873，3片、6.589K、含税单价34.147822、价税合计225，附加价 F_extraprice=0；关联 HPJ00034，名称6/2.21~3/8/SZJYW，引用返回 F_pricetext=8。
- 数学核对：225/6.589=34.147822，225/3=75元/片。若按当前资料8元/片，应24元、约3.642435元/K。只能确认实际使用的金额相当于75元/片，不能确认系统曾把8正确带入后又错误换算。
- 同单第2行 HPJ00001 为75元/片、5片、1000K、375元，与价表一致；第3行等效片价恰好同前一行，提示可查复制/上一行价格残留，但这只是线索，不是已复现根因。
- 来源委外单 SUB00000976 第3行数量也为6.589K。未复现前端带价事件、未取得录入当时价表快照或插件代码，不应断言人为录错或系统换算故障。
- 基础资料表单 GUID 直接 View 返回“不允许加载业务对象”，采购订单 View 的 F_huapian 引用可返回当前价格文本。证据：output/po-price-TK20260901032-live.json、output/po-price-SUB00000976-live.json；只读脚本 scripts/scratch/2026-10/probe_po_price_live.js、probe_po_price_source.js。

### 同案继续核验：订单变更与应付调价（2026-10-17，WebAPI-only）

- 订单当前版本001，ChangeDate=2026-09-09 14:04:19.167，ChangeReason=修改步距，修改人为采购员A。该证据提示应调查修改区间后是否触发重算；没有变更前字段快照，不能证明此前选了75元价表，也不能确认沿用上一行。
- WebAPI按物料N102010873、供应商G050查应付并核对订单号：AP00152450（FID375004，类型2暂估，状态C已审核）该行6.589K、含税34.147822、225元；AP00160310（FID393352，类型3财务，状态A草稿）同一订单、源单AP00152450，该行6.589K、含税3.642434、24元。财务单创建/修改人为采购员A，创建时间2026-10-07 16:33:01.357。
- 应付按类型区分上下游，不把225和24直接相加判为重复付款；草稿24元仅证明已录入，不能表述为已审核生效或已付款。
- 客户端GetFormMetaData对PUR_PurchaseOrder和AP_PAYABLE均返回response_error解析失败，因此未能经该接口取得带价公式/插件。遵守用户WebAPI-only约定，不以SQL或浏览器绕过；如需追根因，人工在BOS采购订单扩展对象检查F_huapian、F_piannumber、FQty的值更新事件、FTaxPrice/金额重算和插件的当前行取值，并提供001变更前后快照。
- 证据：output/price-investigate-po.json、price-investigate-followup.json、price-investigate-ap-375004.json、price-investigate-ap-393352.json。只读，未复现UI事件，根因仍未确认。

### 同案根因排查补充（2026-10-17，只读）

- WebAPI查同一HPJ00034引用发现存在按8元/片正确计费的其他订单，例如TK20260813040的23片、184元。因此当前证据不支持所有该价表/片转K都必然算错；不能据此排除特定操作顺序下的插件缺陷。
- N102010873物料当前规格2.60*2.60，最后修改时间2026-07-01 15:20:35.960，早于目标9月订单；不能以近期改物料规格解释9月9日修改步距。
- 历史订单引用返回的是当前价表文本，不是录单当时价格快照；其他旧单价不等于当前8元不自动算历史错误。参考文章给出的PUR_PurchaseChange在本账套不存在，不继续猜业务对象。
- 本轮仍未取得变更前快照和插件逻辑，故“沿用上一行75”与“修改步距后未重算”均为待验证假设，不能升级为根因。下一步所需证据：TK20260901032版本000/001第3行划片信息、片数、数量、含税价和金额前后值；PUR_PurchaseOrder扩展的F_huapian值更新/实体服务规则，以及读取F_pricetext并写入FTaxPrice的插件代码。WebAPI受限时由用户/实施提供导出件，不用SQL或浏览器替代用户约定。
- 证据output/price-investigate-root-followup.json；脚本scripts/scratch/2026-10/probe_price_root_followup.js。

### 纠正：已取得正式变更单原价，排除本次变更新产生34元（2026-10-17 WebAPI复核）

- 前述“未取得变更前数值”已被本次证据更新。仓库references/procurement/purchase-order-delete-change-lock.md已记录正确表单PUR_POXChange，先前未检索到该领域条目而误查PUR_PurchaseChange；今后查采购订单变更必须先使用PUR_POXChange及原单号_V版本号，不以错误表单查询失败判定WebAPI无能力。
- ExecuteBillQuery命中TK20260901032_V001（FID100862），View和ExecuteBillQuery独立复核：第3行N102010873，FQtyX=FQty=6.589，FTaxPriceX=FTaxPrice=34.147822，FAllAmount=225；当前变更行HPJ00034、片数3。X字段为原数量/原含税价，含义参照金蝶官方采购订单新变更单API样例https://vip.kingdee.com/article/269520497934000640，并以字段名及前后值配对核对。
- 三行原数量和原含税价均与变更后相同。因此34元/K在本次变更前已存在，不能再将“9月9日修改步距时新算出34元”作为解释；本次也未把价格纠正为约3.64。
- 时间线：ChangeDate 2026-09-09 14:04:19.167；创建14:05:51.667；审核14:05:53.130；生效ActiveDate14:05:54，操作人采购员A。变更原因修改步距；自定义划片信息没有原值X配对字段，不能认定究竟从哪个HPJ区间改为8元，也不能认定原先75元来自上一行。
- 证据output/price-change-100862.json及price-change-100862-query.json；只读脚本probe_price_change_actual.js、probe_price_change_verify.js。后续根因应追查9月1日首次录单取价或更早编辑过程，而非将9月9日变更当成价格首次产生时点。
