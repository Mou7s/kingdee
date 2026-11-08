#!/usr/bin/env bun
/** 只读字段探针。仓库根执行 bun scripts/tools/probe_fieldkeys.js <FormId> <字段,字段> [过滤条件]。
 * 不附加 FID；无数据只证明查询被接受，不证明字段取值。请求失败不判断字段有效性。
 */
export async function probeFields(api, formId, candidates, filter = "") {
  const results = [];
  for (const key of [...new Set(candidates.map(x => x.trim()).filter(Boolean))]) {
    try {
      const rows = await api.executeBillQuery(formId, key, filter, 3);
      if (!Array.isArray(rows)) throw new Error("查询返回格式异常");
      results.push({ key, status: rows.length ? "accepted_with_rows" : "accepted_empty", rows });
    } catch (error) {
      const message = String(error?.message ?? error);
      // 只有错误同时点名本候选且明确字段不存在，才分类为字段错误。
      const fieldError = message.includes(key) && /字段不存在|标识.*不存在|引用字段.*不存在/.test(message);
      results.push({ key, status: fieldError ? "field_error" : "request_error", message });
      if (!fieldError) break; // 连接、权限、过滤或其他失败停止，避免误判后续候选。
    }
  }
  return results;
}
if (import.meta.main) {
  const [formId, raw, filter = ""] = process.argv.slice(2);
  if (!formId || !raw?.split(",").some(x => x.trim())) {
    console.error("用法: bun scripts/tools/probe_fieldkeys.js <FormId> <字段,字段> [过滤条件]");
    process.exit(2);
  }
  const { K3CloudWebAPI } = await import("../../lib/k3/index.js");
  const api = new K3CloudWebAPI();
  await api.login();
  const results = await probeFields(api, formId, raw.split(","), filter);
  results.forEach(result => console.log(JSON.stringify(result)));
  if (results.some(x => x.status.endsWith("error"))) process.exitCode = 1;
}
