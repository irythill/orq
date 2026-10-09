"""orq_i18n — m(en, pt) returns the text in the user's language (same rules as orq-i18n.sh):
$ORQ_LANG, else ui.lang from the merged config ("auto" | "en" | "pt"), else the system locale."""
import os


def lang(cfg=None):
    v = os.environ.get("ORQ_LANG")
    if v in ("en", "pt"):
        return v
    v = ((cfg or {}).get("ui") or {}).get("lang", "auto")
    if v in ("en", "pt"):
        return v
    loc = os.environ.get("LC_ALL") or os.environ.get("LC_MESSAGES") or os.environ.get("LANG") or ""
    return "pt" if loc.startswith("pt") else "en"


_LANG = None


def set_lang(cfg=None):
    global _LANG
    _LANG = lang(cfg)
    os.environ.setdefault("ORQ_LANG", _LANG)


def m(en, pt=None):
    global _LANG
    if _LANG is None:
        _LANG = lang()
    return pt if (_LANG == "pt" and pt is not None) else en
