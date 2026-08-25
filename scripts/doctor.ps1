param([Parameter(Mandatory = $true)] [string]$Workspace)

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Failures = 0
function Pass([string]$Message) { Write-Host "[doctor] PASS  $Message" }
function Fail([string]$Message) { Write-Error "[doctor] FAIL  $Message"; $script:Failures++ }
function Check-Command([string]$Name, [string]$Label) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) { Pass "$Label ($($command.Source))" } else { Fail "$Label 未安装" }
}
function Check-Link([string]$Source, [string]$Destination, [string]$Label) {
  if (Test-Path -LiteralPath $Destination) {
    $item = Get-Item -Force -LiteralPath $Destination
    if ($item.LinkType -eq 'SymbolicLink' -and ([string]$item.Target) -eq $Source) { Pass $Label; return }
  }
  Fail "$Label 缺失或不属于当前 checkout"
}

if (-not (Test-Path -LiteralPath $Workspace -PathType Container)) { Fail "工作区不存在: $Workspace" } else { $Workspace = (Resolve-Path -LiteralPath $Workspace).Path }
foreach ($item in @(@('git', 'Git'), @('node', 'Node.js'), @('pnpm', 'pnpm'), @('glab', 'GitLab CLI'), @('apifox', 'Apifox CLI'), @('codegraph', 'CodeGraph'), @('rg', 'ripgrep'), @('playwright', 'Playwright'))) { Check-Command $item[0] $item[1] }
if (Get-Command node -ErrorAction SilentlyContinue) {
  $nodeMajor = [int](& node -p 'process.versions.node.split(".")[0]')
  if ($nodeMajor -ge 20) { Pass "Node.js $nodeMajor >= 20" } else { Fail "Node.js 需要 >=20，当前为 $(& node --version)" }
}
if (Get-Command pnpm -ErrorAction SilentlyContinue) {
  if ((& pnpm --version) -eq '10.33.0') { Pass 'pnpm 10.33.0' } else { Fail "pnpm 必须为 10.33.0（当前 $(& pnpm --version)）" }
}
foreach ($client in @(Join-Path $HOME '.claude'), (Join-Path $HOME '.codex')) {
  foreach ($skill in @('glab-flow', 'init-glab-flow')) { Check-Link (Join-Path $Root "skills/$skill") (Join-Path $client "skills/$skill") "$client 的 $skill 技能链接" }
  foreach ($agent in @('intake', 'review-preview', 'release-check')) { Check-Link (Join-Path $Root "agents/$agent.md") (Join-Path $client "agents/$agent.md") "$client 的 $agent agent 链接" }
}
glab auth status *> $null
if ($LASTEXITCODE -eq 0) { Pass 'GitLab 已授权' } else { Fail 'GitLab 未授权；运行 glab auth login' }
apifox whoami *> $null
if ($LASTEXITCODE -eq 0) { Pass 'Apifox 已授权' } else { Fail 'Apifox 未授权或网络不可达；运行 apifox login' }
$browserList = (& playwright install --list 2>$null | Out-String)
if ($browserList -match 'chromium') { Pass 'Playwright Chromium 已安装' } else { Fail 'Playwright Chromium 未安装；运行 playwright install chromium' }
$codegraphReady = $false
if (Test-Path -LiteralPath (Join-Path $Workspace '.codegraph')) {
  & codegraph status $Workspace *> $null
  $codegraphReady = $LASTEXITCODE -eq 0
}
if ($codegraphReady) { Pass '业务工作区 CodeGraph 已初始化' } else { Fail '业务工作区尚未完成 CodeGraph 初始化；运行 codegraph init <workspace>' }
& pnpm --dir $Root cli version *> $null
if ($LASTEXITCODE -eq 0) { Pass 'glab-flow 引擎可运行' } else { Fail "glab-flow 引擎依赖未完成；运行 pnpm --dir $Root install --frozen-lockfile" }
if ($Failures -gt 0) { Write-Error "[doctor] 失败：$Failures 项未就绪。完整流程禁止启动。"; exit 1 }
Write-Host '[doctor] 全部能力、授权与工作区索引均已就绪。'
