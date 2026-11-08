# 星空版本盘点与补丁差距评估

## 目录

- 1. 判定产品版本（三处交叉验证，缺一不下结论）
- 2. 判断补丁级别
- 3. 跨库查询的连接池坑（实证）
- 4. 一套部署里常见的库
- 5. 官方升级口径（快照，用时重新拉原文）
- 6. 顺手做的加固符合性检查（只读、无侵入）
- 7. 版别、服务期与二开：数据库查不到的部分
- 8. 边界与交接
- 9. 服务器侧只读探测手法（Windows + OpenSSH，实测可用）
- 10. 补丁执行单的产出（用户说「做一个文档出来」时）
- 11. 停机与窗口安排（用户问「一定要停服务器才能更新吗」时按这个答）


用途：回答「我们这套星空能不能打补丁 / 该打什么补丁」。先拿到硬证据，再谈方案；补丁的安装与下载不在助手能做的范围内。

## 1. 判定产品版本（三处交叉验证，缺一不下结论）

| 来源 | 做法 | 说明 |
| --- | --- | --- |
| 站点登录页 | `curl -sS --noproxy '*' -o /dev/null -w '%{http_code}' http://<host>/k3cloud/` 后 grep `ver=` | 资源版本号就是产品版本，如 `ver=9.0.280.13`；外网映射地址和 1.95 返回同一个值可确认是同一套站点 |
| WebAPI | `AuthService.ValidateUser` 返回的 `Context.DisplayVersion` | 最权威且可脚本化；同一响应里还有 `DataCenterName`、`DBid`、`UserName`，顺带把账套身份确认了 |
| 数据库 | 数据中心库 `T_BOS_REGISTER` 的 `FBOSVERSION` / `FPTNO` / `FPRODUCTEDITION` | 每个数据中心一行注册信息 |

`T_BAS_SYSTEMPROFILE` 里没有产品版本，别在那儿找（它的 FCategory 只有 AM/AP/BOS/GL/STK 这类业务参数）。

## 2. 判断补丁级别

- `T_BOS_REGISTERPKGHISTORY`（`FPTNO` / `FDATE`，按日期倒序）是版本注册/更新历史，最后一条的时间约等于最后一次装补丁的时间；据此可算出落后了多少个月。
- 版本号形态本身是判据：未打周期/整合补丁时是 `9.0.280.13` 这类 build 号；打完周期补丁后会变成 `9.0.0.<YYYYMMDD>`，打到 V9.1 则为 `9.1.0.<YYYYMMDD>`。仍是 build 号形态就不要说「已是最新」。
- **「从未打过补丁」的硬证据**（管理中心库 `K3DBConfiger*`）：补丁记录表 `T_BAS_DATACENTERMAJORVER`、`T_BAS_DATACENTERVERINFO` 为空即从未安装任何补丁；同库 `T_BAS_DATACENTER` 每行还带数据中心版本 `FVISION`（如 `9.0.0.20241107`，与 `T_BOS_REGISTER.FBOSVERSION` 同源）和备份方式/备份时间字段，可一并核对。下结论前凑三条独立证据：补丁记录表空 ＋ `SiteInfo.xml` 的 InstalledPkgs 里没有 `PT-` 补丁包 ＋ `WebSite\bin` 里没有晚于产品安装日期的 `Kingdee.*` 产品程序集（只有二开 dll）。
- 官方核对口径：登录后在个人信息下拉「关于」里看版本。

## 3. 跨库查询的连接池坑（实证）

`mssql` 的 `sql.connect(cfg)` 用的是**全局连接池**：只改 `database` 再 connect 会复用已有池，查询静默跑在第一个库上（症状是两张库的 `sys.tables` 列表一模一样，或报 `Invalid object name`）。跨库必须：

```js
const pool = await new sql.ConnectionPool({ ...base, database: db }).connect();
try { /* pool.request().query(...) */ } finally { await pool.close(); }
```

## 4. 一套部署里常见的库

- 数据中心库 `AIS<YYYYMMDDHHMMSS>`（库名里带装库时间，业务账套）
- 管理中心库 `K3DBConfiger<...>`
- `ReportServer` / `ReportServerTempDB`（报表）
- 注意区分：DB 服务器主机名（如 `<SQL_SERVER_HOST>`）≠ 应用服务器（`<K3_INTRA_HOST>`）≠ 管理中心服务器（8000 端口，通常另有其机）

## 5. 官方升级口径（快照，用时重新拉原文）

统一套路：**升到本版本最后一个迭代补丁 → 逐级升到 V8.2 最后一个迭代补丁（V9.0 及以上到 V9.1）→ 装平台整合补丁 → 装业务整合补丁 → 再补单独发布的业务安全补丁**。二开内容多则就地升到本版本最后迭代补丁，影响最小。

### 单个版本的执行顺序与安装坑（以企业版 V9.0 为例）

合集附件《升级补丁步骤 forV<版本>-总共 N 个补丁》docx 给的顺序就是全部内容，**该文档正文往往只有一两行字，真正的信息在正文内嵌截图里**——`unzip -o x.docx word/media/` 抠出 png 再按图读字，否则会误判成「文档什么都没有」。企业版 V9.0 的 N=7 拆开是：1 标准补丁 ＋ 1 平台整合 ＋ 1 业务整合 ＋ 4 业务安全补丁。

