/**
 * 常用表单 ID（完整列表见 .agents/skills/kingdee-k3cloud/references/system/k3cloud-form-ids.md）
 * 新脚本优先用常量，避免手写拼写错误。
 */
export const FORMS = {
  // 基础资料
  MATERIAL: "BD_MATERIAL",
  CUSTOMER: "BD_Customer",
  STOCK: "BD_STOCK",
  SUPPLIER: "BD_Supplier",
  EMPLOYEE: "BD_Empinfo",

  // 采购 / 应付
  PUR_REQUISITION: "PUR_Requisition",
  PUR_RECEIVE: "PUR_ReceiveBill",
  STK_INSTOCK: "STK_InStock",
  AP_PAYABLE: "AP_PAYABLE",

  // 生产
  PRD_MO: "PRD_MO",
  PRD_PPBOM: "PRD_PPBOM",
  PRD_INSTOCK: "PRD_INSTOCK",
  PRD_PICK: "PRD_PickMtrl",

  // 工序
  SFC_PLAN: "SFC_OperationPlanning",
  SFC_REPORT: "SFC_OperationReport",
  SFC_BALANCE: "SFC_OPERPROCBALANCE",
  SFC_TRANSFER: "SFC_OPERATIONTRANSFER",

  // 销售 / 库存
  SAL_OUTSTOCK: "SAL_OUTSTOCK",
  STK_MISC: "STK_MISCELLANEOUS",
  STK_TRANSFER: "STK_TRANSFERDIRECT",
};
