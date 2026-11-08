/**
 * 金蝶 K3 统一入口（新脚本优先从此导入）
 *
 * @example
 * import { K3CloudWebAPI, FORMS, DOC_STATUS_SHORT, escapeK3 } from "../../lib/k3/index.js";
 */

export {
  K3CloudWebAPI,
  K3_DB_HOST,
  K3_DB_USER,
  K3_DB_PASS,
  K3_DB_NAME,
  K3_SQLCMD_HOST,
  K3_FS_DB,
  AP_PAYABLE_FORM_ID,
  assertApPayableWriteAllowed,
} from "../../k3cloud.js";

export {
  escapeK3,
  responseRows,
  chunks,
  decimal6,
  money,
  unitPrice,
} from "../../k3_utils.js";

export {
  DOC_STATUS,
  DOC_STATUS_SHORT,
  OPER_STATUS,
  statusLabel,
} from "./status.js";

export { FORMS } from "./forms.js";