1. **标准补丁**：一包升到本版本最后迭代（企业版 V9.0 → `PT-163010 [9.0.0.20250410]`，构建号 `9.0.434.12`）。标准补丁是累积的，不需要从旧 build 逐包补；同页面更新的 `[9.1.0.20250807]`（`PT-163015`）是更高版本，按文档别下错。
2. **平台整合补丁** → 3. **业务整合补丁**，顺序不能颠倒（原文「先平台后业务」），且都必须在标准补丁之后。
4. 再装单独发布的业务安全补丁（零售 / BBC / 条码 / Fastjson 等）。

安装前的两个硬坑：

- **补丁包下载后必须先解除锁定/只读**（右键→属性→勾掉「解除锁定」或去掉只读），否则安装直接失败。
- 业务安全补丁安装时**务必勾选【允许重复执行】**（多份公告原文强调）。

补丁记录表里出现的补丁号与版本号形态可用于事后回查：装完标准补丁 `DisplayVersion` 应从 build 号变成 `9.0.0.20250410`，`T_BAS_DATACENTERMAJORVER` / `T_BAS_DATACENTERVERINFO` 从空变成有记录。

- 补丁包下载：`https://open.kingdee.com/K3Cloud/Open/PTDownload.aspx`，选企业版/标准版，**需金蝶云账号登录态**。

### 先找包：文件默认落在 C 盘用户目录

用户说「下好了」而本机与程序目录里都搜不到时，**先列服务器的 `C:\Users\<用户>\Downloads`、桌面、文档**，再谈「没下下来」——浏览器下载默认落 C 盘用户目录，只扫 D 盘和安装目录会得出错误结论，还得用户来纠正。列出文件名 / 大小 / 下载时间、并检查是否带 `Zone.Identifier` 锁定标记。周期补丁与加固补丁常与历史包混在同一目录（含更高版本线的），逐个核对构建号。用户用序号回报进度时（「3、4 都下好了」）**不要按自己清单的编号去推哪些还缺**——序号错位很常见，直接列目录对比实际文件再回答。

### 包在页面的哪一层（用户贴下载页截图问「还要下哪些」时按这个答）

- 顶层卡片（`PT-xxxxxx` ＋「下载 / 查看历史记录」两个按钮）只有**标准补丁**；**平台整合补丁、业务整合补丁要点进「查看历史记录」**，在历史记录里那张卡上点「整合补丁」按钮，展开后「平台下载」＝平台整合补丁、「业务下载」＝业务整合补丁（官方公告附的就是这条路径的截图）。历史记录页每行右侧是 **下载 / 详情 / 新特性 / 整合补丁** 四个按钮，按**构建号**（如 `9.0.434.12`）定位到目标行，别按补丁号翻。只回「去补丁下载页」用户会在同一页反复找不到；用户回「我没找到」就别再重复同一条路径说明，升级为：① 先把公告里的公开直链找齐、能自己下的下好传服务器；② 抓官方截图核对按钮原文，再把「点哪一层、按钮叫什么」写成逐级步骤；③ 仍拿不到就让他打 4008-836-836 或找客户经理报「版本＋构建号＋补丁名」要直链。
- 同一张卡上还可能挂着**资金台账补丁**（支付安全加固 `KD-20250919`，顺序：平台整合 → 业务整合 → 资金台账），而那份「N 个补丁」docx 常漏掉它。**不要按包名把它当成「资金管理 / 银企互联」模块补丁**：`FIN_Pay_V9` 实测是**付款台账（超额支付拦截）**功能包，覆盖 `CN_PAYAPPLY`（付款申请单）→`AP_PAYBILL`（付款单）、`AP_PAYBILL`→`AP_REFUNDBILL`、`AP_OtherPayable`、费用报销 `ER_*` 几条链，插件挂在 `AP_PAYBILL` 的**审核**操作上。装不装的判据只能来自 §6.1 拆包读脚本（读出覆盖哪些单据）＋ §6.2 单据在用实测（本环境付款申请单当天还在核准 → 装），按包名或按「你们用不用资金管理」去问业务都会被带偏。
- **业务加固补丁按「构建号区间」匹配，不按补丁号**：公告给的适用范围形如 `V9.0.116.12~V9.0.434.12`（例：条码加固 `barcode_V9_2025_08_26_14_22_47.1.1.472.1.kdpkg.zip`），先算出打完标准补丁后的构建号落在哪一档再选包。
- **别把 V9.1 线的包当成 V9.0**：同页与同目录并存 `PT-163015 [9.1.0.20250807]`、`PT-163016 [9.1.644.11]`、`PT-163025`（金蝶AI星空 V9.1，发布时间常最新，最容易被当成「新版」点下去）。判断看**构建号**（`9.0.434.12` vs `9.0.553.10` / `9.1.x`）与包内「适用范围」，不看补丁号大小或发布时间。
- 公告直接给下载链接的包**无需登录态**，可以自己下好、`scp` 传到服务器并核对两端哈希（推荐做法）。两个公开 CDN 主机：`k3cloudpt.kingdee.com/Package/...`（Fastjson 通用补丁，`KDPSIRT-2026-00071` 方案四：`https://k3cloudpt.kingdee.com/Package/RepairFastJson/RepairFastJson_1_1_1143_14/1_1_1143_14/Stardard/RepairFastJson.1.1.1143.14.kdpkg`）和 `pkgsfile.open.kingdee.com/<目录>/<包名>`（资金台账补丁：`https://pkgsfile.open.kingdee.com/FinPay/FIN_Pay_V9.kdpkg`，约 98 KB）。找法就是把公告正文抓下来 grep `https?://(k3cloudpt|pkgsfile)\.kingdee\.com`。
- **不要按包名猜 CDN 路径**：同一主机的目录名与文件名的对应关系没有规律，猜出来的 URL 一轮全是连不上/404，纯浪费。只交付出现在公告正文或被 `curl -sIL` 实测 200 的链接。
- 给用户链接前先 `curl -sIL -A '<UA>' <url>` 自验：HTTP 200 ＋ `Content-Length` ＋ `Last-Modified` 与公告的「最近更新日期」对得上。
- **补丁列表本身是登录墙，别去逆向**：列表走 `POST https://open.kingdee.com/K3Cloud/Open/Kingdee.CDP.ServiceFacade.ServicesStub.CDPService.GetListPatchs.cdpgw`，body 是**对象** `{"p0":<token>,"p1":<搜索词>}`（不是数组；数组会回「参数计数不匹配」），请求头要 `PType: Multi` 与 `CDPUser_TK` / `ASP.NET_SessionId` cookie。匿名调用固定回 `{"Code":"-999","Description":"token is empty"}`，所以标准补丁列表与「整合补丁」子项只能在用户自己的登录态里点；助手要做的是把逐级路径写清楚＋把公开直链下好，不要在鉴权上耗时间，也不要索要账号。

