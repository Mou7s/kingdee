#!/usr/bin/env bun
/**
 * 反审核并删除指定版本的 BOM（ENG_BOM），包含完整下游引用安全检查与快照留痕。
 * 默认 dry-run，显式传入 --apply 才执行反审核与删除。
 *
 * Usage:
 *   bun scripts/tools/delete_bom.js <BOM版本号> [--material <父项物料编码>] [--apply]
 *   bun scripts/tools/delete_bom.js NBM0000001_V1.1 --material NBM0000001
 *   bun scripts/tools/delete_bom.js NBM0000001_V1.1 --material NBM0000001 --apply
 */

import {
  K3CloudWebAPI,
  FORMS,
  DOC_STATUS_SHORT,
  statusLabel,
  escapeK3,
} from "../../lib/k3/index.js";
import { mkdirSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2).filter((a) => a !== "--");
const apply = args.includes("--apply");

let expectedMaterial = null;
const matIdx = args.indexOf("--material");
if (matIdx !== -1 && args[matIdx + 1] && !args[matIdx + 1].startsWith("--")) {
  expectedMaterial = args[matIdx + 1];
}

const positional = args.filter((a, idx) => {
  if (a.startsWith("--")) return false;
  if (matIdx !== -1 && idx === matIdx + 1) return false;
  return true;
});

const targetFNumber = positional[0];

if (!targetFNumber) {
  console.log(
    "用法: bun scripts/tools/delete_bom.js <BOM版本号> [--material <父项物料编码>] [--apply]"
  );
  console.log("  默认 dry-run 只做安全检查与快照留痕；加 --apply 才执行反审核与删除");
  process.exit(1);
}

const slug = targetFNumber.toLowerCase().replace(/[^a-z0-9.-]+/g, "-");
const dir = `output/delete-${slug}-bom`;
mkdirSync(dir, { recursive: true });

const api = new K3CloudWebAPI();
await api.login();

const queryTarget = () =>
  api.executeBillQuery(
    "ENG_BOM",
    "FID,FNumber,FDocumentStatus,FForbidStatus,FMaterialId.FNumber,FMaterialId.FName,FMaterialId.FSpecification,FName",
    `FNumber='${escapeK3(targetFNumber)}'`,
    10
  );

const queryAllForMaterial = (matNum) =>
  api.executeBillQuery(
    "ENG_BOM",
    "FID,FNumber,FDocumentStatus,FForbidStatus,FMaterialId.FNumber,FName",
    `FMaterialId.FNumber='${escapeK3(matNum)}'`,
    50
  );

const log = {
  time: new Date().toISOString(),
  apply,
  targetFNumber,
  expectedMaterial,
  before: await queryTarget(),
};

