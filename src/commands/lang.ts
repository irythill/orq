// orq lang                 show the current language
// orq lang pt|en|auto      set it (auto = system locale)
// orq lang toggle          switch between en and pt
// --notify                 also show a herdr pop-up (used by the herdr key binding)
// Applies to whatever starts afterwards (board, notices, orq pick...); running agents keep their language.
import { spawnSync } from "node:child_process";
import { getPath, loadConfig } from "../config.js";
import { detectLang } from "../i18n.js";
import { setValue } from "./set.js";

export const USAGE = "orq lang [pt|en|auto|toggle] [--notify]";

const cfgLang = () => getPath(loadConfig().cfg, "ui.lang");

export function lang(argv: string[]): number {
  let notify = false, arg = "";
  for (const a of argv) {
    if (a === "--notify") notify = true;
    else if (["pt", "en", "auto", "toggle"].includes(a)) arg = a;
    else { console.error(`usage: ${USAGE}`); return 2; }
  }
  const cur = detectLang(cfgLang(), false); // effective language, ignoring $ORQ_LANG
  if (!arg) {
    console.log(`${cur} (ui.lang = ${cfgLang() ?? "auto"})`);
    return 0;
  }
  setValue("ui", "lang", arg === "toggle" ? (cur === "pt" ? "en" : "pt") : arg);
  const msg = detectLang(cfgLang(), false) === "pt" ? "Idioma do orq: Português" : "orq language: English";
  console.log(msg);
  if (notify) spawnSync("herdr", ["notification", "show", msg], { stdio: "ignore" });
  return 0;
}
