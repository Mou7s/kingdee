#!/usr/bin/env bun
/**
 * 按客户内码顺序，将正常客户统一改为 CTK + 6 位流水号。
 *
 * 默认只生成预览；读取预览文件并加 --apply 才执行写入。
 * 不使用 SQL 写入，实际修改走 BD_CUSTOMER 的标准 Save。
 *
 * 预览：
 *   bun scripts/tools/renumber_customers.js
 * 执行：
 *   bun scripts/tools/renumber_customers.js --apply
 */
import fs from "node:fs";
import path from "node:path";
import { K3CloudWebAPI } from "../../lib/k3/index.js";

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes("--apply");
const RESUME = ARGS.includes("--resume");
const SKIP_IDS = new Set();
for (let index = 0; index < ARGS.length; index += 1) {
  if (ARGS[index] === "--skip-id" && ARGS[index + 1]) SKIP_IDS.add(String(ARGS[index + 1]));
  if (ARGS[index].startsWith("--skip-id=")) SKIP_IDS.add(ARGS[index].slice("--skip-id=".length));
  if (ARGS[index] === "--skip-file" && ARGS[index + 1]) {
    const skipFile = path.resolve(ARGS[index + 1]);
    for (const id of fs.readFileSync(skipFile, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
      SKIP_IDS.add(id);
    }
  }
}
const OUTPUT = path.resolve("output/customer_code_renumber_preview.json");
const FORM_ID = "BD_CUSTOMER";
const PREFIX = "CTK";
const TARGET_STATUS = { documentStatus: "C", forbidStatus: "A" };

function toCustomer(row) {
  return {
    id: String(row[0]),
    oldNumber: String(row[1] ?? ""),
    name: String(row[2] ?? "").trim(),
    documentStatus: String(row[3] ?? ""),
    forbidStatus: String(row[4] ?? ""),
    createOrgNumber: String(row[5] ?? ""),
    useOrgNumber: String(row[6] ?? ""),
  };
}

function targetNumber(seq) {
  return `${PREFIX}${String(seq).padStart(6, "0")}`;
}

function assertUnique(values, label) {
  const seen = new Set();
  const duplicates = [];
  for (const value of values) {
    if (seen.has(value)) duplicates.push(value);
    seen.add(value);
  }
  if (duplicates.length) {
    throw new Error(`${label}重复: ${[...new Set(duplicates)].join(", ")}`);
  }
}

async function fetchCustomers(api) {
  const rows = await api.executeBillQuery(
    FORM_ID,
    "FCUSTID,FNumber,FName,FDocumentStatus,FForbidStatus,FCreateOrgId.FNumber,FUseOrgId.FNumber",
    "",
    10000,
  );
  return rows.map(toCustomer);
}

function buildMapping(customers) {
  const active = customers
    .filter((c) =>
      c.documentStatus === TARGET_STATUS.documentStatus &&
      c.forbidStatus === TARGET_STATUS.forbidStatus,
    )
    .sort((a, b) => Number(a.id) - Number(b.id));
  const excluded = customers.filter((c) => !active.includes(c));

  assertUnique(customers.map((c) => c.oldNumber), "当前客户编码");
  assertUnique(active.map((c) => c.id), "待处理客户内码");

  const targetNumbers = active.map((_, index) => targetNumber(index + 1));
  assertUnique(targetNumbers, "目标客户编码");

  const activeIds = new Set(active.map((c) => c.id));
  const excludedNumberConflicts = excluded.filter((c) => targetNumbers.includes(c.oldNumber));
  if (excludedNumberConflicts.length) {
    throw new Error(
      `异常/禁用客户占用了目标编码，不能直接迁移: ${excludedNumberConflicts
        .map((c) => `${c.oldNumber}(${c.name})`)
        .join(", ")}`,
    );
  }

  const usedNumbers = new Set(customers.map((c) => c.oldNumber));
  const temporaryNumbers = [];
  let candidate = 900001;
  while (temporaryNumbers.length < active.length && candidate <= 999999) {
    const number = targetNumber(candidate);
    if (!usedNumbers.has(number) && !targetNumbers.includes(number)) {
      temporaryNumbers.push(number);
    }
    candidate += 1;
  }
  if (temporaryNumbers.length !== active.length) {
    throw new Error("无法为两阶段改码找到足够的临时 CTK 编码");
  }

  const mapping = active.map((customer, index) => ({
    id: customer.id,
    oldNumber: customer.oldNumber,
    newNumber: targetNumbers[index],
    temporaryNumber: temporaryNumbers[index],
    name: customer.name,
    documentStatus: customer.documentStatus,
    forbidStatus: customer.forbidStatus,
    createOrgNumber: customer.createOrgNumber,
    useOrgNumber: customer.useOrgNumber,
  }));

  return {
    generatedAt: new Date().toISOString(),
    formId: FORM_ID,
    rule: "CTK + 6位流水号",
    ordering: "按客户内码升序",
    includedStatus: TARGET_STATUS,
    totalCustomers: customers.length,
    includedCount: mapping.length,
    excludedCount: excluded.length,
    excluded,
    mapping,
  };
}

function printPreview(preview) {
  const changed = preview.mapping.filter((x) => x.oldNumber !== x.newNumber);
  const unchanged = preview.mapping.length - changed.length;
  console.log(`客户总数: ${preview.totalCustomers}`);
  console.log(`本次处理: ${preview.includedCount}`);
  console.log(`暂不处理: ${preview.excludedCount}`);
  console.log(`需要改码: ${changed.length}`);
  console.log(`已符合最终编号: ${unchanged}`);
  console.log(`预览文件: ${OUTPUT}`);
  console.log("\n前10条:");
  for (const row of preview.mapping.slice(0, 10)) {
    console.log(`${row.id}\t${row.oldNumber}\t${row.newNumber}\t${row.name}`);
  }
  console.log("\n后10条:");
  for (const row of preview.mapping.slice(-10)) {
    console.log(`${row.id}\t${row.oldNumber}\t${row.newNumber}\t${row.name}`);
  }
  if (preview.excluded.length) {
    console.log("\n暂不处理的客户状态:");
    for (const row of preview.excluded) {
      console.log(`${row.id}\t${row.oldNumber}\tdoc=${row.documentStatus}\tforbid=${row.forbidStatus}\t${row.name}`);
    }
  }
}

async function loadOrCreatePreview(api) {
  if (APPLY) {
    if (!fs.existsSync(OUTPUT)) {
      throw new Error(`找不到预览文件: ${OUTPUT}，请先运行不带 --apply 的命令`);
    }
    const preview = JSON.parse(fs.readFileSync(OUTPUT, "utf8"));
    if (preview.rule !== "CTK + 6位流水号") {
      throw new Error("预览文件不是当前的 CTK + 6位流水号规则，请先重新生成预览");
    }
    return preview;
  }
  const customers = await fetchCustomers(api);
  const preview = buildMapping(customers);
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(preview, null, 2) + "\n", "utf8");
  return preview;
}

