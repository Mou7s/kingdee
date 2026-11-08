#!/usr/bin/env bun
/**
 * 通用单据搜索：在多个表单中按单据号/MO 号模糊查询
 *
 * Usage:
 *   bun scripts/tools/search_bill.js <关键词>
 *   bun run search-bill -- MO260428041
 */
import {
  K3CloudWebAPI,
  DOC_STATUS_SHORT,
  statusLabel,
  escapeK3,
} from "../../lib/k3/index.js";

const keyword = process.argv[2];
if (!keyword) {
  console.log("用法: bun scripts/tools/search_bill.js <关键词>");
  console.log("示例: bun scripts/tools/search_bill.js MO260428041");
  process.exit(1);
}

const forms = {
  PUR_ReceiveBill: {
    name: "采购收料单",
    fields: "FID,FBillNo,FDocumentStatus,FDate",
    searchField: "FBillNo",
  },
  PUR_PurchaseOrder: {
    name: "采购订单",
    fields: "FID,FBillNo,FDocumentStatus",
    searchField: "FBillNo",
  },
  PUR_MRB: {
    name: "采购退料单",
    fields: "FID,FBillNo,FDocumentStatus",
    searchField: "FBillNo",
  },
  STK_InStock: {
    name: "采购入库单",
    fields: "FID,FBillNo,FDocumentStatus,FDate",
    searchField: "FBillNo",
  },
  AP_PAYABLE: {
    name: "应付单",
    fields: "FID,FBillNo,FDocumentStatus,FDate",
    searchField: "FBillNo",
  },
  AP_Match: {
    name: "应付核销单",
    fields: "FID,FBillNo,FDocumentStatus",
    searchField: "FBillNo",
  },
  AR_Match: {
    name: "应收核销单",
    fields: "FID,FBillNo,FDocumentStatus",
    searchField: "FBillNo",
  },
  PRD_MO: {
    name: "生产订单",
    fields: "FID,FBillNo,FDocumentStatus,FDate",
    searchField: "FBillNo",
  },
  PRD_MOChange: {
    name: "生产订单变更单",
    fields: "FID,FBillNo,FDocumentStatus",
    searchField: "FBillNo",
  },
  PRD_PPBOM: {
    name: "生产用料清单",
    fields: "FID,FBillNo,FDocumentStatus",
    searchField: "FBillNo",
  },
  PRD_INSTOCK: {
    name: "生产入库单",
    fields: "FID,FBillNo,FDocumentStatus,FDate",
    searchField: "FBillNo",
  },
  PRD_PickMtrl: {
    name: "生产领料单",
    fields: "FID,FBillNo,FDocumentStatus,FDate",
    searchField: "FBillNo",
  },
  PRD_RetStock: {
    name: "生产退料单",
    fields: "FID,FBillNo,FDocumentStatus",
    searchField: "FBillNo",
  },
  SAL_SaleOrder: {
    name: "销售订单",
    fields: "FID,FBillNo,FDocumentStatus",
    searchField: "FBillNo",
  },
  SAL_OUTSTOCK: {
    name: "销售出库单",
    fields: "FID,FBillNo,FDocumentStatus,FDate",
    searchField: "FBillNo",
  },
  SFC_OperationPlanning: {
    name: "工序计划",
    fields: "FID,FBillNo,FDocumentStatus",
    searchField: "FMONumber",
  },
  SFC_OperationReport: {
    name: "工序汇报",
    fields: "FID,FBillNo,FDocumentStatus",
    searchField: "FBillNo",
  },
  SFC_OPERPROCBALANCE: {
    name: "工序结算单",
    fields: "FID,FBillNo,FDocumentStatus",
    searchField: "FBillNo",
  },
  SFC_OPERATIONTRANSFER: {
    name: "工序转移单",
    fields: "FID,FBillNo,FDocumentStatus",
    searchField: "FBillNo",
  },
  SFC_OperOutGroupReceive: {
    name: "工序委外集中接收",
    fields: "FID,FBillNo,FDocumentStatus,FDate",
    searchField: "FBillNo",
  },
  SFC_OperOutGroupSend: {
    name: "工序委外集中发出",
    fields: "FID,FBillNo,FDocumentStatus,FDate",
    searchField: "FBillNo",
  },
  SFC_OperationRejects: {
    name: "工序异常/不良单",
    fields: "FID,FBillNo,FDocumentStatus",
    searchField: "FBillNo",
  },
  SUB_PPBOM: {
    name: "委外用料清单",
    fields: "FID,FBillNo,FDocumentStatus",
    searchField: "FBillNo",
  },
  SUB_ReqChange: {
    name: "委外申请变更单",
    fields: "FID,FBillNo,FDocumentStatus",
    searchField: "FBillNo",
  },
  SUB_SUBREQORDER: {
    name: "委外订单",
    fields: "FID,FBillNo,FDocumentStatus",
    searchField: "FBillNo",
  },
  STK_MISCELLANEOUS: {
    name: "其他入库单",
    fields: "FID,FBillNo,FDocumentStatus,FDate",
    searchField: "FBillNo",
  },
  STK_TRANSFERDIRECT: {
    name: "直接调拨单",
    fields: "FID,FBillNo,FDocumentStatus,FDate",
    searchField: "FBillNo",
  },
};

const api = new K3CloudWebAPI();
await api.login();
console.log("登录成功\n");

const safe = escapeK3(keyword);
let foundCount = 0;

for (const [formId, { name: formName, fields, searchField }] of Object.entries(forms)) {
  const searchFields = [searchField];
  if (searchField !== "FBillNo") searchFields.push("FBillNo");

  for (const sf of searchFields) {
    try {
      const rows = await api.executeBillQuery(
        formId,
        fields,
        `${sf} like '%${safe}%'`,
        10
      );
      if (!rows?.length) continue;

      foundCount++;
      console.log(`\n✓ ${formName} (${formId}) - 找到 ${rows.length} 条`);
      console.log("-".repeat(60));
      for (const row of rows) {
        const billNo = row[1] || "";
        const status = statusLabel(row[2], DOC_STATUS_SHORT);
        let dateStr = "";
        const date = row[3];
        if (date && date !== "Invalid Date") {
          try {
            dateStr = new Date(date).toLocaleDateString("zh-CN");
          } catch {
            dateStr = String(date);
          }
        }
        console.log(`  FID:${row[0]}  ${billNo}  状态:${status}  ${dateStr}`);
      }
      break;
    } catch {
      // 单表失败忽略，继续其他表单
    }
  }
}

if (foundCount === 0) {
  console.log(`未找到包含 "${keyword}" 的单据`);
  process.exit(1);
}
