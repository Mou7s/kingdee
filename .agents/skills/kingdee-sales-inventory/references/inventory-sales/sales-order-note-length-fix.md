# 销售订单备注超长导致生产/工序计划保存失败（250 字段）

2026-08-31 XSDD034994/034995/034996 → MO260826047 实测：`T_SAL_ORDERENTRY.FNOTE` 250-255 直接下推到 `T_SFC_OPERPLANNING.F_UNW_TEXT_QTR(250)` 触发“数据库长度为250，实际255”。

## 现象

- 销售订单 `FNOTE` 实测：034994=255, 034995=250, 034996=252（晶圆批号/封装/测试/打标规范全量，含全角标点、多空格、首尾引号）
- 生产订单保存粉色报错：`表名T_SFC_OPERPLANNING的字段F_UNW_TEXT_QTR的数据库长度为250，实际录入长度为255/252，请在数据库修改字段长度`
- 下游 `T_SFC_OPERPLANNING.F_UNW_TEXT_QTR` 定义 `NVARCHAR(250)`，而 `T_PRD_MOENTRY.F_UNW_TEXT_QTR1` 为 2000，超长部分应分流。

## 为什么 WebAPI 改不动（本账套实测）

- `SAL_SaleOrder` 已审核(C)且有下游 `PRD_MO` 时，`unAuditBill` 报错“订单已有下游单据关联，不允许反审核”，`saveBill` 即使 `IsSuccess` 也不改 `Note`（View 回查仍 255）
- `ViewBill SAL_SaleOrder` 结构：`SaleOrderEntry: [{Id: FENTRYID, Note: FNOTE, MaterialId_Id, Qty}]`，Save 需 `FEntity` 思路不适用，`NeedUpDateFields=["SaleOrderEntry"]` 在此状态下被业务校验拦截

## 改法（用户明确授权单条 FNOTE 时）

### 1. 先算能压多少（dry-run）
```js
function shortenNote(s){
 let t=s.replace(/　/g,' ').replace(/，/g,',').replace(/。/g,'.').replace(/：/g,':').replace(/；/g,';')
  .replace(/（/g,'(').replace(/）/g,')').replace(/【/g,'[').replace(/】/g,']')
  .replace(/“/g,'"').replace(/”/g,'"').replace(/‘/g,"'").replace(/’/g,"'").replace(/、/g,',').replace(/—/g,'-').replace(/－/g,'-');
 t=t.replace(/^"+|"+$/g,'').replace(/\s+/g,' ');
 t=t.replace(/\s*,\s*/g,', ').replace(/\s*;\s*/g,'; ').replace(/\s*:\s*/g,': ');
 t=t.replace(/\s*\(\s*/g,'(').replace(/\s*\)\s*/g,') ').replace(/\s+/g,' ').trim();
 t=t.replace(/产品型号:/g,'型号:').replace(/晶圆名称:/g,'晶圆:').replace(/晶圆批号:/g,'批号:').replace(/晶圆片号:/g,'片号:')
  .replace(/封装规范:/g,'封装:').replace(/FT测试规范:/g,'FT:').replace(/打标规范:/g,'打标:').replace(/包装方式/g,'包装').replace(/取片方式/g,'取片').replace(/特殊备注:/g,'备注:');
 return t.replace(/\s+/g,' ').trim();
}
// 实测：255→238 (-17), 250→233 (-17), 252→233 (-19)，均 ≤250
```
光改半角/去空格会从 250→255（因补空格），必须做固定词缩写。

### 2. 直接 SQL（最小范围，显式授权）
```sql
-- 前值备份（输出到日志，非 #temp）
SELECT FENTRYID, FNOTE, LEN(FNOTE) FROM T_SAL_ORDERENTRY WHERE FENTRYID=219800; -- 255
-- 单字段更新
UPDATE T_SAL_ORDERENTRY SET FNOTE='型号: MKD2M500065GA 晶圆: MKD2M500065(GD2MD2A1) 批号: 260523D00766 片号: 26D15995 封装: MKT-BDD-... 备注:(1)Map只取PASS...' WHERE FENTRYID=219800;
-- 回查
SELECT LEN(FNOTE), FNOTE FROM T_SAL_ORDERENTRY WHERE FENTRYID=219800; -- 238 ≤250 通过，再 ViewBill 校验
```
- 范围：单条 `FENTRYID`，单字段 `FNOTE`，不改数量/客户
- 前值/目标值/影响行数写入日志，更新后 View + `LEN()` 双重回查
- 本例 XSDD034994 1行更新，回查 238 已通过；034995/034996 同法可到 233

### 3. 根治（可选）
`ALTER TABLE T_SFC_OPERPLANNING ALTER COLUMN F_UNW_TEXT_QTR NVARCHAR(500)`，超长分流到 `F_UNW_TEXT_QTR1(2000)`，与 `T_PRD_MOENTRY` 对齐。

## 处置顺序

1. 先 dry-run 算压后长度，确认 ≤250 再申请单条授权
2. 用户明确“先改 XSDD034994”→ 仅改该条，不批量扩散
3. 改后让用户重下推验证不报错，再决定是否改剩余两张
