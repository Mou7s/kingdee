# 删除工序计划（SFC_OperationPlanning）

## 何时用

生产订单下工序计划错误、重复，需要整单删掉重建时。

## 标准流程

1. **查状态** `FDocumentStatus`：若为 **C**（已审核）→ 先 `unAuditBill`
2. **查工序** `FOperStatus`：若为 **4**（开工）→ 先 `UndoToPlan`
3. **删除** `deleteBill`（不需要 Cancel/UnCancel）

注意：`executeBillQuery` 因子实体 join 会多行，**按 FID 去重** 后再操作。

先查上下游和实际物料流向，确认用户授权删除的是这些计划。下面的单号只是历史命令示例，运行时换成本次已核对的对象。

工具限制：当前 `scripts/tools/delete_sfc_plan.js` 会捕获 `UndoToPlan` 的错误后继续循环，不能把命令整体结束当作全部成功。执行前须审阅并确保失败停止；失败时停止后续删除，不扩大范围。删除后按原 FID 和生产订单号独立查询，确认目标不存在，并核对生产订单与其他上下游未被误改。

## 推荐命令

```bash
# 预览
bun run delete-sfc -- MO260626026

# 执行
bun run delete-sfc -- MO260626026 --apply
```

等价：

```bash
bun scripts/tools/delete_sfc_plan.js MO260626026 --apply
```

## 历史脚本

`scripts/bun_test/delete_mo_plan_single.js`（无 dry-run，直接删）
