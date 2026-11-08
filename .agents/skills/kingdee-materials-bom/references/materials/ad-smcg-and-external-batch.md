# AD-车规前缀与 SMCG 分组及外购批号坑（2026-09-01~02 实战）

## 1. AD- 前缀保留
- Fiem 车规 `AD-3.0SMDJ22CA`、`AD-TKMN0100` 用户已明确 **建料 FName 保留 `AD-`**，查重必须含 `AD-`（`*like %AD-3.0SMDJ%*`）。`3.0` 表示 3000W 不可省，`AD-` 表示 AEC-Q101 车规系列。
- 误删示例：`AD-3.0SMDJ22CA` 去前缀建成 `3.0SMDJ22CA` 会与`NDA0300115 SMDJ22CA SMC` 规格 `SMC` 混淆，正确应为 `AD-3.0SMDJ22CA SMCG`（`SMCG 7.10×6.50`，`DA031`）。

## 2. SMCG 独立分组 DA031
- `DA` 父 `TVS管 (FID 111453)` 下已有 `DA030 SMC (FID 111457)`，`SMCG` 全库曾 0 条，`DA030` 不能复用。
- `BD_MATERIALGROUP` 无 WebAPI，需直连 SQL `<K3_MAIN_DB>`：
  ```sql
  -- 取号
  SELECT MAX(FID) FROM T_BD_MATERIALGROUP; -- 892913
  SELECT MAX(FPKID) FROM T_BD_MATERIALGROUP_L; -- 100497
  -- 插入
  INSERT INTO T_BD_MATERIALGROUP (FID,FNUMBER,FGROUPID,FPARENTID,FFULLPARENTID,FLEFT,FRIGHT,FPOINTRATE,FShowPOS,FShowBigScreen,FCREATORID,FCREATEDATE,FMODIFIERID,FMODIFYDATE)
  VALUES (892914,'DA031','d82dac3f-43fa-4fce-9b7f-9e3280abd0d8',111453,'.111452.111453',0,0,0,'1','1',16394,'1900-01-01',16394,GETDATE());
  INSERT INTO T_BD_MATERIALGROUP_L (FPKID,FID,FLOCALEID,FNAME,FDESCRIPTION) VALUES (100498,892914,2052,'SMCG',' ');
  ```
- 建后 `NDA0310001 AD-3.0SMDJ22CA SMCG` 首号验证通过。

## 3. 外购 N 料批号必补
- `create_material.js` 仅对 `N101|N102` 或 `--product` 自动 `IsBatchManage=true`，`NDM/NDA/NDS` 外购非生产料默认 `false`（`NDM0130020/NDS0700031/NDA0300126` 复现）。
- 模板实测 `NDM0130013/NDA0300115` 均为 `true`，新建后必须 `View` 核对，`false` 立即：
  ```js
  await api.post("DynamicFormService.UnAudit",{formid:"BD_MATERIAL",data:{Ids:fid}});
  await api.post("DynamicFormService.Save",{formid:"BD_MATERIAL",data:{Model:{FMATERIALID:fid, SubHeadEntity1:{FEntryId:stock.Id, FIsBatchManage:true, FStockId:stock.StockId, FStoreUnitID:stock.StoreUnitID}}}});
  await api.post("DynamicFormService.Submit",{formid:"BD_MATERIAL",data:{Ids:fid}});
  await api.post("DynamicFormService.Audit",{formid:"BD_MATERIAL",data:{Ids:fid}});
  ```
- 2026-08-31 批量 5 条已按此修复回查 `true`。
- **补 `FIsBatchManage` 时同时核 `FBatchRuleID`（批号规则）**：2026-10-16 复核 `NDA030*` 124 条，123 条为 `PHBM004`，仅 `NDA0300126`（SMCJ18CA，即上文那条）批号规则为空——当年的补号只补了开关、没补规则。新建外购料直接走 `scripts/tools/create_external_material.js`（Save 即带 `FBatchRuleID:{FNumber:"PHBM004"}`），不要用 `create_material.js` 建完再补；`View`/列表回查时开关与规则一起看，`FIsBatchManage=true` 不等于规则已设。
- `material_template_diff.js` 输出 `"known":false` 的字段是**未验证**，不能判为一致（本次样板 `NDA0300126` 的批号规则就是这种情形），须另用列表通道（`ExecuteBillQuery` 取 `FBatchRuleID.FNumber`）单独核对。

## 4. B 大类纠偏
- 误把 `BAT64-04` 放 `BE006 (ESD)`，正解 `BS006 SOT-23 肖特基`（`BS0060001 BAT54 单芯` 同组），`BAS/BAV → BD`，`AP → BM`。截图以 `B(OEM成品)` 层级为准，先定产品类型再定封装。
