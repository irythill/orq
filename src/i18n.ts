// m(en, pt) returns the text in the user's language. Same rules as setup/orq-i18n.sh and orq_i18n.py:
// $ORQ_LANG, else ui.lang from the merged config ("auto" | "en" | "pt"), else the system locale.
export type Lang = "en" | "pt";

export function systemLang(): Lang {
  const e = process.env;
  const loc = e.LC_ALL || e.LC_MESSAGES || e.LANG || Intl.DateTimeFormat().resolvedOptions().locale || "";
  return loc.toLowerCase().startsWith("pt") ? "pt" : "en";
}

export function detectLang(cfgLang?: unknown, useEnv = true): Lang {
  const v = useEnv ? process.env.ORQ_LANG : undefined;
  if (v === "en" || v === "pt") return v;
  if (cfgLang === "en" || cfgLang === "pt") return cfgLang;
  return systemLang();
}

let current: Lang | undefined;

export function setLang(l: Lang): void {
  current = l;
}

export function m(en: string, pt?: string): string {
  current ??= detectLang();
  return current === "pt" && pt !== undefined ? pt : en;
}