### 包到手后的核对（五步；批量跑 `scripts/tools/verify_kdpkg_packages.ps1 -Path <下载目录>`）

1. `Unblock-File`（等价右键属性「解除锁定」）：`Get-Item <file> -Stream Zone.Identifier` 有流就是来自网络下载，未解除会导致安装失败。
2. 记文件名 / 大小 / 下载时间 **+ SHA256**——执行单要求现场与官方页面核对，哈希另外用来证明传到服务器那份与原件是同一个文件。
3. 包内通常带 `PT-<号>_补丁说明.txt`，**是 UTF-8（带 BOM）**：PowerShell 用 `GetEncoding(936)` 读会得到 `锘?` 开头的乱码，必须 `[IO.File]::ReadAllText($p,[Text.Encoding]::UTF8)`。
4. 该说明首行「适用范围：本补丁适用于企业版/标准版 …」可反过来佐证版别判定（与 WebAPI 的 `ProductEdition` 互证）。
5. **读包内 `app.manifest` 核对包身份**——`.kdpkg` 实为 **CAB**（文件头 `4D 53 43 46` = `MSCF`），不是 zip（zip 工具会报「找不到中央目录结尾记录」），只能用 `expand.exe`：

   ```powershell
   expand.exe -D "<包路径>"                              # 列包内容
   expand.exe -R "<包路径>" -F:app.manifest "<现存目标目录>"    # 抽出 manifest（目标必须是目录）
   ```

   2026-10-13 本地 CAB 测试修正：目标用现存目录，加入 `-R` 恢复包内文件名，不强制尾反斜杠或仅凭参数顺序判断。旧写法可能把文件恢复为输入包名，且尾反斜杠可能影响参数传递。必须同时检查返回码和实际 app.manifest；本地样例不证明所有厂商包结构相同。manifest 里 `PackageName` / `Version` / `ISV` 加 `Resource/ResourceItem/@FilePath`（内层组件名）就是包身份，据此可确认「用户下到的到底是哪个包」：
   - **标准补丁是组合包**，内层含 MC / BOS / STD / 文件服务 / Tomcat / `barcode.*` / `BBCMall.*` 等——所以条码、BBC 这类组件**本来就跟标准补丁走**，单独发布的安全补丁是 build 更高的覆盖包，不冲突；回答「某模块要不要单独打补丁」时要区分这两者。
   - `TempPatch_V9_BOS_<版本线>` → 内层 `K3Cloud Temp Patch` = **平台整合补丁**；`TempPatch_V9_STD_<版本线>` → 内层 `K3Cloud Temp STDPatch.<ver>` = **业务整合补丁**。整合补丁构建号（如 `9.0.871.2` / `9.0.884.4`）与标准补丁构建号（`9.0.434.12`）**不是同一递增序列**，不要拿构建号大小去推「该装哪个整合补丁」，按包名里的版本线（`20250410`）匹配。
   - `SignVerifyContent/SignContent` 为空的整合补丁（TempPatch）属正常，**不代表下载损坏**；有签名的（标准补丁、`ISV=PUB` 的通用补丁）可另作凭据写进核对表。

   > 坑：文件名里带方括号（如 `[Pub_20260903]TempPatch_...kdpkg`，官方加固包常这样命名）时，**PowerShell 把 `[]` 当通配符**——`Test-Path` / `Get-Item` / `Get-FileHash` / `Unblock-File` 全部要加 `-LiteralPath`，否则统一报「文件不存在」，会误判成用户没下载。

