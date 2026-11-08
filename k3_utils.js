/**
 * 转义金蝶查询过滤条件中的单引号，防止查询语法报错
 * @param {any} value - 原始值
 * @returns {string} 转义后的字符串
 */
export function escapeK3(value) {
  return String(value ?? "").replace(/'/g, "''");
}

/**
 * 从金蝶 WebAPI 原始响应数据中安全提取行数据（Rows 二维数组）
 * @param {any} data - API 响应数据
 * @returns {any[]} 二维数据行数组，提取失败时返回空数组 []
 */
export function responseRows(data) {
  if (data && typeof data === "object") {
    // 处理标准的 ExecuteBillQuery 返回结构
    if (data.Result?.Rows) {
      return data.Result.Rows;
    }
    // 如果已经是数组格式，直接返回
    if (Array.isArray(data)) {
      return data;
    }
  }
  return data || [];
}

/**
 * 将大数组分块，切分成多个指定大小的小数组，用于批量分块请求
 * @param {any[]} items - 待切分的大数组
 * @param {number} size - 每个分块的最大容量
 * @returns {any[][]} 分块后的二维数组
 */
export function chunks(items, size) {
  const result = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

/**
 * 将数值格式化为 6 位小数，常用于内存中做单价的一致性比较
 * @param {any} value - 数值
 * @returns {string} 6位小数格式的字符串，如 "0.814000"
 */
export function decimal6(value) {
  const num = Number(value || 0);
  return num.toFixed(6);
}

/**
 * 对金额（如价税合计、税额）执行精确的四舍五入并保留 2 位小数
 * 利用 Number.EPSILON 避免 JS 浮点数计算造成的精度偏差
 * @param {any} value - 原始金额数值
 * @returns {string} 2位小数格式的金额字符串，如 "120.50"
 */
export function money(value) {
  const num = Number(value || 0);
  return (Math.round((num + Number.EPSILON) * 100) / 100).toFixed(2);
}

/**
 * 对单价执行精确的四舍五入并保留 6 位小数
 * 利用 Number.EPSILON 避免 JS 浮点数计算造成的精度偏差
 * @param {any} value - 原始单价数值
 * @returns {string} 6位小数格式的单价字符串，如 "0.720354"
 */
export function unitPrice(value) {
  const num = Number(value || 0);
  return (Math.round((num + Number.EPSILON) * 1000000) / 1000000).toFixed(6);
}