function indexById(customers) {
  return new Map(customers.map((c) => [c.id, c]));
}

function refNumber(ref) {
  return ref?.Number ?? ref?.FNumber ?? "";
}

function textValue(value) {
  if (Array.isArray(value)) {
    return value.find((item) => item.Key === 2052)?.Value ?? value[0]?.Value ?? " ";
  }
  return String(value ?? " ");
}

function buildCustomerModel(detail, newNumber) {
  const requiredRefs = {
    FCreateOrgId: detail.CreateOrgId,
    FUseOrgId: detail.UseOrgId,
    FGroup: detail.FGroup,
    FSALDEPTID: detail.SALDEPTID,
    FSALGROUPID: detail.SALGROUPID,
    FSELLER: detail.SELLER,
    FRECCONDITIONID: detail.RECCONDITIONID,
    FSETTLETYPEID: detail.SETTLETYPEID,
  };
  const missing = Object.entries(requiredRefs)
    .filter(([, ref]) => !refNumber(ref))
    .map(([key]) => key);
  if (!textValue(detail.Name).trim()) missing.push("FName");
  if (!textValue(detail.ShortName).trim()) missing.push("FShortName");
  if (missing.length) {
    throw new Error(`客户 ${detail.Id} 保存模型缺少必填值: ${missing.join(", ")}`);
  }

  const model = {
    FCUSTID: detail.Id,
    FNumber: newNumber,
    FName: textValue(detail.Name),
    FShortName: textValue(detail.ShortName),
    FCreateOrgId: { FNumber: refNumber(detail.CreateOrgId) },
    FUseOrgId: { FNumber: refNumber(detail.UseOrgId) },
    FGroup: { FNumber: refNumber(detail.FGroup) },
    FSALDEPTID: { FNumber: refNumber(detail.SALDEPTID) },
    FSALGROUPID: { FNumber: refNumber(detail.SALGROUPID) },
    FSELLER: { FNumber: refNumber(detail.SELLER) },
    FRECCONDITIONID: { FNumber: refNumber(detail.RECCONDITIONID) },
    FSETTLETYPEID: { FNumber: refNumber(detail.SETTLETYPEID) },
  };

  for (const [key, ref] of [
    ["FTRADINGCURRID", detail.TRADINGCURRID],
    ["FTaxRate", detail.TaxRate],
    ["FTaxType", detail.TaxType],
    ["FCustTypeId", detail.CustTypeId],
  ]) {
    const number = refNumber(ref);
    if (number) model[key] = { FNumber: number };
  }
  return model;
}

