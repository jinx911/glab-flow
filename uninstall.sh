#!/usr/bin/env bash
# Removes only links created by this checkout. Global runtime dependencies and
# user credentials are retained because they may serve other projects.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
CLAUDE="${HOME}/.claude"
CODEX="${HOME}/.codex"

remove_link() {
  local source="$1" destination="$2"
  if [[ -L "$destination" && "$(readlink "$destination")" == "$source" ]]; then
    rm "$destination"
    echo "[glab-flow] removed $destination"
  elif [[ -e "$destination" || -L "$destination" ]]; then
    echo "[glab-flow] keep user-owned path: $destination"
  fi
}

remove_link "$ROOT/skills/glab-flow" "$CLAUDE/skills/glab-flow"
remove_link "$ROOT/skills/init-glab-flow" "$CLAUDE/skills/init-glab-flow"
remove_link "$ROOT/skills/glab-flow" "$CODEX/skills/glab-flow"
remove_link "$ROOT/skills/init-glab-flow" "$CODEX/skills/init-glab-flow"
for agent in intake review-preview release-check; do
  remove_link "$ROOT/agents/$agent.md" "$CLAUDE/agents/$agent.md"
  remove_link "$ROOT/agents/$agent.md" "$CODEX/agents/$agent.md"
done
echo "[glab-flow] skill links removed; global tools and credentials were retained."
