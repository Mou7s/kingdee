# K3 单据批量导出 Excel（WebAPI → xlsx）

适用于「导出某期间全部 XX 单」类请求（销售出库、采购、生产等大表单）。只读查询，无写操作。

## 流程

1. `cd <REPO_ROOT> && bun run login` 确认连接。
2. **先用 `Limit=1` 探测全部 FieldKeys**：字段是否可查按表单逐个验证，猜错只会在查询时报错（报错会点名字段），带错跑全量浪费一整轮。已知不可查：`BD_MATERIAL` 无 `FID`（改 `FMasterId`）；`SAL_OUTSTOCK` 表头无 `FCurrencyID`、分录无 `FEntryID`（分录内码改用 `FID` 单据内码）。
3. **翻页拉全量，不要先数总数**：服务端单次最多静默返回 1 万行——即使传 `TopRowCount=500000` 的计数查询也只回 10000，把它当总数会整段漏数据。直接 `StartRow/Limit` 翻页到短页，行数以实拉为准：

```js
async function queryPage(api, formId, fieldKeys, filter, startRow, limit) {
  const data = await api.post("DynamicFormService.ExecuteBillQuery", {
    data: {
      FormId: formId, FieldKeys: fieldKeys, FilterString: filter,
      OrderString: "FDate ASC,FBillNo ASC",  // 翻页必须有稳定排序，否则分页结果未定义
      StartRow: startRow, Limit: limit, TopRowCount: 0,
    },
  });
  api.raiseIfError(data);
  return Array.isArray(data) ? data : data?.Result?.Rows ?? [];
}
const all = [];
const PAGE = 3000; // 实测稳定
for (let start = 0; ; start += PAGE) {
  const rows = await queryPage(api, formId, fieldKeys, filter, start, PAGE);
  all.push(...rows);
  if (rows.length < PAGE) break;
}
```

- 日期过滤写 `FDate>='2026-01-01' and FDate<'2027-01-01'`。
- 表头+分录字段一次查询：FieldKeys 先表头后分录，返回一行一分录，按 FieldKeys 顺序下标取值（返回是数组不是对象）。
- 一次性脚本放 `scripts/scratch/YYYY-MM/`；Windows 路径写 `C:/Users/...`（MSYS `/c/...` 可能 Module not found）。
- 大导出先落 JSON 中间文件，再单独一个脚本组装 xlsx——两段拆开便于失败重跑不重拉数据。

## 组装 Excel（exceljs，kingdee 仓库 node_modules 已有）

