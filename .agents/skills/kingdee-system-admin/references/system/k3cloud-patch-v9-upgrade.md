# 金蝶云星空 企业版 V9.0 补丁升级执行单

## 目录

- 一、目标与现状
- 一之二、进度状态与待办（2026-09-21 更新）
- 二、补丁清单（实测：需装 5 个，不装 3 个）
- 三、开工前置条件（4 项，缺一不可）
- 四、执行步骤
- 五、执行记录
- 附录 A　基线快照（2026-09-21 只读核查）
- 附录 B　二开清单与处置预案（接手版）
- 附录 C　④ 资金台账补丁「要不要装」的实测依据（2026-09-21）

> 适用环境：示例电子有限公司 星空私有云
> 依据文档：《升级补丁步骤forV9.0-总共7个补丁.docx》（vip.kingdee.com/knowledge/829642361319334912 附件）
> 本执行单中的"实测"项均来自 2026-09-21 对生产环境的只读核查（服务器 <K3_INTRA_HOST> / <K3_ALT_HOST>，<SQL_SERVER_HOST>）

---

## 一、目标与现状

| 项 | 当前值（实测） | 升级后目标 |
| --- | --- | --- |
| 产品版本（关于/DisplayVersion） | `9.0.280.13` | `9.0.0.20250410` |
| 核心程序集 `Kingdee.BOS.dll` | 9.0.280.13，文件日期 2024-11-07 | 随补丁更新 |
| 数据中心版本 `T_BAS_DATACENTER.FVISION` | `9.0.0.20241107` | 随补丁更新 |
| 产品版别 | **企业版**（`Context.ProductEdition = 0`） | 不变 |
| 补丁历史 | **从未安装过任何补丁**（补丁记录表为空、注册历史止于 2024-11-08） | 见第五节 |

**关键结论：现有环境落后约 22 个月，2025 年 1 月至今的全部平台/业务安全补丁均未安装。**

---

## 一之二、进度状态与待办（2026-09-21 更新）

| 阶段 | 状态 |
| --- | --- |
| 版本 / 版别 / 二开面 / 补丁历史核查 | ✅ 完成（企业版、9.0.280.13、从未打过补丁；二开由 UNW 226 + ZBMY 6 个对象构成） |
| 二开接管（不依赖前任 IT） | ✅ 完成（见 `output/二开接管清单.md` / 附录 B） |
| 备份体系核查与优化 | ✅ 完成（补齐佛山 / 管理中心库 / 系统库 / 体检作业，开压缩，清理 129 GB 死备份） |
| **补丁包下载与核对** | ✅ **完成**：5 个包全部到位并解除网络锁定，大小 / SHA256 / 包内组件已核对（见第二节核对表） |
| 模块取舍（零售 / BBC / 条码 / 资金台账） | ✅ 完成：零售 / BBC / 条码**不装**；资金台账**需装**（依据见附录 C） |
| 维护窗口 | ⬜ **待定**（建议国庆停产期 10/1~10/3，整台机停一天） |
| 通知外部对接方（`<K3_EXTRA_HOST>:666`） | ⬜ **待办** |
| 窗口前基线刷新（`bun run check-patch`） | ⬜ 窗口当天开工前 30 分钟执行 |
| 星空卫士离线检测包（可选） | ⬜ 未下载；不下载则步骤 5 用「手动核对」替代（见步骤 5 说明） |
| 打补丁 + 验证 | ⬜ 按第四、五节执行 |

> **不需要再下载任何补丁包**。唯一可选件是星空卫士离线检测包（仅影响"离线复测漏洞"这一步的验证方式）。

---

## 二、补丁清单（实测：需装 5 个，不装 3 个）

