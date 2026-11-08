# 金蝶补丁包批量核对：大小 / SHA256 / 网络锁定 / 包内 app.manifest 身份
# 用途：用户说「包下好了」后，一次把「下了哪些、是不是目标包」问清楚；不修改输入包；会在临时目录提取 app.manifest。
# 用法（服务器侧）：
#   powershell -NoProfile -File verify_kdpkg_packages.ps1 -Path "C:\Users\Administrator\Downloads"
# 经 SSH 调用时用 base64(UTF-16LE) + -EncodedCommand 传（见 references/system/version-and-patch-inventory.md 的服务器取证步骤）。
param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw "输入目录不存在: $Path" }

[Console]::OutputEncoding = [Text.Encoding]::UTF8
$work = Join-Path $env:TEMP ('kdpkg_verify_' + [Guid]::NewGuid().ToString('N'))
$script:verifyFailed = $false
New-Item -ItemType Directory -Force -Path $work | Out-Null

# 关键：文件名常含 []（官方加固包），一路用 -LiteralPath，否则 PowerShell 当通配符报「文件不存在」
Get-ChildItem -LiteralPath $Path -Recurse -File -Filter *.kdpkg |
  Sort-Object FullName | ForEach-Object {
    $f    = $_
    $stream = [IO.File]::OpenRead($f.FullName)
    try {
      $bytes = New-Object byte[] 4
      $count = $stream.Read($bytes, 0, 4)
      $sig = if ($count -eq 0) { '' } else { ($bytes[0..($count-1)] | ForEach-Object { $_.ToString('X2') }) -join ' ' }
    } finally { $stream.Dispose() }
    $kind = if ($sig -like '4D 53 43 46*') { 'CAB' } elseif ($sig -like '50 4B*') { 'ZIP' } else { '未知' }
    $lock = if (Get-Item -LiteralPath $f.FullName -Stream Zone.Identifier -ErrorAction SilentlyContinue) { '锁定' } else { '已解锁' }

    '== ' + $f.FullName
    '   大小 {0:N0} KB   修改 {1}   {2}   头 {3} ({4})' -f ($f.Length/1KB), $f.LastWriteTime, $lock, $sig, $kind
    '   SHA256 ' + (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash

    # app.manifest 抽到现存目录；-R 恢复包内文件名，输出目录不拼尾反斜杠。
    $sub = Join-Path $work ([Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $sub | Out-Null
    & expand.exe -R "$($f.FullName)" -F:app.manifest "$sub" 2>&1 | Out-Null
    $expandExit = $LASTEXITCODE
    $m = Join-Path $sub 'app.manifest'
    if ($expandExit -eq 0 -and (Test-Path -LiteralPath $m)) {
      [xml]$x = Get-Content -LiteralPath $m -Encoding UTF8
      '   包名 {0}   版本 {1}   ISV {2}' -f $x.Package.PackageName, $x.Package.Version, $x.Package.ISV
      $x.Package.Resource.ResourceItem | ForEach-Object { '     内层组件: ' + $_.FilePath }
      if ([string]::IsNullOrWhiteSpace($x.Package.SignVerifyContent.SignContent)) {
        '     签名: 空（整合补丁 TempPatch 属正常，不代表下载损坏）'
      } else {
        '     签名: 有（' + $x.Package.SignVerifyContent.SignType + '）'
      }
    }
    else { $script:verifyFailed = $true; '   app.manifest 抽取失败：检查包格式、包内条目及 expand 返回码；不能判为核对通过' }
    ''
  }

'manifest 临时目录: ' + $work

if ($script:verifyFailed) { exit 1 }
