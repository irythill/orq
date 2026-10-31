// orq board — live orchestration board from orq's own state files (port of herdr-board; no /proc, systemd or jq):
//   agents      <state>/agents/<unit>.json written by `orq agent --run` (alive = process.kill(pid, 0)), tree memory
//               against the cap from the process table (ps, or CIM on Windows — sampled asynchronously)
//   test queue  the "verify" lock (src/lock.ts)            conductors  .orquestra/<ID>/owner per workspace (orq claim)
//   quota       `orq quota` lines cached in <state>/board/quota.txt, refreshed in the background every 5 min
//   blocks      <state>/blocks.json (orq block)            scoreboard  src/stats.ts, last 7 days
// Refreshes every --interval s on a TTY; otherwise (or with --once) prints once; --json for scripts.
// Keys: q quits · r refreshes the quota · l language · t theme (ui.theme: gunmetal | chrome | lcd | terminal).
import { execFile, spawn } from "node:child_process";
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync } from "node:fs";
import { freemem, homedir, totalmem } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { colorMode } from "../banner.js";
import { getPath, loadConfig } from "../config.js";
import { writeAtomic } from "../fsutil.js";
import { m, setLang } from "../i18n.js";
import { alive, status as lockStatus } from "../lock.js";
import { expand, stateDir } from "../paths.js";
import { processTableAsync, treeMem } from "../process.js";
import { collect, type Source } from "../quota.js";
import { collectRuns, type Row, rows } from "../stats.js";
import { load as loadBlocks } from "./block.js";
import { setValue } from "./set.js";

export const USAGE = "orq board [-w <workspace>]... [--once] [--json] [--interval S]   live board: queue, agents, conductors, quota";

const CLI = fileURLToPath(new URL("../cli.js", import.meta.url));
const QTTL = 300_000, RECENT_MS = 30 * 60_000, ORPHAN_MS = 24 * 3600_000;
type Table = Map<number, [number, number]>;

// --- snapshot ---------------------------------------------------------------------------------------------------
export interface Agent {
  unit: string; title: string; agent: string; model?: string; host?: string; pid: number; issue: string; label: string;
  state: "running" | "died" | "ok" | "fail"; rc?: number; secs: number; mem?: number; cap?: number; activity?: string;
}
export interface QItem { label: string; pid: number; secs: number; mem?: number }
export interface Conductor { id: string; kind: string; account: string; alive: boolean; issues: string[] }
export interface Quota { name: string; five: string; week: string; reset5h?: number; resetWeek?: number; note?: string }
export interface Snapshot {
  at: string; mem: { used: number; total: number }; workspaces: string[];
  queue: { holders: QItem[]; waiters: QItem[] }; agents: Agent[]; conductors: Conductor[];
  quota: { lines: Quota[]; age?: number }; blocks: Record<string, { until: number; reason?: string }>; scoreboard: Row[];
}

const read = (f: string) => { try { return readFileSync(f, "utf8"); } catch { return ""; } };
const models = new Map<string, string | undefined>();

/** The model a run was started with, from its job file (-m / --model in the argv). */
function modelOf(prefix: string): string | undefined {
  if (!models.has(prefix)) {
    let v: string | undefined;
    try {
      const a = (JSON.parse(read(`${prefix}.job.json`)).argv ?? []) as string[];
      const i = a.findIndex((x) => x === "-m" || x === "--model");
      v = i >= 0 ? a[i + 1] : a.find((x) => x.startsWith("--model="))?.slice(8);
    } catch { /* no job file */ }
    models.set(prefix, v?.split("/").pop());
  }
  return models.get(prefix);
}

/** What the agent did last, from the tail of its log (stream JSON of claude/opencode, else the last text line). */
export function activity(log: string): string | undefined {
  const lines = log.split(/\r?\n/).slice(-40);
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (!l.startsWith("{")) continue;
    try {
      const j = JSON.parse(l);
      if (j.type === "assistant") {
        const t = (j.message?.content ?? []).filter((c: { type: string }) => c.type === "tool_use").pop();
        if (t) return `· ${t.name}`;
      } else if (j.type === "tool_use") return `· ${j.part?.tool ?? "tool"}`;
      else if (j.type === "text" && j.part?.text) return String(j.part.text);
    } catch { /* partial line */ }
  }
  return lines.filter((l) => l.trim() && !l.trim().startsWith("{")).pop();
}

