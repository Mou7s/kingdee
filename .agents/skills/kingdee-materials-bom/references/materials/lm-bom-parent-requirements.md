# 蓝膜 BOM（0-lm）父项前置条件与 10104 蓝膜片口径（2026-09-17 实证）

## 目录

- 现象
- 10104「自采塑封」两套口径（全组 1738 条统计）
- 改字段的正确位置（关键坑）
- 收敛后的标准流程
- 蓝膜 BOM 体检口径（复核 / 回答「是不是蓝膜 BOM 有问题」）
- 原 SKILL.md 正文（备查）


## 现象

按 `.agents/skills/kingdee-materials-bom/references/materials/bom-usage-and-batch-update.md` §12 的报文给 `N101041737 MOS300N10-L` 建蓝膜 BOM，Save 返回失败，错误串：

```
字段“父项物料单位”是必填项;字段“父项物料编码”是必填项;
父项物料中的“可为主产品”必须是勾选的!;
父项物料未审核或已禁用，不允许保存！;父项物料单位的基本单位不能为空!
```

前两条和最后两条是**错位报错**（父项明明是 `C` 已审核、未禁用、单位 K）。真正病因只有中间那条：父项物料的 **可为主产品 = 未勾选**。

判据（`FIsMainPrd` 可直接用 `executeBillQuery` 查）：

| 物料 | FCategoryID | FErpClsID | FIsMainPrd | FIsSubContract | 能否做 BOM 父项 |
|---|---|---|---|---|---|
| N101041737 MOS300N10-L（改造前） | CHLB01_SYS | 1 | false | false | ❌ |
| N101041737 MOS300N10-L（改造后） | CHLB04_SYS | 3 | true | true | ✅ |
| N101040161 三极管8550-L ATW（样板） | CHLB04_SYS | 3 | true | true | ✅ |

## 10104「自采塑封」两套口径（全组 1738 条统计）

| 口径 | 条数 | FCategoryID | FErpClsID | FIsSubContract | FIsMainPrd | FIsProduce |
|---|---|---|---|---|---|---|
| 蓝膜片（`-L`，蓝膜 BOM 的父项） | 894 | CHLB04_SYS 委外半成品 | 3 | true | true | false |
| 晶圆片（裸名，BOM 子项） | 842 | CHLB01_SYS 原材料 | 1 | false | false | false |
| 混合（异常） | 2 | — | 1/2 | 混 | 混 | — |

结论：10104 的 `-L` 蓝膜片必须建成「委外半成品 + ERP3 + 允许委外 + 可为主产品」，裸名晶圆片建成「原材料 + ERP1」；两条都建成 ERP1 时，蓝膜片事后挂不上 BOM（同组 `N101041728 MOS3407A-L` 即此状态）。

蓝膜 BOM 是否已建不能只看分组：按父项编号反查 `ENG_BOM`（任意分组）再下结论；本组 612 张 BOM、14 条名以 `-L` 结尾的料缺 BOM。

## 改字段的正确位置（关键坑）

`BD_MATERIAL` 的 Save 报文里，各属性的实体归属不同，写错实体会报「寻找实体上 IsMainPrd 对应的属性描述符失败，实体不存在此属性！[EntityType：…]」：

| 字段 | 所在实体（Save 键） | 存储表 |
|---|---|---|
| FErpClsID 物料属性 | `SubHeadEntity` | T_BD_MATERIALBASE |
| FIsSubContract 允许委外 | `SubHeadEntity` | T_BD_MATERIALBASE |
| FCategoryID 存货类别 | Model 顶层（+`SubHeadEntity`） | T_BD_MATERIALBASE |
| FIsMainPrd 可为主产品 | **`SubHeadEntity5`** | T_BD_MATERIALPRODUCE |

- 把 `FIsMainPrd` 放在 Model 顶层或 `SubHeadEntity` 都会被拒（顶层报 MATERIAL 实体无此属性，SubHeadEntity 报 MaterialBase 无此属性）。
- `NeedUpDateFields` 里写上 `FErpClsID/FIsSubContract` **不能**让 `SubHeadEntity` 生效：Save 返回 `IsSuccess=true`，但实际只有顶层 `FCategoryID` 落库（本次先踩此坑）。用不带 `NeedUpDateFields` 的模型、显式带 `FEntryId`（View 的 `MaterialBase[0].Id`，与 `MaterialProduce[0].Id` 同值）即可一次写全。
- 定位“某字段属于哪个实体”的通用办法：先查存储列归属，再对上 View 的实体数组

```sql
SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
WHERE COLUMN_NAME LIKE '%MAINPRD%';
-- FISMAINPRD → T_BD_MATERIALPRODUCE → MaterialProduce → Save 键 SubHeadEntity5
-- FISSUBCONTRACT → T_BD_MATERIALBASE → MaterialBase → Save 键 SubHeadEntity
```