try {
  if (log.before.length !== 1) {
    throw new Error(
      `目标 BOM 未找到或命中多条: count=${log.before.length} (${targetFNumber})`
    );
  }

  const [
    fid,
    fnumber,
    status,
    forbidStatus,
    mtrlNumber,
    mtrlName,
    mtrlSpec,
    fname,
  ] = log.before[0];

  log.expectedFId = fid;
  log.resolvedMaterial = mtrlNumber;

  if (fnumber !== targetFNumber) {
    throw new Error(`BOM 编码不匹配: 实际=${fnumber}, 预期=${targetFNumber}`);
  }
  if (expectedMaterial && mtrlNumber !== expectedMaterial) {
    throw new Error(
      `父项物料编码不匹配: 实际=${mtrlNumber}, 预期=${expectedMaterial}`
    );
  }

  log.allMaterialBomsBefore = await queryAllForMaterial(mtrlNumber);
  log.snapshot = await api.viewBill("ENG_BOM", fid);

  const treeEntries = log.snapshot?.TreeEntity ?? [];
  log.childSummary = treeEntries.map((row) => ({
    seq: row.Seq,
    childNumber: row.MATERIALIDCHILD?.Number ?? null,
    childName:
      row.MATERIALIDCHILD?.Name?.find((n) => n.Key === 2052)?.Value ??
      row.MATERIALIDCHILD?.Name?.[0]?.Value ??
      null,
    childSpec:
      row.MATERIALIDCHILD?.Specification?.find((n) => n.Key === 2052)?.Value ??
      row.MATERIALIDCHILD?.Specification?.[0]?.Value ??
      null,
    numerator: row.NUMERATOR,
    denominator: row.DENOMINATOR,
    unit: row.CHILDUNITID?.Number ?? null,
  }));

  // 检查下游单据引用
  log.moReferences = await api.executeBillQuery(
    FORMS.PRD_MO,
    "FID,FBillNo,FDocumentStatus",
    `FBomId=${fid}`,
    100
  );
  log.ppbomReferences = await api.executeBillQuery(
    FORMS.PRD_PPBOM,
    "FID,FBillNo,FDocumentStatus",
    `FBomId=${fid}`,
    100
  );
  log.subPpbomReferences = await api.executeBillQuery(
    "SUB_PPBOM",
    "FID,FBillNo,FDocumentStatus",
    `FBomId=${fid}`,
    100
  );

  if (
    log.moReferences.length > 0 ||
    log.ppbomReferences.length > 0 ||
    log.subPpbomReferences.length > 0
  ) {
    throw new Error(
      `存在下游单据引用 (PRD_MO=${log.moReferences.length}, PRD_PPBOM=${log.ppbomReferences.length}, SUB_PPBOM=${log.subPpbomReferences.length})，禁止删除！`
    );
  }

  console.log(
    `目标核对通过: BOM=${fnumber} (FID=${fid}), 状态=${statusLabel(status, DOC_STATUS_SHORT)}, 禁用=${forbidStatus}, 父项=${mtrlNumber} (${mtrlName} | ${mtrlSpec}), 简称=${fname}`
  );

  if (apply) {
    if (status === "C") {
      console.log(`正在反审核 BOM ${targetFNumber} (FID:${fid})...`);
      log.unAudit = await api.unAuditBill("ENG_BOM", [fid]);
    }

    const midState = await queryTarget();
    log.midState = midState;
    if (midState.length !== 1 || !["A", "D", "Z"].includes(midState[0][2])) {
      throw new Error(`反审核后状态异常: ${midState[0]?.[2]}`);
    }

    console.log(
      `反审核完成 (当前状态:${midState[0][2]})，正在执行删除 BOM ${targetFNumber}...`
    );
    log.deleted = await api.deleteBill("ENG_BOM", [fid]);

    log.after = await queryTarget();
    if (log.after.length !== 0) {
      throw new Error(`删除后仍能查到该 BOM: count=${log.after.length}`);
    }
    log.allMaterialBomsAfter = await queryAllForMaterial(mtrlNumber);
    log.materialStatusAfter = await api.executeBillQuery(
      FORMS.MATERIAL,
      "FMaterialId,FNumber,FName,FSpecification,FDocumentStatus,FForbidStatus",
      `FNumber='${escapeK3(mtrlNumber)}'`,
      10
    );
  }
} catch (error) {
  log.error = error.message;
}

const fileName = `${dir}/${apply ? "apply" : "dry-run"}.json`;
writeFileSync(fileName, JSON.stringify(log, null, 2));

console.log(
  JSON.stringify(
    {
      apply,
      expectedFId: log.expectedFId ?? null,
      before: log.before,
      childSummary: log.childSummary ?? [],
      allMaterialBomsBefore: log.allMaterialBomsBefore ?? [],
      moReferencesCount: log.moReferences?.length ?? 0,
      ppbomReferencesCount: log.ppbomReferences?.length ?? 0,
      subPpbomReferencesCount: log.subPpbomReferences?.length ?? 0,
      error: log.error ?? null,
      after: log.after ?? null,
      allMaterialBomsAfter: log.allMaterialBomsAfter ?? null,
      materialStatusAfter: log.materialStatusAfter ?? null,
      logFile: fileName,
    },
    null,
    2
  )
);

if (log.error) {
  process.exit(1);
}
