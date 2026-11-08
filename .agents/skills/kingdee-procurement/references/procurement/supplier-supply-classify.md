# 供应商供应类别 FSupplyClassify（BD_SUPPLIER）

2026-09-02 实测 G026 案例沉淀。

## 字段
- 位置：`BD_SUPPLIER.SupplierBase.SupplyClassify`，查询字段 `FSupplyClassify`（`executeBillQuery` 可用，`FSupplyClassify.FNumber` 不存在）
- 单选枚举，不可多选

## 枚举值（全库 500 行实测 2026-09-02）
| 值 | 含义（界面显示） | 数量 | 能否下单 |
|---|---|---|---|
| `CG` | 采购 | 302 | 只能 `PUR_PurchaseOrder`，`SUB_SUBREQORDER` 0 行 |
| `ZH` | 招标/综合（实测为 采购+委外 双活） | 146 | `PUR` 5+ 且 `SUB` 5+ 双活，如 G053 供应商Z、G050 供应商J |
| `FW` | 服务 | 51 | 未验证 |
| `WW` | 委外 | 1（改后 G026 唯一） | 只能委外，反向阻塞采购 |

## 结论
- 供应商要同时做采购和委外，必须设为 `ZH`，不能设 `CG` 或 `WW`。
- `CG` 的 112 家抽样 20 家均无 SUB；`ZH` 的 G053/G050 均双活。
- G026 原 `CG`（217 PO / 350 AP 均为采购链），误改 `WW` 会阻塞后续采购单，正确值是 `ZH`。

## 操作
- 前端：`供应商-修改 → 基本信息 → 供应类别` 下拉选 `ZH` 对应项 → 保存 → 重新审核。
- API：`View` 取 `SupplierBase[0].SupplyClassify` 校验，`unAudit → Save {FSupplyClassify: "ZH"} → Audit`，回查 `executeBillQuery BD_SUPPLIER FSupplyClassify='ZH'`。
- 校验：`PUR_PurchaseOrder` 与 `SUB_SUBREQORDER` 分别按 `FSupplierId.FNumber='Gxxx'` 各查 1 行确认双活。

## 坑位
- 界面中文标签与后台值不一致（ZH 显示可能是 招标/综合），以 `FSupplyClassify` 后台值为准。
- 改类不影响历史单据，但影响后续下单校验；改前先按 500 行 `distinct FSupplyClassify` 确认全库分布。
