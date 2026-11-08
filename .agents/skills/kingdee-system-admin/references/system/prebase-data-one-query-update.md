# 预置基础资料1查询与批量修改方法

## 目录

- 1. 先区分设计器标识和 API FormId
- 2. 读取当前数据，先确认范围
- 3. 从设计器确认真实字段
- 4. 写入方式：只通过 WebAPI Save
- 5. 推荐顺序：先试写一条，再批量
- 6. 批量更新的安全实现
- 7. 最终全量回查
- 8. 本次实测结果
- 9. 给其它 Agent 的执行要求

> 适用于金蝶云星空中通过 BOS 设计器创建的“预置基础资料1”。
> 本文记录的是已在本账套账套实测成功的方法，示例场景为：将文件编号 `TK-IDM-0332` 开头的记录的“芯片型号”修改为 `AFZ032AxxVU`。

原记录未注明执行日期；36 条、前缀和目标型号均是历史案例，不是通用默认值。下方代码只示意保存模型，不是可直接执行的批处理工具；复用时必须参数化本次范围、旧值与目标值，默认 dry-run，并由显式 `--apply` 进入用户已授权的写入分支。

## 1. 先区分设计器标识和 API FormId

BOS 设计器属性面板中可能看到：

- 名称：预置基础资料1
- 元素类型：基础资料
- 主键字段：`FID`
- 唯一识别字段：`FMasterId`
- 单据状态字段：`FDocumentStatus`
- 代码字段：文件编码
- 名称字段：名称
- 唯一标识：例如 `472700c8-bc17-41fb-a38c-0dc361460455`

设计器的 GUID 是元数据唯一标识，**不能直接当作 WebAPI 的 FormId**。

当前账套实测可用的业务对象是：

```text
BAS_PreBaseDataOne
```

搜索菜单中显示的 `YZJCZL1` 是菜单/功能侧标识，不是本次 WebAPI 查询使用的 FormId。

## 2. 读取当前数据，先确认范围

必须先重新登录并查询当前数据，不使用旧的 JSON、旧的单据列表或历史结果作为写入依据。

优先从项目统一入口导入：

```js
import { K3CloudWebAPI, escapeK3 } from "../../lib/k3/index.js";
```

查询核心字段：

```js
const fields = [
  "FID",
  "FNumber",
  "FName",
  "F_XPXH",
  "FDocumentStatus",
  "FForbidStatus",
];

const prefix = "TK-IDM-0332";
const rows = await api.executeBillQuery(
  "BAS_PreBaseDataOne",
  fields.join(","),
  `FNumber like '${escapeK3(prefix)}%'`,
  10000,
);
```

返回二维数组时，列位置对应：

| 下标 | 字段 | 含义 |
|---:|---|---|
| 0 | `FID` | 记录内码 |
| 1 | `FNumber` | 文件编号 |
| 2 | `FName` | 名称 |
| 3 | `F_XPXH` | 芯片型号 |
| 4 | `FDocumentStatus` | 数据状态，`C` 为已审核 |
| 5 | `FForbidStatus` | 禁用状态，`A` 为正常 |

本场景中，必须核对：

1. 匹配数量是否仍为预期的 36 条；
2. 编号是否全部以 `TK-IDM-0332` 开头；
3. `FID` 是否唯一；
4. 是否有记录已经是目标值；
5. 是否有记录处于禁用或非预期状态；
6. 当前 `F_XPXH` 值是否与预计的旧值一致。

不要把查询条件写成普通物料 `BD_MATERIAL`。这类记录属于自定义预置基础资料，普通物料查询查不到。

## 3. 从设计器确认真实字段

截图中“芯片型号”字段对应的真实字段键是：

```text
F_XPXH
```

不要根据显示顺序猜字段。应使用 `DynamicFormService.View` 读取一条样本的完整详情，再对照字段名称和页面布局确认。

样本读取：

```js
const detail = await api.viewBill("BAS_PreBaseDataOne", fid);
console.log(detail.F_XPXH);
```

本场景中其它已核实字段包括：

| 页面字段 | API 字段 |
|---|---|
| 框架型号 | `F_UNW_Text_fg2` |
| 树脂型号 | `F_UNW_Text_qtr` |
| 键合型号 | `F_UNW_Text_83g` |
| 供应商芯片规格 | `F_UNW_Text_83g1` |
| 载带 | `F_UNW_Text_apv_tzk` |
| 盖带 | `F_UNW_Text_apv_tzk_ca9` |
| 吸嘴 | `F_ZBMY_XZ` |
| 剪刀 | `F_ZBMY_PD` |
| 芯片型号 | `F_XPXH` |

本次只修改 `F_XPXH`，不能把相邻的供应商芯片名称、供应商芯片规格等字段一起覆盖。

## 4. 写入方式：只通过 WebAPI Save

不要用 SQL `UPDATE` 修改正式业务数据。

使用 `DynamicFormService.Save`，并明确指定：

- `FID`：当前记录的真实内码；
- `F_XPXH`：目标值；
- `NeedUpDateFields`：只列 `F_XPXH`；
- 不提交、不审核、不执行其它业务操作。

项目封装调用：

```js
const target = "AFZ032AxxVU";

const saved = await api.saveBill(
  "BAS_PreBaseDataOne",
  {
    FID: fid,
    F_XPXH: target,
  },
  ["F_XPXH"],
  ["FID", "F_XPXH"],
  false,
);

if (saved?.Result?.ResponseStatus?.IsSuccess !== true) {
  throw new Error(`保存失败：${number}`);
}
```