| 序 | 补丁 | 实测包名 / 包版本 | 实测文件名（`C:\Users\Administrator\Downloads\`） | 本环境是否需要 |
| --- | --- | --- | --- | --- |
| ① | 标准补丁（升到 25 年 4 月） | `Kingdee_Cloud_V9.0_Patch`　**9.0.434.12** | `PT-163010\Kingdee_Cloud_V9.0_Patch.9.0.434.12.kdpkg` | **必装**，顺序起点 |
| ② | 平台整合补丁 | `TempPatch_V9_BOS_20250410`　**9.0.871.2** | `[Pub_20260903]TempPatch_V9_BOS_20250410.9.0.871.2.kdpkg` | **必装，必须在 ① 之后** |
| ③ | 业务整合补丁 | `TempPatch_V9_STD_20250410`　**9.0.884.4** | `[Pub_20260916]TempPatch_V9_STD_20250410.9.0.884.4.kdpkg` | **必装，必须在 ② 之后** |
| ④ | 资金台账补丁（支付安全加固 KD-20250919） | `FIN_Pay_V9`　**1.1.1153.8** | `FIN_Pay_V9.kdpkg` | **需装**：实测为「付款台账 / 超额支付拦截」功能包，覆盖 `CN_PAYAPPLY`（付款申请单）→ `AP_PAYBILL`（付款单）、`AP_PAYBILL` → `AP_REFUNDBILL`（付款退款单）；本环境付款链天天在用（依据见附录 C） |
| ⑤ | KDPSIRT-2026-00071（Fastjson RCE） | `RepairFastJson`（`ISV=PUB`，全版本通用）　**1.1.1143.14** | `RepairFastJson.1.1.1143.14.kdpkg` | **必装**（本环境已实测中招） |
| ✖ | KDPSIRT-2025-00102 零售 | — | — | **不装**：抽样 `CMK_LS_*` 全 0 行，业务未用零售 |
| ✖ | KDPSIRT-2025-00100 BBC | — | — | **不装**：账套内 0 张 BBC 表 |
| ✖ | KDPSIRT-2025-00119 条码 | `barcode_V9_2025_08_26_14_22_47.1.1.472.1.kdpkg.zip` | — | **不装**（2026-09-21 决定）。注：① 组合包自带 `barcode.9.0.369.1` 组件，随标准补丁走 |

> ⚠️ 补丁下载页上另有 **PT-162003（= 当前版本 9.0.280.13 的安装盘包）**、**PT-163016 / PT-163015（9.1 版本线，如 9.1.644.11）**，**本次都不要安装**；本步终点是 **9.0.0.20250410（构建号 9.0.434.12）**。

### 补丁包实测核对表（2026-09-21 服务器实测）

| 序 | 文件大小 | SHA256 | 网络锁定 | 金蝶签名 | 包内组件（来自包内 `app.manifest`） |
| --- | --- | --- | --- | --- | --- |
| ① | 1,398,402 KB | `56F4240D003E8B1B5CF422BAECCC8527785C63E73FB507384D7F0F01EA4971A8` | 已解锁 | 有（SignType=KD） | MC Patch / BOS Patch / STD Patch / File Server V9 / `barcode.9.0.369.1` / `BBCMall.9.0.432.3` / `Apache_Tomcat_Serve.9.0.2410.1` / PT-log / PackageTool |
| ② | 174,502 KB | `C70565BC166CD5A21348400A5A4C813C7AFD32EE6C3E7A6AD2B689BC5FB85B30` | 已解锁 | 签名内容为空 | K3Cloud MC Temp Patch / K3Cloud Temp Patch（平台）/ File Server TempPatch |
| ③ | 175,149 KB | `CD1AA9339F014303AEC6DF50E51DFEFDA78D95DE69C0EC719B46B4EE18F73879` | 已解锁 | 签名内容为空 | `K3Cloud Temp STDPatch.9.0.884.4` |
| ④ | 98 KB | `343A940978DCEEB8552B87573BBC9DEBD1255E905CD44EC69F3E5C34210960D5` | 已解锁 | 有 | `FIN_Pay_V9_MC` + `FIN_Pay_V9_SDT` |
| ⑤ | 4,495 KB | `F716C83FCAE526E0C776DA039667AE8BBE7A9E50CBCB9C2417EC93EE417350A7` | 已解锁 | 有 | `RepairFastJson_MC` + `RepairFastJson_SDT` |

**包身份核对方法**（`.kdpkg` 实为 CAB 包，含 `app.manifest` + `app.pkgdef`）：

```powershell
expand.exe -D "<包完整路径>"                              # 列包内容
expand.exe "<包完整路径>" -F:app.manifest "<目标目录>\"     # 抽出 manifest 看 PackageName / Version / 内含组件
```

> 注意：② ③ 的文件名含方括号，PowerShell 里必须用 `-LiteralPath`（`Test-Path`/`Get-Item` 会把 `[]` 当通配符，导致误报"文件缺失"）。

### 下载位置（备查，供下次或重建环境用）

- 补丁下载页：`https://open.kingdee.com/K3Cloud/Open/PTDownload.aspx` → 选 **企业版**
  - **① 标准补丁**：卡片「金蝶云星空 V9 · PT-163010」→ 点「下载」
  - **② ③ 整合补丁**：同一卡片 → 点「查看历史记录」→ 在历史列表找**构建号 9.0.434.12** 那张卡 → 点卡片上的 **「整合补丁」** 按钮 → 展开为 **平台下载 / 平台说明 / 业务下载 / 业务说明** → 「平台下载」= ② 、「业务下载」= ③
    （顶层卡片上**没有**「整合补丁」按钮，只在历史记录页里有——这是找不到入口的常见原因）
  - 该列表接口为 token 鉴权（`GetListPatchs.cdpgw`），**必须用已登录金蝶云账号的浏览器**操作，无法离线代下
