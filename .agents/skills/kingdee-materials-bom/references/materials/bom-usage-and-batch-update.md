# 金蝶 BOM 用量修改 WebAPI 操作手册

## 目录

- 1. 核心原则
- 2. 运行环境和客户端
- 3. BOM 表单和关键字段
- 4. 正确发现 BOM 分组
- 5. 修改前的范围筛选
- 6. 写入前必须先做 dry-run
- 7. 单张 BOM 的标准修改流程
- 8. 非目标分录校验
- 9. 批量处理规则
- 10. 历史 PDFN 修改规则示例（原记录未注明执行日期）
- 11. 修改记录导出
- 12. 新建蓝膜 BOM（已验证 2026-09-11）

用于已明确授权的 `ENG_BOM` 用量修改；详细流程按需读取。新建蓝膜 BOM 另见第 12 节。

> 本文记录的是在示例电子有限公司账套中验证过的流程。
> 连接配置、账号和密码不写入本文，也不得复制到聊天提示词中。

## 1. 核心原则

BOM 修改必须通过金蝶 K3 Cloud WebAPI 的单据流程完成，不直接修改数据库。

禁止使用 SQL：

- `INSERT`
- `UPDATE`
- `DELETE`

修改范围必须由用户明确确认，包括：

- 产品系列或父项范围；
- BOM 分组；
- 旧用量；
- 新用量；
- 要修改的具体分录；
- 是否允许反审核、提交和审核。

只能修改明确授权的分录用量。不得顺便修改：

- 父项物料；
- 子项物料编码；
- 规格型号；
- 单位；
- 损耗率；
- 锡丝、黑胶、芯片等其他子项；
- 其他未授权字段。

批量前先在授权范围内选一张样板验证完整链路。历史 PDFN3 单芯筛选须覆盖 `PDFN3X3`、`PDFN3*3-8`；纯铜线两条用量可能为 `45 m/K` 和 `2.5 m/K`，不能把小用量当成唯一分录。

## 2. 运行环境和客户端

项目使用 Bun 和仓库已有的 K3 客户端：

```js
import { K3CloudWebAPI } from "<REPO_ROOT>/lib/k3/index.js";

const api = new K3CloudWebAPI();
await api.login();
```

新脚本优先从以下入口导入：

```text
lib/k3/index.js
```

实际客户端封装在：

```text
k3cloud.js
```

主要接口：

```js
api.executeBillQuery(...)
api.viewBill("ENG_BOM", fid)
api.unAuditBill("ENG_BOM", [fid])
api.saveBill("ENG_BOM", model, ...)
api.submitBill("ENG_BOM", [fid])
api.auditBill("ENG_BOM", [fid])
```

## 3. BOM 表单和关键字段

BOM 表单 ID：

```text
ENG_BOM
```

列表查询时常用字段：

```text
FID
FNumber
FGROUP.FNumber
FGROUP.FName
FDocumentStatus
FMaterialId.FNumber
FMaterialId.FName
FMaterialId.FSpecification
```

调用完整详情：

```js
const detail = await api.viewBill("ENG_BOM", fid);
```

### 列表查询的分录字段写法（2026-09-18 实证）

`executeBillQuery` 查 `ENG_BOM` 分录时，**字段名直接写分录字段本身，不能加实体前缀**：

```text
FMATERIALIDCHILD.FNumber / .FName / .FSpecification / .FDocumentStatus / .FForbidStatus
FNUMERATOR              用量（不是 NUMERATOR）
FCHILDUNITID.FNumber    子件单位
FMATERIALIDCHILD.Id     不支持（报「引用字段Id不存在」）
```

写 `FTreeEntity.FMaterialId.FNumber`、`FTreeEntity_FMATERIALIDCHILD.FNumber`、`TreeEntity_...`、`FEntity_...`
都会报「元数据中标识为 X 的字段不存在」。因此按子件物料/子件名称筛选 BOM 可以直接在服务端过滤：

