# ENG_BOM（物料清单）WebAPI 查询手册

## 目录

- 1. 每个脚本自己登录
- 2. 分录字段不加实体前缀
- 3. 字段名不确定先探针，别拿主查询试错
- 4. 型号 token 的口径歧义
- 5. 框架类物料的分类口径
- 6. 交付形态（用户偏好）
- 7. 禁用状态与禁用进度统计（BOM 与料号是两条独立的轴）


适用：按父项规格/分组/子件筛 BOM，导出 BOM 清单，核对某物料被哪些 BOM 使用。只读查询，不改单据。

## 1. 每个脚本自己登录

`K3CloudWebAPI` 不做自动登录，`bun run login`（login_k3cloud.js）只是独立进程的一次验证，cookie 不跨进程共享。脚本里第一次查询前必须：

```js
const api = new K3CloudWebAPI();
await api.login();
```

漏掉就直接抛「会话信息已丢失，请重新登录」——先看脚本有没有 login，再怀疑网络或凭据。

## 2. 分录字段不加实体前缀

`executeBillQuery("ENG_BOM", ...)` 的分录字段直接写分录字段本身：

```text
FMATERIALIDCHILD.FNumber / .FName / .FSpecification / .FDocumentStatus / .FForbidStatus
FNUMERATOR              用量（写 NUMERATOR 报「字段不存在」）
FCHILDUNITID.FNumber    子件单位（CHILDUNITID.FNumber / FCHILDUNITID.FNumber 视版本，先用探针确认）
FMATERIALIDCHILD.Id     不支持（报「引用字段Id不存在」）
```

`FTreeEntity.FMaterialId.FNumber`、`FTreeEntity_FMATERIALIDCHILD.*`、`TreeEntity_*`、`FEntity_*` 全部报「元数据中标识为 X 的字段不存在」。

好处是可以一次在服务端按子件过滤，不必逐张 `viewBill`：

```js
const rows = await api.executeBillQuery(
  "ENG_BOM",
  "FID,FNumber,FDocumentStatus,FGROUP.FNumber,FGROUP.FName," +
    "FMaterialId.FNumber,FMaterialId.FName,FMaterialId.FSpecification," +
    "FMATERIALIDCHILD.FNumber,FMATERIALIDCHILD.FName,FMATERIALIDCHILD.FSpecification," +
    "FMATERIALIDCHILD.FDocumentStatus,FMATERIALIDCHILD.FForbidStatus,FNUMERATOR,FCHILDUNITID.FNumber",
  "FMaterialId.FSpecification like '%SOT-23(6R)%' and FMATERIALIDCHILD.FName like '%框架%'",
  20000
);
```

- 一条 BOM 命中多条分录会返回多行 → 按 `FID`（必要时 `FID+子件编码`）去重；纯列表查询（不带分录字段）天然一行一张 BOM。
- 需要完整分录结构时用 `viewBill("ENG_BOM", fid)` 读 `detail.TreeEntity`：分录字段是 `Id / MATERIALIDCHILD.Number·Name·Specification / NUMERATOR / CHILDUNITID.Number`，多语言名称取 `Key === 2052`。
- 库存/采购等旁证另查 `STK_Inventory`（可按 `FMaterialId=<FID>`）、`PUR_PurchaseOrder`（`FCloseStatus='A'` 未关闭）。

## 3. 字段名不确定先探针，别拿主查询试错

用仓库工具逐个查询候选，不附加 FID。输出区分有数据、空结果、点名的字段错误和其他请求错误；其他请求错误立即停止，不能判断后续字段有效性：

```bash
bun scripts/tools/probe_fieldkeys.js ENG_BOM \
  "FMATERIALIDCHILD.FNumber,FNUMERATOR,FTreeEntity_NUMERATOR,NUMERATOR" \
  "FNumber='AD0060005_V1.0'"
```

同一轮里把「怀疑的错写法」也放进去，一次拿到确证，避免来回两轮。

## 4. 型号 token 的口径歧义

「规格型号 6R」在 BOM 语境有两种读法，必须先定口径再出表：

| 口径 | 含义 | 过滤写法 |
| --- | --- | --- |
| A（默认） | BOM 列表的「规格型号」列 = **父项物料规格**含 6R | `FMaterialId.FSpecification like '%SOT-23(6R)%'` |
| B | BOM **子件**是规格含 6R 的物料 | `FMATERIALIDCHILD.FSpecification like '%6R%'` |

- 本厂 6R 指 **SOT-23(6R)** 封装，父项规格形如 `SOT-23(6R)` 或 `SOT-23(6R)/3K盘/无/A4`；「SOT 6R」= `%SOT-23(6R)%`。
- 两个口径各出一页明细，回复里点明差别；用户澄清后**立刻按新口径重出并把新文件作为主交付**，不要让旧口径文件继续挂着。
- 规格 substring 过滤必然带进旁支：`%6R%` 会命中 `TO-252/2.5K盘/无/E6R5N-B`、父项 `SOT-23(6R)` 却挂 `27R` 系列框架等情况。出表前扫一遍规格取值分布，把对不上的行单列「需确认」页。

## 5. 框架类物料的分类口径

- 铜框架 = 子件名称含「铜」：铜镀银框架（含片装/卷装）、裸铜框架、铜框架、单基岛铜框架（全镀银）。分类用正则 `/铜/`。
- 非铜：铁镍框架、镍钯金框架、双基岛框架（条镀银/全镀银）。
- 料号 `105010xxx` 为铜镀银分组，`105020xxx` 铁镍，`105030xxx` 镍钯金，`105040xxx` 裸铜；`N` 前缀是新编码。

