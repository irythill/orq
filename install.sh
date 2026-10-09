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
BIN="$HOME/.local/bin"
UNIT_DIR="$HOME/.config/systemd/user"
ACCOUNTS="${CLAUDE_ACCOUNTS_FILE:-$HOME/.config/claude-accounts}"
DRY=0 UNINSTALL=0

for a in "$@"; do
  case "$a" in
    --dry-run|-n) DRY=1 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $a (see --help)" >&2; exit 2 ;;
  esac
done

if [ -t 1 ]; then R=$'\e[31m' G=$'\e[32m' Y=$'\e[33m' B=$'\e[1m' N=$'\e[0m'; else R='' G='' Y='' B='' N=''; fi
WARNINGS=0
say()  { echo "$@"; }
warn() { echo "${Y}warn${N}  $*"; WARNINGS=$((WARNINGS + 1)); }
run()  { if [ "$DRY" = 1 ]; then echo "  [dry-run] $*"; else "$@"; fi; }
row()  { printf '  %-8s %-18s %s\n' "$1" "$2" "$3"; }  # status, name, detail

# --- link helpers -------------------------------------------------------------------------------------------------
# link <target in repo> <link path>: replaces an existing symlink, never a real file or dir.
link() {
  local src=$1 dst=$2
  if [ -L "$dst" ]; then
    [ "$(readlink "$dst")" = "$src" ] && { echo "  ok      $dst"; return; }
    echo "  relink  $dst -> $src (was $(readlink "$dst"))"
  elif [ -e "$dst" ]; then
    warn "$dst exists and is not a symlink: skipped (move it away and re-run)"; return
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
    *) echo "  keep    $dst (points to $t, not this repo)" ;;
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
  say "${B}herdr service${N}"
  unit="$UNIT_DIR/herdr.service"
  if [ -L "$unit" ] && [ "$(readlink "$unit")" = "$ROOT/setup/herdr.service" ]; then
    say "  the herdr server keeps running; to stop it: systemctl --user disable --now herdr"
    unlink_ours "$unit"
    systemd_ok && run systemctl --user daemon-reload
  else
    unlink_ours "$unit"
  fi
  say "Done. ~/.config/orq/, history and workspaces were left untouched."
  exit 0
fi

# --- requirements -------------------------------------------------------------------------------------------------
say "${B}orq install${N} (repo: $ROOT)$([ "$DRY" = 1 ] && echo ' — dry run, nothing is changed')"
say ""
say "${B}requirements${N}"
ERRORS=0
for c in git jq python3; do
  if command -v "$c" >/dev/null; then row "${G}ok${N}" "$c" "$(command -v "$c")"
  else row "${R}MISSING${N}" "$c" "required: install it with your package manager"; ERRORS=$((ERRORS + 1)); fi
done
if command -v python3 >/dev/null; then
  pyv=$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')
  if python3 -c 'import sys; sys.exit(sys.version_info < (3, 11))'; then row "${G}ok${N}" "python TOML" "python $pyv (tomllib)"
  elif python3 -c 'import tomli' 2>/dev/null; then row "${G}ok${N}" "python TOML" "python $pyv + tomli"
  else row "${Y}warn${N}" "python TOML" "python $pyv < 3.11: use config.json or: pip install --user tomli"; WARNINGS=$((WARNINGS + 1)); fi
fi
if systemd_ok; then row "${G}ok${N}" "systemd --user" "works"
else row "${Y}warn${N}" "systemd --user" "not available: no herdr service, no per-agent memory cap (WSL2: enable systemd in /etc/wsl.conf)"; WARNINGS=$((WARNINGS + 1)); fi
if command -v herdr >/dev/null; then row "${G}ok${N}" "herdr" "$(command -v herdr)"
else
  row "${Y}warn${N}" "herdr" "missing; install it (read the script first):"
  echo "             curl -fsSL https://herdr.dev/install.sh -o /tmp/herdr-install.sh && less /tmp/herdr-install.sh && sh /tmp/herdr-install.sh"
  WARNINGS=$((WARNINGS + 1))
fi
AGENTS=0
for c in claude codex opencode agy copilot; do
  if command -v "$c" >/dev/null; then row "${G}ok${N}" "agent: $c" "$(command -v "$c")"; AGENTS=$((AGENTS + 1))
  else row "-" "agent: $c" "not found (optional)"; fi
done
[ "$AGENTS" = 0 ] && warn "no agent CLI found: install and log in to at least one (claude is needed for the conductor)"
command -v claude >/dev/null || warn "claude not found: the conductor and /orq-setup run inside Claude Code"
if [ "$ERRORS" -gt 0 ]; then
  echo "${R}error${N}: $ERRORS required tool(s) missing (git, jq, python3). Install them and re-run." >&2
  exit 1
fi

# --- scripts ------------------------------------------------------------------------------------------------------
say ""
say "${B}scripts → $BIN${N}"
while read -r f; do link "$f" "$BIN/$(basename "$f")"; done < <(scripts)
case ":$PATH:" in
  *":$BIN:"*) ;;
  *) warn "$BIN is not on PATH: add  export PATH=\"\$HOME/.local/bin:\$PATH\"  to ~/.bashrc (or ~/.zshrc)" ;;
esac

# --- herdr service ------------------------------------------------------------------------------------------------
say ""
say "${B}herdr service${N}"
if command -v herdr >/dev/null && systemd_ok; then
  link "$ROOT/setup/herdr.service" "$UNIT_DIR/herdr.service"
  [ -x "$BIN/herdr" ] || warn "the service runs $BIN/herdr, which does not exist (herdr is at $(command -v herdr)): link it there"
  run systemctl --user daemon-reload
  if systemctl --user is-active --quiet herdr 2>/dev/null; then
    echo "  ok      herdr service already running (not restarted)"
    run systemctl --user enable herdr --quiet
  else
    run systemctl --user enable --now herdr
  fi
else
  say "  skipped (needs herdr and systemd --user). Once both are there, re-run this or do it by hand:"
  say "    mkdir -p $UNIT_DIR && ln -sfn $ROOT/setup/herdr.service $UNIT_DIR/herdr.service"
  say "    systemctl --user daemon-reload && systemctl --user enable --now herdr"
fi

# --- skills -------------------------------------------------------------------------------------------------------
say ""
say "${B}Claude skills${N}"
while read -r root; do
  while read -r s; do link "$s" "$root/$(basename "$s")"; done < <(skills)
done < <(skill_roots | sort -u)

say ""
if [ "$WARNINGS" -gt 0 ]; then say "Done with $WARNINGS warning(s) (see above)."; else say "Done."; fi
say "${B}next:${N} open Claude and run /orq-setup"