```js
const rows = await api.executeBillQuery(
  "ENG_BOM",
  "FID,FNumber,FDocumentStatus,FGROUP.FName,FMaterialId.FNumber,FMaterialId.FName,FMaterialId.FSpecification," +
    "FMATERIALIDCHILD.FNumber,FMATERIALIDCHILD.FName,FMATERIALIDCHILD.FSpecification,FNUMERATOR,FCHILDUNITID.FNumber",
  "FMaterialId.FSpecification like '%6R%' and FMATERIALIDCHILD.FName like '%框架%'",
  20000
);
```

一条 BOM 若命中多条分录会返回多行，仍须按 `FID`（必要时 `FID+子件编码`）去重。

完整详情中的重要字段：

```js
detail.Number
detail.DocumentStatus
detail.MATERIALID
detail.GROUP
detail.TreeEntity
```

`TreeEntity` 中的分录字段：

```js
{
  Id,                         // 分录内码，等价于 FEntryID
  MATERIALIDCHILD.Number,     // 子项物料编码
  MATERIALIDCHILD.Name,       // 子项物料名称
  MATERIALIDCHILD.Specification,
  NUMERATOR,                  // 用量
  CHILDUNITID.Number          // 单位
}
```

多语言名称可能是数组，需要取中文 `Key === 2052` 的值：

```js
function chineseName(value) {
  return Array.isArray(value)
    ? value.find((item) => item.Key === 2052)?.Value || ""
    : "";
}
```

## 4. 正确发现 BOM 分组

金蝶界面左侧的「BOM分组」对应的是：

```text
FGROUP
```

例如查询 IDM-PDFN3X3：

```js
const rows = await api.executeBillQuery(
  "ENG_BOM",
  "FID,FNumber,FGROUP.FNumber,FGROUP.FName,FDocumentStatus,FMaterialId.FNumber,FMaterialId.FName",
  "FGROUP.FName='IDM-PDFN3X3'",
  100
);
```

查询 IDM-PDFN5X6：

```js
const rows = await api.executeBillQuery(
  "ENG_BOM",
  "FID,FNumber,FGROUP.FNumber,FGROUP.FName,FDocumentStatus,FMaterialId.FNumber,FMaterialId.FName",
  "FGROUP.FName='IDM-PDFN5X6'",
  100
);
```

字段区别：

```text
FGROUP          = BOM 分组，对应界面左侧 BOM 分组
FMaterialGroup  = 父项物料分组，不是 BOM 分组
```

不要只按父项物料规格查询。例如仅用：

```text
FSpecification like '%PDFN5%'
```

可能漏掉 IDM、OEM 等 BOM 分组中的记录。

带分录字段的查询可能一张 BOM 返回多行，必须按真实 `FID` 去重：

```js
const unique = new Map();
for (const row of rows) {
  unique.set(String(row[0]), row);
}
const uniqueRows = [...unique.values()];
```

## 5. 修改前的范围筛选

对每个唯一 `FID` 调用 `viewBill("ENG_BOM", fid)`，读取完整 `TreeEntity` 后再筛选。

不能只用“同时包含铝带和铜线”这种宽条件，至少要判断：

```text
父项范围正确
BOM 分组正确
状态正确
铝带分录数量正确
铜线分录数量正确
铝带旧用量正确
铜线旧用量正确
```

标准的一对一 BOM 判断：

```js
const aluminum = tree.filter((entry) => entry.materialName === "铝带");
const copper = tree.filter((entry) => entry.materialName === "铜线");

const isStandardBom =
  aluminum.length === 1 &&
  copper.length === 1;
```

推荐只把以下 BOM 自动加入批量修改：

```text
FDocumentStatus === "C"
铝带恰好 1 条
铜线恰好 1 条
旧用量完全匹配用户确认值
```

### 纯铜线 BOM

纯铜线 BOM 是有铜线、但没有铝带的 BOM：

```text
铝带数量 = 0
铜线数量 >= 1
```

如果纯铜线 BOM 中有多条铜线，例如：

```text
铜线：25 + 5
铜线：37.8 + 2.1
```

不能因为其中一条等于目标旧值，就自动判断它是要修改的分录。必须先向用户确认具体 `FEntryID`。

### 状态边界

```text
A = 草稿
B = 审核中
C = 已审核
D = 重新审核
Z = 暂存
```

默认批量修改只处理状态 `C`。状态 `D` 不得无条件套用 `C` 状态流程，应单独列出并让用户确认。