- **④ 资金台账补丁**直链（无需登录，实测 200）：`https://pkgsfile.open.kingdee.com/FinPay/FIN_Pay_V9.kdpkg`
- **⑤ Fastjson 补丁**直链（无需登录，实测 200）：`https://k3cloudpt.kingdee.com/Package/RepairFastJson/RepairFastJson_1_1_1143_14/1_1_1143_14/Stardard/RepairFastJson.1.1.1143.14.kdpkg`
- 兜底：若在「补丁历史记录」里看不到「整合补丁」按钮，通常是账号未登录或服务期过期，直接打 **4008-836-836** 报"企业版 V9.0、构建号 9.0.434.12 的平台整合补丁 + 业务整合补丁"要直链

### 本环境受 KDPSIRT-2026-00071 影响的实测证据（按公告判定方法核查）

```
K3Cloud\RetaiKtmSite\WEB-INF\lib\fastjson-1.2.83.jar    ← 命中（1.2.X 且 X ≤ 83）
K3Cloud\QingSite\WEB-INF\lib\fastjson-1.2.83.jar        ← 命中
K3Cloud\RetaiKtmSite_JDK17\WEB-INF\lib                  ← 目录不存在，无需处理
K3Cloud\QingSite_JDK17\WEB-INF\lib                      ← 目录不存在，无需处理
```

---

## 三、开工前置条件（4 项，缺一不可）

1. **补丁下载权限**：用金蝶云账号登录补丁下载页，确认服务期内可下载；若不可下载，联系金蝶客户经理。
2. **二开确认** ⚠️ 风险面已摸清（见附录 B / `output/二开接管清单.md`）：二开由 **UNW**（226 个对象）与 **ZBMY**（6 个对象）两家完成，共 232 个扩展对象、涉及 103 张单据，但**真正含代码的只有 9 处**（6 个 Python 脚本 + `wfs.dll` 两个插件 + KDYF 报表插件）。Python 脚本源码已导出，可自行修改；仅 `wfs.dll` / `KDYF.*` 为无源码的编译程序集。**无需前任 IT 参与**：补丁后按清单逐项验证，出问题按附录 B 的处置顺序在元数据里禁用该插件（保留 DLL），业务即可先恢复。
3. **维护窗口**：应用服务与 SQL Server 部署在**同一台服务器**（<K3_INTRA_HOST> = <K3_ALT_HOST>），补丁期间整台停机。外网映射 `<K3_EXTRA_HOST>:666` 供 WebAPI 使用，可能有外部集成与定时任务在调用，需提前通知并停用。
4. **模块启用确认**（决定零售 / BBC / 条码 / 资金台账是否安装，**2026-09-21 已定**）：
   - 零售：抽样 `CMK_LS_SERIALNO`、`CMK_LS_StoreReceiptSerial`、`CMK_LS_StoreShipSerial` 均 0 行 → **不装**（KDPSIRT-2025-00102）
   - BBC：账套内 0 张 BBC 表（仅安装盘带了 `BBCMallSite` 站点目录）→ **不装**（KDPSIRT-2025-00100）
   - 条码：安装盘已装条码包（`K3_BarCode_AM 9.0.224.1`、`Patch.BarCode(供应链)`），抽样条码相关表 0 行 → **不装**（KDPSIRT-2025-00119，2026-09-21 决定）；另注 ① 组合包自带 `barcode.9.0.369.1` 组件随标准补丁走
   - 资金台账：**装**（2026-09-21 实测判定，见附录 C）——它不是"资金管理 / 银企互联"模块补丁，而是**付款台账（超额支付拦截）**功能包，覆盖 `CN_PAYAPPLY`→`AP_PAYBILL`、`AP_PAYBILL`→`AP_REFUNDBILL`；本环境的付款申请单（1414 张，最新 2026-09-21 18:27）与付款单（2842 张，最新 2026-09-12）天天在用；银企互联（`T_WB_*` 表全 0 行）与资金管理（`T_FM_*` 表不存在）实际未使用
   - 轻分析/零售站点：`RetaiKtmSite`、`QingSite` 目录存在（Fastjson 补丁必须装，不受此影响）

---

## 四、执行步骤

### 步骤 0　补丁包准备（停机前完成）