function tail(file: string, bytes = 16_384): string {
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const size = fstatSync(fd).size, b = Buffer.alloc(Math.min(size, bytes));
    readSync(fd, b, 0, b.length, size - b.length);
    return b.toString("utf8");
  } catch { return ""; } finally { if (fd !== undefined) closeSync(fd); }
}

function agents(table: Table | undefined, now: number): Agent[] {
  const d = join(stateDir(), "agents"), out: Agent[] = [];
  let files: string[] = [];
  try { files = readdirSync(d).filter((f) => f.endsWith(".json")); } catch { /* no runs yet */ }
  for (const f of files) {
    let s: Record<string, unknown>;
    try { s = JSON.parse(read(join(d, f))); } catch { continue; }
    const pid = Number(s.pid), at = Date.parse(String(s.at)), end = s.end ? Date.parse(String(s.end)) : undefined;
    const prefix = String(s.prefix ?? "");
    const st: Agent["state"] = s.status === "ok" || s.status === "fail" ? s.status : alive(pid) ? "running" : "died";
    if (st === "died" && now - at > ORPHAN_MS) continue;
    if ((st === "ok" || st === "fail") && now - (end ?? at) > RECENT_MS) continue;
    const a: Agent = { unit: f.slice(0, -5), title: String(s.title ?? ""), agent: String(s.agent ?? "?"), model: modelOf(prefix),
      host: s.host as string | undefined, pid, issue: basename(dirname(prefix)), label: basename(prefix), state: st,
      secs: Math.max(0, Math.round(((end ?? now) - at) / 1000)), cap: typeof s.cap === "number" ? s.cap : undefined };
    if (s.rc !== undefined) a.rc = Number(s.rc);
    if (st === "running") {
      if (table) a.mem = treeMem(pid, table);
      a.activity = activity(tail(`${prefix}.log`))?.replace(/\s+/g, " ").replace(homedir(), "~").slice(0, 60);
    }
    out.push(a);
  }
  const rank = { running: 0, died: 1, fail: 2, ok: 3 };
  return out.sort((x, y) => rank[x.state] - rank[y.state] || y.secs - x.secs);
}

const field = (t: string, k: string) => new RegExp(`${k}=(\\S+)`).exec(t)?.[1] ?? "";
const herdrAlive = (id: string) => new Promise<boolean>((res) =>
  execFile("herdr", ["agent", "get", id], { timeout: 5000, windowsHide: true }, (e) => res(!e)));

async function conductors(wss: string[]): Promise<Conductor[]> {
  const by = new Map<string, Conductor & { at: number }>();
  for (const ws of wss) {
    const O = join(ws, ".orquestra");
    for (const id of existsSync(O) ? readdirSync(O).filter((x) => !x.startsWith(".")) : []) {
      const t = read(join(O, id, "owner")).trim();
      if (!t) continue;
      const who = field(t, "pane"), at = Date.parse(field(t, "at")) || 0;
      const c = by.get(who) ?? { id: who, kind: field(t, "kind") || "herdr", account: field(t, "account"), alive: false, issues: [], at };
      c.issues.push(id); c.at = Math.max(c.at, at);
      by.set(who, c);
    }
  }
  const ttl = Number(process.env.ORQ_CLAIM_TTL_H ?? 24) * 3600_000;
  const out = [...by.values()];
  await Promise.all(out.map(async (c) => { c.alive = c.kind === "herdr" ? await herdrAlive(c.id) : Date.now() - c.at < ttl; }));
  return out.filter((c) => c.alive).map(({ at: _, ...c }) => ({ ...c, issues: c.issues.sort() }));
}

// Quota: the board never waits for the network. A stale cache starts `orq board --collect-quota` detached.
const qdir = () => join(stateDir(), "board");
const qfile = () => join(qdir(), "quota.txt");

export function parseQuota(text: string): Quota[] {
  return text.split(/\r?\n/).flatMap((l) => {
    const r = /^(\S+) 5h=(\S+) week=(\S+)(?: reset5h=(\d+))?(?: resetweek=(\d+))?(?: \[(.*)\])?/.exec(l.trim());
    return r ? [{ name: r[1], five: r[2], week: r[3], ...(r[4] ? { reset5h: Number(r[4]) } : {}),
      ...(r[5] ? { resetWeek: Number(r[5]) } : {}), ...(r[6] ? { note: r[6] } : {}) }] : [];
  });
}

