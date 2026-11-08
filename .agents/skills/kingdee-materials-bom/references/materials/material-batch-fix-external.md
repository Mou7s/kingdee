# 外购 N 料批号补齐（NDM/NDA/NDS/NDZ/NDE）

问题：`scripts/tools/create_material.js` 仅对 `N101|N102` 或 `--product` 自动 `FIsBatchManage=true`。外购组 `DM013/DM006/DA030/DS070/DS072/DZ053/DE010` 的模板要求 `IsBatchManage=true`（View 实测：`NDM0130013 CTKD30P06 DM013 / NDA0300115 SMDJ22CA DA030 / NDS0700030 MBRF10200CT DS070 / NDZ0530032 2EZ5.1D5 DZ053 / NDE0100007 TESDB03DF DE010` 均为 `CHLB09_SYS/ERP1/K/CTK13/批号是`），但新建外购 N 料会落成 `false`。

复现：2026-08-31 批量 `NDM0130020 CTKAUD50N10V / NDS0700031 MBR2060 / NDM0130021 CTKD100N10 / NDM0130022 CTKD50N10 / NDA0300126 SMCJ18CA` 首次 Save 后 View 均为 `batch=false`；2026-09-04 `NDZ0530044 2EZ15D5 DZ053` 同样复现（Save 后 `batch=false/cat=CHLB09_SYS/erp=1`，按下方路径补为 `true` 回 C）。

修复（已验证）：
```js
const rows = await api.executeBillQuery("BD_MATERIAL","FMATERIALID,FDocumentStatus",`FNumber='${num}'`,1);
const fid = String(rows[0][0]);
if (rows[0][1]==='C') await api.post("DynamicFormService.UnAudit",{formid:"BD_MATERIAL",data:{Ids:fid}});
const d = (await api.post("DynamicFormService.View",{formid:"BD_MATERIAL",data:{Number:num}}))?.Result?.Result;
const stock = d.MaterialStock?.[0];
await api.post("DynamicFormService.Save",{formid:"BD_MATERIAL",data:{Model:{
  FMATERIALID: fid,
  SubHeadEntity1:{ FEntryId: stock.Id, FIsBatchManage:true, FStockId: stock.StockId, FStoreUnitID: stock.StoreUnitID }
}}});
await api.post("DynamicFormService.Submit",{formid:"BD_MATERIAL",data:{Ids:fid}});
await api.post("DynamicFormService.Audit",{formid:"BD_MATERIAL",data:{Ids:fid}});
```
后置检查：独立 View 确认 `MaterialStock[0].IsBatchManage===true` 且 `DocumentStatus=C`。后续应升级 `create_material.js` 对 `^N(DM|DA|DS|DZ|DE)` 前缀也自动启用，或在新建外购 N 料后强制此补齐。

## `--product` 建料漏批号规则与超短收率（成品 N 料通病）

- `create_material.js --product` 只开 `FIsBatchManage`，不带批号规则与完工超/短收率。新成品料会落成 `BatchRuleID` 空、超收/短收 `0/0`，而同组样板（如 `BS0060001`）是 `PHBM004` + `500/5`。建完必须按样板 View 核对这两处，不只看批号开关。
- 补齐（已验证，反审核→Save→提交→审核→回查）：`SubHeadEntity1:{FEntryId:stock.Id, FBatchRuleID:{FNumber:"PHBM004"}}` 配 `SubHeadEntity5:{FEntryId:produce.Id, FFinishReceiptOverRate:500, FFinishReceiptShortRate:5}`。注意两处键名坑：`FBatchRuleID` 只认 `{FNumber}` 形态，`{Id:...}` 会被静默忽略；超短收率 Save 键带 `F` 前缀（View 里显示无 `F`）。每次 Save 后都独立 View 核对落值，错键不报错只会静默丢弃，通过后再提交审核。

## DE010 DFN1006-2L 外购模板

- TESD 系 `DFN1006-2L` 按业务属性分两组：`AE010` 与 `DE010` 同封装不同属性；用户明确“外购”时归 `DE010 DFN1006-2L`，不要套用 `AE010`（`NAE010` 系 TESD 同名料存在但属性不同）。`NDE010` 编码段内连续分配，定号前按 `FNumber like 'NDE010%'` 取最大顺延并精确查候选占用。
- 全套模板：`CHLB09_SYS / ERP1 外购 / 单位K / 仓CTK13 / 购是销是存是 / 税SL02_SYS / 批号是`。
- 规格两种写法并存：丝印已知时用全格式 `DFN1006-2L/10K盘/无/丝印`，丝印未知时只写短格式 `DFN1006-2L`（同组 `NDE0100001/0002/0003/0006` 均为短格式）；缺丝印时先问用户按哪种建，不代猜丝印。
- 建料命令必须显式传 `--unit K --category CHLB09_SYS --stock CTK13`；`NDE` 同样落成 `batch=false`，按上方路径补齐后回查。

## DZ053 DO-41 模板（2026-09-04 NDZ0530044 实证）

- `2EZxxD5` 稳压管归 `DZ053 DO-41`（FID 111577），规格只写短格式 `DO-41`（对照 `NDZ0530032 2EZ5.1D5 / NDZ0530016 2EZ24D5`）。
- 全套模板：`CHLB09_SYS 库存商品 / ERP1 外购 / 单位K / 仓CTK13 / 购是销是存是产否 / 税SL02_SYS / 批号是`。
- 建料命令必须显式传 `--unit K --category CHLB09_SYS --stock CTK13`；不能用 `--product`（会把采购置 false、生产置 true，偏离模板）。
- 候选号按 `FNumber like 'NDZ053%'` 取最大顺延（本次最大 `NDZ0530043`→取 `NDZ0530044`，精确查空闲后写入），编码定号后仍需用户确认再 `--apply`。