async function changeNumber(api, row, newNumber) {
  const before = await api.viewBill(FORM_ID, row.id);
  if (String(before.Number) !== row.oldNumber && String(before.Number) !== row.temporaryNumber) {
    throw new Error(`${row.id}: 当前编码 ${before.Number} 与预览不一致，停止`);
  }
  if (String(before.Number) === newNumber && before.DocumentStatus === "C") return;

  await api.unAuditBill(FORM_ID, row.id);
  const editable = await api.viewBill(FORM_ID, row.id);
  const model = buildCustomerModel(editable, newNumber);
  await api.saveBill(FORM_ID, model, [], ["FCUSTID", "FNumber", "FName", "FDocumentStatus", "FForbidStatus"]);

  const afterSave = await api.viewBill(FORM_ID, row.id);
  if (String(afterSave.Number) !== newNumber) {
    throw new Error(`${row.id}: Save 后编码不是 ${newNumber}，实际为 ${afterSave.Number}`);
  }
  await api.submitBill(FORM_ID, row.id);
  await api.auditBill(FORM_ID, row.id);
  const afterAudit = await api.viewBill(FORM_ID, row.id);
  if (
    String(afterAudit.Id) !== String(row.id) ||
    String(afterAudit.Number) !== newNumber ||
    afterAudit.DocumentStatus !== "C" ||
    afterAudit.ForbidStatus !== "A"
  ) {
    throw new Error(`${row.id}: 审核后回查不符合预期`);
  }
  console.log(`已完成 ${row.id}: ${row.oldNumber} -> ${newNumber}`);
}