- `FIsSubContract`（允许委外）能被 `FIsProduce` 的实体服务规则联动（元数据规则原文：允许生产不勾选 → 允许委外勾选），但那只在字段变动事件里触发；直接读旧物料不会自动纠正，仍需显式写。

## 收敛后的标准流程

1. 读现状：`executeBillQuery` 取 `FCategoryID.FNumber,FErpClsID,FIsMainPrd,FIsSubContract,FIsProduce,FDocumentStatus,FForbidStatus`；`View` 取 `MaterialBase[0].Id` / `MaterialProduce[0].Id` / `Id`(FID)。
2. `unAuditBill("BD_MATERIAL",[fid])` → 回查应为 `D`。
3. 一次 Save：`{FMATERIALID: fid, FCategoryID:{FNumber:"CHLB04_SYS"}, SubHeadEntity:{FEntryId, FErpClsID:"3", FCategoryID:{FNumber:"CHLB04_SYS"}, FIsSubContract:true}, SubHeadEntity5:{FEntryId, FIsMainPrd:true}}` → 回查四项全部到位。
4. `submitBill` → `auditBill` → 回查 `C`、未禁用。
5. 建蓝膜 BOM（§12 报文）→ 三路复核：`executeBillQuery(ENG_BOM)`、`View`（`TreeEntity[].MATERIALIDCHILD/NUMERATOR/DENOMINATOR/CHILDUNITID`）、SQL `T_ENG_BOM`+`T_ENG_BOMCHILD`+`T_ENG_BOMGROUP`。
6. 规格变更与属性变更可同批：已审核物料改规格走 `UnAudit → Save{NeedUpDateFields:["FSpecification"], Model:{FMATERIALID,FSpecification}} → Submit → Audit`，与属性改写互不干扰。

## 蓝膜 BOM 体检口径（复核 / 回答「是不是蓝膜 BOM 有问题」）

用户怀疑某型号或整册蓝膜 BOM 有问题时，按下面三路查、逐路给实测数字，别凭印象答：

1. **父子配对**：父项是 `-L` 蓝膜片，子项是不带 `-L` 的**同一颗**晶圆片。**先把名称归一化再比**，原始字符串直接比对会把几百条正常数据报成异常：去掉全部空格与全角空格、去掉「（禁用）/（停用）/（晶圆）」这类标注、**去掉所有 `-L` 而不只是结尾的（厂家后缀常写在 `-L` 之后，如 `三极管BC807S-L  YW`）**、允许父项尾部多一个厂家标记（`SK/KXW/XS/JJ/XYD/ZWJY/FJATW/WXRYW` 等）。旧 `lm（旧）` 组**不能按名称判**：`10102xxx` 父 / `10101xxx` 子、父子同叫「稳压管芯片/三极管芯片」、或「客供芯片-蓝膜片 → 客供芯片-晶圆片」，都是历史命名惯例；该组配对看**料号数字串等长且仅一位不同**（`101020229`↔`101010229`、`10202xxxx`↔`10201xxxx`），父项规格常带 `-L` 而子项不带，同样不能据此判异常。
2. **用量与单位**：全组应为 `1:1`、子项单位 `K`。
3. **同父项多张 BOM**：同一父项挂 ≥2 张即重复候选；子项不同的（如 `_V1.1 子=A` / `_V1.2 子=B`）优先复核，子项相同的属历史版本冗余，列出料号+子项+状态交用户定夺，不擅自删。

**委外物料链交叉核对（BOM 对不对，还要看单据怎么用）**：委外订单（`SUB_SUBREQORDER`）的用料清单是 `SUB_PPBOM`，单号形如 `SUBBOM0000xxxx`，按头表 `FSUBBILLNO = 委外订单号` 查；头 `FBOMID` 指向 `ENG_BOM.FID`，可证明该单据确实用了这张 BOM。核对面：父项、子项、分子/分母、`FMUSTQTY`（应发）是否等于委外订单行数量、`FDOCUMENTSTATUS`。

**只读 SQL 列名（写前先 `INFORMATION_SCHEMA.COLUMNS` 核对，别猜）**：

