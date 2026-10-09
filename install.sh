#!/usr/bin/env bash
# orq installer: checks requirements and links (never copies) the scripts, the herdr service and the skills.
#
#   ./install.sh               install (idempotent, safe to re-run, safe while sessions are using the scripts)
#   ./install.sh --dry-run     only print what would be done
#   ./install.sh --uninstall   remove only the links this installer creates, and only if they point into this repo
#
# It never writes ~/.config/orq/config.toml: that is /orq-setup's job (inside Claude).
set -uo pipefail

ROOT=$(cd "$(dirname "$0")" && pwd)
. "$ROOT/setup/orq-i18n.sh"   # m "<English>" "<Português>" (ORQ_LANG, ui.lang or the system locale)
BIN="$HOME/.local/bin"
UNIT_DIR="$HOME/.config/systemd/user"
ACCOUNTS="${CLAUDE_ACCOUNTS_FILE:-$HOME/.config/claude-accounts}"
DRY=0 UNINSTALL=0

for a in "$@"; do
  case "$a" in
    --dry-run|-n) DRY=1 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "$(m "unknown option" "opção desconhecida"): $a (--help)" >&2; exit 2 ;;
  esac
done

if [ -t 1 ]; then R=$'\e[31m' G=$'\e[32m' Y=$'\e[33m' B=$'\e[1m' N=$'\e[0m'; else R='' G='' Y='' B='' N=''; fi
WARNINGS=0
say()  { echo "$@"; }
warn() { echo "${Y}$(m warn aviso)${N}  $*"; WARNINGS=$((WARNINGS + 1)); }
run()  { if [ "$DRY" = 1 ]; then echo "  [dry-run] $*"; else "$@"; fi; }
row()  { printf '  %-8s %-18s %s\n' "$1" "$2" "$3"; }  # status, name, detail

# --- link helpers -------------------------------------------------------------------------------------------------
# link <target in repo> <link path>: replaces an existing symlink, never a real file or dir.
link() {
  local src=$1 dst=$2
  if [ -L "$dst" ]; then
    [ "$(readlink "$dst")" = "$src" ] && { echo "  ok      $dst"; return; }
    echo "  relink  $dst -> $src ($(m was antes): $(readlink "$dst"))"
  elif [ -e "$dst" ]; then
    warn "$dst $(m "exists and is not a symlink: skipped (move it away and re-run)" "existe e não é um link: pulei (tire-o do caminho e rode de novo)")"; return
  else
    echo "  link    $dst -> $src"
  fi
  [ -d "$(dirname "$dst")" ] || run mkdir -p "$(dirname "$dst")"
  run ln -sfn "$src" "$dst"
}
# unlink_ours <link path>: removes it only if it is a symlink pointing into this repo.
unlink_ours() {
  local dst=$1 t
  [ -L "$dst" ] || return 0
  t=$(readlink "$dst")
  case "$t" in
    "$ROOT"/*) echo "  remove  $dst"; run rm -f "$dst" ;;
    *) echo "  keep    $dst ($(m "points to $t, not this repo" "aponta para $t, não para este repo"))" ;;
  esac
}

# --- what we link -------------------------------------------------------------------------------------------------
scripts() {
  local f
  for f in "$ROOT"/setup/herdr-* "$ROOT"/setup/agent-quota "$ROOT"/setup/claude-accounts "$ROOT"/setup/orq-*; do
    [ -f "$f" ] && [ -x "$f" ] && echo "$f"
  done
}
skills() { local d; for d in "$ROOT"/skills/*/; do [ -f "$d/SKILL.md" ] && echo "${d%/}"; done; }
skill_roots() {
  echo "$HOME/.claude/skills"
  [ -f "$ACCOUNTS" ] || return 0
  sed -e 's/#.*//' -e "s|~|$HOME|" "$ACCOUNTS" | awk 'NF>=2 {print $2 "/skills"}'
}
systemd_ok() { command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1; }

