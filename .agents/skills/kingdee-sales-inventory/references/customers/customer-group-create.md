# 客户分组新建（WebAPI GroupSave）

> 2026-11-03 实测：`DynamicFormService.GroupSave` 可为客户分组建组并成功落库。以下编号/名称仅为当次记录，复用前必须重新查询占用与现有分组。

## 适用场景

新增销售员或员工需要独立客户分组，命名口径为「工号作分组编码 + 姓名作分组名称」（现行分组如 `TK4307/邱文杰`、`TK4357/杨钊`、`TK3908/肖知心` 均为该口径）。

## 已验证请求

```js
await c.post("DynamicFormService.GroupSave", {
  formid: "BD_Customer",
  data: {
    GroupFieldKey: "FGroup",
    FParentId: 0,        // 现有客户分组均为根级，FPARENTID=0
    FNumber: "TK4305",
    FName: "曹智富",
    FDescription: " ",
  },
});
```

成功响应 `Result.ResponseStatus.IsSuccess=true`，`SuccessEntitys[0]` 返回新 `Id` 与 `Number`。

## 新建步骤

1. `QueryGroupInfo` 取全量分组，确认 `FNUMBER` 未被占用、是否已有同名分组；同时确认父级：本账套客户分组都是根级（`FPARENTID=0`）。
2. 打印完整 payload 做 dry-run，显式 `--apply` 才调用 `GroupSave`。
3. 成功后再次 `QueryGroupInfo` 独立回查：`FID/FNUMBER/FNAME/FPARENTID/FGROUPID` 与分组总数 +1。

## 坑位

- 客户分组没有独立 DynamicForm 表单，`BD_CUSTOMERGROUP` 任何大小写 `ExecuteBillQuery` 都报“业务对象不存在”；查询/回查只走 `post("DynamicFormService.QueryGroupInfo", {data:{FormId:"BD_Customer"}})`。
- 分组字段键是 `FGroup`（底层 `T_BD_CUSTOMER.FPRIMARYGROUP`）；`GroupFieldKey` 传 `FPrimaryGroup` 会报字段不存在。
- 不要因为姓名在新分组的 `BD_Empinfo`/`BD_SALER` 查不到就拒绝建组：`TK4307/TK4357` 等分组存在，但对应工号在 `BD_Empinfo` 未建档，两者不是强绑定。
- 分组编码是主数据编码，写入失败不得用 SQL 直插绕过；先只读排查编号占用/翻译表冲突。

## 证据

- `scripts/scratch/2026-11/create-customer-group-tk4305.js`（默认 dry-run）
- 2026-11-03 建组结果：`TK4305/曹智富`，FID 934788，FPARENTID 0，分组数 29 → 30。
