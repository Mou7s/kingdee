# 组装拆卸单 STK_AssembledApp API 保存写法（2026-09-12 实测）

本账套首次走通的 API 建单结构（4 张成功草稿验证，随后已删除）。只 Save 草稿，不提交不审核。

## 能用的结构

- 顶层：`FEntity: [{FMaterialID:{FNumber}, FQty/FBaseQty, FUnitID/FBaseUnitID:{FNumber:"K"}, FStockID:{FNumber}, FStockLocId, FStockStatusID:{FNumber:"KCZT01_SYS"}, FLot:{FNumber}, FOwnerTypeID/FOwnerID/FKeeperTypeID/FKeeperID, FSubEntity:[...]}]`，`IsEntryBatchFill:true`。
- 子件容器只能用 `FSubEntity`（`STK_ASSEMBLYSUBITEM` 在 Save 会被整体忽略）；子件物料键 `FMaterialIDSETY:{FNumber}`，数量 `FQtySETY/FBaseQtySETY`，其余 `FUnitIDSETY/FBaseUnitIDSETY/FStockIDSETY/FStockStatusIDSETY/FLOTSETY/FOwnerIDSETY/FKeeperIDSETY`。
- 仓位写法分两种，写错报“仓位维度不能为空”：成品行用数字ID `FStockLocId:100048`（= 物料主数据 `StockPlaceId_Id`）；子件行用弹性嵌套 `FStockLocIdSETY:{FSTOCKLOCIDSETY__FF100008:{FNumber:"4"}}`（CTK10/CTK20 系 SOT-23成品仓）。`FStockPlaceID`、`{F100011:...}` 在成品行不认。
## 排错：报错字段≠真正病因时做 2x2 隔离

- K3 校验报错会错位（如成品仓位写错报成“子件物料编码必填”）。一次只换一个变量打矩阵：成品A/成品B × 子件A/子件B，定位到具体行列后再改报文，不要同时换多个字段反复重试。
- Save 失败不落单（返回的 FID 查不到，无需清理）；成功的测试草稿会占单号，测完用 `deleteBill` 按 FID 删并回查为空。

## 结论修正：NBS0060001 成品单最终在前端建成（同日）

- 上述“子件必被清空”仅限 API 路径：补料（含批号规则）后 API 重测依然被拦。
- 用户随后在前端以同样成品/子件/数量建成并审核（42K，CTK11/CTK20，批号1），库存已对上。因此 API 被拦不等于业务做不成：新料做成品、API 反复报子件必填时，先对齐模板（批号规则、超短收率）再转前端建单，不要在 API 上换键耗尽次数。
- `BS0060001` 同样失败但原因是它已禁用（`ForbidStatus=B`），另案。

## 读路径：查单据时间、操作人与明细

要回答「这张单什么时候做的 / 谁做的 / 做了什么」，只读查询即可，不要写任何东西：

- 表头字段（`ExecuteBillQuery`，`FilterString: FBillNo='ZZCX…'`，注意响应是裸数组）：`FID,FBillNo,FDate,FDocumentStatus,FCreateDate,FApproveDate,FCreatorId.FName,FModifierId.FName,FBillTypeID.FName`。**`FCreatedDate` 不存在**，制单时间就是 `FCreateDate`；`FDate` 是业务日期，与创建时间不是一回事，两个都要报。
- `FCreatorId.FName` 常见为集成账号「入库」（接口/系统批建），此时单据是自动生成的，人工只负责审核——答复里把「制单账号」和「审核人」分开写，不要拿审核人当制单人。想说明它是批量作业中的一张，可查当天全量（`FDate>='…' and FDate<'…'` + `OrderString: FCreateDate ASC`）。
- View 结构：顶层 `ProductEntity[]` 为成品行（`MaterialID`、`FQty`、`StockID`、`StockPlaceID`、`Lot`、`StockStatusID`，键名用大写 D）；子件是嵌套的 `ProductEntity[0].STK_ASSEMBLYSUBITEM[]`，键名与 Save 侧一致地加 `SEY/SETY` 后缀：`MaterialIDSETY`、`FQtySETY`、`FStockIDSETY`、`StockPlaceIDSETY`、`FStockStatusIDSETY`、`LotSETY`。**用 Save 键名读子件会得到 `null`，不报错**，所以取值前先打 `Object.keys(row)`。
- 其他易错点：`View` 里的名称是多语言数组，按 `Name.find(x => x.Key === 2052).Value` 取；未配置的仓位会回成 `{Number: undefined}`，打印成 `undefined undefined` 而不是空。
- 只读脚本写在 `scripts/scratch/YYYY-MM/`，用 `../../../k3cloud.js` 引入客户端；查完把重复的探测脚本删掉，只留一个可复跑的。

## 2026-10-29 拆卸草稿及事务枚举纠错