| 对象 | 正确列名 | 常见误写（都是 View 键名或别的表） |
|---|---|---|
| BOM 明细 `T_ENG_BOMCHILD` | 子项物料 `FMATERIALID`、头关联 `FID`、单位 `FUNITID`、用量 `FNUMERATOR/FDENOMINATOR` | `FMATERIALIDCHILD`、`FCHILDUNITID` |
| BOM 分组 | `T_ENG_BOM.FGROUP` → `T_ENG_BOMGROUP.FID`，名在 `T_ENG_BOMGROUP_L` | — |
| 委外用料清单头 `T_SUB_PPBOM` | 委外订单号 `FSUBBILLNO`、产品 `FMATERIALID`、`FBOMID` | `FMOBillNo`（生产 PPBOM 才有）、`FCUSTOMERID`（不存在） |
| 委外用料清单分录 `T_SUB_PPBOMENTRY` | `FMATERIALID/FNUMERATOR/FDENOMINATOR/FMUSTQTY/FSCRAPRATE` | `FQTY`、`FPICKEDQTY`（在 `_Q` 表） |
| 委外领料 | 头 `T_SUB_PICKMTRLDATA`；`T_SUB_PICKMTRLDATAENTRY` 不存在（Invalid object name） | — |

**实测基线（会漂移，只作对照）**：全库蓝膜 BOM 2187 行（分组 `0-lm` + `lm（旧）`）；按上面的归一化规则判定后，**真·父子错配只有 2 条**——`101020229_V1.0` 子项挂成 `101010224 BC850C芯片`、`101021021_V1.0` 子项挂成 `101011022 B1040S`，都是 2024-12 建的历史料，正确的伙伴 `101010229`/`101011021` 确实存在（已审核但已禁用）；**同父项多张 BOM 12 个父项 / 24 张**（3 张由集成账号 `kingdee` 批量导入、其余手工，其中 3 个父项两张子项互不相同）；用量非 1:1 与单位非 K 各 0 条。

**报条数之前先验证判定规则**：名称类比对先归一化，再抽 3~5 条人工确认「是不是同一颗 die」才给总数；清单先标成「待核」交用户挑范围，不要把粗筛结果直接说成「异常 N 条」——精确复核会把它推翻（本次先报 34 条、复核后真异常 2 条，只能当场改口）。这类历史数据用户通常选择不改，问清范围再动手。核查确实无异常就直接报「对得上」并给数字，不要为迎合提问硬找问题；一次只报事实与范围，不替用户决定改哪条。

只读脚本骨架（连接常量照 `scripts/tools/check_over_report.js`，仓库外临时脚本要用绝对路径导入 `k3cloud.js`）：

```js
import mssql from "mssql";
import { K3_DB_HOST, K3_DB_USER, K3_DB_PASS, K3_DB_NAME } from "<REPO_ROOT>/k3cloud.js";
const config = { user: K3_DB_USER, password: K3_DB_PASS, server: K3_DB_HOST,
  database: K3_DB_NAME, options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 600000, connectionTimeout: 60000 };
await mssql.connect(config);
```

## 原 SKILL.md 正文（备查）

- **蓝膜 BOM 的前置条件与 10104 蓝膜片口径（2026-09-17 实证）**：`ENG_BOM` Save 报「父项物料中的“可为主产品”必须是勾选的!」（常伴随“父项物料单位/编码必填”“父项未审核”等**错位报错**）时，真正缺的是父项 `FIsMainPrd`=true。10104 组实测两套口径：蓝膜片（`-L`，蓝膜 BOM 父项）894 条全为 `CHLB04_SYS 委外半成品 / FErpClsID=3 / FIsSubContract=true / FIsMainPrd=true / FIsProduce=false`，晶圆片（裸名）842 条全为 `CHLB01_SYS / ERP1 / 委外否 / 主产品否`；两条都按 ERP1 建则蓝膜片事后挂不上 BOM。改写字段的实体位置：`FErpClsID`/`FIsSubContract` 在 `SubHeadEntity`（`T_BD_MATERIALBASE`），`FIsMainPrd` 在 **`SubHeadEntity5`**（`T_BD_MATERIALPRODUCE`）——`FIsMainPrd` 放 Model 顶层或 `SubHeadEntity` 会报「实体不存在此属性」，且 `NeedUpDateFields` 带这些字段名并不会让 `SubHeadEntity` 生效（Save 报成功但只有顶层 `FCategoryID` 落库）；定位字段归属先用 `INFORMATION_SCHEMA.COLUMNS` 查存储表再对 View 实体。用户问「这个型号的蓝膜 BOM 有没有问题」时别凭印象答，按体检口径三路查并给数字：① `ENG_BOM` 父子项是否为同一颗（父名去 `-L` ＝ 子名，旧 `lm（旧）` 组父子同名不算异常）、② 用量 1:1 与子项单位 `K`、③ 单据链——委外订单的用料清单 `T_SUB_PPBOM`（`FSUBBILLNO`=委外订单号，`FBOMID`→`ENG_BOM.FID`）子项与应发量是否与订单行一致；查完对得上就说对得上，扫出异常列清单交用户。

