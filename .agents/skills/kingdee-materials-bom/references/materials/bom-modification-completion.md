# BOM 批量修改的分组覆盖与完成门槛

## 适用范围

适用于 K3 Cloud `ENG_BOM` 的批量用量修改，尤其是 PDFN3/PDFN5 等存在 IDM、OEM 等 BOM 分组的产品族。

## 分组发现

不要只按父项物料名称或规格筛选。先查询 BOM 自身分组：

```js
const rows = await api.executeBillQuery(
  "ENG_BOM",
  "FID,FNumber,FGROUP.FNumber,FGROUP.FName,FDocumentStatus,FMaterialId.FNumber,FMaterialId.FName",
  "FGROUP.FName='IDM-PDFN3X3'",
  100
);
```

- `FGROUP` 是界面左侧的 BOM 分组；
- `FMaterialGroup` 是父项物料分组，两者不可混用；
- 查询含分录字段时，一张 BOM 可能返回多行，统计和写入前必须按真实 `FID` 去重；
- 用户截图出现 IDM/OEM 等分组时，必须对每个相关 `FGROUP.FName` 补做扫描。

## 候选分类

对每个唯一 `FID` 调用 `viewBill("ENG_BOM", fid)`，读取完整 `TreeEntity`，再按以下条件分类：

1. 标准一对一：铝带恰好一条、铜线恰好一条；
2. 纯铜线：铝带为零、铜线至少一条；
3. 其他结构：无铜线、重复分录或分录数量不符合规则。

只有状态 `C`、结构符合、旧用量精确匹配用户确认值的标准一对一 BOM 才可自动批量处理。状态 `D` 单独统计，不可无条件并入。

纯铜线多分录不能因为其中一条等于旧值就自动修改，必须确认具体 `FEntryID`。

## 修改字段边界

用户授权“铝带＋铜线各一根”时，两个分录都属于目标；不能只改铜线。

用户授权“只改铜线”时，只提交铜线的 `FEntryID` 与 `FNUMERATOR`，铝带和所有其他分录保持原值。

写入仍遵循：

```text
实时快照 → 反审核 → DynamicFormService.Save 最小模型
→ 保存后回查 → 提交 → 审核 → 最终回查
```

每张写入前再次检查状态和旧值。任意一张不符、保存回查失败、非目标分录变化、提交或审核失败，都立即停止，不跳过继续；已反审核的单据尝试恢复并记录结果。

## 批次完成门槛

批量写入结束后不能只依据旧候选清单或操作日志宣布完成。必须：

1. 按所有相关 `FGROUP` 重新扫描当前 `ENG_BOM`；
2. 按系列和 BOM 分组核对候选数、成功数和排除数；
3. 对每张成功记录回查状态 `C` 和目标新用量；
4. 列出纯铜线、D 状态和其他结构的排除原因；
5. 从当前 WebAPI 回查结果重建修改记录导出；
6. Excel 使用普通工作表区域和 AutoFilter，避免复杂原生 Table XML；
7. 交付前检查 ZIP、XML、工作表行数、筛选范围，并使用 LibreOffice 或等效引擎实际打开。

## 本次验证过的授权差异

- PDFN3 一对一：铝带 `2.0 → 1.6`，铜线 `2.5 → 2.3`，两个分录都改；
- PDFN5 一对一：只改铜线 `2.8 → 2.769`，铝带不改。
