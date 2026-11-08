import net from "net";
import { URL } from "url";
import { readFileSync } from "fs";

const configUrl = new URL("./k3cloud.local.json", import.meta.url);
let K3_CONFIG;
try {
  K3_CONFIG = JSON.parse(readFileSync(configUrl, "utf8"));
} catch {
  throw new Error("Missing or invalid k3cloud.local.json. Copy k3cloud.local.example.json and fill in local credentials.");
}

const requiredConfigKeys = [
  "K3_BASE_URL", "K3_BASE_URL_INTRANET", "K3_DBID", "K3_USERNAME", "K3_PASSWORD",
  "K3_DB_HOST", "K3_DB_USER", "K3_DB_PASS", "K3_DB_NAME", "K3_SQLCMD_HOST", "K3_FS_DB",
];
const missingConfigKeys = requiredConfigKeys.filter((key) => !K3_CONFIG[key]);
if (missingConfigKeys.length) {
  throw new Error(`Incomplete k3cloud.local.json; missing: ${missingConfigKeys.join(", ")}`);
}

const K3_BASE_URL = K3_CONFIG.K3_BASE_URL;
const K3_BASE_URL_INTRANET = K3_CONFIG.K3_BASE_URL_INTRANET;
const K3_DBID = K3_CONFIG.K3_DBID;
const K3_USERNAME = K3_CONFIG.K3_USERNAME;
const K3_PASSWORD = K3_CONFIG.K3_PASSWORD;
const K3_LCID = K3_CONFIG.K3_LCID ?? 2052;

export const K3_DB_HOST = K3_CONFIG.K3_DB_HOST;
export const K3_DB_USER = K3_CONFIG.K3_DB_USER;
export const K3_DB_PASS = K3_CONFIG.K3_DB_PASS;
export const K3_DB_NAME = K3_CONFIG.K3_DB_NAME;
export const K3_SQLCMD_HOST = K3_CONFIG.K3_SQLCMD_HOST;
export const K3_FS_DB = K3_CONFIG.K3_FS_DB;

// 内网金蝶地址必须绕过系统代理：模块加载时对内网主机统一注入直连。
{
  const intra = new URL(K3_BASE_URL_INTRANET).hostname;
  const noProxy = (process.env.NO_PROXY ?? process.env.no_proxy ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  if (!noProxy.includes(intra)) {
    process.env.NO_PROXY = [...noProxy, intra].join(",");
    process.env.no_proxy = process.env.NO_PROXY;
  }
}
/** 财务应付单：禁止提交/审核（项目硬规则，见 AGENTS.md） */
export const AP_PAYABLE_FORM_ID = "AP_PAYABLE";

const AP_PAYABLE_FORBIDDEN_SERVICES = new Set([
  "DynamicFormService.Submit",
  "DynamicFormService.Audit",
]);

const AP_PAYABLE_FORBIDDEN_OPS = new Set([
  "submit",
  "audit",
  "workflowsubmit",
  "startworkflow",
  "toaudit",
]);

/**
 * 类型2暂估核验后可Submit/Audit；类型3财务与未知类型禁止。
 * @param {string} serviceName
 * @param {string|null|undefined} formId
 * @param {string|null|undefined} opNumber
 */
export function assertApPayableWriteAllowed(serviceName, formId, opNumber = null, verifiedTypes = []) {
  if (String(formId ?? "").trim().toUpperCase() !== AP_PAYABLE_FORM_ID) return;
  const op = String(opNumber ?? "").trim().toLowerCase();
  const custom = /\.excuteoperation$/i.test(serviceName);
  const restricted = AP_PAYABLE_FORBIDDEN_SERVICES.has(serviceName) ||
    (custom && (AP_PAYABLE_FORBIDDEN_OPS.has(op) || /submit|audit|workflow/.test(op)));
  if (!restricted) return;
  const standard = AP_PAYABLE_FORBIDDEN_SERVICES.has(serviceName) || (custom && ["submit", "audit"].includes(op));
  if (standard && verifiedTypes.length && verifiedTypes.every(type => String(type) === "2")) return;
  throw new Error("[SAFETY] 仅实时验证为类型2的暂估应付可提交审核；财务应付、未知类型及工作流操作禁止。");
}

/**
 * 判断主机是否为内网/私有地址（10.x / 172.16-31.x / 192.168.x / localhost）
 */
function isPrivateHost(hostname) {
  if (/^(localhost|127\.|::1)/i.test(hostname)) return true;
  const m = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * 探测目标 URL 的 TCP 连接可用性
 * @param {string} urlStr - 目标 URL 字符串
 * @param {number} timeout - 超时毫秒数
 * @returns {Promise<string|null>} 可用时返回 urlStr，不可用时返回 null
 */
function probeUrl(urlStr, timeout = 1500) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(urlStr);
      const port = parsed.port || (parsed.protocol === "https:" ? 443 : 80);
      const host = parsed.hostname;
      
      const socket = net.createConnection(Number(port), host);
      socket.setTimeout(timeout);
      
      socket.on("connect", () => {
        socket.destroy();
        resolve(urlStr);
      });
      
      socket.on("timeout", () => {
        socket.destroy();
        resolve(null);
      });
      
      socket.on("error", () => {
        socket.destroy();
        resolve(null);
      });
    } catch {
      resolve(null);
    }
  });
}

