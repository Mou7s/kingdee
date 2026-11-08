# 金蝶云星空（K/3 Cloud）常用单据字段参考手册

本手册收录了本项目中所有常用金蝶单据（表单）已验证可用的 API 查询字段（`FieldKeys`）。在编写新查询脚本时，可以直接按需选用这些字段。

> **📌 通用规范提醒**：
> * 所有业务字段大都以 `F` 开头（如 `FBillNo`）。
> * 关联基础资料字段以 `Id` 结尾。在 `ExecuteBillQuery` 中可以使用点号进行级联联表查询（如 `FCustId.FNumber` 获取客户编码，`FCustId.FName` 获取客户中文名）。

---

## 目录
1. [基础资料 (Master Data)](#1-基础资料-master-data)
2. [销售管理 (Sales Management)](#2-销售管理-sales-management)
3. [生产与工序管理 (Production & Workshop)](#3-生产与工序管理-production--workshop)
4. [仓储与库存管理 (Inventory & Stock)](#4-仓储与库存管理-inventory--stock)
5. [采购管理 (Purchase Management)](#5-采购管理-purchase-management)
6. [应收应付 (Accounts Receivable/Payable)](#6-应收应付-accounts-receivablepayable)

---

## 1. 基础资料 (Master Data)

### 物料资料 (BD_MATERIAL)
* **FormId**: `BD_MATERIAL`
* **常用查询字段**：

| 字段 Key | 中文名 | 备注 |
| :--- | :--- | :--- |
| `FMATERIALID` | 物料内码 | 主键 ID |
| `FNumber` | 物料编码 | 如 `N103030015` |
| `FName` | 物料名称 | |
| `FSpecification` | 规格型号 | |
| `FDocumentStatus` | 单据状态 | `A` 暂存，`C` 已审核 |
| `FForbidStatus` | 禁用状态 | `A` 正常，`B` 禁用 |

---

## 2. 销售管理 (Sales Management)

### 销售订单 (SAL_SaleOrder)
* **FormId**: `SAL_SaleOrder`
* **常用查询字段（表头）**：

| 字段 Key | 中文名 | 备注 |
| :--- | :--- | :--- |
| `FID` | 单据内码 | 主键 ID |
| `FBillNo` | 销售单号 | 如 `XSDD027131` |
| `FDocumentStatus` | 单据状态 | `A` 暂存，`B` 审核中，`C` 已审核 |
| `FCloseStatus` | 关闭状态 | `A` 未关闭，`B` 已结案 |
| `FCustId.FNumber` | 客户编码 | |
| `FCustId.FName` | 客户名称 | |
| `FDate` | 下单日期 | |
| `FCreatorId.FName` | 创建人 | |
| `FNote` | 备注 | |

* **明细行分录（`SaleOrderEntry`）** (通常在 `viewBill` 详情中获取)：

| 字段 Key | 中文名 | 备注 |
| :--- | :--- | :--- |
| `Seq` | 行号 | 1, 2, 3... |
| `MaterialId.Number` | 物料编码 | |
| `Qty` | 订购数量 | |
| `TaxPrice` | 含税单价 | |
| `DeliveryDate` | 要货/交货日期 | |

---

### 销售出库单 (SAL_OUTSTOCK)
* **FormId**: `SAL_OUTSTOCK`
* **常用查询字段**：

| 字段 Key | 中文名 | 备注 |
| :--- | :--- | :--- |
| `FID` | 单据内码 | |
| `FBillNo` | 出库单号 | |
| `FDate` | 出库日期 | |
| `FDocumentStatus` | 单据状态 | `C` 已审核 |
| `FRealQty` | 实退/实收数量 | |
| `FStockId.FName` | 仓库名称 | 出库仓库 |

---

## 3. 生产与工序管理 (Production & Workshop)

### 生产订单 (PRD_MO)
* **FormId**: `PRD_MO`
* **常用查询字段**：

| 字段 Key | 中文名 | 备注 |
| :--- | :--- | :--- |
| `FID` | 单据内码 | |
| `FBillNo` | 生产订单号 | 如 `MO260328004` |
| `FDocumentStatus` | 单据状态 | |
| `FStatus` | 业务状态 | 计划、下达、开工、完工等 |
| `FQty` | 计划生产数量 | |
| `FMaterialId.FNumber` | 生产产品编码 | |
| `FMaterialId.FName` | 生产产品名称 | |

---

### 生产用料清单 (PRD_PPBOM)
* **FormId**: `PRD_PPBOM`
* **常用查询字段**：

| 字段 Key | 中文名 | 备注 |
| :--- | :--- | :--- |
| `FID` | 单据内码 | |
| `FBillNo` | 用料清单号 | |
| `FMOBillNo` | 关联生产订单号 | |
| `FDocumentStatus` | 单据状态 | |
| `FMaterialId.FNumber` | 损耗/子物料编码 | |
| `FMaterialId.FName` | 损耗/子物料名称 | |
| `FMustQty` | 应发数量 | |
| `FPickedQty` | 实发数量 | |
| `FUnitId.FName` | 单位名称 | |

---

### 生产入库单 (PRD_INSTOCK)
* **FormId**: `PRD_INSTOCK`
* **常用查询字段**：

| 字段 Key | 中文名 | 备注 |
| :--- | :--- | :--- |
| `FID` | 单据内码 | |
| `FBillNo` | 入库单号 | |
| `FDate` | 入库日期 | |
| `FMoBillNo` | 关联生产订单号 | |
| `FDocumentStatus` | 单据状态 | |
| `FMaterialId.FNumber` | 入库物料编码 | |
| `FMaterialId.FName` | 入库物料名称 | |
| `FRealQty` | 实收/入库数量 | |
| `FMustQty` | 应收数量 | |
| `FStockId.FName` | 仓库名称 | |
| `FWorkShopId1.FName` | 生产车间 | ⚠️ 不可写 `FWorkshopId.FName`，否则服务端 SQL 拼接报 `t0.=st012_L.FDEPTID` 语法错误（2026-11-06 验证） |
| `FLot.FNumber` | 批号 | |

---

### 生产退料单 (PRD_ReturnMtrl)
* **FormId**: `PRD_ReturnMtrl`
* **常用查询字段**：

| 字段 Key | 中文名 | 备注 |
| :--- | :--- | :--- |
| `FID` | 单据内码 | |
| `FBillNo` | 退料单号 | |
| `FDate` | 退料日期 | |
| `FMoBillNo` | 关联生产订单号 | |
| `FDocumentStatus` | 单据状态 | |
| `FMaterialId.FNumber` | 退料物料编码 | |
| `FMaterialId.FName` | 退料物料名称 | |
| `FQty` | 实退数量 | |

---

### 工序结算单 (SFC_OPERPROCBALANCE)
* **FormId**: `SFC_OPERPROCBALANCE`
* **常用查询字段**：

| 字段 Key | 中文名 | 备注 |
| :--- | :--- | :--- |
| `FID` | 单据内码 | |
| `FBillNo` | 结算单号 | |
| `FOPNo` | 业务单号 / 条码号 | 常用匹配标识（如 `TX031488`） |
| `FSourceBillNo` | 关联源单号 | 往往关联工序转移单 |
| `FBalDate` | 结算日期 | |
| `FSUPPLIERID.FName` | 加工商/供应商 | 外协厂名称 |
| `FDocumentStatus` | 单据状态 | |
| `FMaterialId.FName` | 加工物料名称 | |
| `FMaterialId.FSpecification` | 规格型号 | |
| `FBalanceQty` | 结算数量 | |
| `FBalanceTaxPrice` | 结算含税单价 | |
| `FTaxAllAmount` | 价税合计 | 结算总金额 |

---

### 工序转移单 (SFC_OPERATIONTRANSFER)
* **FormId**: `SFC_OPERATIONTRANSFER`
* **常用查询字段**：

| 字段 Key | 中文名 | 备注 |
| :--- | :--- | :--- |
| `FBillNo` | 转移单号 | |
| `FDocumentStatus` | 单据状态 | |
| `FMOBillNo` | 生产订单号 | 关联 PRD_MO 的 FBillNo |
| `FSourceBillNo` | 源单编号 | |
| `FBILLDATE` | 单据日期 | |
| `FBillTypeID` | 单据类型 ID | |
| `FCreatorId` | 创建人 ID | |
| `FDescription` | 备注 | |

---

## 4. 仓储与库存管理 (Inventory & Stock)

### 即时库存 (STK_Inventory)
* **FormId**: `STK_Inventory`
* **常用查询字段**：

| 字段 Key | 中文名 | 备注 |
| :--- | :--- | :--- |
| `FID` | 内码 | |
| `FMaterialId` | 物料内码 ID | |
| `FMaterialId.FNumber` | 物料编码 | |
| `FMaterialId.FName` | 物料名称 | |
| `FStockId` | 仓库内码 ID | |
| `FStockId.FName` | 仓库名称 | |
| `FBaseUnitId` | 基本单位 ID | |
| `FBaseUnitId.FName` | 单位名称 | |
| `FBaseQty` | 库存数量 | 实物即时库存量 |

---

### 直接调拨单 (STK_TRANSFERDIRECT)
* **FormId**: `STK_TRANSFERDIRECT`
* **常用查询字段**：

| 字段 Key | 中文名 | 备注 |
| :--- | :--- | :--- |
| `FID` | 单据内码 | |
| `FBillNo` | 调拨单号 | |
| `FDate` | 调拨日期 | |
| `FDocumentStatus` | 单据状态 | |
| `FQty` | 调拨数量 | |
| `FSrcStockId.FName` | 调出仓库 | |
| `FDestStockId.FName` | 调入仓库 | |
| `FMaterialId.FNumber` | 调拨选用的物料 | |

---

### 组装拆卸单 (STK_AssembledApp)
* **FormId**: `STK_AssembledApp`
* **常用查询字段（父项）**：

| 字段 Key | 中文名 | 备注 |
| :--- | :--- | :--- |
| `FBillNo` | 单据编号 | |
| `FDate` | 业务日期 | |
| `FAffairType` | 事务类型 | `Assembly` 组装，`Disassembly` 拆卸 |
| `FQty` | 组装/拆卸套数 | |
| `FStockId.FName` | 父项仓库 | |
| `FDocumentStatus` | 单据状态 | |
| `FMaterialId.FNumber` | 父项物料编码 | 组装出的成品或拆卸的原件 |

* **常用查询字段（子项/明细分录）**：

| 字段 Key | 中文名 | 备注 |
| :--- | :--- | :--- |
| `FMaterialIDSETY.FNumber` | 子项物料编码 | 拆卸出的物料或组装的配件 |
| `FQtySETY` | 子项消耗数量 | |
| `FStockIDSETY.FName` | 子项仓库 | |

---

### 其他出库单 (STK_MisDelivery) 与 其他入库单 (STK_MISCELLANEOUS)
* **FormId**: `STK_MisDelivery` (出库) / `STK_MISCELLANEOUS` (入库)
* **常用查询字段**：

| 字段 Key | 中文名 | 备注 |
| :--- | :--- | :--- |
| `FBillNo` | 单据编号 | |
| `FDate` | 业务日期 | |
| `FDocumentStatus` | 单据状态 | |
| `FQty` | 数量 | |
| `FStockId.FName` | 仓库名称 | |
| `FMaterialId.FNumber` | 物料编码 | |

---

## 5. 采购管理 (Purchase Management)

### 采购收料单 (PUR_ReceiveBill)
* **FormId**: `PUR_ReceiveBill`
* **常用查询字段**：

| 字段 Key | 中文名 | 备注 |
| :--- | :--- | :--- |
| `FID` | 单据内码 | |
| `FBillNo` | 收料单号 | |
| `FDate` | 收料日期 | |
| `FSupplierId.FNumber` | 供应商编码 | |
| `FSupplierId.FName` | 供应商名称 | |
| `FDocumentStatus` | 单据状态 | |
| `FMaterialId.FNumber` | 物料编码 | |
| `FMaterialId.FName` | 物料名称 | |
| `FMaterialId.FSpecification` | 规格型号 | |
| `FQty` | 实收数量 | |
| `FTaxPrice` | 含税单价 | |
| `FAllAmount` | 价税合计 | 行总额 |

---

## 6. 应收应付 (Accounts Receivable/Payable)

### 应付单 (AP_Payable)
* **FormId**: `AP_Payable`
* **常用查询字段（表头）**：

| 字段 Key | 中文名 | 备注 |
| :--- | :--- | :--- |
| `FID` | 单据内码 | |
| `FBillNo` | 应付单号 | |
| `FDocumentStatus` | 单据状态 | ⚠️ 应付单只能为 `Save` 草稿状态 |
| `FDATE` | 业务日期 | |
| `FSUPPLIERID.FNumber` | 供应商编码 | |
| `FSUPPLIERID.FName` | 供应商名称 | |
| `FCreatorId.FName` | 创建人 | |
| `FCreateDate` | 创建时间 | |
| `FModifierId.FName` | 修改人 | |
| `FModifyDate` | 修改时间 | |

* **常用查询字段（分录明细行 `AP_PAYABLEENTRY`）**：

| 字段 Key | 中文名 | 备注 |
| :--- | :--- | :--- |
| `FORDERNUMBER` | 采购订单号 | |
| `FSourceBillNo` | 关联源单号 | 往往关联工序结算单 `TX...` 号 |
| `FMATERIALID.FNumber` | 物料编码 | |
| `FMATERIALID.FName` | 物料名称 | |
| `FPRICEQTY` | 计价数量 | |
| `FPRICE` | 不含税单价 | |
| `FTAXPRICE` | 含税单价 | |
| `FTAXRATE` | 税率 (%) | |
| `FNOTAXAMOUNTFOR` | 不含税金额 | |
| `FTAXAMOUNTFOR` | 税额 | |
| `FALLAMOUNTFOR` | 价税合计 | 实付总额 |
# 发货通知单包装类型（2026-10-12 实时验证补录）

销售出库单 `SAL_OUTSTOCK` 同日新增同名字段：字段键及 View 属性 `F_ADKB_Combo_PackType`，实体 `FEntity`，物理列 `T_SAL_OUTSTOCKENTRY.F_ADKB_COMBO_PACKTYPE`（varchar），实时扩展元数据确认与发货通知单同一枚举。出库侧来源 LK 的 `FENTRYID` 为出库分录，`FSBILLID/FSID` 为来源通知单 FID/分录，须限定 `FSTABLENAME='T_SAL_DELIVERYNOTICEENTRY'` 并核对物料和唯一关联。来源：2026-10-12 本账套元数据、列结构与接口查询。

`SAL_DeliveryNotice` 明细实体 `FEntity`：字段键及 View 属性 `F_ADKB_Combo_PackType`，物理列 `T_SAL_DELIVERYNOTICEENTRY.F_ADKB_COMBO_PACKTYPE`（varchar）。销售订单来源列为 `T_SAL_ORDERENTRY.F_ADKB_COMBO_PACKTYPE`。来源必须沿通知单明细 LK 的 `FENTRYID → FSBILLID/FSID` 精确定位订单分录，并验证来源表、物料与关联唯一性。来源：本账套扩展元数据、数据库列结构与 WebAPI 查询交叉验证；详细范围和操作边界见技能 `../kingdee-sales-inventory/references/inventory-sales/delivery-pack-historical-backfill.md`。
# 物料库存属性补充（2026-10-13 实时验证）

`BD_MATERIAL` 库存属性：Save 实体键 `FEntityInvPty`，分录主键 `FEntryID`，影响出库成本 `FIsAffectCost`；View 集合 `MaterialInvPty`，属性编码 `InvPtyId.Number='04'` 为批号。来源：本账套 `T_META_OBJECTTYPE.FKERNELXML` 与 NBM0060031 最小保存、View 回查；按同组模板确认目标值，不作为全部物料默认设置。流程见建料技能 `../kingdee-materials-bom/references/materials/material-create.md` 的“成品库存属性的批号影响出库成本”。

### 应收余额查询补充（2026-10-23 WebAPI实测）

`AR_receivable`：列表 `FRECEIVEAMOUNT,FNORECEIVEAMOUNT` 为分录已/未结算金额；View `AP_PAYABLEENTRY` 内同名字段保留 F 前缀；表头到期日 View 属性为 `FENDDATE_H`。表头 `NOTWRITTENOFFAMOUNTFOR` 不等同分录未结算合计；列表 `FNOTWRITTENOFFAMOUNTFOR` 已验证不存在。见 `../finance/ar-settlement-match-trace.md` 的逾期交叉核对条目。

## 利润与销售成本字段（2026-10-26 WebAPI验证）

- `SAL_OUTSTOCK/SAL_RETURNSTOCK`：`FEntryCostAmount`分录成本、`FCostAmount_LC`本位币成本；`FCostAmount`属于税务子实体的计入成本金额，不能替代销售成本。来源：QueryBusinessInfo、列表及View抽样，证据`output/profit-cost-20261026/`。
- `GL_VOUCHER`：主键`FVOUCHERID`，分录`FEntity_FEntryID`；借贷本位币发生额`FDEBIT/FCREDIT`，科目`FAccountID.FNumber/FName`，状态`FDocumentStatus/FInvalid`，账簿`FAccountBookID.FName`，本位币`FBASECURRENCYID.FNumber`。来源同上。使用边界见`../finance/company-profile-readonly.md`利润与成本章节。
