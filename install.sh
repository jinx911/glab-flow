#!/usr/bin/env bash
# A successful exit means the complete local runtime and the supplied business
# workspace's CodeGraph index have been installed and verified.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
YES=0
WORKSPACE=""

usage() {
  cat <<'EOF'
Usage: ./install.sh --workspace <business-workspace> [--yes]

Installs and verifies the complete glab-flow runtime: Git, Node.js, pnpm,
glab, Apifox CLI, CodeGraph, ripgrep, Playwright Chromium, npm dependencies,
agent skill links and login/index health checks.

--workspace  Business workspace glab-flow will drive. CodeGraph is indexed
             there, never in the glab-flow checkout.
--yes        Accept the displayed global-installation plan without prompting.
EOF
}

die() { echo "[glab-flow] ERROR: $*" >&2; exit 1; }
info() { echo "[glab-flow] $*"; }

confirm() {
  if [[ "$YES" == "1" ]]; then return; fi
  read -r -p "[glab-flow] $1 [y/N] " answer
  [[ "$answer" == "y" || "$answer" == "Y" || "$answer" == "yes" || "$answer" == "YES" ]] || die "安装已取消。"
}

node_is_supported() {
  command -v node >/dev/null 2>&1 && [[ "$(node -p 'Number(process.versions.node.split(".")[0])')" -ge 20 ]]
}

run_system() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then "$@"; else command -v sudo >/dev/null 2>&1 || die "当前系统需要 sudo 才能安装系统依赖。"; sudo "$@"; fi
}

install_macos() {
  if ! command -v brew >/dev/null 2>&1; then
    command -v curl >/dev/null 2>&1 || die "缺少 curl，无法获取 Homebrew。"
    info "安装 Homebrew（官方安装器）…"
    NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    if [[ -x /opt/homebrew/bin/brew ]]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi
    if [[ -x /usr/local/bin/brew ]]; then eval "$(/usr/local/bin/brew shellenv)"; fi
  fi
  info "通过 Homebrew 安装 Git、Node、glab 和 ripgrep…"
  brew install git node glab ripgrep
}

install_debian() {
  command -v apt-get >/dev/null 2>&1 || die "Linux 仅自动支持 Debian/Ubuntu（apt-get）。"
  info "通过 apt 安装 Git、Node、glab、ripgrep 和基础下载工具…"
  run_system apt-get update
  run_system apt-get install -y ca-certificates curl git glab nodejs npm ripgrep
  if ! node_is_supported; then
    info "系统 Node.js 低于 v20，切换到 NodeSource Node.js 22 LTS 源…"
    curl -fsSL https://deb.nodesource.com/setup_22.x | run_system bash -
    run_system apt-get install -y nodejs
  fi
}

safe_link() {
  local source="$1" destination="$2"
  mkdir -p "$(dirname "$destination")"
  if [[ -e "$destination" || -L "$destination" ]]; then
    if [[ -L "$destination" && "$(readlink "$destination")" == "$source" ]]; then info "保留既有链接: $destination"; return; fi
    die "拒绝覆盖用户已有文件: $destination"
  fi
  ln -s "$source" "$destination"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace) WORKSPACE="${2:-}"; shift 2 ;;
    --yes) YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "未知参数: $1" ;;
  esac
done
[[ -n "$WORKSPACE" ]] || { usage; die "必须指定 --workspace。"; }
[[ -d "$WORKSPACE" ]] || die "工作区不存在: $WORKSPACE"
WORKSPACE="$(cd "$WORKSPACE" && pwd)"

case "$(uname -s)" in
  Darwin) PLATFORM="macOS/Homebrew" ;;
  Linux) PLATFORM="Debian/Ubuntu apt" ;;
  MINGW*|MSYS*|CYGWIN*) die "Windows 请在 PowerShell 执行 .\\install.ps1 -Workspace <path>。" ;;
  *) die "不支持的系统: $(uname -s)" ;;
esac
cat <<EOF
[glab-flow] 完整安装计划（${PLATFORM}）
  1. 安装/更新 Git、Node.js 20+、pnpm、glab、Apifox CLI、CodeGraph、ripgrep、Playwright Chromium
  2. 为 Claude Code 与 Codex 安装 glab-flow 技能和内置 agents
  3. 安全完成 GitLab / Apifox 登录，并建立 $WORKSPACE 的 CodeGraph 索引
  4. 运行 doctor；任一能力、授权或索引缺失都会以失败退出
EOF
confirm "这会安装全局软件并修改你的 Agent 配置，继续吗？"

case "$(uname -s)" in Darwin) install_macos ;; Linux) install_debian ;; esac
node_is_supported || die "需要 Node.js >=20，当前版本为 $(node --version 2>/dev/null || echo missing)。"
if ! git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  INSTALL_ROOT="${GLAB_FLOW_INSTALL_DIR:-${HOME}/.local/share/glab-flow}"
  info "当前为源码压缩包分发，迁移到可更新的 Git checkout: $INSTALL_ROOT"
  if [[ ! -d "$INSTALL_ROOT/.git" ]]; then
    mkdir -p "$(dirname "$INSTALL_ROOT")"
    git clone --depth 1 https://github.com/jinx911/glab-flow.git "$INSTALL_ROOT"
  fi
  args=(--workspace "$WORKSPACE")
  if [[ "$YES" == "1" ]]; then args+=(--yes); fi
  exec "$INSTALL_ROOT/install.sh" "${args[@]}"
fi
info "安装 pnpm、Apifox CLI、CodeGraph 和 Playwright…"
npm install -g pnpm@10.33.0 apifox-cli@latest @colbymchenry/codegraph@latest playwright@latest
for command_name in pnpm glab apifox codegraph rg playwright; do command -v "$command_name" >/dev/null 2>&1 || die "$command_name 安装后未进入 PATH，请重新打开终端后重试。"; done
info "安装 Playwright Chromium 浏览器…"
playwright install chromium
info "将 CodeGraph 注册到已安装的 Agent 客户端…"
codegraph install --target=auto --yes

CLAUDE="${HOME}/.claude"
CODEX="${HOME}/.codex"
safe_link "$ROOT/skills/glab-flow" "$CLAUDE/skills/glab-flow"
safe_link "$ROOT/skills/init-glab-flow" "$CLAUDE/skills/init-glab-flow"
safe_link "$ROOT/skills/glab-flow" "$CODEX/skills/glab-flow"
safe_link "$ROOT/skills/init-glab-flow" "$CODEX/skills/init-glab-flow"
for agent in intake review-preview release-check; do
  safe_link "$ROOT/agents/$agent.md" "$CLAUDE/agents/$agent.md"
  safe_link "$ROOT/agents/$agent.md" "$CODEX/agents/$agent.md"
done

info "安装引擎依赖并构建…"
pnpm --dir "$ROOT" install --frozen-lockfile
pnpm --dir "$ROOT" build
if ! glab auth status >/dev/null 2>&1; then info "请完成 GitLab 授权…"; glab auth login; fi
if ! apifox whoami >/dev/null 2>&1; then info "请完成 Apifox 授权；Token 不会由 glab-flow 记录。"; apifox login; fi
info "初始化业务工作区的 CodeGraph 索引…"
codegraph init "$WORKSPACE"
"$ROOT/scripts/doctor.sh" --workspace "$WORKSPACE"
info "完整安装完成。下一步：/init-glab-flow $WORKSPACE"
