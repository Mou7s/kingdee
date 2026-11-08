# Database-driven K3 bill-form discovery

Use this reference when `bun run search-bill -- <bill-no>` misses a bill that is known to exist.

## Validated read-only discovery pattern

1. Inspect SQL Server metadata (`sys.tables` and `sys.columns`) for business header tables that contain `FBILLNO` and `FDOCUMENTSTATUS`.
2. Scope the first pass to relevant prefixes: `T_SFC`, `T_PUR`, `T_PRD`, `T_SUB`, `T_STK`, `T_AP`, `T_AR`, and `T_SAL`.
3. If the table has `FFORMID`, group by the row value and retain a non-zero row count plus a sample bill number. Do not infer the API FormId from the physical table name when `FFORMID` is available.
4. Validate each candidate with `executeBillQuery` and a real sample bill using `FID,FBillNo,FDocumentStatus`. Only request `FDate` after confirming that the field works for that form.
5. Add validated business forms to `scripts/tools/search_bill.js` and document them in `.agents/skills/kingdee-k3cloud/references/system/k3cloud-form-ids.md`.

The SQL step is SELECT-only. Never use metadata discovery as a reason to write SQL business data.

## Form/table mappings validated in the Tongke database

| Physical table | FormId | Sample bill | Validation result |
|---|---|---|---|
| `T_SFC_OPEROUTGR` | `SFC_OperOutGroupReceive` | `WWJS2647` | FID `102672`, status `C` |
| `T_SFC_OPEROUTGS` | `SFC_OperOutGroupSend` | `WWFC999` | FID `101061`, status `C` |
| `T_SFC_OPTREJECTS` | `SFC_OperationRejects` | `GXBLP000008` | FID `100010`, status `A` |
| `T_PRD_MOCHANGE` | `PRD_MOChange` | `MOCH000176` | FID `100189`, status `B` |
| `T_PRD_RESTOCK` | `PRD_RetStock` | `SCTK00000005` | FID `100005`, status `C` |
| `T_SUB_PPBOM` | `SUB_PPBOM` | `SUBBOM00005334` | FID `115325`, status `C` |
| `T_SUB_REQCHANGE` | `SUB_ReqChange` | `SUBCH000016` | FID `100028`, status `C` |
| `T_SUB_REQORDER` | `SUB_SUBREQORDER` | `SUB00000954` | FID `110958`, status `C` |
| `T_AP_MATCK` | `AP_Match` | `YFHXD00000696` | FID `100696`, status `C` |
| `T_AR_MATCK` | `AR_Match` | `YSHXD00005800` | FID `105801`, status `C` |
| `T_PUR_POORDER` | `PUR_PurchaseOrder` | `TK20260824039` | FID `116486`, status `C` |
| `T_PUR_MRB` | `PUR_MRB` | `CGTL000842` | FID `100867`, status `C` |
| `T_SAL_ORDER` | `SAL_SaleOrder` | `XSDD034902` | FID `145189`, status `C` |
| `T_SAL_OUTSTOCK` | `SAL_OUTSTOCK` | `XSCKD000754` | FID `100932`, status `C` |

Some forms above already existed in the registry; the table is a validation bank, not a claim that every row must be newly added.

## Exclusion rule

Not every table with bill-like columns is a business bill. `T_SFC_SCHEDULINGLOG` / `SFC_SchedulingLog` had records and a valid API query, but it is a system scheduling log, so it was intentionally excluded from ordinary bill-number search. Apply the same check to caches, configuration, analysis, and operation-log tables.

## Regression checklist

- Count the registered FormIds after edits.
- Search the original missed bill and a newly discovered counterpart.
- Run `bun run test:safety` and `git diff --check`.
- Keep the AP safety rule unchanged: `AP_PAYABLE` may be saved as draft only; never submit or audit it from the script.