- [x] **补丁包已全部到位（2026-09-21 核对完成）**：① ② ③ ⑤ 必装包 + ④ 资金台账包 均已在 `C:\Users\Administrator\Downloads\`
- [x] **解除网络锁定**：5 个包已逐一 `Unblock-File` 解除，复查均为"已解锁"（② ③ 原本带网络锁定标记，未解锁会导致安装失败）
- [x] **记录文件名 / 大小 / SHA256**：见上文「补丁包实测核对表」；包身份已用包内 `app.manifest` 核对（PackageName / Version / 内含组件均与预期一致）
- [x] ⑥ 条码补丁 **不装**（2026-09-21 决定）；✖ 零售 / BBC **不装**

### 步骤 1　备份（硬前提，补丁无法卸载，回滚只能靠备份）

**自动备份的实测现状（2026-09-21 核查并优化后）**：

| 库 | 自动备份 | 备份位置 | 保留 |
| --- | --- | --- | --- |
| `<K3_MAIN_DB>`（东莞本账套，数据中心 001） | ✅ 每天 00:00，作业 `KD-MAIN.Subplan_1` | `D:\正式数据备份\ALL\` | 15 天（每天 03:00 清理） |
| `<K3_SUB_DB>`（分厂账套，数据中心 002） | ✅ 每天 01:00，作业 `分厂账套账套-每日完整备份` | `D:\正式数据备份\分厂账套\` | 15 天 |
| `<K3_MC_DB>` + `master`/`model`/`msdb`/`ReportServer`/`ReportServerTempDB` | ✅ 每天 02:00，作业 `管理中心库与系统库-每日完整备份`（2026-09-21 新建） | `D:\正式数据备份\系统库\` | 15 天 |
| 备份有效性巡检 | ✅ 每天 04:00，作业 `备份体检-数据库备份有效性检查`，任一库超 26 小时未备份即作业失败，明细写 `msdb.dbo.BackupHealthLog` | — | 60 天 |

> **2026-09-21 的备份体系优化（均已实测验证）**：
> 1. 打开服务器级备份压缩（`backup compression default = 1`）——此前**未压缩**（190GB 备份写出 190GB）；开启后实测管理中心库 386MB→103MB、佛山 4.53GB→0.75GB
> 2. 清理作业由**每周日**改为**每天 03:00**——此前每周只在周日清理一次，是 2026-09-20 备份因"磁盘空间不足"失败的根因
> 3. 佛山账套由 00:00 移到 01:00，避开主账套的 IO 高峰
> 4. 管理中心库与系统库重新纳入每日备份（它们自 2025-09-02 起被移出计划，近一年无备份）
> 5. 清理 `D:\正式数据备份\PART` 目录 1362 个陈旧差异备份（129.28GB，2024-10~2025-09，配套的完整备份早已过期，**不可还原**）；清单存档 `output/PART目录删除清单_20260921.txt`
>
> ⚠️ 仍存在的结构性风险：所有备份都在**同一台机、同一块 PERC H750 阵列盘**上，没有异地副本。补丁前的手动备份与异机保存**不能省**。

- [ ] **手动完整备份三个库**（补丁会改写两个账套库与管理中心库）：
  - 主账套约 190 GB（压缩后应显著变小，实测参考：管理中心库约 3.8 倍压缩比）、佛山账套约 4.5 GB、管理中心库约 0.4 GB
  - **不要放进 `D:\正式数据备份\` 目录**——每天的「自动清除超15天的备份」作业会把它删掉
- [ ] **程序目录整目录备份**：`D:\Program Files (x86)\Kingdee\K3Cloud`（至少 `WebSite`、`ManageSite`、`CommonFileServer`、`Guard`）
- [ ] **二开与许可单独留底**：附录 B 的 6 个程序集 + `WebSite\Web.config` + `ManageSite\App_Data\ISVConfigure.xml` + `ManageSite\App_Data\Lic`（43 个 `.lic`，最新 2026-08-19）
- [ ] **记录基线**（见附录 A），执行前再跑一次确认版本未变
- [ ] 备份文件**异机/异盘保存**（本机只有 C:、D: 两个盘，C 盘仅剩 44.9 GB，不适合）；每个备份做一次 `RESTORE VERIFYONLY` 抽查
- [ ] **窗口期间禁用自动备份 / 清理 / 体检作业（共 5 个，补完务必全部重新启用）**：`KD-MAIN.Subplan_1`（00:00）、`分厂账套账套-每日完整备份`（01:00）、`管理中心库与系统库-每日完整备份`（02:00）、`自动清除超15天的备份.Subplan_1`（03:00）、`备份体检-数据库备份有效性检查`（04:00）——避免在半成品状态下产生"不可用于回滚"的备份、或清理掉停机前手动做的那份备份

### 步骤 2　停机

- [ ] 通知用户下线、停用外部接口调用与定时任务
- [ ] 停止 K3Cloud 服务（均为"自动/正在运行"）：

  ```
  K3CloudManager
  K3CloudJobProcess
  K3CloudMQService
  K3CloudTomcat
  K3CloudGuardService
  K3CloudClienter
  ```

- [ ] 停止 IIS（W3SVC）；确认 80 / 1550 / 8000 / 8600 端口无连接
- [ ] 确认 SQL Server 无业务连接（可保留服务本身运行，供安装器升级数据库）

### 步骤 3　按序安装补丁

- [ ] **① 标准补丁**：`PT-163010\Kingdee_Cloud_V9.0_Patch.9.0.434.12.kdpkg`（到 25 年 4 月版本；组合包含 MC / BOS / STD / 文件服务 / Tomcat / 条码 / BBCMall 组件）
- [ ] **② 平台整合补丁**：`[Pub_20260903]TempPatch_V9_BOS_20250410.9.0.871.2.kdpkg`
- [ ] **③ 业务整合补丁**：`[Pub_20260916]TempPatch_V9_STD_20250410.9.0.884.4.kdpkg`（"先平台后业务"，顺序不可颠倒）
- [ ] **④ 资金台账补丁**：`FIN_Pay_V9.kdpkg`（建/改 5 张台账表 + 预置台账配置 + 给 `AP_PAYBILL`/`CN_PAYAPPLY` 等操作注入 `Kingdee.K3.FIN.Pay.App.ServicePlugIn` 插件 + 新增权限对象 `TZPZ`；系统参数 `CN.LEDGERENABLE` 初始值 **0＝拦截默认关闭**）
- [ ] **⑤ `RepairFastJson.1.1.1143.14.kdpkg`** —— Fastjson 漏洞（安装后**重启 K3CloudTomcat 服务**）
- [ ] ✖ 零售 / BBC / 条码补丁：本次**不装**（若后续业务启用，再按对应漏洞公告单独补）

规则：
- 每个包装完**先看安装日志有无报错**再装下一个；不跳步、不改顺序
- 安装器会让程序 + **两个数据中心的数据库**都升级，两个库都要连得上
- ② ③ ④ ⑤ 属于临时/整合包，安装时一律**勾选【允许重复执行】**

### 步骤 4　启动

- [ ] 启动 IIS
- [ ] 依次启动服务：`K3CloudManager` → `K3CloudMQService` → `K3CloudTomcat` → `K3CloudJobProcess` → `K3CloudClienter` → `K3CloudGuardService`
- [ ] 打开管理中心 `http://127.0.0.1:8000`，确认两个数据中心状态正常
- [ ] **重新启用窗口期间禁用的 5 个作业**：`KD-MAIN.Subplan_1`、`分厂账套账套-每日完整备份`、`管理中心库与系统库-每日完整备份`、`自动清除超15天的备份.Subplan_1`、`备份体检-数据库备份有效性检查`
- [ ] **客户端分发**：无需另行下载安装包——服务器 `WebSite\ClientBin\K3CloudClientPortal.exe`（124.4 MB，安装盘版）已就位；通知用户重新运行它即可获取与服务器匹配的新客户端版本

