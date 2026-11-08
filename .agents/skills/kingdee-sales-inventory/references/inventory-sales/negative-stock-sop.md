# 金蝶 K3 Cloud 负库存处理标准操作流程(SOP)

> 2026-10-17 迁移说明：原文是 2026-07-08 历史 SOP，保留原有事实与建议，未在本次复查账套。下方直接 UPDATE 仓库配置的示例是历史禁用示例，不可执行；当前操作须遵守 AGENTS.md 和用户 WebAPI-only 约定。人工前端步骤仅供用户手工参考，Agent 不使用浏览器操作金蝶。旧脚本名、FormId 和字段复用前先查当前代码及元数据，不得照抄运行。

## 目录

- 1. 处理原则(铁律)
- 2. 标准处理步骤
- 3. 案例参考
- 4. 预防措施(长期)
- 5. 常用 SQL 速查
- 6. 联系方式
- 7. 修订记录

> 适用:全公司所有仓库
> 维护:IT 部
> 版本:v1.0 / 2026-07-08
> 关联脚本:`query_negative_stock.js`、`query_stock_onhand.js`

---

## 1. 处理原则(铁律)

| 优先级 | 处理方式 | 适用场景 | 内控要求 |
|:--:|:--|:--|:--|
| ① | **改原单据**(反审-改-再审) | 出/入库数量录错、调拨方向错 | 必须留修改备注 |
| ② | **撤销异常单据** | 单据已删但库存未回滚 | 找金蝶支持 |
| ③ | **盘盈/盘亏单** | 真实盘点差异 | 必须有盘点表 |
| ❌ | **凭空盘盈** | —— | **严禁,无依据 = 内控违规** |

---

## 2. 标准处理步骤

### 步骤 1:发现(5 分钟内)

- **来源 A**:每日定时任务告警(脚本 `query_negative_stock.js`)
- **来源 B**:用户反馈 / `STK_StockNegativeWarnRpt`(已启用)
- **确认命令**:
  ```bash
  bun query_negative_stock.js
  ```

### 步骤 2:定位(10 分钟)

查 T_STK_INVENTORYLOG 流水,找到产生负库存的原始单据:

```sql
SELECT l.FBillNo, l.FSourFormID AS FormID, l.FUpdateTime, l.FUpdateBaseQty, l.FOperationNumber
FROM T_STK_INVENTORYLOG l
INNER JOIN T_STK_INVENTORY i ON l.FInventoryID = i.FID
INNER JOIN T_BD_MATERIAL m ON i.FMaterialID = m.FMaterialId
INNER JOIN T_BD_STOCK s ON i.FStockID = s.FStockId
WHERE m.FNumber = '物料编码' AND s.FNumber = '仓库编码'
ORDER BY l.FUpdateTime DESC
```

定位字段:
- `FBillNo`:单据编号(直接定位单据)
- `FSourFormID`:单据类型(`STK_TransferDirect` 直接调拨、`PRD_PickMtrl` 生产领料、`SAL_OutStock` 销售出库 等)
- `FOperationNumber`:操作(`Audit` 审核、`UnAudit` 反审核)
- `FUpdateBaseQty`:本次变动数量(正负)

### 步骤 3:根因分类

| 场景 | 根因 | 处理方式 |
|:--|:--|:--|
| A | 出/入库数量录错 | **改原单据**(场景 1) |
| B | 调拨方向/数量错 | **改原单据** |
| C | 单据已删但库存未回滚 | 找金蝶支持 |
| D | 真实盘点盘盈(实物 > 账面) | **盘盈单**(场景 2) |
| E | 真实盘点盘亏(实物 < 账面) | **盘亏单**(场景 2) |

### 步骤 4:执行修复

#### 场景 1:改原单据(优先,治本)

1. 金蝶前端:库存管理 → 单据列表 → 找到那张单据(`FBillNo`)
2. 操作菜单 → **反审核** → 修改数量/方向 → 保存
3. 重新**审核**
4. 单据备注写明:`[负库存修复] 原数量XX改XX,原因:XXX,修复人:XXX,日期:XXX`

#### 场景 2:盘盈/盘亏(慎用,必须有依据)

1. 仓管盘点,签字盘点表
2. 金蝶前端:库存管理 → 其他入库单(盘盈) / 其他出库单(盘亏)
3. 备注:`盘盈/盘亏,依据盘点表XXX号`
4. **附件**:盘点表 PDF/扫描件存档
5. 上报:财务知会(影响损益)

#### 场景 3:异常单据(找金蝶)

- 备份 T_STK_INVENTORYLOG 流水
- 联系金蝶工程师 / 实施顾问