## 6. 写入前必须先做 dry-run

正式写入前先只查询，不调用反审核、保存、提交和审核接口。

dry-run 输出至少包括：

- 候选数量；
- 每张 BOM 编号；
- FID；
- 父项物料；
- BOM 分组；
- 当前状态；
- 目标分录的 `FEntryID`；
- 修改前用量；
- 修改后用量；
- 被排除的 BOM 及原因。

候选数量和明细必须处于用户已明确授权的范围；范围或分录有歧义时先澄清，不重复索取已有授权。

批量脚本建议使用显式开关：

```text
默认：dry-run
明确传入 --apply：才允许写入
```

## 7. 单张 BOM 的标准修改流程

### 7.1 保存修改前快照

写入前实时读取当前 BOM：

```js
const before = await api.viewBill("ENG_BOM", fid);
```

快照至少保存：

```text
DocumentStatus
父项物料
TreeEntity 分录数量
每个分录的 FEntryID
子项物料编码
规格
单位
当前用量
```

不能使用旧 JSON、旧导出文件或历史查询结果代替当前查询。

### 7.2 再次检查前置条件

每张 BOM 在真正写入前都要再次检查：

```text
状态仍然是 C
目标分录仍然存在
目标分录数量仍然符合预期
旧用量仍然是用户确认的值
```

任何一项不符合，都要停止批量处理，不要盲目覆盖新值。

### 7.3 反审核

```js
await api.unAuditBill("ENG_BOM", [fid]);
```

反审核后重新读取，确认状态已经不是 `C`。

### 7.4 用最小模型保存

#### 同时修改铝带和铜线

例如：

```text
铝带：2.0 → 1.6
铜线：2.5 → 2.3
```

保存模型：

```js
await api.saveBill(
  "ENG_BOM",
  {
    FID: fid,
    FTreeEntity: [
      {
        FEntryID: aluminumEntryId,
        FNUMERATOR: 1.6,
      },
      {
        FEntryID: copperEntryId,
        FNUMERATOR: 2.3,
      },
    ],
  },
  [],
  ["FID", "FDocumentStatus"],
  false
);
```

#### 只修改铜线

例如：

```text
铜线：2.8 → 2.769
```

保存模型：

```js
await api.saveBill(
  "ENG_BOM",
  {
    FID: fid,
    FTreeEntity: [
      {
        FEntryID: copperEntryId,
        FNUMERATOR: 2.769,
      },
    ],
  },
  [],
  ["FID", "FDocumentStatus"],
  false
);
```

关键要求：

```text
使用真实 FEntryID
只提交得到授权的分录
IsDeleteEntry 必须为 false
不要提交整张 TreeEntity 重建 BOM
```

### 7.5 保存后立即回查

```js
const saved = await api.viewBill("ENG_BOM", fid);
```

确认：

```text
目标分录已经是新用量
分录数量没有变化
非目标分录没有变化
非目标物料、规格、单位没有变化
```

### 7.6 提交和审核

```js
await api.submitBill("ENG_BOM", [fid]);
await api.auditBill("ENG_BOM", [fid]);
```

### 7.7 审核后最终回查

```js
const after = await api.viewBill("ENG_BOM", fid);
```

必须确认：

```text
DocumentStatus === "C"
目标分录用量正确
非目标分录与修改前快照一致
```

## 8. 非目标分录校验

可以按 `FEntryID` 建立前后快照：

```js
function assertUnchangedExceptTargets(beforeTree, afterTree, targetIds) {
  const beforeMap = new Map(
    beforeTree.map((entry) => [String(entry.entryId), entry])
  );
  const afterMap = new Map(
    afterTree.map((entry) => [String(entry.entryId), entry])
  );

  if (beforeMap.size !== afterMap.size) {
    throw new Error("BOM 分录数量发生变化");
  }

  for (const [entryId, before] of beforeMap) {
    const after = afterMap.get(entryId);
    if (!after) {
      throw new Error(`分录 ${entryId} 消失`);
    }

    if (targetIds.has(entryId)) {
      if (
        after.materialNumber !== before.materialNumber ||
        after.specification !== before.specification ||
        after.unit !== before.unit
      ) {
        throw new Error(`目标分录 ${entryId} 的物料、规格或单位变化`);
      }
    } else if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error(`未授权分录 ${entryId} 发生变化`);
    }
  }
}
```

