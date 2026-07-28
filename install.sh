#!/bin/bash
# glab-flow installer — symlinks skill + agents into ~/.claude
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE="$HOME/.claude"
mkdir -p "$CLAUDE/skills" "$CLAUDE/agents"
ln -sf "$DIR/skills/glab-flow" "$CLAUDE/skills/glab-flow"
for a in intake review-preview release-check; do
  ln -sf "$DIR/agents/$a.md" "$CLAUDE/agents/$a.md"
done
echo "[glab-flow] installed (skill + 3 agents). Engine: cd $DIR && pnpm install"
echo "[glab-flow] set: export GLAB_FLOW_TOKEN=<your-gitlab-token>"