## 6. 交付形态（用户偏好）

- 输出Excel 直接放仓库 `output/` 根目录（不建子目录），文件名带口径：`output/SOT6R_BOM_铜框架_YYYYMMDD.xlsx`。
- exceljs 写多 Sheet：汇总（口径、总数、分类计数、料号状态提示）/ 分布 / 明细 / 对照 / 需确认。
- **不要加 autoFilter 或 Table 对象**，否则用户打开时提示修复；冻结首两行、列宽即可。
- 写完必须用仓库 `xlsx` 读回校验 Sheet 名与各页行数，再回复。
- 回复里直接给关键数字表 + 框架/料号分布表 + `C:\` 完整路径 + 一张 MEDIA 卡（不重复贴卡）。
- 明细页固定列：序号 / BOM编号 / BOM_FID / BOM状态 / BOM分组 / 父项编码·名称·规格 / 框架编码·名称·规格·状态 / 用量 / 单位。状态写 `C(已审核)` 这类带中文标签的形式，料号同时给单据状态与禁用状态（`B` = 已禁用）。
- 禁用进度类交付的分页：汇总 / 按框架料号统计 / 料号状态 / 待禁用_BOM_已审核未禁用 / 待禁用_BOM_仅N新料 / 待处理_BOM_重新审核D未禁用。每行带 `BOM_FID`，执行阶段直接用。

## 7. 禁用状态与禁用进度统计（BOM 与料号是两条独立的轴）

- 「正常」= `FForbidStatus='A'`，不是单据状态。用户说「还有多少是正常状态的，就是已审核未禁用的」＝ `FDocumentStatus='C'` 且 `FForbidStatus='A'`；`D`（重新审核）虽然未禁用但禁不了，金蝶里通常要先审核回 C —— 单列一页并说明，不要混进「可禁用」计数。
- `ENG_BOM` 自带 `FForbidStatus`（A 正常 / B 已禁用），料号在 `BD_MATERIAL` 上也有 `FForbidStatus`：**两者互不联动**。常见组合有「料号已禁用但名下 BOM 仍正常」「料号仍正常但名下 BOM 已禁用」。统计和后续动作必须两边分别查、分别报，不能由一边推另一边。
- 一次查全状态，再在本地交叉分组（框架料号 × BOM单据状态 × BOM禁用状态）：

```js
const rows = await api.executeBillQuery(
  "ENG_BOM",
  "FID,FNumber,FDocumentStatus,FForbidStatus,FGROUP.FName," +
    "FMaterialId.FNumber,FMaterialId.FSpecification," +
    "FMATERIALIDCHILD.FNumber,FMATERIALIDCHILD.FName,FMATERIALIDCHILD.FSpecification," +
    "FMATERIALIDCHILD.FDocumentStatus,FMATERIALIDCHILD.FForbidStatus",
  "FMaterialId.FSpecification like '%SOT-23(6R)%' and FMATERIALIDCHILD.FName like '%框架%'",
  20000
);
```

- 料号侧另一条查询走 `BD_MATERIAL`（`FNumber='X' or FNumber='Y' ...`，限制在 BOM 里出现过的料号上），取 `FDocumentStatus/FForbidStatus/FMaterialGroup.FName`，并回填「该料号在 BOM 中出现次数 / 其中已禁用数」，料号与 BOM 的进度差就一眼可见。
- 统计前抽 1~2 张 `viewBill("ENG_BOM", fid)` 复核 `ForbidStatus` 与 `ForbidderId_Id`（非 0 = 真有人禁用过），确认字段没读错再出数。
- 料号新旧：`N` 前缀=新料，非 N=旧料。本厂产品与框架配对一致，按「父项是 N」和「框架是 N」过滤会得到同一批（289=289 这种相等可以互相当校验）；两个集合不相等就是出现了新旧混搭，单独列出。
- 统计只读，禁用是写操作：先给只读统计 + dry-run（FID / 料号 / 当前 `FDocumentStatus`+`FForbidStatus` / 拟执行动作），等用户点明范围（例如「只禁 N 新料的 N 张 BOM + N 个 N 框架料号」）再执行，执行后回查状态。

### 7.1 问「成品料号有多少个」= BOM 父项物料去重，不是 BOM 张数

同一成品的多版本 BOM 只算一个成品料号（实测 513 张 BOM → 413 个料号）。用户要的是“让销售订单选不到”时：

- **只能处置料号（`BD_MATERIAL`）**：销售订单能不能选到只看料号的 `FForbidStatus` / `FDocumentStatus`，禁 BOM 不影响销售订单选料。两件事分别做、分别报。
- `Forbid` 被拒（有即时库存 / 未完成生产订单 / 未关闭销售订单）时用 `unAuditBill` 把料号 `C→D`，新单据同样选不到；恢复走 `submitBill → auditBill`。详见 `references/materials/material-forbid-6r.md` §7–§8 与仓库 `.agents/skills/kingdee-materials-bom/references/materials/material-forbid-6r.md`。
- 汇报前把汇总口径限定条件写清楚（如「每个料号至少有一张铜框架 BOM」≠「只用铜框架」），并反向拉一遍同父项的全部 BOM 子件做交叉核对：拿 `ENG_BOM` 同一父项的全部 BOM（去掉铜过滤）比每个 `FMATERIALIDCHILD.FName`；混挂的（如钢/铁镍框架版本）单独列一页让用户确认，不要自己替业务判断哪个版本在用（这些 BOM 的 `ISDEFAULT` 常为 `0`，没默认标记可用）。
