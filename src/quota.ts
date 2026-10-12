// Quota per agent/account, from the sources in the [quota] config section:
//   "builtin"            claude: the account's usage (Anthropic OAuth usage endpoint, same login Claude Code uses)
//                        codex:  the rate_limits Codex writes into its latest session file
//   false                left out of the list entirely
//   "none"               no collector: never skipped for quota; use `orq block` when it runs out
//   { command = "..." }  any command printing lines "<name> 5h=NN% week=NN% [note]"
// Output line (read by orq-pick and the board): "<name> 5h=NN% week=NN% [note]".
//   -  = the plan has no such window (not limiting);  ? = no data (expired login, collector failed).
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { claudeAccounts } from "./accounts.js";
import { writeAtomic } from "./fsutil.js";
import { stateDir } from "./paths.js";
import { m } from "./i18n.js";

export type Pct = number | "-" | "?";
export interface QuotaLine { name: string; five: Pct; week: Pct; note?: string }
export type Source = "builtin" | "none" | false | { command: string };

const show = (p: Pct) => (typeof p === "number" ? `${Math.floor(p)}%` : p);
export const format = (q: QuotaLine) => `${q.name} 5h=${show(q.five)} week=${show(q.week)}${q.note ? ` [${q.note}]` : ""}`;
const noData = (name: string, note: string): QuotaLine => ({ name, five: "?", week: "?", note });

// --- last good reading per account ----------------------------------------------------------------------------------
// The usage endpoint rate-limits (HTTP 429) — often exactly when an account is busy or exhausted. Then the last good
// reading beats "?": orq-pick must keep seeing an account at 100 %. Each window's figure holds until that window
// resets (then it is 0 %); a window without a reset time is kept for up to 5 h.
interface Cached { pct: Pct; resetsAt?: string }
const KEEP_MS = 5 * 3600_000;
const cacheFile = (name: string) => join(stateDir(), "quota", `${name}.json`);

function remember(name: string, five: Cached, week: Cached): QuotaLine {
  try { writeAtomic(cacheFile(name), JSON.stringify({ five, week, at: Date.now() })); } catch { /* best effort */ }
  return { name, five: five.pct, week: week.pct };
}

/** The cached reading (its age in the note), window by window; nothing usable → the "no data" line. */
export function fromCache(name: string, why: string, now = Date.now()): QuotaLine {
  try {
    const c = JSON.parse(readFileSync(cacheFile(name), "utf8")) as { five: Cached; week: Cached; at: number };
    const still = (w: Cached): Pct | undefined => {
      if (w.resetsAt) { const t = Date.parse(w.resetsAt); if (!Number.isNaN(t)) return t > now ? w.pct : 0; }
      return now - c.at < KEEP_MS ? w.pct : undefined;
    };
    const five = still(c.five), week = still(c.week);
    if (five !== undefined && week !== undefined) {
      const min = Math.round((now - c.at) / 60_000);
      return { name, five, week, note: `${why}; ` + m(`last reading, ${min} min ago`, `última leitura, há ${min} min`) };
    }
  } catch { /* no cache */ }
  return noData(name, why);
}

// --- claude ---------------------------------------------------------------------------------------------------------
interface OAuth { accessToken?: string; expiresAt?: number }

function claudeToken(dir: string): OAuth | undefined {
  try {
    return JSON.parse(readFileSync(join(dir, ".credentials.json"), "utf8")).claudeAiOauth;
  } catch { /* not in a file: macOS keeps it in the Keychain */ }
  if (process.platform !== "darwin") return undefined;
  try {
    const raw = execFileSync("security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return JSON.parse(raw).claudeAiOauth;
  } catch { return undefined; }
}

export async function claudeQuota(name: string, dir: string): Promise<QuotaLine> {
  const t = claudeToken(dir);
  if (!t?.accessToken) return noData(name, m("not logged in", "sem login"));
  // Never refresh the token here (that would rotate Claude Code's login): an expired one just means "open claude".
  if (t.expiresAt && t.expiresAt < Date.now())
    return noData(name, m("login expired: open claude once", "login expirado: abra o claude uma vez"));
  try {
    const r = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: { Authorization: `Bearer ${t.accessToken}`, "anthropic-beta": "oauth-2025-04-20" },
      signal: AbortSignal.timeout(15_000),
    });
    if (r.status === 401) return noData(name, m("login expired: open claude once", "login expirado: abra o claude uma vez"));
    if (!r.ok) return fromCache(name, `HTTP ${r.status}`);
    type W = { utilization?: number; resets_at?: string } | null | undefined;
    const j = await r.json() as Record<string, W>;
    const win = (w: W): Cached => ({ pct: typeof w?.utilization === "number" ? w.utilization : "-",
      ...(typeof w?.resets_at === "string" ? { resetsAt: w.resets_at } : {}) });
    return remember(name, win(j.five_hour), win(j.seven_day));
  } catch (e) {
    return fromCache(name, m("collector failed", "coletor falhou") + `: ${(e as Error).message}`);
  }
}