模型只带 `FID` 和目标字段，更新字段列表也只带 `F_XPXH`，避免误改其它数据。

## 5. 推荐顺序：先试写一条，再批量

即使用户已经明确授权批量修改，也建议先用第一条记录验证保存模型和权限：

1. 重新查当前 36 条；
2. 选择一条明确的 `FID`；
3. 保存 `F_XPXH=AFZ032AxxVU`；
4. 立即按 `FID` 查询回查；
5. 确认 `F_XPXH` 已变为目标值；
6. 确认 `FDocumentStatus` 和 `FForbidStatus` 没有变化；
7. 成功后重新读取整个前缀范围，再处理其余记录。

样本回查：

```js
const check = await api.executeBillQuery(
  "BAS_PreBaseDataOne",
  "FID,FNumber,F_XPXH,FDocumentStatus,FForbidStatus",
  `FID=${fid}`,
  1,
);

const after = check[0];
if (
  !after ||
  after[2] !== target ||
  after[3] !== beforeDocumentStatus ||
  after[4] !== beforeForbidStatus
) {
  throw new Error(`样本回查不一致：${number}`);
}
```

## 6. 批量更新的安全实现

批量处理时要重新获取范围，并逐条保存、逐条回查。遇到任何保存失败或回查不一致，立即停止，不要自动重试或扩大范围。

示意代码：

```js
const formId = "BAS_PreBaseDataOne";
const prefix = "TK-IDM-0332";
const target = "AFZ032AxxVU";
const fields = "FID,FNumber,FName,F_XPXH,FDocumentStatus,FForbidStatus";

async function queryScope() {
  const rows = await api.executeBillQuery(
    formId,
    fields,
    `FNumber like '${escapeK3(prefix)}%'`,
    10000,
  );
  rows.sort((a, b) => String(a[1]).localeCompare(String(b[1]), "en", { numeric: true }));
  return rows;
}

const beforeRows = await queryScope();
if (beforeRows.length !== 36) {
  throw new Error(`范围数量不是预期的36条，而是${beforeRows.length}条，停止写入`);
}

const seenFids = new Set();
for (const row of beforeRows) {
  const [fid, number, name, oldValue, documentStatus, forbidStatus] = row;

  if (seenFids.has(fid)) {
    throw new Error(`FID重复：${fid}`);
  }
  seenFids.add(fid);

  if (!String(number).startsWith(prefix)) {
    throw new Error(`范围外记录：${number}`);
  }

  if (String(oldValue ?? "").trim() === target) {
    continue;
  }

  await api.saveBill(
    formId,
    { FID: fid, F_XPXH: target },
    ["F_XPXH"],
    ["FID", "F_XPXH"],
    false,
  );

  const check = await api.executeBillQuery(
    formId,
    "FID,FNumber,F_XPXH,FDocumentStatus,FForbidStatus",
    `FID=${fid}`,
    1,
  );
  const after = check[0];

  if (
    !after ||
    String(after[2] ?? "") !== target ||
    String(after[3] ?? "") !== String(documentStatus ?? "") ||
    String(after[4] ?? "") !== String(forbidStatus ?? "")
  ) {
    throw new Error(`逐条回查不一致，已停止：${number}`);
  }

  console.log(`OK ${number}`);
}
```

注意：如果第一次试写已经把第一条改成目标值，批量循环中应识别为 `already_target` 并跳过，而不是重复保存。

## 7. 最终全量回查

批量保存结束后必须重新查询，不使用循环期间的旧数组作为最终证据。

```js
const finalRows = await api.executeBillQuery(
  formId,
  "FID,FNumber,F_XPXH,FDocumentStatus,FForbidStatus",
  `FNumber like '${escapeK3(prefix)}%'`,
  10000,
);

const finalBad = finalRows.filter((row) =>
  String(row[2] ?? "") !== target ||
  String(row[3] ?? "") !== "C" ||
  String(row[4] ?? "") !== "A"
);

if (
  finalRows.length !== 36 ||
  new Set(finalRows.map((row) => row[0])).size !== 36 ||
  finalBad.length !== 0
) {
  throw new Error(`最终回查失败：匹配=${finalRows.length}，异常=${finalBad.length}`);
}

console.log("最终验证通过：36条芯片型号均为目标值，状态均为已审核且正常");
```

最终查询列的位置是：

```text
FID, FNumber, F_XPXH, FDocumentStatus, FForbidStatus
 0       1        2              3              4
```

校验下标时不要把 `F_XPXH`、`FDocumentStatus`、`FForbidStatus` 错位；最终汇总校验必须用正确的列位置。

## 8. 本次实测结果

本场景执行前：

- 前缀匹配：36 条；
- `F_XPXH` 已是目标值：0 条；
- 待修改：36 条；
- 全部数据状态：`C`；
- 全部禁用状态：`A`。

执行后：

- 最终匹配：36 条；
- `F_XPXH=AFZ032AxxVU`：36 条；
- 异常记录：0 条；
- 全部仍为已审核、正常。

## 9. 给其它 Agent 的执行要求

接手后不要直接照抄历史结果。每次都必须：

1. 读取项目 `AGENTS.md` 和 K3 相关技能；
2. 登录当前账套；
3. 重新查询当前前缀范围；
4. 按 `FID` 去重并核对数量；
5. 先验证字段键和一条样本；
6. 只在明确授权的字段和记录范围内使用 WebAPI Save；
7. 每条保存后立即回查；
8. 最后重新全量查询并报告匹配数、成功数、异常数和状态；
9. 不打印或复制 `k3cloud.js` 中的账号、密码和数据库凭据；
10. 不用 SQL 直接写正式业务数据。
