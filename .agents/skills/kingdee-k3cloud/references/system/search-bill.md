# 通用查单

## 推荐命令

```bash
bun run search-bill -- MO260428041
bun run search-bill -- AP00124418
```

会在采购/应付/生产/工序/销售/调拨等多表单中按单据号（工序计划额外按 `FMONumber`）模糊搜索。

## 状态与结果核对

状态映射以 `lib/k3/status.js` 为准，未知状态先验证。上述编号仅为命令示例。区分全部查询成功但无匹配与部分表单查询失败；未命中时参考 `references/system/database-form-discovery.md`，不要直接断言单据不存在。

## 历史脚本

`scripts/bun_test/search_any_bill.js`（状态码 B 的旧文案有误，请用 tools 版）
