# ENG_BOM BOM 分组字段发现

## 适用场景

当用户按金蝶左侧「BOM分组」核对 PDFN3/PDFN5 或其他产品族时，不能只按父项物料规格查询；必须按 BOM 自身分组扫描。

## 正确字段

`ENG_BOM` 的列表查询字段是：

```js
"FGROUP.FNumber,FGROUP.FName"
```

分组过滤示例：

```js
"FGROUP.FName='IDM-PDFN5X6'"
"FGROUP.FName='IDM-PDFN3X3'"
```

- `FGROUP` 是 BOM 分组，对应界面左侧「BOM分组」；
- `FMaterialGroup` 是父项物料分组，两者不能混用；
- `GROUP.Number` 不是 `ExecuteBillQuery` 的有效字段标识；
- `viewBill("ENG_BOM", fid)` 的详情会返回 `GROUP`，可用于最终回查分组。

## 推荐步骤

1. 用 `FGROUP` 查询目标分组，按真实 `FID` 去重。
2. 对每个 FID 调用 `viewBill`，读取状态、父项、`GROUP` 和完整 `TreeEntity`。
3. 再按铝带/铜线分录数量、旧用量和状态筛选；纯铜线多分录不能套用“各一根”的规则。
4. 写入后回查 `GROUP`、状态、目标分录和非目标分录。

## 重要教训

仅使用 `FMaterialId.FSpecification like '%PDFN5%'` 或 `%PDFN3%` 可能遗漏界面 BOM 分组下的同规格 BOM。发现用户截图中有 IDM/OEM 等分组时，必须补做 `FGROUP.FName` 分组查询，并将分组加入导出修改记录。

## 查询完整分组树与新建 BOM 分组（2026-11-10 实测）

1. **查询完整 BOM 分组树**：
   调用 `DynamicFormService.QueryGroupInfo`，传入 `{ data: { FormId: "ENG_BOM", GroupFieldKey: "FGROUP" } }`，返回数组位于 `Result.NeedReturnData`（含 `FID`、`FNUMBER`、`FNAME`、`FPARENTID`、`FFULLPARENTID`）。例如塑封组 `0-SF`（`FID=274204`）下有 `OEM`（`FID=117750`）与 `IDM`（`FID=240728`），`IDM` 下各封装子组命名规则为 `FNUMBER: a-<封装小写>`、`FNAME: IDM-<封装大写>`（如 `a-toll` / `IDM-TOLL`，`FID=947497`），`OEM` 下为 `b-<封装小写>` / `OEM-<封装大写>`。
2. **新建与删除 BOM 分组**：
   先通过 `QueryGroupInfo` 校验父分组 `FID` 及目标编码/名称未占用，默认 dry-run，获批后调用 `DynamicFormService.GroupSave`：
   ```js
   await api.post("DynamicFormService.GroupSave", {
     formid: "ENG_BOM",
     data: {
       GroupFieldKey: "FGROUP",
       FParentId: 240728, // IDM (OEM 为 117750)
       FNumber: "a-toll",
       FName: "IDM-TOLL",
       FDescription: " ",
     },
   });
   ```
   若需删除无下游引用的空分组，可调用 `DynamicFormService.GroupDelete`（传入 `{ formid: "ENG_BOM", data: { FormId: "ENG_BOM", GroupFieldKey: "FGROUP", GroupPkIds: "<FID>", Ids: "<FID>" } }`）。操作后再次调用 `QueryGroupInfo` 独立回查。
