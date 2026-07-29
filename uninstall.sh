#!/bin/bash
set -e
CLAUDE="$HOME/.claude"
rm -f "$CLAUDE/skills/glab-flow" "$CLAUDE/skills/init-glab-flow" "$CLAUDE/agents/intake.md" "$CLAUDE/agents/review-preview.md" "$CLAUDE/agents/release-check.md"
echo "[glab-flow] uninstalled"
