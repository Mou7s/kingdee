# 金蝶 K3Cloud 常用表单ID参考

## 目录

- 基础资料
- 生产管理
- 工序管理
- 采购管理
- 销售管理
- 库存管理
- 应收应付
- 委外管理
- 系统

> 从代码库提取，遇到新表单时持续补充。

## 基础资料

| 表单ID | 说明 | 备注 |
|--------|------|------|
| `BD_MATERIAL` | 物料 | |
| `BD_CUSTOMER` | 客户 | |
| `BD_STOCK` | 仓库 | |
| `BD_Empinfo` | 员工 | 2026-09 WebAPI 实测；主表 `T_HR_EMPINFO`，部门经 `FStaffId`→`T_BD_STAFF.FDEPTID` |
| `BD_MATERIALSAFESTOCK` | 物料安全库存 | |
| `BD_STOCKMAXMIN` | 仓库最大最小库存 | |
| `BD_STOCKMAXMINSTOCK` | 仓库最大最小库存明细 | |

## 生产管理

| 表单ID | 说明 | 备注 |
|--------|------|------|
| `PRD_MO` | 生产订单 | |
| `PRD_MOChange` | 生产订单变更单 | 2026-08 数据库/API 实测 |
| `PRD_PPBOM` | 生产用料清单 | 不是工序计划！ |
| `PRD_INSTOCK` | 生产入库单 | |
| `PRD_PickMtrl` | 生产领料单 | |
| `PRD_RetStock` | 生产退料单 | 2026-08 数据库/API 实测 |

## 工序管理

| 表单ID | 说明 | 备注 |
|--------|------|------|
| `SFC_OperationPlanning` | 工序计划 | |
| `SFC_OperationReport` | 工序汇报 | |
| `SFC_OPERPROCBALANCE` | 工序结算单 | |
| `SFC_OPERATIONTRANSFER` | 工序转移单 | |
| `SFC_OperOutGroupReceive` | 工序委外集中接收 | 2026-08 实测可用 |
| `SFC_OperOutGroupSend` | 工序委外集中发出 | 2026-08 数据库/API 实测 |
| `SFC_OperationRejects` | 工序异常/不良单 | 2026-08 数据库/API 实测 |
| `SFC_OperPlanning` | 工序计划(别名) | |
| `SFC_OperReport` | 工序汇报(别名) | |
| `SFC_OpPlan` | 工序计划(别名) | |
| `SFC_OpRpt` | 工序汇报(别名) | |
| `SFC_OpTransfer` | 工序转移(别名) | |
| `SFC_WWDD` | 委外订单 | |

## 采购管理

| 表单ID | 说明 | 备注 |
|--------|------|------|
| `PUR_Requisition` | 采购申请单 | 2026-11 数据库/API 实测，前缀 CGSQ |
| `PUR_ReceiveBill` | 采购收料单 | |
| `PUR_PurchaseOrder` | 采购订单 | 2026-08 数据库/API 实测 |
| `PUR_InStock` | 采购入库单 | |
| `PUR_MRB` | 采购退料单 | |
| `PUR_SubContract` | 委外订单 | |
| `PUR_SubContractOrder` | 委外订单 | |
| `PUR_SubReqOrder` | 委外申请单 | |
| `PUR_Instock` | 采购入库单 | |

## 销售管理

| 表单ID | 说明 | 备注 |
|--------|------|------|
| `SAL_OutStock` | 销售出库单 | |
| `SAL_SaleOrder` | 销售订单 | 2026-08 数据库/API 实测 |
| `SAL_DeliveryNotice` | 发货通知单 | |
| `SAL_ReturnStock` | 销售退货单 | |

## 库存管理

| 表单ID | 说明 | 备注 |
|--------|------|------|
| `STK_InStock` | 入库单 | |
| `STK_Miscellaneous` | 其他入库单 | |
| `STK_TransferDirect` | 直接调拨单 | |
| `STK_AssemblyAppEntry` | 组装申请分录 | |
| `STK_SafeStock` | 安全库存 | |

## 应收应付

| 表单ID | 说明 | 备注 |
|--------|------|------|
| `AP_Payable` | 应付单 | ⚠️ 只能Save，不能Submit |
| `AP_Match` | 应付核销单 | 2026-08 数据库/API 实测 |
| `AR_Match` | 应收核销单 | 2026-08 数据库/API 实测 |
| `AP_PayApply` | 付款申请单 | |
| `AP_PayBill` | 付款单 | |
| `AR_Receivable` | 应收单 | |

## 委外管理

| 表单ID | 说明 | 备注 |
|--------|------|------|
| `SUB_REQ` | 委外申请单 | |
| `SUB_PPBOM` | 委外用料清单 | |
| `SUB_ReqChange` | 委外申请变更单 | 2026-08 数据库/API 实测 |
| `SUB_SUBREQORDER` | 委外订单 | 2026-08 数据库/API 实测 |
| `SUB_Delivery` | 委外发货 | |
| `SUB_InStock` | 委外入库 | |
| `SUB_ReceiveBill` | 委外收料单 | |
| `SUB_WWDD` | 委外订单 | |
| `SUB_SUBREQORDER` | 委外订单 | 当前账套可用 |

## 系统