### 步骤 5　验证（逐条打勾）

- [ ] **版本**：WebAPI 登录返回 `DisplayVersion` = `9.0.0.20250410`；`Context.ProductEdition` 仍为 `0`
- [ ] **补丁记录**：`T_BAS_DATACENTERMAJORVER` / `T_BAS_DATACENTERVERINFO` 由空变为有补丁号与补丁日期
- [ ] **Fastjson**：`RetaiKtmSite\WEB-INF\lib`、`QingSite\WEB-INF\lib` 下 `fastjson-1.2.83.jar` 已被删除或替换为 2.0.64
- [ ] **二开存活**：附录 B 的 6 个程序集仍存在于 `WebSite\bin`；`ISVConfigure.xml` 未丢失
- [ ] **二开功能**：`wfs.dll` 相关功能、`KDYF.*` 报表、自定义单据（`Z_` 前缀表相关）逐项点检
- [ ] **业务抽查**：生产订单 / 工序汇报 / 工序转移 / 应付单 / 物料 / BOM 各查数张，核对状态与数量
- [ ] **付款链回归**（本期唯一新增回归点，因 ④ 给两个单据的审核操作注入了插件）：
      `CN_PAYAPPLY` 付款申请单、`AP_PAYBILL` 付款单 各做一张「新建 → 提交 → 审核」；确认 `CN.LEDGERENABLE = 0`（台账拦截未启用）时审核正常、无「台账处理异常」报错；
      再确认 `T_BD_LEDGERCONFIG` 已建出且存在预置行（`FID=1`，`FNUMBER=TZPZ_SYS`，`FENABLE=1`），`T_BD_LEDGERCONFIGENTRY` 有 **21 行**（含 `CN_PAYAPPLY→AP_PAYBILL`、`AP_PAYBILL→AP_REFUNDBILL`、`AP_PAYBILL→WB_BankPay`、`AP_OtherPayable→AP_PAYBILL`、`ER_ExpReimbursement→AP_PAYBILL` 等）
