#!/bin/bash
set -e
CLAUDE="$HOME/.claude"
CODEX="$HOME/.codex"
rm -f "$CLAUDE/skills/glab-flow" "$CLAUDE/skills/init-glab-flow" \
      "$CLAUDE/agents/intake.md" "$CLAUDE/agents/review-preview.md" "$CLAUDE/agents/release-check.md" \
      "$CODEX/skills/glab-flow" "$CODEX/skills/init-glab-flow"
echo "[glab-flow] uninstalled (~/.claude + ~/.codex)"