/**
 * 金蝶 K3Cloud WebAPI 客户端类
 */
export class K3CloudWebAPI {
  baseUrl = K3_BASE_URL;
  intranetUrl = K3_BASE_URL_INTRANET;
  dbid = K3_DBID;
  username = K3_USERNAME;
  password = K3_PASSWORD;
  lcid = K3_LCID;
  context = null;    // 登录成功后的上下文数据
  cookies = [];     // 存储网络会话 Cookie 凭证

  /**
   * 根据服务名称构造完整的金蝶服务请求 URL
   * @param {string} serviceName - 服务类和方法路径，例如 'AuthService.ValidateUser'
   */
  serviceUrl(serviceName) {
    return `${this.baseUrl}/Kingdee.BOS.WebApi.ServicesStub.${serviceName}.common.kdsvc`;
  }

  /**
   * 发送底层的 POST 请求并维护会话 Cookie（支持默认 120 秒超时限制）
   * @param {string} serviceName - 服务名称
   * @param {object} payload - 请求参数載荷
   * @param {number} timeoutMs - 超时毫秒数 (默认 120 秒)
   * @returns {Promise<object>} JSON 格式响应数据
   */
  async verifyEstimatedPayables(payload) {
    const data = payload?.data ?? {};
    const ids = String(data.Ids ?? "").split(",").map(x => x.trim()).filter(Boolean);
    const numbers = data.Numbers ?? [];
    if ((!ids.length && !numbers.length) || !Array.isArray(numbers) || (ids.length && numbers.length) ||
        ids.some(x => !/^\d+$/.test(x)) || numbers.some(x => typeof x !== "string" || !x.trim())) {
      throw new Error("[SAFETY] 提交审核必须使用明确且有效的单据Ids或Numbers。");
    }
    const targets = [...new Set(ids.length ? ids : numbers)];
    const types = [];
    for (let i = 0; i < targets.length; i += 40) {
      const batch = targets.slice(i, i + 40);
      const filter = batch.map(x => ids.length ? `FID=${x}` : `FBillNo='${x.replace(/'/g, "''")}'`).join(" or ");
      const rows = await this.executeBillQuery(AP_PAYABLE_FORM_ID, "FID,FBillNo,FSETACCOUNTTYPE", filter, 200);
      if (!Array.isArray(rows) || rows.some(r => !Array.isArray(r) || r.length !== 3)) throw new Error("[SAFETY] 应付类型查询失败。");
      for (const target of batch) {
        const matches = rows.filter(r => String(r[ids.length ? 0 : 1]) === target);
        if (matches.length !== 1 || String(matches[0][2]) !== "2") throw new Error(`[SAFETY] ${target} 不是唯一且类型2的暂估应付。`);
        types.push(matches[0][2]);
      }
    }
    return types;
  }

