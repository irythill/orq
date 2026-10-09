#!/bin/bash
# Omarchy theme change -> herdr colors. Replaces the marked block in herdr's config with the herdr.toml generated from
# the template ~/.config/omarchy/themed/herdr.toml.tpl and reloads the server if it is running.
SRC="$HOME/.local/state/omarchy/current/theme/herdr.toml"
CFG="$HOME/.config/herdr/config.toml"
BEGIN="# >>> omarchy theme (generated, do not edit)"
OLD_BEGIN="# >>> omarchy theme (gerado, não edite)"   # marker written by older versions
END="# <<< omarchy theme"
[[ -f $SRC && -f $CFG ]] || exit 0
tmp=$(mktemp)
awk -v b="$BEGIN" -v ob="$OLD_BEGIN" -v e="$END" -v src="$SRC" '
  $0 == b || $0 == ob { skip = 1; next }
  $0 == e { skip = 0; next }
  !skip { print }
  END { print b; while ((getline l < src) > 0) print l; print e }
' "$CFG" > "$tmp" && mv "$tmp" "$CFG"
herdr server reload-config >/dev/null 2>&1 || true