export function quota(now: number): Snapshot["quota"] {
  let age: number | undefined;
  try { age = now - statSync(qfile()).mtimeMs; } catch { /* never collected */ }
  if (age === undefined || age > QTTL) startCollect();
  return { lines: parseQuota(read(qfile())), age };
}

function startCollect(): void {
  const lock = join(qdir(), "quota.pid");
  const pid = Number(read(lock));
  if (pid > 0 && alive(pid)) return;
  mkdirSync(qdir(), { recursive: true });
  const c = spawn(process.execPath, [CLI, "board", "--collect-quota"], { detached: true, stdio: "ignore", windowsHide: true });
  if (c.pid) writeAtomic(lock, String(c.pid));
  c.unref();
}

async function collectQuota(): Promise<number> {
  const lines = await collect((getPath(loadConfig().cfg, "quota") ?? {}) as Record<string, Source>);
  writeAtomic(qfile(), lines.join("\n") + "\n");
  return 0;
}

let sb: { at: number; ws: string; rows: Row[] } | undefined;
function scoreboard(ws: string, now: number): Row[] {
  if (!sb || sb.ws !== ws || now - sb.at > 60_000) {
    let r: Row[] = [];
    try { r = rows(collectRuns(ws, 7)); } catch { /* unreadable history */ }
    sb = { at: now, ws, rows: r };
  }
  return sb.rows;
}

export async function snapshot(wss: string[], table?: Table): Promise<Snapshot> {
  const now = Date.now(), q = lockStatus("verify");
  const item = (e: { label: string; pid: number; at: number }): QItem =>
    ({ label: e.label, pid: e.pid, secs: Math.round((now - e.at) / 1000), ...(table ? { mem: treeMem(e.pid, table) } : {}) });
  return {
    at: new Date(now).toISOString(), mem: { used: totalmem() - freemem(), total: totalmem() }, workspaces: wss,
    queue: { holders: q.holders.map(item), waiters: q.waiters.map(item) }, agents: agents(table, now),
    conductors: await conductors(wss), quota: quota(now), blocks: loadBlocks(), scoreboard: scoreboard(wss[0], now),
  };
}

// --- render -----------------------------------------------------------------------------------------------------
// Palettes from the irythill SYNTH.DECK portfolio (as herdr-board): paper surface ink ink2 muted rule accent ok warn err.
const PAL: Record<string, string[]> = {
  gunmetal: ["25;27;29", "36;39;41", "230;232;234", "172;174;176", "139;142;145", "83;86;89", "160;187;215", "160;187;215", "214;180;110", "224;120;110"],
  chrome: ["220;222;224", "237;238;240", "29;32;34", "59;61;64", "83;85;88", "150;152;155", "59;88;118", "59;88;118", "150;105;30", "165;55;45"],
  lcd: ["8;18;12", "15;28;19", "127;234;133", "97;181;101", "91;141;93", "47;81;54", "127;234;133", "127;234;133", "214;220;110", "234;120;100"],
};
export const THEMES = ["gunmetal", "chrome", "lcd", "terminal"];
interface Ink { base: string; surf: string; ink: string; ink2: string; mut: string; rul: string; acc: string; ok: string; wrn: string; err: string; b: string; r: string }

function inks(theme: string, mode = colorMode()): Ink {
  const none = { base: "", surf: "", ink: "", ink2: "", mut: "", rul: "", acc: "", ok: "", wrn: "", err: "", b: "", r: "" };
  if (mode === "none") return none;
  const p = PAL[theme];
  if (!p || mode === "basic") return { ...none, base: "\x1b[0m", surf: "\x1b[0m", mut: "\x1b[2m", rul: "\x1b[2m", acc: "\x1b[36m",
    ok: "\x1b[32m", wrn: "\x1b[33m", err: "\x1b[31m", ink: "\x1b[22m", ink2: "\x1b[22m", b: "\x1b[1m", r: "\x1b[0m" };
  const fg = (i: number) => `\x1b[38;2;${p[i]}m`, base = `\x1b[48;2;${p[0]}m${fg(2)}`;
  return { base, surf: `\x1b[48;2;${p[1]}m${fg(2)}`, ink: fg(2), ink2: fg(3), mut: fg(4), rul: fg(5), acc: fg(6), ok: fg(7),
    wrn: fg(8), err: fg(9), b: "\x1b[1m", r: `\x1b[22m${base}` };
}