- [ ] **外部集成**：经 `<K3_EXTRA_HOST>:666` 的接口调用回归
- [ ] **星空卫士离线检测（可选）**：使用星空卫士 + 离线检测包复测，对照公告 checklist 确认漏洞消除
      （注意：`K3CloudGuardService` 在线更新检测项会报 `NullReferenceException`，日志在 `K3Cloud\Guard\Log`；且 `K3Cloud\Guard` 目录下**目前没有任何离线检测包**，需另从金蝶客服 / 社区获取）
      **未取到检测包时，改为手动核对以下三条**（覆盖本期必补项）：
      ① `RetaiKtmSite\WEB-INF\lib`、`QingSite\WEB-INF\lib` 下 `fastjson-1.2.83.jar` 已删除或替换
      ② WebAPI 登录返回 `DisplayVersion = 9.0.0.20250410`
      ③ `T_BAS_DATACENTERMAJORVER` 由空变为有补丁号与补丁日期
- [ ] 恢复定时任务与外部对接，通知用户恢复使用

### 步骤 6　回滚（仅在失败时）

1. 停止所有 K3Cloud 服务与 IIS
2. 用步骤 1 的备份还原三个数据库
3. 还原 `D:\Program Files (x86)\Kingdee\K3Cloud` 程序目录（含二开程序集与 `ISVConfigure.xml`）
4. 启动服务并验证版本回到 `9.0.280.13`

### 步骤 7　附带的加固项（建议同期完成）

- [ ] 管理中心 IIS 绑定由 `*:8000` / `*:8443`（全网卡，当前仅靠防火墙拦截）改为只绑 `127.0.0.1`
- [ ] 管理员账号使用别名登录；管理员密码为强密码（≥8 位，字母+数字+特殊字符）
- [ ] 站点登录启用校验码
- [ ] 复查 `WebSite\UploadFiles` 下是否存在 `.asp/.aspx/.asmx/.ashx` 等脚本文件（本次核查命中 0）
- [ ] 持续关注 `https://trust.kingdee.com/security-notice`

---

## 五、执行记录

| 时间 | 步骤 | 操作人 | 结果 / 备注 |
| --- | --- | --- | --- |
| 2026-09-21 | 步骤 0 补丁包到位 / 解锁 / 哈希核对 | 运维员A + Hermes | ✅ 5 个包全部到位并解锁，见「补丁包实测核对表」 |
|  | 步骤 1 备份 |  |  |
|  | 步骤 2 停机 |  |  |
|  | 步骤 3-① 标准补丁 PT-163010 |  |  |
|  | 步骤 3-② 平台整合补丁 |  |  |
|  | 步骤 3-③ 业务整合补丁 |  |  |
|  | 步骤 3-④ 资金台账补丁 |  |  |
|  | 步骤 3-⑤ Fastjson 补丁 |  |  |
|  | （不装）零售 / BBC / 条码 | — | 2026-09-21 已判定不适用 |
|  | 步骤 4 启动 |  |  |
|  | 步骤 5 验证 |  |  |

---

## 附录 A　基线快照（2026-09-21 只读核查）

| 项 | 值 |
| --- | --- |
| 服务器 | `<SQL_SERVER_HOST>`，Windows Server 2016 Standard，<K3_INTRA_HOST>（NIC2）/ <K3_ALT_HOST>（optun） |
| 安装目录 | `D:\Program Files (x86)\Kingdee\K3Cloud` |
| 安装盘 | `D:\Kingdee\K3Cloud_V9.0_DVD`（2024-06） |
| 产品版本 | `9.0.280.13`（`Kingdee.BOS.dll` = 9.0.280.13，文件日期 2024-11-07） |
| 数据中心版本 | `9.0.0.20241107`（T_BAS_DATACENTER.FVISION，两个数据中心相同） |
| 版别 | 企业版（`Context.ProductEdition = 0`；`Kingdee.BOS.Context.IsStandardEdition()` 仅当 ProductEdition=1 时返回 True，已反射实测） |
| 补丁状态 | 未安装任何补丁：`T_BAS_DATACENTERMAJORVER`、`T_BAS_DATACENTERVERINFO` 为空；`SiteInfo.xml` 已安装包全部为 9.0.280.13 / 9.0.78.3 安装盘包；无 PT- 补丁包 |
| 许可 | `ManageSite\App_Data\Lic` 共 43 个 `.lic`，2024-09-12 ~ **2026-08-19**（约每两月一份，许可通道活跃） |
| 星空卫士 | `K3CloudGuardService` 运行中，检测项已更新至 142 项（2026-08-10）；在线更新检测项报 `NullReferenceException`；`K3GuardHtmlReport` 为空 |
| IIS 站点 | Default Web Site(80/443)、ManageSite(`*:8000`/`*:8443`)、SFSMessagePush(1550/1555)、K3CloudMobile(8600/8644)；应用 `/K3Cloud`、`/K3CloudApp`、`/K3CloudGuard`、`/K3CloudFileServer`、`/K3CloudMiniApp` |
| 外网暴露 | 仅 `<K3_EXTRA_HOST>:666` 可达；公网 80 / 8000 / 8080 / 1433 均不可达 |
| UploadFiles 检查 | 无 `.asp/.aspx/.asmx/.ashx` 可疑文件（命中 0） |

