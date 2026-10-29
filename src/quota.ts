// Quota per agent/account, from the sources in the [quota] config section:
//   "builtin"            claude: the account's usage (Anthropic OAuth usage endpoint, same login Claude Code uses)
//                        codex:  the rate_limits Codex writes into its latest session file
//                        antigravity: per-model quota from Cloud Code (fetchAvailableModels), with the login agy keeps
//                                 in the OS keyring (src/keyring.ts: Secret Service, Keychain, Credential Manager)
//                        opencode: the MiniMax Token Plan (/v1/token_plan/remains) with $MINIMAX_API_KEY or the key
//                                 OpenCode keeps in its auth.json; $MINIMAX_API_HOST for the China region
//                        copilot: premium requests left this month (`gh api /copilot_internal/user`; a monthly
//                                 allowance, shown in the week slot)
//   false                left out of the list entirely
//   "none"               no collector: never skipped for quota; use `orq block` when it runs out
//   { command = "..." }  any command printing lines "<name> 5h=NN% week=NN% [note]"
// Output line (read by orq-pick and the board): "<name> 5h=NN% week=NN% [note]".
//   -  = the plan has no such window (not limiting);  ? = no data (expired login, collector failed).
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { claudeAccounts } from "./accounts.js";
import { writeAtomic } from "./fsutil.js";
import { readSecret } from "./keyring.js";
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
  try { return JSON.parse(readSecret("Claude Code-credentials", userInfo().username) ?? "").claudeAiOauth; } catch { return undefined; }
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

// --- antigravity ----------------------------------------------------------------------------------------------------
interface ModelQuota { quotaInfo?: { remainingFraction?: number; resetTime?: string } }

/** Worst usage per window across models: a reset within 6 h belongs to the 5h window, a later one to the week. */
export function antigravityFromModels(models: Record<string, ModelQuota>, now = Date.now()): { five: Cached; week: Cached } {
  const five: Cached = { pct: "-" }, week: Cached = { pct: "-" };
  for (const { quotaInfo: q } of Object.values(models ?? {})) {
    if (typeof q?.remainingFraction !== "number" || !q.resetTime) continue;
    const at = Date.parse(q.resetTime); if (Number.isNaN(at)) continue;
    const w = at - now <= 6 * 3600_000 ? five : week;
    const used = Math.round((1 - q.remainingFraction) * 100);
    if (w.pct === "-" || used > (w.pct as number)) { w.pct = used; w.resetsAt = q.resetTime; }
  }
  return { five, week };
}

function agyToken(): { access?: string; expiry?: string } | undefined {
  // agy (go-keyring) keeps {"token": {access_token, expiry, ...}} under service "gemini", user "antigravity"
  // (on Windows go-keyring names the credential "gemini:antigravity").
  const raw = readSecret("gemini", "antigravity", "gemini:antigravity");
  if (!raw) return undefined;
  try {
    const t = JSON.parse(raw).token;
    return { access: t?.access_token, expiry: t?.expiry };
  } catch { return undefined; }
}

export async function antigravityQuota(): Promise<QuotaLine> {
  const name = "antigravity";
  const t = agyToken();
  if (!t?.access) return noData(name, m("no agy login in the keyring", "sem login do agy no chaveiro"));
  // Never refresh it here (that is agy's login): an expired one just means "run agy once" (`agy models` is enough).
  const expired = m("login expired: run `agy models`", "login expirado: rode `agy models`");
  if (t.expiry && Date.parse(t.expiry) < Date.now()) return fromCache(name, expired);
  try {
    const r = await fetch("https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels", {
      method: "POST", body: "{}",
      // The endpoint answers 403 without a client User-Agent.
      headers: { Authorization: `Bearer ${t.access}`, "Content-Type": "application/json", "User-Agent": "antigravity" },
      signal: AbortSignal.timeout(15_000),
    });
    if (r.status === 401) return fromCache(name, expired);
    if (!r.ok) return fromCache(name, `HTTP ${r.status}`);
    const j = await r.json() as { models?: Record<string, ModelQuota> };
    const { five, week } = antigravityFromModels(j.models ?? {});
    return remember(name, five, week);
  } catch (e) {
    return fromCache(name, m("collector failed", "coletor falhou") + `: ${(e as Error).message}`);
  }
}

