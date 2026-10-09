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
. "$(dirname "$(realpath "$0")")/orq-i18n.sh"

NAME=${1:?"$(m usage uso): new-conductor.sh <name> <workspace>"}
WS=$(cd "${2:?"$(m "give the workspace folder" "informe a pasta do workspace")"}" && pwd)
ROOT=$(cd "$(dirname "$0")/.." && pwd)

fill() { sed -e "s#{{WORKSPACE}}#$WS#g" -e "s#{{NAME}}#$NAME#g" "$1"; }

mkdir -p "$WS/.orquestra" "$WS/.worktrees" "$WS/.claude"

if [ ! -f "$WS/CLAUDE.md" ]; then
  fill "$ROOT/templates/workspace.CLAUDE.md" > "$WS/CLAUDE.md"
  echo "==> $(m "created $WS/CLAUDE.md (FILL IN repos, group, base, Plane and issue standard)" "criado $WS/CLAUDE.md (PREENCHA repos, grupo, base, Plane e padrão de issue)")"
else
  echo "==> $(m "$WS/CLAUDE.md already exists; check its 'Orchestration' section" "$WS/CLAUDE.md já existe; confira a seção 'Orchestration'")"
fi

fill "$ROOT/templates/conductor.instructions.md" > "$WS/.orquestra-conductor.md"
fill "$ROOT/templates/conductor.settings.local.json" > "$WS/.claude/settings.local.json"
echo "==> $(m "instructions in $WS/.orquestra-conductor.md and permissions in $WS/.claude/settings.local.json" "instruções em $WS/.orquestra-conductor.md e permissões em $WS/.claude/settings.local.json")"

echo "==> $(m "suggested groups (CLAUDE.md Group column = herdr workspace):" "grupos sugeridos (coluna Group do CLAUDE.md = workspace do herdr):")"
for dir in "$WS"/*/; do
  [ -d "$dir/.git" ] || [ -f "$dir/.git" ] || continue
  echo "    $(basename "$dir" | tr '[:upper:]_' '[:lower:]-') -> ${dir%/}"
done

if [ "$ORQ_LANG" = pt ]; then cat <<EOT

Pronto. Próximos passos:
  1. Preencha $WS/CLAUDE.md (tabela de repos com Group e Base, projetos do Plane, padrão de issue).
  2. Abra o herdr e, num pane: cd $WS && herdr-conductor [conta] [modelo]
  3. No conductor: /issue <ID>
EOT
else cat <<EOT

Done. Next steps:
  1. Fill in $WS/CLAUDE.md (repo table with Group and Base, Plane projects, issue standard).
  2. Open herdr and, in a pane: cd $WS && herdr-conductor [account] [model]
  3. In the conductor: /issue <ID>
EOT
fi
