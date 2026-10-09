# orq-i18n.sh — sourced by orq's bash scripts (not executable). `m "<English>" "<Português>"` prints the text in the
# user's language. Language: $ORQ_LANG, else ui.lang from orq-config ("auto" | "en" | "pt"), else the system locale.
if [ -z "${ORQ_LANG:-}" ]; then
  _orq_l=$("$(dirname "$(realpath "${BASH_SOURCE[0]}")")/orq-config" get ui.lang 2>/dev/null || true)
  case $_orq_l in
    en|pt) ORQ_LANG=$_orq_l ;;
    *) case ${LC_ALL:-${LC_MESSAGES:-${LANG:-}}} in pt*) ORQ_LANG=pt ;; *) ORQ_LANG=en ;; esac ;;
  esac
  export ORQ_LANG; unset _orq_l
fi
m() { if [ "$ORQ_LANG" = pt ] && [ $# -ge 2 ]; then printf '%s' "$2"; else printf '%s' "$1"; fi; }