- 停更节奏：V6.2 与 V7.1 已于 2026-04-30 停止更新；V7.2/7.3/7.5 → 2027-03-31；V7.6 → 2027-04-30；V7.7 → 2027-06-30；V8.0 → 2027-12-31；V8.1 起继续支持，官方推荐版本是 V9.1。停更即意味着不再提供错误补丁、安全补丁和 BUG 修复。
- 必须靠版本升级（低版本无单独补丁）才能修的两项：支付安全加固 `KD-20250919`（整合补丁＋资金台账补丁）、命令执行漏洞 `KDPSIRT-2025-00106`（V7.2 起受影响）。
- 排查/修复流程（星空卫士＋离线检测包、checklist1 平台类、checklist2 业务类、UploadFiles 后门检查）见金蝶社区 `knowledge/576323658743011584`；各版本升级步骤见 `knowledge/829642361319334912` 的 12 份 docx 附件。补丁号与漏洞清单会随公告更新，每次重新抓原文，不要沿用旧快照。

### 找不到入口时用官方文档自带的截图定位

金蝶公告正文里的插图是 `/download/<hash>.png`，`curl -L -A '<UA>'` 抓下来直接读图，就能看清按钮叫什么、在页面哪一层——比反复猜页面结构快得多。抓文章页**必须带 `?productLineId=1&isKnowledge=2&lang=zh-CN`**：不带这组参数时页面照样返回几百 KB HTML，但 payload 里没有正文（关键词命中 0），很容易误判成「这页没内容」而放弃。社区页的 Nuxt `window.__NUXT__` payload 里还会内嵌**关联文章的完整正文**（一次可取到安全公告的 checklist 与「支付安全加固补丁公告」的补丁表格），匹配 URL 前先把 `\u002F` 换成 `/`。

## 6. 顺手做的加固符合性检查（只读、无侵入）

- 外网映射端口逐个探（`curl -sS --noproxy '*' -m 6 -o /dev/null -w '%{http_code}' http://<公网IP>:<port>/`）：站点端口通、8000（管理中心）和 1433（SQL）不通 = 符合「管理中心禁止发布到外网」。
- `\K3Cloud\WebSite\UploadFiles` 下出现 `.asp/.aspx/.asmx/.ashx` 说明可能被传后门，需全盘查杀——这一步要服务器文件访问，没有共享时只能让 IT 查，不要臆断。
- 判断某模块是否在用不要只看有没有表：表存在≠已启用（标准库自带大量模块表）。要把「模块迹象」和「已启用」分开写。
- 单个业务安全补丁要不要装，按公告里「确认是否受影响的方法」在服务器上实测，不要凭模块有没有表推断。例：Fastjson 远程代码执行 `KDPSIRT-2026-00071` 的判定方法就是查 `\K3Cloud\RetaiKtmSite\WEB-INF\lib`、`RetaiKtmSite_JDK17\WEB-INF\lib`、`QingSite\WEB-INF\lib`、`QingSite_JDK17\WEB-INF\lib` 下有没有 `fastjson-1.2.X.jar`(X≤83) 或 `fastjson2-2.0.X.jar`(X≤62)——十几秒就能定论；公告同时给了「未使用零售/轻分析可直接删 jar」和「方案四：全版本通用补丁 `RepairFastJson.<ver>.kdpkg`（推荐）」两条路，用通用补丁最省事，不必纠结模块在不在用。JDK17 目录不存在就跳过对应那两处。
- 零售/BBC 这类模块补丁，公告常写明「仅涉及已购买并部署该模块的用户」——先看公告的适用前提，再看业务是否真的在用，别默认全装。

### 6.1 拆包读脚本：判定「这个补丁包到底改什么 / 要不要装」

`.kdpkg` 是层层 CAB，一路拆到底后**最终 payload 常是纯文本**（元数据清单 ＋ 安装 SQL），直接读就能看到它建哪些表、预置什么数据、挂哪个插件、开哪个开关——这是唯一能回答「它管的是哪个模块」的证据，比按包名猜快得多，也远比问业务可靠。

递归拆包要点：

