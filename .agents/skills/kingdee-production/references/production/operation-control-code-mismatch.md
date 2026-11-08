# 工序计划汇报控制码与工艺路线不一致（MO260710048 / RT000040）

## 背景
- 用户反馈：`MO260710048` 的 14 张 `TX087471-484` “很多工序是免汇报的，在工序计划里面是全部都要汇报，和工艺路线对不上”。14 行拆分、TX 号、K 数拆分（13.8+13×19.2=263.4K）本身**正常**，问题仅在汇报控制码。
- 120/130 是否存在：`viewBill` 的 `Entity[0].SubEntity` 有 13 行（含 120/130），之前直接查 `T_SFC_OPERPLANNINGDETAIL` 只得到 11 行是误查旧表。

## 真实数据（2026-09-01 实测）
- **工艺路线** `RT000040` FID 786203 → `T_ENG_ROUTEOPERSEQ` FENTRYID 100058 → `T_ENG_ROUTEOPERDETAIL` 13 步：
  - 10:111586(免检+汇报) | 20:226304(不用汇报) | 30:226304 | 40:111586 | 50:111586 | 60:226304 | 70:226304 | 80:111610(免检+委外) | 90:226304 | 100:111586 | 110:111586 | 120:111586 | 130:111586
- **工序计划** `TX087471` FID 240707 `viewBill` SubEntity 13 步：
  - 10:111586 | 20:111586✗ | 30:111586✗ | 40:111586 | 50:111586 | 60:111586✗ | 70:226304 | 80:111610 | 90:111586✗ | 100:111586 | 110:111586 | 120:111586 | 130:111586
- **对照**：20/30 应为 226304 写成 111586，60 应为 226304 写成 111586，90 应为 226304 写成 111586；其余对齐。对照标杆 `MO260710047/TX075329` 截图前端列表显示“银胶固化/PLASMA/固化/回流焊/二次固化 不用”即对应 226304，但其 `viewBill` 底层也全是 111586，说明列表视图的“不用”是另一视图渲染，单据本体已在 2026-08-20 恢复时写死。

## 控制码字典
- `T_ENG_OPTCTRLCODE` FREPORTMODE：`10`=要汇报，`40`=不用汇报。
  - 111586 OCC000001 免检+汇报 (10)
  - 111610 OCC000002 免检+委外 (40, 工艺中仅 80 用)
  - 226304 不用汇报 (40)
- `FOPTCTRLCODEID` 需与 `T_ENG_ROUTEOPERDETAIL.FOPTCTRLCODEID` 逐工序号一一对应，不能全量默认 111586。

## 诊断路径（可靠）
1. 以 `T_PRD_MOENTRY.FROUTINGID` 取路线 FID → `T_ENG_ROUTEOPERSEQ.FENTRYID` → `T_ENG_ROUTEOPERDETAIL` 得标准 13 行。
2. 以 `K3CloudWebAPI.viewBill("SFC_OperationPlanning", fid).Entity[0].SubEntity` 得实际 13 行，取 `OperNumber` + `OptCtrlCodeID_Id` + `OptCtrlCodeID.Number`。
3. 按 `OperNumber` 逐行对比，标记 20/30/60/90 差异。不要用 `T_SFC_OPERPLANNINGDETAIL`（仅 11 行、旧结构）作为主表。
4. `executeBillQuery` 查工序计划时 `TopRowCount` 至少 20，否则 `TX087471-484` 14 张会被截成 10 张。

## 修复边界
- 仅改 `SubEntity.FOPTCTRLCODEID`，不改 MO 拆分、K 数、120/130 存在性。
- 14 张 × 5 个错位 = 70 行，`NeedUpdateFields` 限定字段，dry-run 显影响行数，事务内 `Save`，改后 `viewBill` 回查并让用户前端复核。

## WebAPI 限制（2026-09-01 实测 TX087471 + 2026-09-02 补测 TX087472）
- `unAuditBill` 可从 `C→D`，但 `Save` 改 `SubEntity.OptCtrlCodeId` 不落地：2026-09-01 在 `TX087471` 上尝试 `NeedUpdateFields=[]/["Entity"]/["FOptCtrlCodeId"]/["FEntity"]/["SubEntity"]`、`OptCtrlCodeId/FOptCtrlCodeId` 双键名、仅 Id vs 完整 SubEntity 复制、`IsDeleteEntry=false/true` 共 10 余组合，均返回 `ResponseStatus.IsSuccess:true` 但回查 `OptCtrlCodeId_Id` 仍为原值 111586。2026-09-02 在无汇报的 `TX087472` 上先 `unAudit C→D` → `UndoToPlan 4→1` 成功，再试三种 `Save`（`FOptCtrlCodeId FNumber` / `OptCtrlCodeId_Id` / 完整 Entity 复制）仍 `IsSuccess:true` 但 5 个目标工序（20/30/60/70/90）回查仍为 111586，证明即使 `OperStatus=1` 也改不动。
- `executeOperation("UndoToPlan")` 分两层阻塞：
  1. 未反审核时 13 个工序均报 `不能从开工反执行至计划,请先反审核工序计划`（`TX087471/472` 实测）；
  2. 已反审核后若存在 `T_SFC_OPTRPTENTRY`（`TX087471` 的 OP10/20 各 1 条，`TX087480/481/483/484` 各 2 条，`TX087482` 1 条，合计 11 条）则报 `已经汇报，不允许反开工`（`TX087471` 反审后 `UndoToPlan` 报 `工序[10][20]已经汇报`）。8 张干净计划（`TX087472-479` 除 `480-482`）可 `unAudit→UndoToPlan 4→1→Submit→Audit` 回到 `C/4`（实测 `TX087472`），但控制码仍需 SQL。
