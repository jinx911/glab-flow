param(
  [Parameter(Mandatory = $true)] [string]$Workspace,
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Stop-Install([string]$Message) { Write-Error "[glab-flow] ERROR: $Message"; exit 1 }
function Write-Info([string]$Message) { Write-Host "[glab-flow] $Message" }
function Confirm-Install([string]$Message) {
  if ($Yes) { return }
  $answer = Read-Host "[glab-flow] $Message [y/N]"
  if ($answer -notin @('y', 'Y', 'yes', 'YES')) { Stop-Install '安装已取消。' }
}
function Assert-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { Stop-Install "$Name 安装后未进入 PATH，请重新打开 PowerShell 后重试。" }
}
function Add-SafeLink([string]$Source, [string]$Destination) {
  $parent = Split-Path -Parent $Destination
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  if (Test-Path -LiteralPath $Destination) {
    $item = Get-Item -Force -LiteralPath $Destination
    if ($item.LinkType -eq 'SymbolicLink' -and ([string]$item.Target) -eq $Source) { Write-Info "保留既有链接: $Destination"; return }
    Stop-Install "拒绝覆盖用户已有文件: $Destination"
  }
  try { New-Item -ItemType SymbolicLink -Path $Destination -Target $Source | Out-Null }
  catch { Stop-Install "创建符号链接失败。请在 Windows 开发者模式或管理员 PowerShell 中重新执行；原始错误：$($_.Exception.Message)" }
}
function Assert-SymlinkPermission {
  $probeDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "glab-flow-link-$PID"
  $probeTarget = Join-Path $probeDirectory 'target'
  $probeLink = Join-Path $probeDirectory 'link'
  try {
    New-Item -ItemType Directory -Force -Path $probeTarget | Out-Null
    New-Item -ItemType SymbolicLink -Path $probeLink -Target $probeTarget | Out-Null
  } catch {
    Stop-Install 'Windows 创建符号链接需要开发者模式或管理员 PowerShell。请启用后重试。'
  } finally {
    if (Test-Path -LiteralPath $probeDirectory) { Remove-Item -Force -Recurse -LiteralPath $probeDirectory }
  }
}

if (-not (Test-Path -LiteralPath $Workspace -PathType Container)) { Stop-Install "工作区不存在: $Workspace" }
$Workspace = (Resolve-Path -LiteralPath $Workspace).Path
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Stop-Install 'Windows 全量安装需要 winget。' }

Write-Host @"
[glab-flow] 完整安装计划（Windows/winget）
  1. 安装/更新 Git、Node.js LTS、glab、ripgrep、pnpm、Apifox CLI、CodeGraph、Playwright Chromium
  2. 为 Claude Code 与 Codex 安装 glab-flow 技能和内置 agents
  3. 安全完成 GitLab / Apifox 登录，并建立 $Workspace 的 CodeGraph 索引
  4. 运行 doctor；任一能力、授权或索引缺失都会以失败退出
"@
Confirm-Install '这会安装全局软件并修改你的 Agent 配置，继续吗？'
Assert-SymlinkPermission

foreach ($package in @('Git.Git', 'OpenJS.NodeJS.LTS', 'GitLab.glab', 'BurntSushi.ripgrep.MSVC')) {
  Write-Info "通过 winget 安装 $package…"
  winget install --id $package --exact --accept-package-agreements --accept-source-agreements
}
Assert-Command 'node'; Assert-Command 'npm'
$nodeMajor = [int](& node -p 'process.versions.node.split(".")[0]')
if ($nodeMajor -lt 20) { Stop-Install "需要 Node.js >=20，当前为 $(& node --version)" }

Write-Info '安装 pnpm、Apifox CLI、CodeGraph 和 Playwright…'
npm install -g pnpm@10.33.0 apifox-cli@latest @colbymchenry/codegraph@latest playwright@latest
foreach ($command in @('pnpm', 'glab', 'apifox', 'codegraph', 'rg', 'playwright')) { Assert-Command $command }
playwright install chromium
codegraph install --target=auto --yes

$claude = Join-Path $HOME '.claude'
$codex = Join-Path $HOME '.codex'
foreach ($client in @($claude, $codex)) {
  Add-SafeLink (Join-Path $Root 'skills/glab-flow') (Join-Path $client 'skills/glab-flow')
  Add-SafeLink (Join-Path $Root 'skills/init-glab-flow') (Join-Path $client 'skills/init-glab-flow')
  foreach ($agent in @('intake', 'review-preview', 'release-check')) { Add-SafeLink (Join-Path $Root "agents/$agent.md") (Join-Path $client "agents/$agent.md") }
}

pnpm --dir $Root install --frozen-lockfile
pnpm --dir $Root build
glab auth status *> $null
if ($LASTEXITCODE -ne 0) { Write-Info '请完成 GitLab 授权…'; glab auth login }
apifox whoami *> $null
if ($LASTEXITCODE -ne 0) { Write-Info '请完成 Apifox 授权；Token 不会由 glab-flow 记录。'; apifox login }
codegraph init $Workspace
& (Join-Path $Root 'scripts/doctor.ps1') -Workspace $Workspace
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Info "完整安装完成。下一步：/init-glab-flow $Workspace"