- **多文件 CAB 必须带 `-F:*`**：`expand.exe "<包>" -F:* "<目标目录>\"`；只给源路径＋目录会报 `The source file contains multiple files. The -F:filespec option is required to specify which file(s) are to be expanded.`（`-F:<名字>` 只在抽单个文件时用）。
- CAB 里的条目名常是**内容哈希**（`9B8C8B9B...`）而不是文件名；靠上一层 `app.manifest` 的 `ResourceItem/@FilePath + @HashCode` 对应关系还原本层是哪个包。
- 每钻一层先按**文件头**分类，别拿扩展名当依据：`4D 53 43 46`=CAB（继续钻）、`50 4B 03 04`=ZIP、`4D 5A`=MZ/DLL、`FF FE`=UTF-16LE 文本、`EF BB BF`=UTF-8 文本，其它=二进制。**文本就是终点，直接读**。
- **文本解码一律先看 BOM**：`utf-16` 解码对任何偶数长度字节流都不抛异常（只会给整篇乱码），所以「先试 utf-16 再试 utf-8」的写法必然把 UTF-8 文件读成乱码；`FF FE`→utf-16、`EF BB BF`→utf-8-sig，无 BOM 才试 gbk。
- 读 SQL 前**先数一遍 `FENTRYID=<n>;` 的出现次数**，再按与计数对齐的正则解析行。例：预置台账配置形如 `DELETE ... WHERE FENTRYID=25; INSERT ... VALUES (1, 25, '源单据', '目标单据', ...)`，用「抓相邻两个引号字符串」的正则只命中一部分（实测 21 行只抓到 2 行，差点据此把执行单写错）；按 `FENTRYID=(\d+);\s*INSERT[^;]*?VALUES\s*\(\s*1\s*,\s*(\d+)\s*,\s*'([^']*)'\s*,\s*'([^']*)'` 解析。

读完通常能拿到这五类落点，它们就是「影响面」：建表 / 改主键建索引（`P_ALTERPK`、`CREATE INDEX`）、预置业务配置（如 `T_BD_LEDGERCONFIG*`）、**操作插件注入**（`T_META_OPERATESERVICEPLUGIN` 的 `FFORMID` ＋ `FOPERATENUMBER` ＋ `FPLUGINCLASS`，直接给出「插件挂在哪张单据的哪个操作上」）、新增权限对象（`T_SEC_PERMISSIONOBJECT`，如台账配置 `TZPZ`）、系统参数初值（`T_BAS_SYSTEMPROFILE`，如 `CN.LEDGERENABLE=0`＝拦截默认关闭）。

> 写结论的次序：先读出「覆盖哪些单据 / 入口」→ 再用 §6.2 查这些单据在本库的真实使用情况 → 最后给「装 / 不装 ＋ 代价」。因为包内常会给某个操作挂插件，**「代价」必须写成一条明确的回归测试项**（例：付款申请单 / 付款单 新建→提交→审核，确认拦截未启用时不报「台账处理异常」），并写进执行单验证清单。
> 用户说「我不知道，你去看下」时，是要求你把「在用 / 未用」用库里数据判出来，不要把问题弹回去让他确认。

### 6.2 模块 / 功能「在不在用」的 SQL 探针

`sys.tables` 里有表 ≠ 在用（标准库自带全部模块的表）。分两层判，几分钟出结论：

```sql
-- 第一层：按表名前缀汇总「表数 / 有数据表数 / 总行数」（用 sys.partitions，别对大表 COUNT(*)）
SELECT LEFT(t.name,6) AS 前缀, COUNT(*) AS 表数,
       SUM(CASE WHEN p.rows > 0 THEN 1 ELSE 0 END) AS 有数据表数, SUM(p.rows) AS 总行数
FROM sys.tables t JOIN sys.partitions p ON p.object_id=t.object_id AND p.index_id IN (0,1)
WHERE t.name LIKE 'T_CN[_]%' OR t.name LIKE 'T_WB[_]%' OR t.name LIKE 'T_EB[_]%' OR t.name LIKE 'T_FM[_]%'
GROUP BY LEFT(t.name,6) ORDER BY 总行数 DESC;

-- 第二层：关键单据表取「最新业务日期」，区分「在用 / 早已停用 / 只有初始化数据」
-- 列名不能猜：先查 sys.columns 拿日期列，再 MAX()
SELECT name FROM sys.columns WHERE object_id=OBJECT_ID('dbo.T_CN_PAYAPPLY') AND (name LIKE '%DATE%' OR name LIKE '%TIME%');
SELECT CONVERT(varchar(19), MAX(FAPPROVEDATE), 120) AS 最新 FROM dbo.T_CN_PAYAPPLY;
SELECT FDocumentStatus, COUNT(*) FROM dbo.T_CN_PAYAPPLY GROUP BY FDocumentStatus;  -- A 草稿 / C 已审核
```

常用前缀速查：`T_CN_` 出纳（收付款申请、日记账、票据、银行账号）、`T_WB_` 网上银行与电子票据、`T_EB_` 银企互联（一张表都没有＝未部署）、`T_FM_` 资金管理、`T_AP_`/`T_AR_` 应付/应收、`T_GL_` 总账、`ER_` 费用报销、`CMK_`/`CMK_LS_` 零售、`Z_` 二开对象。

结论写三档，别只甩行数：**在用**（有数据且最新业务日期在近期，当天的更硬）、**仅初始化**（全是未审核草稿、或启用期那几条基础资料）、**未部署**（表都不存在）。实测样例：付款链在用（付款申请单 1414 张、最新核准当天 18:27；付款单 2842 张）、出纳日记账 / 银行转账单 / 票据均在用、银企互联与资金管理未使用（`T_WB_*` 业务表全 0 行、`T_EB_*`/`T_FM_*` 无表）。

> 探针里出现的每个列名都要先确认：`T_BAS_BILLTYPE` 没有 `FNAME` 列（直接回 `Invalid column name 'FNAME'`）。把「取列名」与「取数」分成两步，失败时才分得清是「没数据」还是「查询写错」。

