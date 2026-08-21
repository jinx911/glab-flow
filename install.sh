#!/bin/bash
# glab-flow installer — symlinks skill + agents into ~/.claude (Claude Code) and ~/.codex (Codex)
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE="$HOME/.claude"
CODEX="$HOME/.codex"
mkdir -p "$CLAUDE/skills" "$CLAUDE/agents" "$CODEX/skills"
ln -sf "$DIR/skills/glab-flow" "$CLAUDE/skills/glab-flow"
ln -sf "$DIR/skills/init-glab-flow" "$CLAUDE/skills/init-glab-flow"
ln -sf "$DIR/skills/glab-flow" "$CODEX/skills/glab-flow"
ln -sf "$DIR/skills/init-glab-flow" "$CODEX/skills/init-glab-flow"
for a in intake review-preview release-check; do
  ln -sf "$DIR/agents/$a.md" "$CLAUDE/agents/$a.md"
done
echo "[glab-flow] installed → ~/.claude + ~/.codex (glab-flow + init-glab-flow skills, 3 agents)"
echo "[glab-flow] symlinks point at this repo: master 更新即双端生效,无需重装"
echo "[glab-flow] engine:      cd $DIR && pnpm install"
echo "[glab-flow] configure:   /init-glab-flow  (生成 config.md=交付流程 + test-config.md=测试配置)"
echo "[glab-flow] apifox CLI:  接口测试需要 (npm i -g apifox-cli && apifox login --with-token <token>)"
