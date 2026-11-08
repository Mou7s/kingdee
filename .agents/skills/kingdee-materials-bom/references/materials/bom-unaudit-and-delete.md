# 金蝶 BOM 反审核与删除流程 (ENG_BOM)

当用户明确要求删除错误创建或废弃的 BOM 时，按本流程执行安全检查、反审核及删除。

## 一、适用场景与前提条件

1. **场景**：用户明确指定要删除的 BOM 版本（如 `NBQ0130281_V1.1`）。
2. **前提**：必须为明确授权的对象，且该 BOM 未被生产订单或下游用料清单占用。

## 二、前置安全排查

在执行反审核与删除前，必须完成以下核对：

1. **对象唯一性与前值核对**：
   - 校验 BOM 编码 `FNumber`、内码 `FID`、父项物料编码 `FMaterialId.FNumber` 及物料名称。
   - 读取当前单据状态 `FDocumentStatus`（`C` 为已审核，`A` 为暂存，`D` 为重新审核/反审核后状态）。
2. **下游引用检查**：
   - 检查生产订单 `PRD_MO`（`FBomId = {FID}`）是否已有单据引用。
   - 检查生产用料清单 `PRD_PPBOM` 或委外用料清单 `SUB_PPBOM` 是否存在关联。
   - 若存在生产引用，禁止直接删除，必须先向用户说明并停止。

## 三、标准 WebAPI 执行步骤

写操作脚本遵循默认 dry-run，显式 `--apply` 触发执行：

```javascript
import { K3CloudWebAPI } from "../../lib/k3/index.js";

const api = new K3CloudWebAPI();
await api.login();

// 1. 若为已审核(C)，先反审核
if (status === 'C') {
  await api.unAuditBill('ENG_BOM', [fid]);
}

// 2. 检查反审核后状态是否为 A / D / Z
const midState = await api.executeBillQuery('ENG_BOM', 'FID,FDocumentStatus', `FID=${fid}`, 10);
if (!['A', 'D', 'Z'].includes(midState[0][1])) {
  throw new Error(`反审核后状态异常: ${midState[0][1]}`);
}

// 3. 执行删除
await api.deleteBill('ENG_BOM', [fid]);
```

## 四、执行后独立复查

1. **BOM 查空**：重新查询该 BOM 编号，必须返回空数组 `[]`。
2. **主物料核对**：检查父项物料 `BD_MATERIAL`，确认其基础资料状态未受破坏（`FDocumentStatus='C'`、`FForbidStatus='A'`）。
3. **留存版本核对**：若该物料存在前一正常版本（如 `V1.0`），核对保留版本状态依然正常。
4. **留痕记录**：执行结果及快照输出至 `output/` 目录。
