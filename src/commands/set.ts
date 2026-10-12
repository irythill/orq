// orq set <section> <key> <value> — writes one string value into your orq config, atomically.
// TOML: replaces `key = ...` inside [section], adds the key or the section if missing; everything else is kept.
import { existsSync, readFileSync } from "node:fs";
import { writeAtomic } from "../fsutil.js";
import { userConfigFile } from "../paths.js";
import { setTomlString } from "../toml-set.js";

export const USAGE = "orq set <section> <key> <value>       e.g.  orq set ui theme lcd";

export function setValue(section: string, key: string, value: string): void {
  const f = userConfigFile();
  const text = existsSync(f) ? readFileSync(f, "utf8") : "";
  if (f.endsWith(".json")) {
    const j = text.trim() ? JSON.parse(text) : {};
    j[section] = { ...(j[section] ?? {}), [key]: value };
    writeAtomic(f, JSON.stringify(j, null, 2) + "\n");
  } else {
    writeAtomic(f, setTomlString(text, section, key, value));
  }
}

export function set(argv: string[]): number {
  if (argv.length !== 3) { console.error(USAGE); return 2; }
  setValue(argv[0], argv[1], argv[2]);
  return 0;
}