## 7. 版别、服务期与二开：数据库查不到的部分

这三项都不能从账套库断定。先明确「数据库这侧的上限」，再走服务器侧：

- **企业版 / 标准版**：账套库这条路走不通（`T_BOS_REGISTER.FPRODUCTEDITION` 是无文档映射的码 `'0'`，全库无许可/授权表，`LIKE '%EDITION%' / '%LICENSE%'` 命中的全是业务口径字段），**但 WebAPI 登录响应里就有答案**：`Context.ProductEdition`。取值映射由金蝶自己的程序集定——反射 `Kingdee.BOS.Context` 的 `IsStandardEdition()` 实测只在 `ProductEdition == 1` 时返回 True（0/2/3 均 False），所以 `ProductEdition = 0` 即**企业版**。版别决定下载哪个补丁包，别用「安装盘里有 Standard 字样」「包名叫 K3Cloud V9 Standard」这类间接线索推；只有拿不到登录响应时才退回服务器端管理中心或客户端「关于」。
- **许可 / 标服服务期**（决定有没有补丁下载权限）：同样不在账套库，在管理中心的产品注册信息里，或用金蝶云账号登录 `PTDownload` 验证。间接佐证：`ManageSite\App_Data\Lic` 下的 `.lic` 若仍按约两个月一份持续更新（看 mtime 序列），说明许可签发通道还活着，能下载补丁的概率高——但仍以账号登录 `PTDownload` 的结果为准，不要把佐证说成结论。
- **二开清单**：数据库侧只有表名线索——`Z_` 前缀表（实测 1751 张，占 `T_` 表约两成）分两类形态：标准表同名镜像（`Z_PUR_XPOOrder` ↔ `T_PUR_XPOORDER`）和自定义对象表（`Z_<项目>_t_Cust*`）。登录页 `browserConfigStr` 里的插件列表只有标准插件（`Kingdee.EntryRole.HTML5.*`、`KDPWYWebSocket`、`QingboardRefresh.Plugin`），看不出二开。**元数据侧能给的是确定清单，不是迹象**：`T_META_OBJECTTYPE` 的 `FSUPPLIERNAME` 是二开商标记（去掉 `Kingdee` 即为二开，实测本环境共 232 个扩展对象、涉及 103 张标准单据，二开方 `UNW` 226 个 ＋ `ZBMY` 6 个），GUID 形态的 `FID` ＋ `FINHERITPATH` 直接给出「扩展自哪张标准单据」，对象元数据 XML 里的插件注册能列出挂载点。真正有代码的通常只是少数几处：**Python 脚本插件（`PyScript`）的源码就在元数据里、可直接导出，不依赖原二开方**；只有编译好的 C# dll（`WebSite\bin` 里 Company 非 Kingdee 的那些，如 `wfs.dll`）是黑盒。服务端 `ISVConfigure.xml`（ISV 注册码）与这两侧清单互为交叉验证；找不到原二开方时，把源码、dll、元数据 XML 一起导出留底即可接手（处置预案：出问题在元数据里把插件注册的 `IsEnabled` 置 False，**保留 dll 与元数据不删**，业务先恢复）。服务端两步就能定性：① `ManageSite\App_Data\ISVConfigure.xml` 读 ISV 注册（Name / DevCode / Id）；② `WebSite\bin` 里挑 `LastWriteTime` 晚于产品安装日期的 dll，看版本信息里的 Company / Product / Description 区分（金蝶标准程序集 Company 是 Kingdee，第三方/自研会写自家名字，如 `Company='P R C'`、`Product='scbl_plugin'`）。该清单必须交给二开方确认新补丁下的兼容性——这正是「二开多就地升到最后迭代补丁、不直接跳大版本」的理由。

需要进应用服务器时，不要枚举用户名反复试登录；直接把本机公钥和授权命令交给用户，让他执行后把用户名告诉你：

```powershell
$k = '<本机 ~/.ssh/*.pub 的内容>'
Add-Content -Path "$env:ProgramData\ssh\administrators_authorized_keys" -Value $k -Encoding utf8
icacls "$env:ProgramData\ssh\administrators_authorized_keys" /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F"
```

非管理员账号改为追加到 `C:\Users\<用户名>\.ssh\authorized_keys`。进服务器后按只读原则取这四样：管理中心产品注册（版别/服务期/许可模块）、`\K3Cloud\WebSite\bin` 与 BOS 插件注册（二开）、补丁安装日志/补丁目录（最后一次真正装补丁的日期，用来验证 `T_BOS_REGISTERPKGHISTORY` 的推断）、`UploadFiles` 后门检查。

## 8. 边界与交接

- 助手能做：版本/补丁差距盘点、补丁前检查清单、补丁后回查（DisplayVersion + 关键单据抽查）。前后各有一个只读脚本，已注册进 `package.json`、列入 README 命令表：
  - `bun run check-patch`（`scripts/tools/check_patch_prereq.js`）：采基线——版本/版别、每个数据中心的版本与最近备份时间、补丁记录表行数、模块与关键单据量，落 `output/patch_baseline_<时间戳>.json`。
  - `bun run verify-patch`（`scripts/tools/verify_after_patch.js`）：自动取最新基线逐项对比，打印 ✅/❌ 并存 `output/patch_verify_*.json`。**装补丁前跑它本来就该有 5 项 ❌**（DisplayVersion 未变、两张补丁记录表仍 0 行、数据中心 `FVISION` 未动、`FBOSVERSION` 未变）——这是「还没打补丁」的正确结果，可当作脚本可信度自检；打完补丁这几项必须转 ✅。单据量类项只判「不小于基线」，有新增业务属正常。
