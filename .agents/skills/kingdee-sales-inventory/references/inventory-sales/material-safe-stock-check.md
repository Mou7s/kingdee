# 物料安全库存核对（T_BD_MATERIALSTOCK · 案例 N103030015/017 · 2026-09-03）

## 安全库存存在哪

- 表 `T_BD_MATERIALSTOCK`（按 物料 × 使用组织 一行），关键字段：
  - `FSAFESTOCK` 安全库存量，`FISENABLESAFESTOCK` 是否启用预警（`'1'` 启用）
  - 另有 `FMINSTOCK/FMAXSTOCK` + `FISENABLEMINSTOCK/FISENABLEMAXSTOCK`，别和安全库存混用
- **组织关联坑**：该表没有 `FSTOCKORGID`（直接用会报 207 Invalid column name）。
  组织键是 `FUSEORGID` → `T_ORG_ORGANIZATIONS.FORGID`（取 `FNUMBER`，如 `100`）。

```sql
SELECT m.FNUMBER AS code, s.FSAFESTOCK AS safeStock,
       s.FISENABLESAFESTOCK AS enabled, o.FNUMBER AS useOrg
FROM T_BD_MATERIAL m
LEFT JOIN T_BD_MATERIALSTOCK s ON s.FMATERIALID = m.FMATERIALID
LEFT JOIN T_ORG_ORGANIZATIONS o ON o.FORGID = s.FUSEORGID
WHERE m.FNUMBER IN ('N103030015','N103030017');
```

## 和 ctk-system 库存预警页交叉

- 预警页读本地 MySQL 快照 `kucun_warning`（`safe_stock / safe_warning_enabled / warning_status / sync_time`），每 30 分钟从金蝶同步；页面显示“正常”只代表 `actual_total >= safe_stock`。
- 用户说“某料没预警”时，先同时查两边再下结论：
  1. 金蝶 `T_BD_MATERIALSTOCK`（源头值 + 开关）；
  2. `kucun_warning WHERE material_code IN (...)`（快照值 + `sync_time` 是否新鲜）。
- 本次案例：两料金蝶源头均为 `450 / 启用 / 组织100`，快照也是 `450` 且当天同步——`N103030015` 显示正常是因为现存 874 > 450，不是没设预警；`N103030017` 现存 0 才报偏低。结论是“已一致，无需加”，不要一上来就写金蝶。
- ctk-system 侧连接入口：该仓库 `tools/db_config.py` 的 `get_mysql_config()` / `get_sqlserver_config()`（读 `local.env`，只核对键存在，不输出值）。