## 附录 B　二开清单与处置预案（接手版）

> 完整版见 `output/二开接管清单.md`（含导出脚本与 DLL 备份清单）。

| 项 | 实测结果 |
| --- | --- |
| 二开方（元数据标记） | **UNW**（226 个对象）＋ **ZBMY**（6 个对象） |
| 扩展范围 | 232 个扩展元数据对象，涉及 **103 张**标准单据/基础资料 |
| 含自定义代码的 | **9 处**：2 个 C# 插件 + 6 个 Python 脚本 + 1 组报表插件 |
| 其余扩展对象 | 只加字段/调界面/加转换规则，无代码 |

**代码插件明细（补丁后必测）**

| 位置 | 插件 | 类型 | 状态 |
| --- | --- | --- | --- |
| 工序汇报单 `SFC_OperationReport`（ZBMY） | `回写结案标识到生产订单` | Python | ✅ 启用（审核后 SQL 回写生产订单 `F_ISEND`） |
| 同上 | `清空回写的结案标识` | Python | ✅ 启用（反审核清空） |
| 同上 | `回写值到生产订单` | Python | ❌ 禁用（含调试残留） |
| 同上 | `wfs.BL` / `wfs.BL_delete` | C#（`wfs.dll`，无源码） | ✅ 启用 |
| 同上 | `KDYF...OperationReportAuditBase` | C# | ❌ 禁用 |
| 生产退料单 `PRD_ReturnMtrl`（ZBMY） | `123` | Python | ✅ 启用（疑似调试脚本） |
| 生产订单批次拆分 `PRD_MO_BATCHSPLIT`（ZBMY） | `test` | Python | ✅ 启用（疑似调试脚本） |
| 工序结算单 `SFC_OperProcBalance`（UNW） | `自动审核` | Python | ✅ 启用 |
| 工序计划 `SFC_OperationPlanning`（UNW） | `print` | Python | ❌ 禁用 |
| 报表 `UNW_MOOScheduleRpt`（UNW） | `KDYF...AppPlugInNew3.KDYF_MOOScheduleRpt` | C# | ✅ 启用（继承金蝶标准报表类，风险最高） |

**二开出问题时的处置顺序**：① 从报错信息里认出插件名 → ② 在元数据里把该插件注册的 `IsEnabled` 置 False（**保留 DLL 与元数据，不要删**）→ ③ 业务先跑起来，Python 脚本我们有源码可直接改，C# 插件需找原二开方或金蝶实施 → ④ 极端情况禁用整个扩展对象，须金蝶实施评估。

**找源头**：`ManageSite\App_Data\ISVConfigure.xml` 中 `Name/DevCode = UNW`；另一家为 `ZBMY`；可报给金蝶客服 4008-836-836 / 客户经理查询部署伙伴。

**已在 `output/` 留存**：5 个 Python 脚本源码、3 份二开元数据 XML、6 个二开 DLL、232 个二开对象清单 JSON。

---

## 附录 C　④ 资金台账补丁「要不要装」的实测依据（2026-09-21）

**结论：装。** 该包不是"资金管理 / 银企互联"模块补丁，而是**付款台账（超额支付拦截）**功能与支付安全加固包，覆盖的正是本环境天天在跑的付款链。

**依据 1：拆包读脚本（`FIN_Pay_V9.kdpkg` → `FIN_Pay_V9_SDT` → `TempPatch_DM`，内含 1 个元数据清单 + 2 个 SQL）**