- 用户问「我现在该去做什么」时不要复述执行单，给按优先级排序的最少几件事：① **今天就发二开兼容性确认**（写明目标补丁号，问对方是否需重编译/回归）——它花的是别人的时间，是唯一能整体推迟窗口的外部依赖；② 定「按公告适用前提要装的业务补丁到底装不装」（零售/BBC/条码这类），要业务确认，不要按表推断；③ 定维护窗口并提前通知（应用与数据库同机＝整台停，外网 WebAPI 端口的对接方要停调用）；④ **备份提前做掉**，别等窗口当天：每个库＋程序目录，判断自动备份还在不在跑**只认 `msdb.dbo.backupset` 的真实备份历史 ＋ `sysjobs`/`sysjobhistory`**（做法见 `references/system/sqlserver-backup-and-agent-ops.md`；管理中心的 `FBACKUPDATE` 只是登记时间，按它下结论会误判成「一年没备份」），缺自动备份的账套当场补每日作业，同时注意历史记录指向的 `.bak` 可能早已不在，挑一个库试还原来验证备份可用；⑤ 补丁包到手先解除锁定/去只读、核对文件名与大小，再跑基线脚本。
- 助手做不了：装补丁（服务器端 IIS/SQL 操作，要停站点、要全库备份）、下载需要登录态的补丁包与社区附件——这部分明确写出来交给用户/实施，不要自行试登录。**例外**：公告直接给出链接的包（如 Fastjson 通用补丁，见 §5）无需登录，可以自己下好、传到服务器并核对哈希。
- 用户上传补丁下载页截图问「还要下哪些」时，按「已就位（文件/大小/位置） / 还差（逐包给到能照着点的页面路径） / 别下错（同页更高版本线的包）」三段答，不要只回一句「去 PTDownload 下载」。
- 一次性探测脚本按约定落在 `scripts/scratch/YYYY-MM/_probe_*.js`（已 gitignore），可复用后再晋升到 `scripts/tools/`。

## 9. 服务器侧只读探测手法（Windows + OpenSSH，实测可用）

- 本机先用 `write_file` 把 PowerShell 脚本写到临时目录，再走 SSH 执行；脚本化的好处是本地文件随时可改，别在 shell 里拼长命令。中文脚本用 **base64(UTF-16LE) + `-EncodedCommand`** 传，避免引号与中文编码问题：

```bash
cd "$LOCALAPPDATA/Temp"
B=$(python -c "import base64;print(base64.b64encode(open('kd_probe.ps1','rb').read().decode('utf-8').encode('utf-16-le')).decode())")
ssh -i C:/Users/<user>/.ssh/id_ed25519 -o BatchMode=yes -o ConnectTimeout=10 administrator@<host> \
  "powershell -NoProfile -EncodedCommand $B" 2>&1 | sed -n '3,$p'
```

- 脚本首行放 `[Console]::OutputEncoding=[Text.Encoding]::UTF8`，否则中文输出乱码；`sed -n '3,$p'` 用来跳过 ssh 的 banner 行。
- 探测拆成多个小脚本（`kd_probe1..N.ps1`）串行跑，便于定位和增量补充；单个脚本别输出太多：`Select-Object -First N`、`Get-ChildItem -Depth 3` 限深度，全盘 `-Recurse` 会跑到超时。
- 反射读金蝶程序集：先 `Set-Location $bin` 让依赖能解析，`[Reflection.Assembly]::LoadFrom("$bin\Kingdee.BOS.dll")` 之后**只取需要的类型**（`$asm.GetType('Kingdee.BOS.Context')`）。对大程序集调 `GetTypes()` 会把进程打爆（StackOverflowException）；加 `AssemblyResolve` 回调同样会递归爆栈——两条都别走。
- 全程只读，不动配置、不停服务、不改数据库；输出按「已验证事实 / 推断 / 待用户在前端确认」分栏写。

## 10. 补丁执行单的产出（用户说「做一个文档出来」时）

交付形态固定两件套，缺一不可：**md 主体进 `.agents/skills/kingdee-k3cloud/references/system/<topic>.md`**（并在 README「文档索引」加一行链接），**同时导出扁平 docx 放 `output/`**，回复里给 `C:\...\output\<名字>.docx` 绝对路径——用户要的是能直接转给实施/IT 的 Word，不是聊天里的结论。`output/` 已 gitignore，交付物别在 output 下再建子目录。

md→docx 用随技能附带的脚本：`python scripts/tools/md_to_docx.py <in.md> <out.docx>`（本机没有 pandoc；python-docx 1.2.0 可用，脚本已处理中文 eastAsia 字体、表格、勾选框）。生成后**回读核对**段落数与表格数应与 md 对得上（实测样例：104 段落 / 6 张表格 / 行数 6-8-4-13-13-7），别只报「已生成」。