# --- uninstall ----------------------------------------------------------------------------------------------------
if [ "$UNINSTALL" = 1 ]; then
  say "${B}orq uninstall${N} (repo: $ROOT)"
  say "${B}scripts${N}"
  while read -r f; do unlink_ours "$BIN/$(basename "$f")"; done < <(scripts)
  say "${B}skills${N}"
  while read -r root; do
    while read -r s; do unlink_ours "$root/$(basename "$s")"; done < <(skills)
  done < <(skill_roots | sort -u)
  say "${B}$(m "herdr service" "serviço do herdr")${N}"
  unit="$UNIT_DIR/herdr.service"
  if [ -L "$unit" ] && [ "$(readlink "$unit")" = "$ROOT/setup/herdr.service" ]; then
    say "  $(m "the herdr server keeps running; to stop it" "o servidor do herdr continua rodando; para parar"): systemctl --user disable --now herdr"
    unlink_ours "$unit"
    systemd_ok && run systemctl --user daemon-reload
  else
    unlink_ours "$unit"
  fi
  say "${B}herdr plugin${N}"
  if command -v herdr >/dev/null && herdr plugin list 2>/dev/null | grep -q "$ROOT/herdr-plugin"; then
    say "  remove  plugin orq"; run herdr plugin unlink orq >/dev/null
  fi
  say "$(m "Done. ~/.config/orq/, history and workspaces were left untouched." "Pronto. ~/.config/orq/, histórico e workspaces ficaram intactos.")"
  exit 0
fi

# --- requirements -------------------------------------------------------------------------------------------------
say "${B}$(m "orq install" "instalação do orq")${N} (repo: $ROOT)$([ "$DRY" = 1 ] && m ' — dry run, nothing is changed' ' — simulação, nada é alterado')"
say ""
say "${B}$(m requirements "pré-requisitos")${N}"
ERRORS=0
for c in git jq python3; do
  if command -v "$c" >/dev/null; then row "${G}ok${N}" "$c" "$(command -v "$c")"
  else row "${R}MISSING${N}" "$c" "$(m "required: install it with your package manager" "obrigatório: instale pelo gerenciador de pacotes")"; ERRORS=$((ERRORS + 1)); fi
done
if command -v python3 >/dev/null; then
  pyv=$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')
  if python3 -c 'import sys; sys.exit(sys.version_info < (3, 11))'; then row "${G}ok${N}" "python TOML" "python $pyv (tomllib)"
  elif python3 -c 'import tomli' 2>/dev/null; then row "${G}ok${N}" "python TOML" "python $pyv + tomli"
  else row "${Y}warn${N}" "python TOML" "python $pyv < 3.11: $(m "use config.json or" "use config.json ou"): pip install --user tomli"; WARNINGS=$((WARNINGS + 1)); fi
fi
if systemd_ok; then row "${G}ok${N}" "systemd --user" "$(m works funciona)"
else row "${Y}warn${N}" "systemd --user" "$(m "not available: no herdr service, no per-agent memory cap (WSL2: enable systemd in /etc/wsl.conf)" "indisponível: sem serviço do herdr e sem teto de memória por agente (WSL2: ligue o systemd em /etc/wsl.conf)")"; WARNINGS=$((WARNINGS + 1)); fi
if command -v herdr >/dev/null; then row "${G}ok${N}" "herdr" "$(command -v herdr)"
else
  row "${Y}$(m warn aviso)${N}" "herdr" "$(m "missing; install it (read the script first):" "ausente; instale (leia o script antes):")"
  echo "             curl -fsSL https://herdr.dev/install.sh -o /tmp/herdr-install.sh && less /tmp/herdr-install.sh && sh /tmp/herdr-install.sh"
  WARNINGS=$((WARNINGS + 1))
fi
AGENTS=0
for c in claude codex opencode agy copilot; do
  if command -v "$c" >/dev/null; then row "${G}ok${N}" "agent: $c" "$(command -v "$c")"; AGENTS=$((AGENTS + 1))
  else row "-" "agent: $c" "$(m "not found (optional)" "não encontrado (opcional)")"; fi
