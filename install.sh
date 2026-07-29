#!/bin/bash
# glab-flow installer — symlinks skill + agents into ~/.claude
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE="$HOME/.claude"
mkdir -p "$CLAUDE/skills" "$CLAUDE/agents"
ln -sf "$DIR/skills/glab-flow" "$CLAUDE/skills/glab-flow"
ln -sf "$DIR/skills/init-glab-flow" "$CLAUDE/skills/init-glab-flow"
for a in intake review-preview release-check; do
  ln -sf "$DIR/agents/$a.md" "$CLAUDE/agents/$a.md"
done
echo "[glab-flow] installed (glab-flow skill + init-glab-flow + 3 agents)."
echo "[glab-flow] engine: cd $DIR && pnpm install"
echo "[glab-flow] configure: /init-glab-flow  (glab CLI handles auth — no token needed)"