  async post(serviceName, payload, timeoutMs = 120000) {
    // 客户端层实时区分暂估类型2与财务类型3，未知类型默认拒绝。
    const formId =
      payload?.formid ?? payload?.formId ?? payload?.FormId ?? payload?.data?.FormId;
    const op = String(payload?.opNumber ?? "").toLowerCase();
    const payable = String(formId ?? "").toUpperCase() === AP_PAYABLE_FORM_ID;
    if (payable && (payload?.data?.IsAutoSubmitAndAudit === true || String(payload?.data?.IsAutoSubmitAndAudit).toLowerCase() === "true")) {
      throw new Error("[SAFETY] AP自动提交审核禁止，请使用类型核验后的独立提交审核接口。");
    }
    const standard = AP_PAYABLE_FORBIDDEN_SERVICES.has(serviceName) ||
      (/\.excuteoperation$/i.test(serviceName) && ["submit", "audit"].includes(op));
    let types = [];
    if (payable && standard) types = await this.verifyEstimatedPayables(payload);
    assertApPayableWriteAllowed(serviceName, formId, payload?.opNumber, types);

    const headers = { "Content-Type": "application/json; charset=utf-8" };
    // 如果已有会话 Cookie，加入请求头以维持金蝶的登录会话
    if (this.cookies.length) {
      headers["Cookie"] = this.cookies.join(";");
    }

    // 内网地址必须绕过系统代理：本机代理（如 Clash 127.0.0.1:7897）转发不了
    // 局域网 IP，会代答 502 Bad Gateway。Bun fetch 只认 NO_PROXY 环境变量
    // （fetch 的 proxy:"" 单独用无效），在模块加载处统一注入，见文件头部。
    const response = await fetch(this.serviceUrl(serviceName), {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });

    // 拦截并更新响应中的 Set-Cookie，保存金蝶 Session ID
    const setCookies = response.headers.getSetCookie?.() ?? [];
    for (const sc of setCookies) {
      const cookiePart = sc.split(";")[0];
      if (!this.cookies.includes(cookiePart)) {
        this.cookies.push(cookiePart);
      }
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * 登录验证接口（采用并行 TCP 探测，秒级容灾切换）
   */
  async login() {
    const candidates = [this.intranetUrl, this.baseUrl];
    // 并行发送网络探测请求，避免因单个地址超时导致耗时等待
    const probes = candidates.map(url => probeUrl(url, 1500));
    const results = await Promise.all(probes);
    
    const aliveUrl = results.find(url => url !== null);
    if (!aliveUrl) {
      throw new Error("Neither intranet nor extranet is reachable.");
    }
    
    this.baseUrl = aliveUrl;
    const data = await this.post("AuthService.ValidateUser", {
      acctID: this.dbid,
      username: this.username,
      password: this.password,
      lcid: this.lcid,
    });
    
    if (data.LoginResultType === 1) {
      this.context = data.Context;
      return data;
    }
    throw new Error("Login failed: Invalid credentials or account.");
  }

  /**
   * 执行单据/基础资料列表查询
   * @param {string} formId - 业务对象表单 ID（如 'BD_STOCK', 'AP_PAYABLE'）
   * @param {string} fieldKeys - 待查询字段列（逗号分隔字符串，例如 'FID,FNumber,FName'）
   * @param {string} filterString - SQL 格式过滤条件（例如 "FNumber = 'CTK20'"）
   * @param {number} topRowCount - 获取的最大行数（分页限制）
   * @returns {Promise<any[]>} 数据行二维数组（若无结果则返回空数组）
   */
  async executeBillQuery(formId, fieldKeys, filterString = "", topRowCount = 100) {
    const data = await this.post("DynamicFormService.ExecuteBillQuery", {
      data: {
        FormId: formId,
        FieldKeys: fieldKeys,
        FilterString: filterString,
        OrderString: "",
        TopRowCount: topRowCount,
        StartRow: 0,
        Limit: topRowCount,
      },
    });
    this.raiseIfError(data);
    return Array.isArray(data) ? data : data?.Result?.Rows ?? [];
  }

  /**
   * 查看单据/基础资料的详细 JSON 数据（包含子表单明细行）
   * @param {string} formId - 表单 ID
   * @param {string|number} billId - 单据内码 FID
   * @returns {Promise<object>} 单据的完整详情结构数据
   */
  async viewBill(formId, billId) {
    const data = await this.post("DynamicFormService.View", {
      formid: formId,
      data: { Id: String(billId) },
    });
    this.raiseIfError(data);
    return data.Result.Result;
  }

  /**
   * 保存/修改单据接口
   * @param {string} formId - 表单 ID
   * @param {object} model - 单据模型数据（需符合对应单据结构）
   * @param {string[]} updateFields - 需明确更新的字段列表（为空则依据金蝶逻辑自动判断更新）
   * @param {string[]} returnFields - 保存成功后需要返回的字段列表
   * @param {boolean} deleteEntry - 是否先删除原有分录行（修改单据时常用，默认为 false）
   * @returns {Promise<object>} 保存成功的响应数据
   */
  async saveBill(formId, model, updateFields = null, returnFields = null, deleteEntry = false) {
    const data = await this.post("DynamicFormService.Save", {
      formid: formId,
      data: {
        NeedUpDateFields: updateFields || [],
        NeedReturnFields: returnFields || [],
        IsDeleteEntry: deleteEntry,
        Model: model,
      },
    });
    this.raiseIfError(data);
    return data;
  }

  /**
   * 批量提交单据
   * @param {string} formId - 表单 ID
   * @param {string|number|Array} billIds - 单据 ID 或 ID 数组
   * @returns {Promise<object>} 提交结果数据
   */
  async submitBill(formId, billIds) {
    const ids = Array.isArray(billIds) ? billIds.join(",") : String(billIds);
    const data = await this.post("DynamicFormService.Submit", {
      formid: formId,
      data: { Ids: ids },
    });
    this.raiseIfError(data);
    return data;
  }

  /**
   * 批量审核单据
   * @param {string} formId - 表单 ID
   * @param {string|number|Array} billIds - 单据 ID 或 ID 数组
   * @returns {Promise<object>} 审核结果数据
   */
  async auditBill(formId, billIds) {
    const ids = Array.isArray(billIds) ? billIds.join(",") : String(billIds);
    const data = await this.post("DynamicFormService.Audit", {
      formid: formId,
      data: { Ids: ids },
    });
    this.raiseIfError(data);
    return data;
  }

  /**
   * 批量反审核单据
   * @param {string} formId - 表单 ID
   * @param {string|number|Array} billIds - 待反审核的单据 ID 或 ID 数组
   * @returns {Promise<object>} 反审核结果数据
   */
  async unAuditBill(formId, billIds) {
    const ids = Array.isArray(billIds) ? billIds.join(",") : String(billIds);
    const data = await this.post("DynamicFormService.UnAudit", {
      formid: formId,
      data: { Ids: ids },
    });
    this.raiseIfError(data);
    return data;
  }

  /**
   * 批量删除单据
   * @param {string} formId - 表单 ID
   * @param {string|number|Array} billIds - 待删除的单据 ID 或 ID 数组
   * @returns {Promise<object>} 删除结果数据
   */
  async deleteBill(formId, billIds) {
    const ids = Array.isArray(billIds) ? billIds.join(",") : String(billIds);
    const data = await this.post("DynamicFormService.Delete", {
      formid: formId,
      data: { Ids: ids },
    });
    this.raiseIfError(data);
    return data;
  }

  /**
   * 执行单据的自定义业务操作（如结案、下达状态切换）
   * @param {string} formId - 表单 ID
   * @param {string} opNumber - 操作编码（例如 'Close', 'CancelRelease' 等）
   * @param {object} data - 额外的参数配置，常用结构如 { Ids: '...' }
   * @returns {Promise<object>} 操作成功后的返回结果
   */
  async executeOperation(formId, opNumber, data = null) {
    const payload = {
      formid: formId,
      opNumber: opNumber,
      data: data || {},
    };
    const responseData = await this.post("DynamicFormService.ExcuteOperation", payload);
    this.raiseIfError(responseData);
    return responseData;
  }

  /**
   * 禁用基础资料或单据
   * @param {string} formId - 表单 ID
   * @param {string|number|Array} billIds - 单据 ID 或 ID 数组
   * @returns {Promise<object>} 操作结果
   */
  async forbidBill(formId, billIds) {
    const ids = Array.isArray(billIds) ? billIds.join(",") : String(billIds);
    return this.executeOperation(formId, "Forbid", { Ids: ids });
  }

  /**
   * 单据下推操作（例如将订单批量下推生成出库单）
   * @param {string} sourceFormId - 源表单 ID（例如 'SAL_DeliveryNotice'）
   * @param {string} targetFormId - 目标表单 ID（例如 'SAL_OUTSTOCK'）
   * @param {string|number|Array} billIds - 源单据 ID 列表
   * @param {object} options - 其它可选下推选项，如 { RuleId: '...', IsDraftWhenSaveFail: 'true' }
   * @returns {Promise<object>} 下推结果响应数据
   */
  async pushBill(sourceFormId, targetFormId, billIds, options = {}) {
    const ids = Array.isArray(billIds) ? billIds.join(",") : String(billIds);
    const pushData = {
      Ids: ids,
      TargetFormId: targetFormId,
      ...options,
    };
    const payload = {
      formid: sourceFormId,
      data: pushData,
    };
    const responseData = await this.post("DynamicFormService.Push", payload);
    this.raiseIfError(responseData);
    return responseData;
  }

  /**
   * 获取表单的完整元数据配置信息（字段、模型定义及验证条件等）
   * @param {string} formId - 表单 ID
   * @returns {Promise<object>} 元数据详情
   */
  async getFormMetadata(formId) {
    const data = await this.post("DynamicFormService.GetFormMetaData", {
      data: { FormId: formId },
    });
    this.raiseIfError(data);
    return data;
  }

  /**
   * 拦截并解析金蝶 API 返回结果中的错误状态
   * @param {object} data - API 响应原始数据
   * @throws {Error} 如果金蝶业务校验失败，抛出错误提示信息
   */
  raiseIfError(data) {
    let current = data;
    while (Array.isArray(current) && current.length) {
      current = current[0];
    }
    if (!current || typeof current !== "object") return;
    const rs = current.Result?.ResponseStatus;
    if (!rs || rs.IsSuccess) return;
    const msgs = (rs.Errors ?? []).map((e) => e.Message).filter(Boolean);
    throw new Error(msgs.join("; ") || "K3Cloud WebAPI returned an error.");
  }
}