### 步骤 5:复核(2 分钟)

```sql
SELECT s.FNumber AS 仓库, m.FNumber AS 物料, i.FBaseQty AS 数量
FROM T_STK_INVENTORY i 
LEFT JOIN T_BD_STOCK s ON i.FStockID = s.FStockId 
LEFT JOIN T_BD_MATERIAL m ON i.FMaterialID = m.FMaterialId 
WHERE m.FNumber = '物料编码' AND s.FNumber = '仓库编码'
```

**确认**:所有记录 `FBaseQty >= 0`

### 步骤 6:留痕 + 上报

- [ ] 单据备注里写修复说明
- [ ] 重大异常(数量 > 10000 或金额 > 1 万)通知财务
- [ ] 记录到 `negative_stock_log.md`(每次修复一条)

---

## 3. 案例参考

### 案例:2026-07-08 N102010143 GYM30P43A-L 在 CTK08

- **问题**:负库存 -518.4 K
- **根因**:直接调拨单 `ZJDB2026070128` 出库 1,081.05 落到单一库存维度,导致同仓分裂后变成负数
- **处理**:反审调拨单 → 拆分分录到两个库存维度(562.65 + 518.40)→ 重新审核 → 负库存清零
- **操作人**:数据库无记录(金蝶业务库不存操作日志,操作日志在金蝶审计库)
- **新配置**:现场仓(CTK08) `FAllowMinusQty` 已改为 0,8:41:26 生效

---

## 4. 预防措施(长期)

| 项 | 状态 | 备注 |
|:--|:--|:--|
| 仓库配置 FAllowMinusQty=0 | ✅ CTK08 已关,❌ CTK11/13/14 仍开 | 本周内沟通后处理 |
| 每日巡检 `query_negative_stock.js` | ⚠️ 未自动化 | 待 IT 部署定时任务 |
| `STK_StockNegativeWarnRpt` 预警 | ✅ 已启用,每日 0 点跑 | 在 BOS 预警管理查看 |
| BOS 出库校验 | ⚠️ 未配 | 建议加自定义校验 |
| 紧急解锁审批流 | ⚠️ 未配 | 产线沟通后再定 |
| KPI 考核(仓管) | ⚠️ 未纳入 | 建议月度加入 |

---

## 5. 常用 SQL 速查

### 查所有负库存
```sql
SELECT s.FNumber AS 仓库, m.FNumber AS 物料, ml.FName AS 物料名, i.FBaseQty AS 数量
FROM T_STK_INVENTORY i 
LEFT JOIN T_BD_STOCK s ON i.FStockID = s.FStockId 
LEFT JOIN T_BD_MATERIAL m ON i.FMaterialID = m.FMaterialId 
LEFT JOIN T_BD_MATERIAL_L ml ON m.FMaterialId = ml.FMaterialId 
WHERE i.FBaseQty < 0
```

### 查仓库负库存配置
```sql
SELECT FNumber, FAllowMinusQty, FModifierID, FModifyDate 
FROM T_BD_STOCK 
ORDER BY FNumber
```

### 关闭负库存(慎用,先沟通)
```sql
UPDATE T_BD_STOCK SET FAllowMinusQty = '0' 
WHERE FNumber IN ('CTK11','CTK13','CTK14')
```

### 查物料在所有仓的库存分布
```sql
SELECT s.FNumber AS 仓库, i.FBaseQty AS 库存, ss.FNumber AS 库存状态, i.FMtoNo AS 跟踪号
FROM T_STK_INVENTORY i 
LEFT JOIN T_BD_STOCK s ON i.FStockID = s.FStockId 
LEFT JOIN T_BD_MATERIAL m ON i.FMaterialID = m.FMaterialId 
LEFT JOIN T_BD_STOCKSTATUS ss ON i.FStockStatusID = ss.FStockStatusId 
WHERE m.FNumber = '物料编码'
ORDER BY s.FNumber, i.FBaseQty DESC
```

---

## 6. 联系方式

| 角色 | 联系方式 | 责任 |
|:--|:--|:--|
| IT 运维 | (内部) | 系统配置、SQL 排查、监控脚本 |
| 仓管 | (内部) | 实物盘点、单据录入 |
| 财务 | (内部) | 盘盈/盘亏损益确认 |
| 金蝶支持 | (供应商) | 系统 BUG、单据异常 |

---

## 7. 修订记录

| 版本 | 日期 | 修订人 | 内容 |
|:--|:--|:--|:--|
| v1.0 | 2026-07-08 | IT | 初版,基于 2026-07-08 负库存事件 |