| 动作 | 实测内容 |
| --- | --- |
| 表结构 | `P_ALTERPK` 重设主键 + 建索引：`T_BD_LEDGERCONFIG`、`T_BD_LEDGERCONFIG_L`、`T_BD_LEDGERCONFIGENTRY`、`T_BD_LEDGERBALANCE`、`T_BD_LEDGERBEGINBILL` |
| 预置台账配置 | `T_BD_LEDGERCONFIG`：`FID=1`、`FNUMBER=TZPZ_SYS`、`FHOTDAY=30`、`FENABLE=1` |
| 覆盖单据对（21 行 `T_BD_LEDGERCONFIGENTRY`） | 付款链：`CN_PAYAPPLY`→`AP_PAYBILL`、`AP_PAYBILL`→`AP_REFUNDBILL`、`AP_PAYBILL`→`WB_BankPay`、`AP_OtherPayable`→`AP_PAYBILL`/`CN_PAYAPPLY`；报销链：`ER_ExpReimbursement`、`ER_ExpenseRequest`（含 `_Travel`）→`AP_PAYBILL`/`CN_PAYAPPLY`；另含期初（无源单据）行。超额校验字段 `FPAYTOTALAMOUNTFOR_H` / `FAPPLYAMOUNTFOR_H`，实付关联 `FREALPAYAMOUNT_S` |
| 操作插件 | 向 `T_META_OPERATESERVICEPLUGIN` 注入 `Kingdee.K3.FIN.Pay.App.ServicePlugIn`：`LedgerPayPlugIn` 挂在 `AP_PAYBILL` 的 **Audit**、`CN_PAYAPPLY` 等操作上；`BankPayBill.Save/Delete` 挂在 `WB_BankPay`（银行付款单） |
| 权限对象 | `T_SEC_PERMISSIONOBJECT` 新增 `TZPZ`（台账配置），子系统 `6002`（FIN） |
| 系统参数 | `T_BAS_SYSTEMPROFILE`：`CN.LEDGERENABLE = 0`（**拦截默认关闭**）、`Pay.VerOverLimitBillFormIds`（超额限定单据） |

**依据 2：本环境实测使用情况（两个数据中心的真实数据）**

| 模块 | 实测 | 判定 |
| --- | --- | --- |
| 付款申请单 `CN_PAYAPPLY` | 东莞 **1414 张**（最新核准 **2026-09-21 18:27**）、佛山 0 张 | **在用（当天）** |
| 付款单 `AP_PAYBILL` | 东莞 **2842 张**（最新 2026-09-12）、佛山 20 张（全部未审核） | **在用** |
| 出纳日记账 `T_CN_JOURNAL` / 银行转账单 `T_CN_BANKTRANSBILL` / 票据收款 `T_CN_BILLRECEIVABLE` | 东莞 3920 / 256 / 2315 张，均 2026-09 有数据 | **在用** |
| 银行账号 `T_CN_BANKACNT` | 东莞 14 个、佛山 10 个 | 已配置 |
| 资金台账 `T_BD_LEDGERCONFIG` 等 5 张表 | **两个库都不存在** | 功能从未部署（本补丁会建出来） |
| 银企互联 / 网银 `T_WB_*`、`T_EB_*`、`T_FM_*` | `T_WB_*` 表存在但业务表**全 0 行**（仅 `T_WB_CNYTRANSACTIONTYPE` 17 行预置交易类型）；`T_EB_*` / `T_FM_*` 一张都不存在 | **未使用** |

**为什么装**：包仅 98 KB，动作 = 建表/索引 + 预置配置 + 注册插件 + 新增权限对象；`CN.LEDGERENABLE` 初始为 `0`（拦截关闭），不改变现有单据行为。它属于金蝶《支付安全加固补丁公告（KD-20250919）》中 V9.0 企业版的第 3 项，且覆盖 `CN_PAYAPPLY → AP_PAYBILL` 这条本环境每天在用的付款链。

**代价**：唯一需要业务回归的是「付款申请单 / 付款单：新建 → 提交 → 审核」（插件挂在审核操作上），已列入步骤 5。

**复核方法（只读 SQL）**：

```sql
-- 付款链使用情况
SELECT COUNT(*) FROM T_CN_PAYAPPLY;   -- 付款申请单
SELECT COUNT(*) FROM T_AP_PAYBILL;    -- 付款单
-- 台账功能是否已部署（打补丁前应为「表不存在」）
SELECT name FROM sys.tables WHERE name LIKE '%LEDGERCONFIG%';
-- 打补丁后应出现：1 行台账配置 + 21 行单据台账配置 + 拦截开关默认 0
SELECT FID, FNUMBER, FENABLE FROM T_BD_LEDGERCONFIG;
SELECT COUNT(*) FROM T_BD_LEDGERCONFIGENTRY;
SELECT FCATEGORY, FKEY, FVALUE FROM T_BAS_SYSTEMPROFILE WHERE FKEY IN ('LEDGERENABLE','VerOverLimitBillFormIds');
```
