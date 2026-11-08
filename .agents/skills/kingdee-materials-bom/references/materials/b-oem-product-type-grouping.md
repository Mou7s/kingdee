# B(OEM成品)按产品类型分组

> 2026-09-01 用户截图纠正：`B(OEM成品)` 下按产品类型细分，不能按封装推分组。

## 层次（截图原文）
- `B(OEM成品)`
  - `BD(二极管-开关管)`
  - `BE(ESD管)`
  - `BI(IC)`
  - `BM(MOSFET)`
  - `BQ(其他)`
  - `BS(肖特基)`
  - `BT(三极管)`
  - `BZ(稳压管)`
  - `BCP(半成品)`

## 实测映射
- `BAT` 系列（`BAT54/BAT64-04`）→ `BS肖特基`，如 `BS0060001 BAT54 单芯 SOT-23(6R)`、`NBS0060001 BAT64-04 单芯 SOT-23/3K盘/无卤/64S`
- `BAS/BAV` → `BD`，如 `BD0060001 BAS21 单芯 SOT-23(6R)`
- `BAT54S 双芯` 在 `BE006 SOT-23(6R)` 为历史特例，不代表 `BAT` 通用归 `BE`
- `AP` 系 MOSFET → `BM`，如 `BM013 TO-252` (`AP50N04D` 等)、`BM076 PDFN5X6-8L` (`AP90N08NF` 等)
- TVS `SMDJ/SMCJ` → `DA`，如 `DA030 SMC` (`NDA0300115 SMDJ22CA SMC`)、`DA031 SMCG` (`NDA0310001 AD-3.0SMDJ22CA SMCG`)

## 坑位
- 误把 `BAT64-04 SOT-23` 放 `BE006`（本会话已纠正为 `BS006`）
- `SOT-23` 封装在 `BD/BE/BM/BS` 均有子分组，必须先定产品类型再定封装
- `N` 前缀判断：`NBS006` 为 `BS006` 新料，`BS0060001` 为旧料

## 判定步骤
1. 按 `FName` 关键字定产品类型（`BAT`→BS、`AP`→BM、`SMDJ`→DA）
2. `executeBillQuery FMaterialGroup.FNumber like 'BS%'` 拉该大类下子分组统计
3. `View` 同组现役样板核对 `CategoryID/ErpClsID/Store/Batch`
4. `DA031 SMCG` 等新增需直连 SQL `T_BD_MATERIALGROUP/_L`（`BD_MATERIALGROUP` 无 WebAPI），见 `material-group-create-delta.md`