async function assertResumeSnapshot(api, preview, skipIds) {
  const customers = await fetchCustomers(api);
  const currentById = indexById(customers);
  const currentByNumber = new Map(customers.map((customer) => [customer.oldNumber, customer]));
  const rowById = indexById(preview.mapping);
  const errors = [];
  for (const row of preview.mapping) {
    const current = currentById.get(row.id);
    if (!current) {
      errors.push(`${row.id}: 客户不存在`);
      continue;
    }
    if (skipIds.has(row.id)) {
      if (current.oldNumber !== row.oldNumber) {
        errors.push(`${row.id}: 跳过客户编码已变化，预览=${row.oldNumber} 当前=${current.oldNumber}`);
      }
      continue;
    }
    const isFinal = current.oldNumber === row.newNumber &&
      current.documentStatus === TARGET_STATUS.documentStatus &&
      current.forbidStatus === TARGET_STATUS.forbidStatus;
    const isOld = current.oldNumber === row.oldNumber;
    const isTemporary = current.oldNumber === row.temporaryNumber;
    if (!isFinal && !isOld && !isTemporary) {
      errors.push(`${row.id}: 当前编码 ${current.oldNumber} 不在原码/目标码/临时代码范围内`);
    }
    if (!isFinal && current.documentStatus !== TARGET_STATUS.documentStatus) {
      errors.push(`${row.id}: 当前状态已变化 doc=${current.documentStatus}`);
    }
  }
  if (errors.length) {
    throw new Error(`当前数据与预览或断点状态不一致，停止执行:\n${errors.slice(0, 20).join("\n")}`);
  }

  const pending = preview.mapping.filter((row) => {
    if (skipIds.has(row.id)) return false;
    const current = currentById.get(row.id);
    return current.oldNumber !== row.newNumber ||
      current.documentStatus !== TARGET_STATUS.documentStatus ||
      current.forbidStatus !== TARGET_STATUS.forbidStatus;
  });
  const conflicts = [];
  for (const target of pending) {
    const owner = currentByNumber.get(target.newNumber);
    if (!owner || owner.id === target.id) continue;
    const ownerRow = rowById.get(owner.id);
    if (!ownerRow || skipIds.has(owner.id)) {
      conflicts.push(`${target.newNumber}(${owner.id})`);
    }
  }
  if (conflicts.length) {
    throw new Error(`目标编码被批次外或跳过客户占用: ${conflicts.join(", ")}`);
  }
  return { currentById, currentByNumber };
}

async function applyMapping(api, preview, skipIds) {
  const state = await assertResumeSnapshot(api, preview, skipIds);
  const changed = preview.mapping.filter((row) => row.oldNumber !== row.newNumber && !skipIds.has(row.id));
  const pending = changed.filter((row) => {
    const current = state.currentById.get(row.id);
    return current.oldNumber !== row.newNumber ||
      current.documentStatus !== TARGET_STATUS.documentStatus ||
      current.forbidStatus !== TARGET_STATUS.forbidStatus;
  });
  const rowById = indexById(preview.mapping);
  const occupiedOwners = [];
  const seenOwnerIds = new Set();
  for (const target of pending) {
    const owner = state.currentByNumber.get(target.newNumber);
    const ownerRow = owner ? rowById.get(owner.id) : null;
    if (ownerRow && ownerRow.id !== target.id && !skipIds.has(ownerRow.id) && !seenOwnerIds.has(ownerRow.id)) {
      occupiedOwners.push(ownerRow);
      seenOwnerIds.add(ownerRow.id);
    }
  }
  console.log(`断点续跑：剩余 ${pending.length} 条客户；需先释放 ${occupiedOwners.length} 个目标编码。`);

  // 把实际占用目标编码的客户先移到临时代码，避免冲突。
  for (const row of occupiedOwners) {
    console.log(`释放目标编码 ${row.id}: ${row.oldNumber} -> ${row.temporaryNumber}`);
    await changeNumber(api, row, row.temporaryNumber);
  }

  // 写入最终编码。
  for (const row of pending) {
    await changeNumber(api, row, row.newNumber);
  }
}

const api = new K3CloudWebAPI();
await api.login();
const preview = await loadOrCreatePreview(api);

if (!APPLY) {
  printPreview(preview);
  console.log("\ndry-run 完成：未修改金蝶数据。确认预览无误后，再加 --apply 执行。");
  process.exit(0);
}

if (!RESUME) {
  console.log("提示：正式执行断点任务请加 --resume，并用 --skip-id 指定明确跳过的客户。\n");
}
await applyMapping(api, preview, SKIP_IDS);
console.log("改码请求已全部返回成功。请继续执行独立回查。\n");