## 9. 批量处理规则

批量处理必须串行逐张执行，不要一次性对大量 FID 盲目提交。

每张 BOM 都要经历：

```text
重新读取
→ 检查旧值
→ 保存快照
→ 反审核
→ 最小保存
→ 保存回查
→ 提交
→ 审核
→ 最终回查
```

批量停止条件：

- 实时候选数量与用户确认数量不一致；
- 任意一张旧用量已经变化；
- 任意一张状态不是预期状态；
- 保存后目标值不正确；
- 非目标分录发生变化；
- 提交失败；
- 审核失败；
- 最终回查失败。

遇到失败：

```text
立即停止，不跳过继续
记录已成功数量和当前失败 BOM
如果已经反审核，尝试恢复为已审核
报告恢复成功或失败
```

## 10. 历史 PDFN 修改规则示例（原记录未注明执行日期）

### PDFN3

标准一对一 BOM：

```text
铝带：2.0 m/K → 1.6 m/K
铜线：2.5 m/K → 2.3 m/K
```

这两个分录都需要修改。

已验证范围包括：

```text
PDFN3X3
PDFN3*3-8
IDM-PDFN3X3
```

### PDFN5

标准一对一 BOM：

```text
铜线：2.8 m/K → 2.769 m/K
铝带：保持原值
```

已验证范围包括：

```text
PDFN5
IDM-PDFN5X6
```

如果用户没有明确授权，以下情况不应自动处理：

```text
纯铜线多分录
D 状态 BOM
没有铝带或没有铜线的结构
铝带/铜线数量不符合一对一条件
旧用量与确认值不一致
```

## 11. 修改记录导出

完成后必须重新从金蝶当前数据回查，不要只拼接旧日志。

记录至少包括：

- 系列；
- BOM 分组；
- BOM 编号；
- FID；
- 父项物料；
- BOM 状态；
- 修改批次；
- 铝带物料、规格、修改前用量、修改后用量；
- 铜线物料、规格、修改前用量、修改后用量；
- 回查结果。

未纳入范围单独记录：

- BOM 编号；
- FID；
- BOM 分组；
- 当前状态；
- 当前分录；
- 未纳入原因。

Excel 采用普通工作表区域和 `AutoFilter`，不要创建复杂的原生 Excel Table XML，以避免 Excel 打开时出现结构修复提示。

交付前至少验证：

```text
ZIP 无坏项
所有 XML 可以解析
工作表数量和行数正确
AutoFilter 存在
无不必要的 Table XML
LibreOffice 或等效引擎可以实际打开
```

## 12. 新建蓝膜 BOM（已验证 2026-09-11）

先读取 `references/materials/lm-bom-parent-requirements.md`，确认父项可为主产品等前置条件；下列为历史最小报文示例，不能替代当前模板和业务范围核对。

父项为 -L 蓝膜片、子项为不带 L 晶圆片，1:1、单位 K，分组 `0-lm`（蓝膜），编号自动生成 `父项号_V1.0`。模板：`N102012246_V1.0`（父 N102012246 → 子 N102012247）。

```js
const model = {
  FCreateOrgId: { FNumber: "100" }, FUseOrgId: { FNumber: "100" },
  FMaterialId: { FNumber: "N102012288" },   // 父项：-L 蓝膜片
  FGroup: { FNumber: "0-lm" },              // 蓝膜分组
  FTreeEntity: [{
    FMaterialIdChild: { FNumber: "N102012289" },  // 子项：不带 L 晶圆片
    FNumerator: 1, FDenominator: 1, FChildUnitId: { FNumber: "K" },
  }],
};
const save = await api.post("DynamicFormService.Save", { formid: "ENG_BOM", data: { Model: model } });
const fid = String(save.Result.Id);  // 成功即得编号 父项号_V1.0
await api.submitBill("ENG_BOM", [fid]);
await api.auditBill("ENG_BOM", [fid]);
const v = await api.viewBill("ENG_BOM", fid);  // 回查 DocumentStatus 应为 C
```