- 实时元数据确认拆卸枚举为 `Dassembly`，不是历史参考中的 `Disassembly`；组装为 `Assembly`。禁止照英文拼写猜枚举。`FCostProportion` 属于子件 FSubEntity，View同名回读。
- 本次 ZZCX014174（FID114396）仅Save草稿A：父NAZ0050092、子NDZ0050010各71.583K，批号1，同CTK10/SOD-523仓位100035；子件仓位Save使用 `{FSTOCKLOCIDSETY__FF100008:{FNumber:"3"}}`，比例100%，费用0。新料默认仓CTK13不代表实物已移仓，此次保留实际仓位。
- 成本结果表T_HS_OUTSTOCKACCTGDATA实时仅到2026-09、旧料无核算行，10月最终成本未确认，故未提交审核、不声称库存已转换。来源采购和生产入库成本不可用含税价拼算代替。证据 output/bzx584b2v4-disassembly-20261029.json 与 output/assembly-metadata-20261029.xml，执行脚本 scripts/scratch/2026-10/bzx584b2v4-disassembly.js 默认dry-run。

2026-10-29后续：用户明确要求直接审核、接受10月成本待核算。按实时单据/库存前值守卫，ZZCX014174已Submit→Audit成功C；WebAPI独立回查旧料非零库存为空，新料NDZ0050010在CTK10/仓位100035/批号1为71.583K，总量不变。此结果证明数量转换完成，不证明10月成本金额核对完成；未启动全账套核算。证据output/bzx584b2v4-disassembly-audit-20261029.json，脚本scripts/scratch/2026-10/audit-bzx584b2v4-disassembly.js。成本未核算并非组装拆卸审核的通用禁止条件，应区分用户授权、库存操作结果和期末金额验证。

## 2026-10-30 客供仓拆卸保存失败（STCLRK001781）

- 用户确认实物蓝膜、授权一次性更正后，默认dry-run预检通过：N102012152/CTK04/芯片仓100015/批号C00SZA.001/客户CTK000009/不参与核算KCZT001，0.5K；目标N102012151无库存，两料C/A。
- 脚本`scripts/scratch/2026-10/n102012152-disassembly.js`拟仅Save草稿：Dassembly、父旧子新各0.5K、双方客户货主CTK000009与CTK04/KCZT001、子件成本比例100%、费用0；子件仓位FF100005/1。首次Save返回FStockID及FStockIDSETY仓库必填，Id和Number均空。不能仅凭本报错认定客供仓不支持拆卸，字段解析/服务清空/仓库过滤尚未定位；不得换货主或状态绕过。
- 失败后独立WebAPI回查备注STCLRK001781的组装拆卸单为空，库存仍旧料0.5K、客户CTK000009、CTK04；无新料库存。没有生成草稿，没有Submit/Audit。证据`output/n102012152-stock/disassembly-draft.json`。已有客户货主Assembly已审实例不等于客供仓Dassembly已验证。

### 同案字段顺序修正成功（2026-10-30）

- 前述仓库必填并非字段名错误或已证明客供仓受限。保持所有业务值不变，将父项FStockID/FStockLocId及子件FStockIDSETY/FStockLocIdSETY移至各自对象末尾（货主、保管者、状态、批号之后），Save明确IsAutoAdjustField=false、IsVerifyBaseDataField=true，保存成功。因同时显式验证参数，结论限于该组合已验证，不声称已隔离具体清空规则。
- 草稿ZZCX014211/FID114435，A/Dassembly；父N102012152、子N102012151各0.5K，两边CTK04/仓位100015/KCZT001/批号C00SZA.001/BD_Customer CTK000009，FCostProportion100、FEE0，View已逐项核对。子件View货主键FOwnerIDSETY、成本比例键FCostProportion（非OwnerIDSETY/CostProportion）。未提交审核。
- Save新增目标料号0数量库存维度行，不是库存数量改变；独立回查非零库存旧料仍0.5K、新料0K。库存守卫应按真实维度比较非零余额，同时记录新增零行，不能把新增零行当审核或库存转换完成。
- 官方说明字段赋值后可能被后续实体服务规则清空，IsAutoAdjustField=false可保留手工顺序：https://vip.kingdee.com/article/731524959477752832 。官方组装拆卸手册确认双方可用客户货主：https://open.kingdee.com/K3Cloud/help/STK_ASSEMBLEDAPP.html 。证据同disassembly-draft.json，本次未验证审核。

- 2026-10-30用户进一步明确“去审核”后，实时草稿及库存守卫通过，ZZCX014211/FID114435已Submit→Audit成功；列表与View均C。非零库存独立回查：N102012152该批由0.5K归零，N102012151在CTK04/仓位100015/批号C00SZA.001/客户CTK000009/KCZT001为0.5K，总量不变。证明此客供仓拆卸路径已完成数量转换，不代表已调仓或MO用料货主已修改。证据`output/n102012152-stock/disassembly-audit.json`；执行脚本`scripts/scratch/2026-10/audit-n102012152-disassembly.js`默认dry-run。8月原单未改。