| 表单ID | 说明 | 备注 |
|--------|------|------|
| `BOS_OperateLog` | 操作日志 | |
| `BOS_PermissionItem` | 权限项 | |
| `SEC_FuncPermissionInfo` | 功能权限信息 | 2026-10-15实时元数据与Save/View/数据库验证：角色、对象、FEntityPermission；模型类型100/400/500已成功补权，900/800/220不在当前对象字段可选范围，不能据此宣称全部类型可保存 |
| `SEC_KDRoles` | 角色 | 2026-10-15元数据、Save/View与SQL回查：主键FRoleID，FEntityUser/FEntityID维护用户关联；只移除单人分配可保留其他用户原分录主键保存，不删除角色定义 |
| `ENG_BOM` | BOM | |
| `ENG_Substitution` | 替代料 | |
| `BAS_WARNSOLUTION` | 预警方案/监控方案 | 2026-10 实测：主表 `T_BAS_WARNSOLUTION`，操作启用 `Enable`、停用 `Disable`，受控字段 `FRun`（1=运行，0=停用） |


### 2026-10-30 生产下游查证补充

- `PRD_PickMtrlApp`：生产领料申请单。实时T_META_OBJECTTYPE_L名称与WebAPI ExecuteBillQuery(FMOBillNo)成功验证；本案MO261024014无记录。
- `PRD_FeedMtrl`：生产补料单。同上元数据与WebAPI查询验证，本案无记录。
- `PRD_ReturnMtrl`：生产退料单。同上验证；与PRD_RetStock生产退库单区分，不可用后者替代生产退料排查。来源：`output/mo261024014-cleanup/discovery-forms.json`、`remaining-downstream.json`。

- `CB_ExpenseCollection`：费用归集单；2026-10-31经WebAPI BillQuery/View验证。主键FID、编号FBillNo、期间FYear/FPeriod，View分录ExpenseCollEntry；归集存在不证明产品分配已完成，见cost-accounting-period-probe.md第10节。

### 2026-11-02 流程配置只读发现

- `BOS_ObjectType`：业务对象目录，字段 FID/FName；由权限元数据关联发现并实测查询。
- `wf_Template`：流程配置中心，主键 FTmpID；`WF_Template_Simple` 为简单流程配置，共用配置记录。
- `WF_ProcDefBill`：流程设计中心，主键 FProcDefId；FObjectTypeId 为入口单据。上述均由 QueryBusinessInfo 与 ExecuteBillQuery 验证，模板另以 View 复核；状态枚举与证据见 production/production-forms.md 的 MRP 审批配置核查。

### 2026-11-03 成本核算与分配标准补充

- `CB_EQUIVALCOEFFICIENT`：约当系数维护单。主表 `T_CB_EQUIVALCOEFFICIENT`，分录 `T_CB_EQUCOEFCENTRY`（实体名 `FEntity`），子分录 `T_CB_EQUCOEFCDETAIL`（实体名 `SubEntity`）。字段：成本中心 `FCostCenterID`、产品/物料 `FProductId`、综合系数 `FALLCOEFC`（限定 [0, 100] 百分比）。受当前未关账成本期间严格守卫。
- `CB_COSTCENTER`：成本中心。主表 `T_CB_COSTCENTER`，生产成本中心业务类型 `FBUSINESSTYPE=4`。
- `CB_ALLOCSTANDARDSET`：费用分配标准设置。主表 `T_CB_ALLOCSTANDARDSET`，分录 `T_CB_ALLOCSTANDARDSETENTRY`。预置分配标准：`20174`（完工入库数量）、`20172`（约当产量）、`20170`（约当系数）。


### 成本分配设置补充（2026-11-03，只读元数据）

- `CB_COSTALLOCCRITERIA`：费用分配标准；物理表T_CB_COSTALLOCCRITERIA，FSTANDARDID主键、FEXPRESS公式。已核20172公式为20171期末在产品数量×20170约当系数，不能当完工数量×UPH权重。
- `CB_STANDARDSET`：费用分配标准设置；物理表T_CB_ALLOCSTANDARDSET及T_CB_ALLOCSTANDARDSETENTRY，是否统一设置FALLSET、统一标准FALLSETSTANDARDID；明细成本中心FCOSTCENTERID和标准FSTANDARDID。此处ID/表由数据库元数据核实，保存模型需另查WebAPI元数据。
- `CB_ALLOCSTANDARDDATA` / `CB_ALLOCSTANDARDDATARPT`：自定义费用分配标准值维护，`CB_QUOTAFACTOR`：定额因子；名称与标识来自T_META_OBJECTTYPE及_L中文元数据，本次未验证写入模型。
- `CB_EQUIVALCOEFFICIENT`本次WebAPI查询键为FID,FBillNo,FDocumentStatus,FYear,FPeriod；不能用保存模型中的Year/Period直接作为查询字段。来源output/coefficient-review-20261103/。
- `CB_WIPSTANDARDSET` / `CB_WIPSTANDARDSETREPORT`：在产品分配标准设置；物理表 `T_CB_WIPSTANDARDSET`（表头：`FID,FBILLNO,FACCTGSYSTEMID,FACCTGORGID,FACCTPOLICYID,FDOCUMENTSTATUS,FISWW`）、`T_CB_WIPSTANDARDSETENTRY`（分录 `FCPHSEntity`：`FENTRYID,FID,FCOSTCENTERID,FALLOSTD`）、`T_CB_WIPSTANDARDSETDETAIL`（子分录 `FExpenseEntity`：`FDETAILID,FENTRYID,FEXPID,FEXPALLOSTD,FCOSTITEMID`）。WebAPI `View` 须传内码 `Id`（不支持按 `Number` 查）。来源：2026-11-04 `QueryBusinessInfo`、`View(100003)` 及数据库实测，证据 `output/recover-zcpfp0000004-20261104/`。
