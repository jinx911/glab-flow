#!/usr/bin/env bash
# Full-runtime health check. A passing result means a user can start the
# configured workflow without a missing local capability.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKSPACE=""
FAILURES=0

usage() { echo "Usage: scripts/doctor.sh --workspace <business-workspace>"; }
pass() { echo "[doctor] PASS  $*"; }
fail() { echo "[doctor] FAIL  $*" >&2; FAILURES=$((FAILURES + 1)); }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace) WORKSPACE="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; fail "未知参数: $1"; shift ;;
  esac
done
[[ -n "$WORKSPACE" ]] || fail "必须指定 --workspace。"
if [[ -n "$WORKSPACE" && -d "$WORKSPACE" ]]; then WORKSPACE="$(cd "$WORKSPACE" && pwd)"; else fail "工作区不存在: $WORKSPACE"; fi

check_command() {
  local command_name="$1" label="$2"
  if command -v "$command_name" >/dev/null 2>&1; then pass "$label ($(command -v "$command_name"))"; else fail "$label 未安装"; fi
}
for pair in "git:Git" "node:Node.js" "pnpm:pnpm" "glab:GitLab CLI" "apifox:Apifox CLI" "codegraph:CodeGraph" "rg:ripgrep" "playwright:Playwright"; do
  command_name="${pair%%:*}"; label="${pair#*:}"; check_command "$command_name" "$label"
done

if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
  if [[ "$node_major" -ge 20 ]]; then pass "Node.js $node_major >= 20"; else fail "Node.js 需要 >=20，当前为 $(node --version 2>/dev/null || echo unknown)"; fi
fi
if command -v pnpm >/dev/null 2>&1; then
  if [[ "$(pnpm --version 2>/dev/null || true)" == "10.33.0" ]]; then pass "pnpm 10.33.0"; else fail "pnpm 必须为 10.33.0（当前 $(pnpm --version 2>/dev/null || echo unknown)）"; fi
fi

for client in "${HOME}/.claude" "${HOME}/.codex"; do
  for skill in glab-flow init-glab-flow; do
    if [[ -L "$client/skills/$skill" && "$(readlink "$client/skills/$skill")" == "$ROOT/skills/$skill" ]]; then pass "$client 的 $skill 技能链接"; else fail "$client 的 $skill 技能链接缺失或不属于当前 checkout"; fi
  done
  for agent in intake review-preview release-check; do
    if [[ -L "$client/agents/$agent.md" && "$(readlink "$client/agents/$agent.md")" == "$ROOT/agents/$agent.md" ]]; then pass "$client 的 $agent agent 链接"; else fail "$client 的 $agent agent 链接缺失或不属于当前 checkout"; fi
  done
done

if command -v glab >/dev/null 2>&1 && glab auth status >/dev/null 2>&1; then pass "GitLab 已授权"; else fail "GitLab 未授权；运行 glab auth login"; fi
if command -v apifox >/dev/null 2>&1 && apifox whoami >/dev/null 2>&1; then pass "Apifox 已授权"; else fail "Apifox 未授权或网络不可达；运行 apifox login"; fi
if command -v playwright >/dev/null 2>&1 && playwright install --list 2>/dev/null | grep -qi chromium; then pass "Playwright Chromium 已安装"; else fail "Playwright Chromium 未安装；运行 playwright install chromium"; fi
if [[ -n "$WORKSPACE" && -d "$WORKSPACE/.codegraph" ]] && codegraph status "$WORKSPACE" >/dev/null 2>&1; then pass "业务工作区 CodeGraph 已初始化"; else fail "业务工作区尚未完成 CodeGraph 初始化；运行 codegraph init <workspace>"; fi
if command -v pnpm >/dev/null 2>&1 && pnpm --dir "$ROOT" cli version >/dev/null 2>&1; then pass "glab-flow 引擎可运行"; else fail "glab-flow 引擎依赖未完成；运行 pnpm --dir $ROOT install --frozen-lockfile"; fi

if [[ "$FAILURES" -gt 0 ]]; then
  echo "[doctor] 失败：$FAILURES 项未就绪。完整流程禁止启动。" >&2
  exit 1
fi
echo "[doctor] 全部能力、授权与工作区索引均已就绪。"
