# 委外多发退料 — 关账后替代方案（SUB00000874 案例）

## 现象
- 委外领料 WWLL260725001 已审：N101041678 802.8K / N101041497 3618.3K，供应商 GYS080002 供应商Q，仓库 CTK01 批号1，上游 SUB00000874 / SUBBOM00004908-04909
- 需退 N101041678 20.975K（多发）
- `SUB_PickMtrl 101207 → SUB_RETURNMTRL` 下推：
  - `RuleId=SUB_Pick_Return` 报错：`委外领料单下推委外退料单条件：1 领料已审 2 实领>退选 3 订单需下达/完工 4 用料清单已审 5 在制>0 ... 在制材料数>0`、`OnInSelectedRow` 拦截
  - `Save` 同报 `SUB00000874第1行 业务状态不为 下达或完工`
- 委外订单列表 `反执行至完工 SUB00000874` 失败：`已经财务结算！`（两分录同错）

## 根因（非工序结算）
- `SFC_OPERPROCBALANCE` 按供应商查为空，不是工序结算单
- DB 直查：`T_SUB_REQORDERENTRY WHERE FID=110878` → `FSTATUS=7` 已结案，`FFINISHDATE 2026-07-28/29`，`FCOSTDATE=2026-07-31` 7月成本已核算关账
- 关账后 `FSTATUS=7` + `FCOSTDATE` 即为“财务结算”锁，禁止反执行、导致在制=0，选单退料链路彻底堵死

## 判定
- 正链退料（SUB_RETURNMTRL 选单）要求 `订单 下达/完工未结案 + 在制>0`，关账后不满足，不可逆
- 反成本会动7月已结账，不推荐

## 关账后实物退回 — 其他入库方案
- 单据：`STK_MISCELLANEOUS` 标准其他入库单 `QTRKD01_SYS`，表 `T_STK_MISCELLANEOUS / T_STK_MISCELLANEOUSENTRY`
- 实测字段：头 `FStockOrgId(100) / FDate / FBillTypeID(QTRKD01_SYS) / FOwnerTypeIdHead(BD_OwnerOrg) / FOwnerIdHead(100) / FStockDirect(GENERAL) / FSUPPLIERID或FDEPTID二选一必填`；行 `STK_MISCELLANEOUSENTRY：FMATERIALID(N101041678) / FUNITID(K) / FQTY/FBASEQTY(20.975) / FSTOCKID(CTK01 111210) / FLOT(1) / FSTOCKSTATUSID(KCZT01_SYS 可用) / FOWNERTYPEID/Keeper` + 仓位 `FSTOCKLOCID` 维度不能为空（CTK01 启用仓位，FSTOCKLOCID 100048 vs WWLL的100001 需按仓位档案填）
- 行备注用 `FEntryNote`（`FNOTE/FEntryNote` 混用会报 `寻找实体上NOTE对应的属性描述符失败`）
- 前端路径：`库存管理 → 其他入库单列表 → 新增 → 标准其他入库单 → 货主类型/货主100 → 部门/供应商二选一 → 行 物料N101041678 数量20.975 仓库CTK01 仓位1 批号1 库存状态可用 → 备注 关联WWLL260725001/SUB00000874 多发退料 → 保存审核`，库存回 CTK01，8月生效，不动订单与7月结算

## 实测 QTRK001003 删不掉教训（2026-09-02 续）
- `Save`：`FEntity` 中 `FSTOCKLOCID:100001`（数值）成功，`FSTOCKLOCID__FNumber:"1"` / 驼峰 `FStockLocId:{FNumber:"1"}` 均报 `仓位维度不能为空`；`FStockOrgId/FBillTypeID` 必带，`FSUPPLIERID` 与 `FDEPTID` 二选一
- `Submit→Audit QTRK001003` 均 `IsSuccess:true` 现状态 `C`，但 `T_STK_INVENTORY WHERE FMATERIALID=855538 AND FSTOCKID=111210` 仍 `FQTY=0/FBASEQTY=0`（FLOT 868866 批号1），库存未+20.975，疑其他入库未触发库存更新（与 `FSTOCKFLAG` / 成本价0 或仓位Flex 有关）
- `unAudit 101021` 报错 `更新库存出现异常情况，更新库存不成功！`，因 `CTK01 FISOPENLOCATION=1 FALLOWMINUSQTY=0` 禁止负库存，`0→-20.975` 被拦；`delete` 因非 `A/D` 被拒，单据卡在 `C` 删不掉
- 教训：关账后用其他入库“回库存”前，先查 `T_STK_INVENTORY FQTY` 与 `T_BD_STOCK.FALLOWMINUSQTY`，评估 `unAudit` 可逆性；真退料优先走 `SUB_RETURNMTRL` 正链，其他入库仅作库存数调整，不冲减委外在制，上线前需确认下游是否已耗用该批号

## 校验与复核
- `T_SUB_REQORDERENTRY.FSTATUS=7` 且 `FCOSTDATE` 非空即关账，`T_META_CONVERTRULE` 可证可用规则仅 `SUB_Pick_Return` / `SUB_Pick_Return_BackFlush`，`SUB_PPBOM→RETURN` 无RuleId
- 替代单审核后用 `STK_Inventory FBaseQty` 核对 CTK01 是否 +20.975K，备注保留关联便于对账