执行单骨架（按此写，实施现场能直接打勾）：

1. 目标与现状表：当前版本 / 数据中心版本 / 版别 → 升级后目标值；
2. 补丁清单表：逐条列「包号 + 版本 + 构建号 / 影响版本范围 / **本环境是否需要**」，表下点明哪个包容易下错（如 V9.0 步骤要的是 `PT-163010`，不是同页的 `9.1.0.20250807`）；
3. 开工前置：下载权限、二开兼容确认（最高风险）、维护窗口（应用与数据库同机、外网 WebAPI 端口要提前通知）、模块启用确认；
4. 分阶段步骤（统一用 `- [ ]` 勾选框）：补丁包解锁 → 备份（每个库 + 程序目录 + 二开 dll + 许可）→ 停服务（逐个列服务名）→ 按序装补丁（每包装完先看日志）→ 启动（列启动顺序）→ 验证清单 → 回滚 → 加固项；
5. 执行记录表（时间 / 步骤 / 操作人 / 结果），留给现场手填；
6. 附录：本次实测基线快照（版本、版别判定依据、许可文件序列、IIS 绑定、外网暴露、`UploadFiles` 结果）＋ 二开程序集清单（文件名 / 时间 / Company·Product）。

收尾按 AGENTS.md 跑 `bun run test:safety` 与 `git diff --check`。执行单里的每个数字都必须来自实测或官方原文；推断项写「待确认」，不要写估计值凑成确定语气。

## 11. 停机与窗口安排（用户问「一定要停服务器才能更新吗」时按这个答）

**必须停，但停的是应用服务，不是关机。** 两个绕不过去的硬原因：① 补丁要覆盖 `WebSite\bin` 的 dll、`WEB-INF\lib` 的 jar 和前端资源，这些文件被运行中的 `w3wp.exe` / Tomcat 锁着，覆盖会失败，金蝶安装器本身也会检测服务状态、服务在跑直接拒绝安装；② 补丁不只是换文件，还要执行 SQL 改表结构（`P_ALTERPK` 改主键、`CREATE INDEX`、加字段、插预置数据），改结构必须没有人在写库。

- 停：IIS（W3SVC）＋ `K3CloudManager` / `K3CloudJobProcess` / `K3CloudMQService` / `K3CloudTomcat` / `K3CloudClienter` / `K3CloudGuardService`。**不停：SQL Server 服务必须保持运行**（安装器要连库做升级）。同机其他用途不受影响。
- **不能只停一个账套**：多个数据中心共用同一套程序集与同一个 SQL 实例，程序集没法只升一半 → 只能整机停。
- 时长量级（讲给业务听）：停机后手动备份三个库 15~30 min（开压缩后）＋ 补丁安装与数据库升级 **2~5 h（大头，主账套近 200 GB）** ＋ 启动与基础验证 30~60 min ≈ **半天到一天**。所以优先选停产期（制造企业看国庆/春节假期或低产周日），万一某包装失败还有余量看日志重试。
- 压窗口的做法：补丁包先挪到数据盘（系统盘常只剩几十 GB，而包合计约 2.8 GB）并预先解压；把「窗口期间禁用作业」和「补完重新启用」写成一条可重复执行的脚本；停机前 30 分钟先通知业务停止录单。
- **窗口期间必须禁用 SQL Agent 的备份 / 清理 / 体检作业**（本环境 5 个：主账套 00:00、佛山 01:00、管理中心库与系统库 02:00、清理 03:00、体检 04:00），否则会备下「改到一半」的不可回滚状态、或把停机前手动做的那份备份清掉；装完在启动步骤里**逐条重新启用**。
- 打完补丁的客户端分发不用另下安装包：服务器 `WebSite\ClientBin\K3CloudClientPortal.exe` 已就位，通知用户重跑一次即拉取与服务器匹配的新版本。
- 星空卫士的「离线检测包」在 `K3Cloud\Guard` 目录下通常**并不存在**（那儿只有程序本体，在线更新检测项还会报 `NullReferenceException`），要另向客服 / 社区索取；没取到时用手动三条替代验证：`RetaiKtmSite` / `QingSite\WEB-INF\lib` 下 `fastjson-1.2.X.jar` 已删或替换、WebAPI 返回的 `DisplayVersion` 已变、`T_BAS_DATACENTERMAJORVER` 由空变为有记录。
- 业务实在停不了一天时，**不要**把「只手工换 fastjson jar 先堵洞」当替代方案推荐（虽然只需重启 Tomcat 几分钟）：非官方做法、不覆盖其余月份的漏洞，而且会让 `T_BOS_REGISTERPKGHISTORY` 的补丁史缺一块，给后续打补丁留坑。改为压缩窗口或另选停产期。

## 辅助工具验证范围（2026-10-13）

`verify_kdpkg_packages.ps1` 已用包含 app.manifest 的本地 CAB（文件名含方括号）验证包名、版本、内层条目解析及源包哈希不变；缺 manifest 的包须退出失败。此验证不代表任何正式补丁已核对或安装。工具会在临时目录写提取文件，不改输入包。