- `deleteBill` 同样被“不允许删除已经下推的数据行; 工序状态不能存在下达、开工、完工、关闭状态”阻塞。
- 结论：已汇报的工序计划不能用 WebAPI 原地改控制码；干净计划即使反开工也改不动。需走 SQL dry-run 校正 `T_SFC_OPERPLANNINGDETAIL.FOPTCTRLCODEID`（70 行，`FDETAILID` 为主键，`T_SFC_OPERPLANNINGDETAIL` 才是真实存储，`T_SFC_OPERPLANNINGDETAIL_B/C` 为空），`Submit→Audit` 后 `OperStatus` 自动回到 4；有汇报的 5 条 OP20 汇报与“改后不用汇报”冲突，需先决定是否删除该 5 条汇报再改。

## 2026-09-03 续：单工序反执行与 Save 仍不落地（TX087471 试点）
- 用户纠正：不需要整单反开工，只要反 `20/30/60/70/90` 五个要改的工序。实测 `TX087471` 的该 5 个 `FDETAILID(1649689/90/93/94/96)` 在批量 `unAudit` 后已处 `FOPERSTATUS=1`，对其执行 `executeOperation("SFC_OperationPlanning","UndoToPlan",{PkEntryIds:[{Id:fid, EntryIds:单ID}]})` 逐个报 `不能从计划反执行至计划`（已是 1），证明已到位；对 `TX087480` 该 5 个处于 `3` 的，逐个单工序 `UndoToPlan` 均 `IsSuccess:true` 并回到 `1`，从而绕过整单反开工被 `40/50 已领料` + `10 已汇报` 阻塞的问题。
- 在 5 工序均为 `1` 后，用 `saveBill` 改 `FOPTCTRLCODEID` 仍不落地：以 `TX087471` 试点构造 `FEntity.FSubEntity` 三种模型（`FOptCtrlCodeId FNumber="不用汇报"` / `OptCtrlCodeId_Id` / 完整 Entity 复制）均 `IsSuccess:true` 但 `viewBill` 回查 `20/30/60/70/90` 仍 `111586`，与 `TX087472` 全量反开工后的结论一致。结论：即使单工序反到 `1`，WebAPI 也改不动控制码，必须走 `T_SFC_OPERPLANNINGDETAIL.FOPTCTRLCODEID` 的事务 SQL。

## 2026-09-03 实测补充（用户分步指令）
- 用户明确分步：先 `unAuditBill` 全部 14 张（`TX087471-484`）→ 再定 `UndoToPlan`。实测批量 `unAuditBill` 14 张一次性 `IsSuccess:true`（`SuccessEntitys` 14 条），DB `FDOCUMENTSTATUS` 全 `D`，`FOPERSTATUS` 仍 `4` 为主（`TX087480-483` 首工序 `5`、`TX087484-30` 为 `3`），未到 `1`，证明 `unAudit` 不自动反开工。
- 要改的 `20/30/60/70/90` 中仅 `20 银胶固化` 有 5 条 `C` 汇报（`GXHB529815/528823/529095/528840`，`TX087480/481` 共用 `663705`），其余 30/60/70/90 均 0 条。用户已手工删除该 5 条 20 汇报，复查 `WHERE FOPERNUMBER IN (20,30,60,70,90)` 为 0 行，剩余 6 条汇报仅在 `10 固晶部`（不影响要改的 5 工序）。
- `UndoToPlan` 仍需 `C→D` 后才能执行：未反审核时 13 工序均报 `请先反审核`；已反审核后有汇报的 `TX087471` 报 `已经汇报，不允许反开工`（`OP10/20`）。5 条 20 汇报删除后，理论上 14 张均可 `UndoToPlan 4→1`（干净 8 张已在 2026-09-02 验证成功）。
- 交互偏好：用户要求工序计划类操作按截图/前端一次只给一步，助手等结果再给下一步，不要一次性推全流程。