// --- copilot --------------------------------------------------------------------------------------------------------
/** Premium requests used this month, from the snapshot `gh api /copilot_internal/user` returns. No 5h window. */
export function copilotFromUser(j: unknown): QuotaLine {
  const u = j as { quota_snapshots?: { premium_interactions?: { percent_remaining?: number; unlimited?: boolean } };
    quota_reset_date?: string };
  const p = u?.quota_snapshots?.premium_interactions;
  if (!p) return noData("copilot", m("no premium request data", "sem dados de requisições premium"));
  if (p.unlimited) return { name: "copilot", five: "-", week: "-", note: m("unlimited", "ilimitado") };
  if (typeof p.percent_remaining !== "number") return noData("copilot", m("no premium request data", "sem dados de requisições premium"));
  const reset = u.quota_reset_date ? m(`, resets ${u.quota_reset_date}`, `, renova em ${u.quota_reset_date}`) : "";
  return { name: "copilot", five: "-", week: Math.max(0, 100 - p.percent_remaining),
    note: m("monthly premium requests", "requisições premium do mês") + reset };
}

export function copilotQuota(): QuotaLine {
  const r = spawnSync("gh", ["api", "/copilot_internal/user"], { encoding: "utf8", timeout: 15_000 });
  if (r.error || r.status !== 0) return noData("copilot", m("gh api failed (gh auth login?)", "gh api falhou (gh auth login?)"));
  try { return copilotFromUser(JSON.parse(r.stdout)); }
  catch { return noData("copilot", m("collector failed", "coletor falhou")); }
}

// --- minimax (opencode) ---------------------------------------------------------------------------------------------
interface MiniMaxModel {
  end_time?: number; weekly_end_time?: number;
  current_interval_remaining_percent?: number; current_weekly_remaining_percent?: number;
}

/** Worst usage per window across the plan's models (remaining % → used %); resets from the windows' end times. */
export function minimaxFromRemains(j: { model_remains?: MiniMaxModel[] }): { five: Cached; week: Cached } | undefined {
  const ms = j?.model_remains ?? [];
  if (!ms.length) return undefined;
  const worst = (pct: keyof MiniMaxModel, end: keyof MiniMaxModel): Cached => {
    let w: Cached = { pct: "-" };
    for (const x of ms) {
      if (typeof x[pct] !== "number") continue;
      const used = 100 - x[pct]!;
      if (w.pct === "-" || used > (w.pct as number))
        w = { pct: used, ...(typeof x[end] === "number" ? { resetsAt: new Date(x[end]!).toISOString() } : {}) };
    }
    return w;
  };
  return { five: worst("current_interval_remaining_percent", "end_time"),
    week: worst("current_weekly_remaining_percent", "weekly_end_time") };
}

function minimaxKey(): string | undefined {
  if (process.env.MINIMAX_API_KEY) return process.env.MINIMAX_API_KEY;
  const data = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  try { return JSON.parse(readFileSync(join(data, "opencode", "auth.json"), "utf8")).minimax?.key; } catch { return undefined; }
}

export async function minimaxQuota(name: string): Promise<QuotaLine> {
  const key = minimaxKey();
  // OpenCode may run another provider: without a MiniMax key there is nothing to limit.
  if (!key) return { name, five: "-", week: "-", note: m("no MiniMax key", "sem chave da MiniMax") };
  try {
    const host = process.env.MINIMAX_API_HOST ?? "api.minimax.io";
    const r = await fetch(`https://${host}/v1/token_plan/remains`, {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return fromCache(name, `HTTP ${r.status}`);
    const j = await r.json() as { model_remains?: MiniMaxModel[]; base_resp?: { status_code?: number; status_msg?: string } };
    if (j.base_resp?.status_code) return fromCache(name, `MiniMax ${j.base_resp.status_code}: ${j.base_resp.status_msg ?? ""}`.trim());
    const q = minimaxFromRemains(j);
    return q ? remember(name, q.five, q.week) : noData(name, m("no plan data", "sem dados do plano"));
  } catch (e) {
    return fromCache(name, m("collector failed", "coletor falhou") + `: ${(e as Error).message}`);
  }
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
    if (name === "antigravity") return wanted(name) ? [format(await antigravityQuota())] : [];
    if (name === "copilot") return wanted(name) ? [format(copilotQuota())] : [];
    if (name === "opencode" || name === "minimax") return wanted(name) ? [format(await minimaxQuota(name))] : [];
    return wanted(name) ? [format(noData(name, m("no builtin collector: use \"none\" or a command",
      "sem coletor embutido: use \"none\" ou um comando")))] : [];
  });
  return (await Promise.all(jobs)).flat();
}