- AOA 一次 `ws.addRows(aoa)`；冻结首行 + 表头加粗底色；末行 `SUM` 公式合计（列号 = 表头列数 + 分录列下标，写前逐列数清，公式列错位最常见）。
- **兼容格式**：普通工作表；不加原生 Excel Table、不加工作表筛选（AutoFilter）——用户要求避免 Excel 打开修复提示。冻结窗格和表头样式可以加。
- 交付到 `output/<名称>.xlsx` 扁平路径，不建子文件夹；回复里直接给 `C:\` 路径，不重复发 MEDIA 卡片。
- **回读验证**：写完 `wb.xlsx.readFile` 回读行数/列数/表头/合计公式；并从源 JSON 独立重算一遍数量/金额合计，核对公式列号与数值一致。

## 会话内交付

数据/文件交付时在会话里直接展示关键内容，不只给文件路径：分录行数、单据数（`FBillNo` 去重）、数量/金额合计、状态分布、TOP 客户/物料、首行样例。

## 后续汇总与图表（导出后的常见追问）

用户拿到全量导出后常追加「按规格/业务员/客户汇总出库数量」「样式优化一下 做个图」。不要重新查金蝶——直接从导出落下的 JSON 中间文件汇总。

1. **先看字段实际取值再定匹配规则**：规格是自由文本（`SOD-523/3K盘/无/C` 与 `SOD-523/8K盘/…` 并存）。「含 3K盘」用 `/3K盘/i` 包含匹配；「SOD-523 3K盘」这类指定型号要按 `^SOD[-_. ]?523\/3K盘/i` 前缀匹配，避免把 8K 盘或其它封装混入。写规则前先列出命中规格样本核对。
2. **口径在回复里写明**：出库数量用 `FRealQty`（实发）并检查负数行（退货红字混入会污染合计）；状态分布（已审核/审核中/重新审核）一并列出——日期过滤默认不排除草稿/反审核单。
3. **汇总输出两层级**：按业务员小计 + 业务员×客户明细（用户问「每个业务员的出库数量」时通常下一步就要客户拆分），按数量降序，附含税金额与单据数（`FBillNo` 去重）。
4. **美化版 Excel（「样式优化」的定版样式）**：每 Sheet 深蓝大标题 + 灰色斜体数据来源副标题（口径、单据数、导出时间）；蓝底白字表头；斑马纹隔行；前三名浅琥珀高亮加粗；数量列加原生数据条——exceljs 用 `ws.addConditionalFormatting({ref, rules:[{type:"dataBar", priority:1, cfvo:[{type:"min"},{type:"max"}], color:{argb}}]})`（已验证可用；exceljs 无 addChart，数据条是唯一的图形化手段）；合计行双线上边框深蓝加粗；Sheet 标签着色 `properties.tabColor`；冻结到表头行。仍不加 Table/AutoFilter（兼容格式红线不因美化放松）。
5. **聊天内图表交付**：ECharts 单文件内联 HTML（从 `registry.npmmirror.com/echarts/<版本>/files/dist/echarts.min.js` 下载后整文件内嵌进 `<script>`），写入 `output/*.html`，回复用单独一行 `::preview{file="路径"}` 内嵌展示。配色/字体读框架 CSS 变量（`var(--foreground)`、`var(--muted-foreground)`、`var(--border)`、`var(--card)`），背景透明不定色。常用两张图：按业务员横向柱状（数量柱+金额折线双轴）、客户 TOP-N 条形（按业务员着色+图例）；长尾合并为「其余N家/人」一项，悬停 tooltip 带金额与单据数。
6. **生成后先校验再交付**：xlsx 回读行数/表头/合计公式；HTML 用 bun 提取 `<script>` 里的数据字面量（`const DATA1 =` 起到 DOM 调用前）eval 校验条目数与合计等于源 JSON，再发 preview。生成 HTML 的脚本不要写一行式 `bun -e`——模板字符串+转义极易错，用独立 .mjs 文件。
7. **原生数据透视表（「在原基础上做透视表」= 加进原交付工作簿，不是另存新文件）**：openpyxl/exceljs 都建不了原生透视表，本机走 PowerShell + Excel COM（已验 Excel 16.0）。两步走：
   - **先用 exceljs 在明细表末尾追加辅助列**：规格是自由文本（`SOD-523/3K盘/无/C`），透视字段无法直接筛「3K盘」——加「封装」（规格首段）与「盘型」（正则 `(\d+(\.\d+)?)\s*K\s*盘`，无则空）两列，透视时才能独立筛选/拖拽。
   - **PowerShell COM 建透视**。`.ps1` 必须存成 UTF-8 带 BOM：无 BOM 时 Windows PowerShell 按 GBK 解析，中文 sheet 名/字段名全坏，报语法错或「值不在预期的范围内」。

```powershell
$src = "销售出库2026!R1C1:R" + $lastRow + "C" + $lastCol
$pc  = $wb.PivotCaches().Create(1, $src)                       # 1 = xlDatabase
$pvt = $pc.CreatePivotTable($newSheet.Range("A3"), "PvtName") # 目标用 Range 对象；"Sheet!R3C1" 字符串会报「值不在预期的范围内」
$pvt.PivotFields("盘型").Orientation = 3                       # 页字段
$pvt.PivotFields("盘型").CurrentPage = "3K盘"                  # 只能设该字段真实存在的值；把 B 字段的值设给 A 字段报 0x800A03EC
$pvt.PivotFields("业务员").Orientation = 1                     # 行字段
$pvt.PivotFields("封装").Orientation = 2                       # 列字段
$df = $pvt.AddDataField($pvt.PivotFields("实发数量"), "出库数量", -4157)  # -4157 = xlSum
$df.NumberFormat = "#,##0"
```

   - **数据源必须排除明细表末尾的合计行**：末行 A 列 `Text` 为「合计」时把源范围收到前一行——合计行维度列为空且含全量 SUM，混进缓存后用户把页筛选切「(全部)」时总计翻倍。
   - **双口径验证后交付**：页字段 `CurrentPage` 分别设为目标值与「(全部)」，读 `$pvt.TableRange2` 右下角总计，应等于从源数据独立重算的筛选合计与明细全量合计；验证完恢复默认筛选再 `$wb.Save()`，最后 exceljs 回读 Sheet 名/页筛选行/列头确认文件完整。重跑脚本先删旧「透视*」Sheet。

## SAL_OUTSTOCK 已验证字段表

表头：`FBillNo,FDate,FDocumentStatus,FCustomerID.FNumber,FCustomerID.FName,FSaleDeptID.FName,FSalesManID.FName,FAllAmount,FNote`
分录：`FMaterialID.FNumber,FMaterialID.FName,FMaterialID.FSpecification,FRealQty,FMustQty,FPrice,FAmount,FTaxPrice,FAllAmount,FStockID.FName,FLot,FStockLocId,FID`

- `FCurrencyID.FName` 报「字段不存在」，不要带；币别需求先 `viewBill` 单张确认实际字段。
- 数量看 `FRealQty/FMustQty`；金额分未税（`FPrice/FAmount`）与含税（`FTaxPrice/FAllAmount`）两组口径，交付时标明用了哪组。
- 其他表单导出时先按第 2 步探测，不要直接套这张表。

## BD_CUSTOMER 已验证字段表

`FCUSTID,FNumber,FName,FShortName,FDocumentStatus,FForbidStatus,FCreateOrgId.FNumber,FUseOrgId.FNumber`

- 简称 `FShortName` 直接在表头可查，底层是 `T_BD_CUSTOMER_L.FSHORTNAME`（多语言表，`FLOCALEID=2052`）；全称与简称是两个独立字段，不要互猜。
- 稳定导出工具：`scripts/tools/export_customers.js`（只读，扁平单 Sheet，输出 `output/customer_list_YYYYMMDD.xlsx`）。