// --- codex ----------------------------------------------------------------------------------------------------------
function latestCodexSession(): string | undefined {
  const root = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "sessions");
  let best: { f: string; t: number } | undefined;
  const walk = (d: string, depth: number) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory() && depth < 3) walk(p, depth + 1);
      else if (e.isFile() && e.name.endsWith(".jsonl")) {
        const t = statSync(p).mtimeMs;
        if (!best || t > best.t) best = { f: p, t };
      }
    }
  };
  walk(root, 0);
  return best?.f;
}

interface Window { used_percent?: number; window_minutes?: number; resets_at?: number }

/** The last rate_limits in a Codex session (.jsonl): 300-min window = 5h, 10080 = week; a window already reset → 0. */
export function codexFromSession(text: string, nowSec: number): { five: Pct; week: Pct } | undefined {
  let last: { primary?: Window; secondary?: Window } | undefined;
  for (const line of text.split("\n")) {
    if (!line.includes('"rate_limits"')) continue;
    try {
      const find = (o: unknown): void => {
        if (o && typeof o === "object") {
          const r = (o as Record<string, unknown>).rate_limits;
          if (r && typeof r === "object") last = r as typeof last;
          Object.values(o).forEach(find);
        }
      };
      find(JSON.parse(line));
    } catch { /* partial line */ }
  }
  if (!last) return undefined;
  const ws = [last.primary, last.secondary].filter((w): w is Window => !!w);
  const win = (mins: number): Pct => {
    const w = ws.find((x) => x.window_minutes === mins);
    if (!w) return "-";
    return (w.resets_at ?? 0) < nowSec ? 0 : Math.floor(w.used_percent ?? 0);
  };
  return { five: win(300), week: win(10080) };
}

export function codexQuota(): QuotaLine {
  const f = latestCodexSession();
  if (!f) return noData("codex", m("no Codex session yet", "nenhuma sessão do Codex ainda"));
  const q = codexFromSession(readFileSync(f, "utf8"), Date.now() / 1000);
  if (!q) return noData("codex", m("no limit data", "sem dados de limite"));
  const age = Math.round((Date.now() - statSync(f).mtimeMs) / 60_000);
  return { name: "codex", ...q, note: m(`from the last session, ${age} min ago`, `da última sessão, há ${age} min`) };
}

// --- command ----------------------------------------------------------------------------------------------------------
function commandQuota(name: string, cmd: string): string[] {
  const r = spawnSync(cmd, { shell: true, encoding: "utf8", timeout: 30_000 });
  const lines = (r.stdout ?? "").split(/\r?\n/).filter((l) => /\S+ 5h=\S+ week=\S+/.test(l));
  return lines.length ? lines : [format(noData(name, m("collector failed", "coletor falhou")))];
}

// --- all --------------------------------------------------------------------------------------------------------------
/** One or more output lines per configured source, in config order. `want` filters by line name. */
export async function collect(sources: Record<string, Source>, want: string[] = []): Promise<string[]> {
  const wanted = (n: string) => !want.length || want.includes(n);
  const jobs: Promise<string[]>[] = Object.entries(sources).map(async ([name, src]) => {
    if (src === false) return [];
    if (src === "none")
      return wanted(name) ? [format({ name, five: "-", week: "-", note: m("no quota collector", "sem coletor de cota") })] : [];
    if (typeof src === "object" && src && "command" in src)
      return commandQuota(name, src.command).filter((l) => wanted(l.split(" ")[0]));
    if (name === "claude") {
      const accs = claudeAccounts().filter((a) => wanted(a.name) || (want.includes("claude")));
      return (await Promise.all(accs.map((a) => claudeQuota(a.name, a.dir)))).map(format);
    }
    if (name === "codex") return wanted(name) ? [format(codexQuota())] : [];
    return wanted(name) ? [format(noData(name, m("no builtin collector: use \"none\" or a command",
      "sem coletor embutido: use \"none\" ou um comando")))] : [];
  });
  return (await Promise.all(jobs)).flat();
}
