// orq block — takes an agent (or account) out of orq-pick until a date. For quotas without a collector
// (Antigravity, Copilot, MiniMax) or any outage you know about before the agent fails.
// State in <state dir>/blocks.json ({name: {until: <epoch seconds>, reason, acct}}), shared with orq-pick. `acct` is the
// login at block time (src/identity.ts): if the agent/account is logged into another one later, the block is dropped.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../fsutil.js";
import { loginId } from "../identity.js";
import { m } from "../i18n.js";
import { stateDir } from "../paths.js";
import { getPath, loadConfig } from "../config.js";
import { collect, type Source } from "../quota.js";

export const USAGE = `orq block <agent|account> [--until YYYY-MM-DD[THH:MM] | --days N | --quota] [--reason "text"]   default: 7 days; --quota: until the quota window resets
orq block -r <agent|account>       unblock early
orq block -l                       list active blocks (expired ones disappear by themselves)`;

interface Block { until: number; reason?: string; acct?: string }
type Blocks = Record<string, Block>;

const file = () => join(stateDir(), "blocks.json");
const now = () => Date.now() / 1000;
const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function load(): Blocks {
  let b: Blocks = {};
  try { b = JSON.parse(readFileSync(file(), "utf8")); } catch { /* missing or broken: no blocks */ }
  const live = Object.fromEntries(Object.entries(b).filter(([, v]) => (v?.until ?? 0) > now()));
  // A block made under another login (the account was switched) no longer applies: the new one has its own quota.
  const kept = Object.fromEntries(Object.entries(live).filter(([k, v]) => {
    if (!v.acct) return true;
    const cur = loginId(k);
    return cur === undefined || cur === v.acct;
  }));
  if (Object.keys(kept).length !== Object.keys(live).length) { try { save(kept); } catch { /* best effort */ } }
  return kept;
}

const save = (b: Blocks) => writeAtomic(file(), JSON.stringify(b, null, 2));

/** "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" in local time (a bare date in JS would be UTC). */
export function parseLocal(s: string): Date {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00` : s);
  if (Number.isNaN(d.getTime())) throw new Error(m(`invalid date: ${s}`, `data inválida: ${s}`));
  return d;
}

/** When a quota line's exhausted window resets, in epoch seconds: the week if it is used up, else the 5h window (the
 *  reading can lag behind the limit: Codex's comes from its last session). undefined = no reset known. */
export function quotaUntil(line: string): number | undefined {
  const reset = (k: string) => { const x = new RegExp(`\\b${k}=(\\d+)`).exec(line); return x ? Number(x[1]) : undefined; };
  const week = /\bweek=(\d+)%/.exec(line);
  if (week && Number(week[1]) >= 100 && reset("resetweek")) return reset("resetweek");
  return reset("reset5h") ?? reset("resetweek");
}

export async function block(argv: string[]): Promise<number> {
  const b = load();
  if (!argv.length || argv[0] === "-h" || argv[0] === "--help") { console.log(USAGE); return 0; }
  if (argv[0] === "-l") {
    for (const k of Object.keys(b).sort())
      console.log(`${k.padEnd(14)} ${m("until", "até")} ${fmt(new Date(b[k].until * 1000))}  ${b[k].reason ?? ""}`);
    if (!Object.keys(b).length) console.log(m("no active blocks", "nenhum bloqueio ativo"));
    return 0;
  }
  if (argv[0] === "-r") {
    if (!argv[1]) { console.error(USAGE); return 2; }
    delete b[argv[1]]; save(b);
    console.log(`${argv[1]} ${m("unblocked", "liberado")}`);
    return 0;
  }
  const [name, ...rest] = argv;
  let until = new Date(Date.now() + 7 * 86400_000), reason = "", byQuota = false;
  while (rest.length) {
    const o = rest.shift();
    if (o === "--until") until = parseLocal(rest.shift() ?? "");
    else if (o === "--days") until = new Date(Date.now() + Number(rest.shift()) * 86400_000);
    else if (o === "--reason") reason = rest.shift() ?? "";
    else if (o === "--quota") byQuota = true;
  }
  if (byQuota) {
    const sources = (getPath(loadConfig().cfg, "quota") ?? {}) as Record<string, Source>;
    const line = (await collect(sources, [name])).find((l) => l.startsWith(`${name} `));
    const r = line && quotaUntil(line);
    if (!r) { console.error(m(`${name}: no quota reset known; use --until or --days`, `${name}: sem horário de renovação da cota; use --until ou --days`)); return 1; }
    until = new Date(r * 1000);
  }
  if (Number.isNaN(until.getTime())) { console.error(USAGE); return 2; }
  const acct = loginId(name);
  b[name] = { until: until.getTime() / 1000, reason, ...(acct ? { acct } : {}) };
  save(b);
  console.log(`${name} ${m("out of orq-pick until", "fora do orq-pick até")} ${fmt(until)}`);
  return 0;
}
