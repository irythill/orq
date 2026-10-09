#!/usr/bin/env bash
# Prepares a folder that groups git repositories to be orchestrated by a conductor in herdr.
#
#   ./setup/new-conductor.sh <name> <workspace>
#   ./setup/new-conductor.sh acme ~/Code/acme-platform
#
# Creates (idempotent; never overwrites an already filled CLAUDE.md):
#   <workspace>/CLAUDE.md                   ecosystem map, from the template (fill it in)
#   <workspace>/.orquestra-conductor.md     conductor instructions (regenerated on every run)
#   <workspace>/.claude/settings.local.json pre-approved conductor permissions (regenerated)
#   <workspace>/.orquestra/ and .worktrees/
# herdr has no profile or fixed session: the conductor is opened with `herdr-conductor` in a pane, inside the folder.
set -euo pipefail

NAME=${1:?usage: new-conductor.sh <name> <workspace>}
WS=$(cd "${2:?give the workspace folder}" && pwd)
ROOT=$(cd "$(dirname "$0")/.." && pwd)

fill() { sed -e "s#{{WORKSPACE}}#$WS#g" -e "s#{{NAME}}#$NAME#g" "$1"; }

mkdir -p "$WS/.orquestra" "$WS/.worktrees" "$WS/.claude"

if [ ! -f "$WS/CLAUDE.md" ]; then
  fill "$ROOT/templates/workspace.CLAUDE.md" > "$WS/CLAUDE.md"
  echo "==> created $WS/CLAUDE.md (FILL IN repos, group, base, Plane and issue standard)"
else
  echo "==> $WS/CLAUDE.md already exists; check its 'Orchestration' section"
fi

fill "$ROOT/templates/conductor.instructions.md" > "$WS/.orquestra-conductor.md"
fill "$ROOT/templates/conductor.settings.local.json" > "$WS/.claude/settings.local.json"
echo "==> instructions in $WS/.orquestra-conductor.md and permissions in $WS/.claude/settings.local.json"

echo "==> suggested groups (CLAUDE.md Group column = herdr workspace):"
for dir in "$WS"/*/; do
  [ -d "$dir/.git" ] || [ -f "$dir/.git" ] || continue
  echo "    $(basename "$dir" | tr '[:upper:]_' '[:lower:]-') -> ${dir%/}"
done

cat <<EOT

Done. Next steps:
  1. Fill in $WS/CLAUDE.md (repo table with Group and Base, Plane projects, issue standard).
  2. Open herdr and, in a pane: cd $WS && herdr-conductor [account] [model]
  3. In the conductor: /issue <ID>
EOT
