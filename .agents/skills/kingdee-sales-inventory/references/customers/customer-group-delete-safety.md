# 空客户分组删除安全核对

空分组（离职销售员名下无客户）删分组节点本身不影响单据，但动手前必须逐项只读核对；缺任一项即停手。

## 分组定位（已验证可用）

- 客户分组没有 DynamicForm 表单：`BD_CUSTOMERGROUP` 任何大小写查 `ExecuteBillQuery` 均报“业务对象不存在”。
- 全量分组走 `post("DynamicFormService.QueryGroupInfo", {data:{FormId:"BD_Customer"}})`，返回 `NeedReturnData[]`：`FID/FNUMBER/FNAME/FGROUPID/FPARENTID/FFULLPARENTID`。
- 分组字段键是 `FGroup`（`QueryBusinessInfo` 元数据：`FieldName=FPRIMARYGROUP`，`LookUpObjectFormId=BOS_FORMGROUP`，`GroupFieldTableName=T_BD_CUSTOMERGROUP`）；传 `FPrimaryGroup` 会报“GroupFieldKey 为 FPrimaryGroup 的字段不存在”。
- 客户归属查 `executeBillQuery("BD_Customer", "FNumber,FName,FGroup.FNumber,...", "FGroup.FNumber='<组号>'")`——注意用 `FGroup` 不是 `FPrimaryGroup`。

## 删除前核对清单（全部只读）

1. 组下客户数 = 0（含所有单据状态，不只看已审核）。
2. 无子分组：`T_BD_CUSTOMERGROUP` 按 `FPARENTID=<FID>` 查 0 行。
3. 跨表同名列逐一排查：`T_BD_SUPPLIER.FPRIMARYGROUP` 与 `T_SEC_USER.FPRIMARYGROUP` 是不同维度的同名列，数字 FID 可能碰撞，必须按 FID 精确查 0 行，不能因“表不同”跳过。
4. 路径缓存：`T_BAS_FULLPATHGROUPINFO` 按 `FID` 查 0 行。
5. 镜像表：`T_BD_CUSTOMERGROUPLEVEL` 为全部分组逐条镜像（含待删 FID），SQL 路径若日后被授权必须同删，否则留孤儿行；WebAPI/前端路径由应用层维护。

## 执行边界

- `DynamicFormService.GroupDelete` 接口存在，但其维度内码参数组合未经验证（缺 `GroupFieldKey` 报“分组字段未指定”，缺维度报“分组内码未指定”）——在拿到可复现的成功报文前，一律走前端“删除分组”，逐个删、删后用 `QueryGroupInfo` 回查确认消失。
- 绝不 SQL 直删分组主数据（AGENTS.md 禁止擅自 SQL 写正式业务数据；分组删除有前端标准入口，不属于“正常流程不可用”的历史脏数据）。
- 只删空分组节点，不碰销售员/员工基础资料——历史单据引用销售员，删了会报错；离职人员做禁用。