done
[ "$AGENTS" = 0 ] && warn "$(m "no agent CLI found: install and log in to at least one (claude is needed for the conductor)" "nenhum agente encontrado: instale e faça login em pelo menos um (o claude é necessário para o conductor)")"
command -v claude >/dev/null || warn "$(m "claude not found: the conductor and /orq-setup run inside Claude Code" "claude não encontrado: o conductor e o /orq-setup rodam dentro do Claude Code")"
if [ "$ERRORS" -gt 0 ]; then
  echo "${R}$(m error erro)${N}: $(m "$ERRORS required tool(s) missing (git, jq, python3). Install them and re-run." "faltam $ERRORS ferramenta(s) obrigatória(s) (git, jq, python3). Instale e rode de novo.")" >&2
  exit 1
fi

# --- scripts ------------------------------------------------------------------------------------------------------
say ""
say "${B}scripts → $BIN${N}"
while read -r f; do link "$f" "$BIN/$(basename "$f")"; done < <(scripts)
case ":$PATH:" in
  *":$BIN:"*) ;;
  *) warn "$BIN $(m "is not on PATH: add" "não está no PATH: adicione")  export PATH=\"\$HOME/.local/bin:\$PATH\"  $(m "to ~/.bashrc (or ~/.zshrc)" "no ~/.bashrc (ou ~/.zshrc)")" ;;
esac

# --- herdr service ------------------------------------------------------------------------------------------------
say ""
say "${B}$(m "herdr service" "serviço do herdr")${N}"
if command -v herdr >/dev/null && systemd_ok; then
  link "$ROOT/setup/herdr.service" "$UNIT_DIR/herdr.service"
  [ -x "$BIN/herdr" ] || warn "the service runs $BIN/herdr, which does not exist (herdr is at $(command -v herdr)): link it there"
  run systemctl --user daemon-reload
  if systemctl --user is-active --quiet herdr 2>/dev/null; then
    echo "  ok      $(m "herdr service already running (not restarted)" "serviço do herdr já rodando (não reiniciado)")"
    run systemctl --user enable herdr --quiet
  else
    run systemctl --user enable --now herdr
  fi
else
  say "  $(m "skipped (needs herdr and systemd --user). Once both are there, re-run this or do it by hand:" "pulado (precisa do herdr e do systemd --user). Quando os dois existirem, rode de novo ou faça à mão:")"
  say "    mkdir -p $UNIT_DIR && ln -sfn $ROOT/setup/herdr.service $UNIT_DIR/herdr.service"
  say "    systemctl --user daemon-reload && systemctl --user enable --now herdr"
fi

# --- skills -------------------------------------------------------------------------------------------------------
say ""
say "${B}$(m "Claude skills" "skills do Claude")${N}"
while read -r root; do
  while read -r s; do link "$s" "$root/$(basename "$s")"; done < <(skills)
done < <(skill_roots | sort -u)

# --- herdr plugin (language switch + board as an overlay) ---------------------------------------------------------
say ""
say "${B}$(m "herdr plugin" "plugin do herdr")${N}"
if command -v herdr >/dev/null; then
  if herdr plugin list 2>/dev/null | grep -q "$ROOT/herdr-plugin"; then echo "  ok      plugin orq"
  else echo "  link    plugin orq -> $ROOT/herdr-plugin"; run herdr plugin link "$ROOT/herdr-plugin" >/dev/null; fi
  if ! grep -q 'orq.lang-toggle' "$HOME/.config/herdr/config.toml" 2>/dev/null; then
    say "  $(m "optional keys — add to ~/.config/herdr/config.toml, then: herdr server reload-config" "teclas opcionais — adicione ao ~/.config/herdr/config.toml e rode: herdr server reload-config")"
    sed -n '2,6p' "$ROOT/herdr-plugin/herdr-plugin.toml" | sed 's/^# \{0,3\}/      /'
    say "      [[keys.command]] key = \"prefix+shift+b\" type = \"plugin_action\" command = \"orq.board\""
  fi
else
  say "  $(m "skipped (herdr not installed)" "pulado (herdr não instalado)")"
fi

say ""
if [ "$WARNINGS" -gt 0 ]; then say "$(m "Done with $WARNINGS warning(s) (see above)." "Pronto, com $WARNINGS aviso(s) (veja acima).")"; else say "$(m Done. Pronto.)"; fi
say "${B}$(m next: "próximo passo:")${N} $(m "open Claude and run /orq-setup" "abra o Claude e rode /orq-setup") · $(m "language" "idioma"): orq-lang pt|en|auto"