export function dur(s: number): string {
  const p = (n: number) => String(Math.floor(n)).padStart(2, "0");
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${p(s % 60)}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h${p(s % 3600 / 60)}m`;
  return `${Math.floor(s / 86400)}d${p(s % 86400 / 3600)}h`;
}
const when = (sec: number) => { const d = new Date(sec * 1000), p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const gb = (b?: number) => (b ? `${(b / 2 ** 30).toFixed(1)} GB` : "-");
const fit = (s: string, n: number) => (s.length > n ? s.slice(0, Math.max(0, n - 1)) + "…" : s.padEnd(n));

export function render(s: Snapshot, theme: string, cols: number, mode = colorMode()): string[] {
  const c = inks(theme, mode), W = Math.max(60, cols), out: string[] = [];
  const meter = (pct: number, n: number) => {
    const f = Math.min(n, Math.round(Math.max(0, pct) * n / 100)), k = pct >= 90 ? c.err : pct >= 70 ? c.wrn : c.ok;
    return `${c.rul}▕${k}${"█".repeat(f)}${c.rul}${"░".repeat(n - f)}▏${c.r}`;
  };
  const section = (name: string, sub: string) => {
    const t = ` ${name} ─ ${sub} `;
    out.push("", `${c.b}${c.ink} ${name}${c.r}${c.mut} ─ ${sub} ${c.rul}${"─".repeat(Math.max(0, W - t.length - 2))}${c.r}`);
  };
  const ws = s.workspaces.map((w) => w.replace(homedir(), "~")).join(" ");
  const left = ` ORQ  ${ws}`, right = `${theme} · ${new Date(s.at).toTimeString().slice(0, 8)} `;
  out.push(`${c.surf}${c.b}${c.acc} ORQ${c.b ? "\x1b[22m" : ""}${c.surf}${c.ink2}  ${ws}${" ".repeat(Math.max(1, W - left.length - right.length))}${c.mut}${right}`);
  const mp = Math.round(100 * s.mem.used / s.mem.total);
  out.push(` ${c.mut}MEM${c.r}  ${meter(mp, 24)} ${c.ink}${gb(s.mem.used)}${c.r} ${c.mut}/ ${gb(s.mem.total)}${c.r}`);

  section("TRANSPORT", m("test queue", "fila de testes"));
  for (const h of s.queue.holders)
    out.push(` ${c.acc}▶ REC${c.r}  ${c.ink}${fit(h.label, 34)}${c.r} ${c.ok}${m("running", "rodando")}${c.r} ${c.ink}${dur(h.secs).padEnd(7)}${c.r} ${c.ink2}${gb(h.mem)}${c.r}`
      + (/^baseline\b/.test(h.label) ? `  ${c.wrn}${m("full suite", "suíte inteira")}${c.r}` : ""));
  s.queue.waiters.forEach((w, i) => out.push(` ${c.mut}‖ ${String(i + 1).padStart(2, "0")}${c.r}   ${c.ink}${fit(w.label, 34)}${c.r} ${c.mut}${m("waiting", "esperando")} ${dur(w.secs)}${c.r}`));
  if (!s.queue.holders.length && !s.queue.waiters.length) out.push(` ${c.mut}${m("empty", "vazia")}${c.r}`);

  section("TRACKS", m("agents", "agentes"));
  s.agents.forEach((a, i) => {
    const n = `${c.mut}${String(i + 1).padStart(2, "0")}${c.r}`, who = `${c.ink}${fit(a.issue, 9)}${c.r} ${c.ink2}${fit(a.label, 22)}${c.r} `
      + `${c.ink}${fit(a.agent, 11)}${c.r}${c.mut}${fit(a.model ?? m("default", "padrão"), 17)}${c.r} ${c.ink}${dur(a.secs).padEnd(7)}${c.r}`;
    if (a.state === "running") {
      const pct = a.cap && a.mem ? Math.round(100 * a.mem / a.cap) : 0, used = 1 + 2 + 2 + 10 + 23 + 11 + 17 + 1 + 8 + 6 + 1 + 7 + 1;
      const warn = a.secs > 3 * 3600 ? ` ${c.err}⚠ ${m("for", "há")} ${dur(a.secs)}${c.r}` : "";
      out.push(` ${c.acc}●${c.r} ${n}  ${who} ${meter(pct, 4)} ${c.ink2}${gb(a.mem).padEnd(6)}${c.r} ${c.mut}${fit(a.activity ?? "", Math.max(0, W - used - 2)).trimEnd()}${c.r}${warn}`);
    } else if (a.state === "died")
      out.push(` ${c.err}●${c.r} ${n}  ${who} ${c.err}${m("runner gone without finishing", "runner sumiu sem terminar")}${c.r}`);
    else out.push(` ${a.state === "ok" ? c.ok : c.err}${a.state === "ok" ? "✓" : "✗"}${c.r} ${n}  ${c.mut}${a.issue.padEnd(9).slice(0, 9)} ${fit(a.label, 22)} ${fit(a.agent, 11)}${fit(a.model ?? "", 17)} ${dur(a.secs).padEnd(7)} ${a.state} rc=${a.rc ?? "?"}${c.r}`);
  });
  if (!s.agents.length) out.push(` ${c.mut}${m("none", "nenhum")}${c.r}`);

  section("MASTER", m("conductors", "conductors"));
  for (const k of s.conductors)
    out.push(` ${c.ok}●${c.r} ${c.mut}${fit(k.id, 22)}${c.r} ${c.ink2}${fit(k.account || "-", 14)}${c.r} ${c.ink}${k.issues.join(" ")}${c.r}`);
  if (!s.conductors.length) out.push(` ${c.mut}${m("no claimed issues", "nenhuma issue reivindicada")}${c.r}`);

  section("MIXER", m("quota", "cota"));
  const win = (v: string, tag: string) => {
    const n = /^(\d+)%?$/.exec(v)?.[1];
    return n !== undefined ? `${c.mut}${tag.padEnd(3)}${c.r} ${meter(Number(n), 6)} ${c.ink}${n.padStart(3)}%${c.r}`
      : `${c.mut}${tag.padEnd(3)} ${" ".repeat(8)} ${v.padStart(3)} ${c.r}`;
  };
  const shown = s.quota.lines.filter((q) => q.five !== "-" || q.week !== "-"), idle = s.quota.lines.filter((q) => !shown.includes(q));
  const cw = 21, per = Math.max(1, Math.floor((W - 1) / cw));
  for (let i = 0; i < shown.length; i += per) {
    const g = shown.slice(i, i + per);
    if (i) out.push("");
    out.push(" " + g.map((q) => `${c.b}${c.ink2}${fit(q.name.slice(0, cw - 2), cw)}${c.r}`).join(""));
    out.push(" " + g.map((q) => win(q.five, "5h") + "    ").join(""));
    out.push(" " + g.map((q) => win(q.week, m("wk", "sem")) + "    ").join(""));
  }
  if (idle.length) out.push(` ${c.mut}${m("no quota collector", "sem coletor de cota")}: ${idle.map((q) => q.name).join(" ")}${c.r}`);
  const blocks = Object.entries(s.blocks).sort();
  for (const [k, b] of blocks)
    out.push(` ${c.wrn}■${c.r} ${c.ink}${k.padEnd(14)}${c.r} ${c.mut}${m("blocked until", "bloqueado até")} ${when(b.until)}  ${b.reason ?? ""}${c.r}`);
  out.push(s.quota.age === undefined ? ` ${c.mut}${m("collecting...", "coletando...")}${c.r}`
    : ` ${c.mut}${dur(Math.round(s.quota.age / 1000))} ${m("ago", "atrás")}${c.r}`);

  section("CHARTS", m("scoreboard, 7 days", "placar, 7 dias"));
  const top = [...s.scoreboard].sort((a, b) => b.n - a.n).slice(0, 8);
  if (top.length) out.push(` ${c.mut}${m("role", "papel").padEnd(7)} ${m("agent", "agente").padEnd(12)} ${m("model", "modelo").padEnd(20)} ${"n".padStart(4)} ${"ok%".padStart(5)} ${m("approved%", "aprov%").padStart(10)} ${"min".padStart(6)}${c.r}`);
  for (const x of top)
    out.push(` ${c.ink2}${x.role.padEnd(7)}${c.r} ${c.ink}${fit(x.agent, 12)}${c.r} ${c.mut}${fit(x.model, 20)}${c.r} ${c.ink}${String(x.n).padStart(4)} ${String(x.ok).padStart(5)} ${(x.approved === null ? "-" : `${x.approved}%`).padStart(10)} ${String(x.min).padStart(6)}${c.r}`);
  if (!top.length) out.push(` ${c.mut}${m("no runs yet", "nenhuma execução ainda")}${c.r}`);

  out.push("", `${c.rul}${"─".repeat(W - 2)}${c.r}`, ` ${c.mut}${m("q quit · r quota · l language · t theme", "q sai · r cota · l idioma · t tema")}${c.r}`);
  return out;
}

// --- command ----------------------------------------------------------------------------------------------------
export async function board(argv: string[]): Promise<number> {
  const wss: string[] = [];
  let once = false, json = false, interval = 3;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-w") wss.push(resolve(expand(argv[++i] ?? ".")));
    else if (a === "--once") once = true; else if (a === "--json") json = true;
    else if (a === "--interval") interval = Math.max(1, Number(argv[++i]) || 3);
    else if (a === "--collect-quota") return collectQuota();
    else if (a === "-h" || a === "--help") { console.log(USAGE); return 0; }
    else { console.error(USAGE); return 2; }
  }
  const cfg = () => loadConfig().cfg;
  if (!wss.length) wss.push((getPath(cfg(), "_workspace") as string | null) ?? process.cwd());
  let theme = process.env.ORQ_THEME || String(getPath(cfg(), "ui.theme") ?? "gunmetal");
  if (!THEMES.includes(theme)) theme = "gunmetal";

  if (json) { console.log(JSON.stringify(await snapshot(wss, await processTableAsync()), null, 2)); return 0; }
  const tty = Boolean(process.stdout.isTTY);
  if (once || !tty) {
    const lines = render(await snapshot(wss, await processTableAsync()), theme, process.stdout.columns ?? 100);
    const c = inks(theme);
    process.stdout.write(lines.map((l) => c.base + l + (c.base ? "\x1b[K" : "")).join("\n") + (c.base ? "\x1b[0m" : "") + "\n");
    return 0;
  }

  // Live: draw at once with the last process table; a new one is sampled in the background (PowerShell takes
  // seconds on Windows) and triggers a redraw when it lands. Nothing here ever blocks the loop.
  let table: Table | undefined, sampling = false, drawing = false, again = false;
  const out = process.stdout, inp = process.stdin;
  const draw = async () => {
    if (drawing) { again = true; return; }
    drawing = true;
    try {
      const c = inks(theme), lines = render(await snapshot(wss, table), theme, out.columns ?? 100);
      out.write(`${c.base}\x1b[H` + lines.map((l) => c.base + l + "\x1b[K").join("\n") + `${c.base}\x1b[J`);
    } finally { drawing = false; }
    if (again) { again = false; void draw(); }
  };
  const sample = () => {
    if (sampling) return;
    sampling = true;
    processTableAsync().then((t) => { table = t; sampling = false; void draw(); });
  };
  out.write("\x1b[?1049h\x1b[?25l\x1b[2J");
  return new Promise<number>((res) => {
    const timer = setInterval(() => { sample(); void draw(); }, interval * 1000);
    const quit = () => {
      clearInterval(timer);
      out.off("resize", onResize);
      if (inp.isTTY) inp.setRawMode(false);
      inp.pause();
      out.write("\x1b[0m\x1b[?25h\x1b[?1049l");
      res(0);
    };
    const onResize = () => { out.write("\x1b[2J"); void draw(); };
    out.on("resize", onResize);
    process.once("SIGINT", quit); process.once("SIGTERM", quit);
    if (inp.isTTY) {
      inp.setRawMode(true); inp.setEncoding("utf8"); inp.resume();
      inp.on("data", (k: string) => {
        if (k === "q" || k === "\x03" || k === "\x1b") return quit();
        if (k === "r") rmSync(qfile(), { force: true });
        else if (k === "l") {
          const next = m("en", "pt") === "pt" ? "en" : "pt";
          try { setValue("ui", "lang", next); } catch { /* read-only config: toggle for this board only */ }
          setLang(next);
        } else if (k === "t") {
          theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
          try { setValue("ui", "theme", theme); } catch { /* idem */ }
        } else return;
        out.write("\x1b[0m\x1b[2J"); void draw();
      });
    }
    sample(); void draw();
  });
}
