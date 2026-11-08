/**
 * 金蝶常用状态码映射（与 AGENTS.md 一致）
 */

/** FDocumentStatus 单据状态 */
export const DOC_STATUS = {
  A: "创建/未审核/草稿",
  B: "审核中",
  C: "已审核",
  D: "重新审核",
  Z: "暂存",
};

/** 简短展示用 */
export const DOC_STATUS_SHORT = {
  A: "草稿",
  B: "审核中",
  C: "已审核",
  D: "重新审核",
  Z: "暂存",
};

/** SFC 工序状态 FOperStatus */
export const OPER_STATUS = {
  "0": "创建",
  "1": "计划",
  "2": "计划确认",
  "3": "下达",
  "4": "开工",
  "5": "完工",
  "6": "关闭",
};

/**
 * @param {string} code
 * @param {Record<string,string>} map
 */
export function statusLabel(code, map = DOC_STATUS_SHORT) {
  const key = String(code ?? "");
  return map[key] || key || "-";
}
