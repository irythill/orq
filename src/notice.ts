// Notices to the conductor: a finished child (orq agent / verify / baseline) or a red CI tells the conductor's herdr
// pane. Delivery is its own detached process (`orq notice <pane> <line>`), so it outlives whoever sent it (a job tab
// that closes, an end-of-turn hook), and everything it does is written to <state>/notices.jsonl, one JSON per line:
//   notice     the line, the pane, the issue, loud or not        try        one attempt: agent state + result
//   delivered  herdr accepted the prompt                         failed     gave up (retries exhausted)
//   ack        the conductor acted on the issue afterwards (orq wait printed its result, or orq verify / orq agent ran)
// Besides the typed line (which a busy or confused conductor can miss) a FAILURE is also signalled where a person
// looks: a herdr notification with sound, a "✗" title on the conductor's pane (display only, expires by itself) and,
// if ui.desktop_notify allows, a desktop notification. Successes stay quiet: a plain herdr notification, nothing else.
// `orq board` reads the same log to show failures that were not delivered or not yet acknowledged.
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPath, loadConfig } from "./config.js";
import { m } from "./i18n.js";
import { stateDir } from "./paths.js";

export const logFile = () => join(stateDir(), "notices.jsonl");
/** Where `orq handoff` records the pane that replaced a conductor's. */
export const handoffFile = (pane: string) => join(stateDir(), "handoff", pane.replace(/\W/g, "_"));

/** Wait before retry n (1-based): 5s, 15s, 45s, 2min, 5min — six attempts, about eight minutes in all. */
export const BACKOFF_S = [5, 15, 45, 120, 300];
export const WINDOW_MS = 60 * 60_000; // the board looks at failures this recent
// A notice with no outcome is "in flight" while its delivery process is alive. It writes an event per attempt, and the
// longest silence between two is the longest backoff plus one attempt's timeouts (get 10s + wait 70s + prompt 20s):
// past that (plus a margin) with nothing new in the log, the process died and the notice counts as undelivered.
export const GRACE_MS = (BACKOFF_S[BACKOFF_S.length - 1] + 100 + 30) * 1000;
const TITLE_TTL_MS = 30 * 60_000; // the "✗" pane title clears itself

export type Attempt = "sent" | "blocked" | "no-agent" | "error";
export type Step = { kind: "done" } | { kind: "retry"; afterMs: number } | { kind: "giveup" };

/** After `tries` attempts (1-based) that ended in `r`: done, wait and try again, or give up. */
export function nextStep(tries: number, r: Attempt): Step {
  if (r === "sent") return { kind: "done" };
  return tries <= BACKOFF_S.length ? { kind: "retry", afterMs: BACKOFF_S[tries - 1] * 1000 } : { kind: "giveup" };
}

/** A failure is loud (sound, pane title, desktop): "status=" other than ok in a done line, or a red CI line. */
export function isLoud(line: string): boolean {
  const st = /\bstatus=(\S+)/.exec(line)?.[1];
  if (st !== undefined) return st !== "ok";
  return /^\[ORQ CI\].* failed\b/.test(line);
}

/** The issue a notice is about: from the answer path (.orquestra/<ID>/...), else the first ID-looking word. */
export function issueOf(text: string): string | undefined {
  return /\.orquestra[\\/]([^\\/\s]+)[\\/]/.exec(text)?.[1] ?? /\b([A-Z][A-Z0-9]*-\d+)\b/.exec(text)?.[1];
}

/** Popup title and body from a notice line: "✗ <title>" / "✓ <title>", details in the body. */
export function popup(line: string): { title: string; body: string } {
  const loud = isLoud(line);
  const t = line.replace(/^\[(HERDR-AGENT DONE|ORQ AGENT DONE|ORQ CI)\] /, "");
  const i = t.indexOf(" status=");
  const title = i < 0 ? t : t.slice(0, i), body = i < 0 ? "" : t.slice(i + 1).replace(/ answer: .*/, "");
  return { title: `${loud ? "✗" : /\bstatus=/.test(line) ? "✓" : "•"} ${title}`, body };
}

/** ui.desktop_notify: true | false | "auto"; default on, but only on Linux with notify-send. */
export function desktopEnabled(setting: unknown, platform: string, hasBin: boolean): boolean {
  if (setting === false || setting === "false" || setting === "off") return false;
  return platform === "linux" && hasBin;
}

// --- log --------------------------------------------------------------------------------------------------------
export interface Ev { at: number; id: string; ev: "notice" | "try" | "delivered" | "failed" | "ack"; pane?: string; issue?: string; loud?: boolean;
  line?: string; n?: number; detail?: string }

export function append(e: Omit<Ev, "at"> & { at?: number }, file = logFile()): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify({ at: Date.now(), ...e }) + "\n");
    // Rotate instead of rewriting: a rename is atomic, so a concurrent detached writer's append lands in the old or the
    // new file, never lost. readLog() reads both.
    if (statSync(file).size > 512 * 1024) renameSync(file, `${file}.1`);
  } catch { /* the log never takes the caller down */ }
}

export function readLog(file = logFile()): Ev[] {
  const one = (f: string): Ev[] => {
    try { return readFileSync(f, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as Ev]; } catch { return []; } }); }
    catch { return []; }
  };
  return [...one(`${file}.1`), ...one(file)];
}

export interface Pending { id: string; issue?: string; line: string; at: number; why: "undelivered" | "unacknowledged" }

/**
 * The failures the board puts in red: loud notices from the last `windowMs` that were not delivered (retries exhausted,
 * or no outcome after `graceMs` — the delivering process died) or were delivered but not acknowledged. Acknowledged =
 * an `ack` for the same issue at or after the notice. One entry per issue (the newest). Newest first.
 */
export function pendingNotices(events: Ev[], now: number, windowMs = WINDOW_MS, graceMs = GRACE_MS): Pending[] {
  const by = new Map<string, Ev[]>();
  for (const e of events) by.set(e.id, [...(by.get(e.id) ?? []), e]);
  const out = new Map<string, Pending>();
  for (const [id, evs] of by) {
    const n = evs.find((e) => e.ev === "notice");
    if (!n || !n.loud || now - n.at > windowMs) continue;
    if (n.issue && events.some((e) => e.ev === "ack" && e.issue === n.issue && e.at >= n.at)) continue;
    const delivered = evs.some((e) => e.ev === "delivered"), failed = evs.some((e) => e.ev === "failed");
    if (!delivered && !failed && now - Math.max(...evs.map((e) => e.at)) < graceMs) continue; // still being delivered
    const p: Pending = { id, ...(n.issue ? { issue: n.issue } : {}), line: n.line ?? "", at: n.at, why: delivered ? "unacknowledged" : "undelivered" };
    // A delivered notice with no issue has nothing to acknowledge against: nothing to show.
    if (p.why === "unacknowledged" && !n.issue) continue;
    const key = n.issue ?? id, old = out.get(key);
    if (!old || old.at < p.at) out.set(key, p);
  }
  return [...out.values()].sort((a, b) => b.at - a.at);
}

// --- delivery ---------------------------------------------------------------------------------------------------
export interface Res { status: number | null; stdout: string; stderr: string }
export interface Deps {
  run: (cmd: string, args: string[], timeoutMs?: number) => Res;
  sleep: (ms: number) => Promise<void>;
  log: (e: Omit<Ev, "at" | "id">) => void;
  desktop: boolean;
}

const herdrOk = (r: Res) => r.status === 0;
/** `herdr agent get` → the agent's state (idle | working | blocked | done | unknown), undefined when there is no such agent. */
export function agentState(r: Res): string | undefined {
  if (!herdrOk(r)) return undefined;
  try { return (JSON.parse(r.stdout) as { result?: { agent?: { agent_status?: string } } }).result?.agent?.agent_status ?? "unknown"; }
  catch { return undefined; }
}
/** One try: look at the agent, wait out a dialog, submit the prompt. */
export function attempt(pane: string, line: string, d: Deps): { r: Attempt; state?: string; detail: string } {
  const got = d.run("herdr", ["agent", "get", pane], 10_000), state = agentState(got);
  if (state === undefined) return { r: "no-agent", detail: (got.stderr || got.stdout).trim().slice(0, 200) || `exit ${got.status}` };
  // Blocked = a dialog is open: typing now is rejected. Give it a minute to be answered; busy (working) is sent at
  // once — the agent's own input queue holds the line until its turn ends.
  if (state === "blocked") d.run("herdr", ["agent", "wait", pane, "--until", "idle", "--until", "done", "--until", "working", "--timeout", "60000"], 70_000);
  const p = d.run("herdr", ["agent", "prompt", pane, line], 20_000);
  if (herdrOk(p)) return { r: "sent", state, detail: state === "working" ? "agent was working: queued in its input" : "ok" };
  const err = (p.stderr || p.stdout).trim().slice(0, 200) || `exit ${p.status}`;
  return { r: /agent_blocked/.test(err) ? "blocked" : "error", state, detail: err };
}

/** The visual signals, independent of the conductor reading text. Never throws. */
export function signal(pane: string, line: string, d: Deps): void {
  const loud = isLoud(line), { title, body } = popup(line);
  try {
    d.run("herdr", ["notification", "show", title, ...(body ? ["--body", body] : []), "--sound", loud ? "request" : "none"], 10_000);
    if (!loud) return;
    if (pane) d.run("herdr", ["pane", "report-metadata", "--source", "orq", "--title", title, "--ttl-ms", String(TITLE_TTL_MS), pane], 10_000);
    if (d.desktop) d.run("notify-send", ["-u", "critical", "-a", "orq", title, body], 10_000);
  } catch { /* best effort */ }
}

/** Deliver one notice: signals first, then the typed line with retries. True when herdr accepted it. */
export async function deliver(id: string, pane: string, line: string, d: Deps): Promise<boolean> {
  signal(pane, line, d);
  if (!pane) return true; // no conductor pane: the signals are all there is
  for (let n = 1; ; n++) {
    const a = attempt(pane, line, d);
    d.log({ ev: "try", n, pane, detail: `${a.r}${a.state ? ` (agent ${a.state})` : ""}: ${a.detail}` });
    const s = nextStep(n, a.r);
    if (s.kind === "done") { d.log({ ev: "delivered", n, pane }); return true; }
    if (s.kind === "giveup") {
      d.log({ ev: "failed", n, pane, detail: a.detail });
      if (isLoud(line) && d.desktop) d.run("notify-send", ["-u", "critical", "-a", "orq", m("✗ notice NOT delivered to the conductor", "✗ aviso NÃO entregue ao conductor"), popup(line).title], 10_000);
      return false;
    }
    await d.sleep(s.afterMs);
  }
}

const exec = (cmd: string, args: string[], timeoutMs = 15_000): Res => {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: timeoutMs });
  return { status: r.error ? null : r.status, stdout: r.stdout ?? "", stderr: r.stderr || (r.error ? String(r.error.message) : "") };
};
const hasBin = (b: string) => spawnSync(process.platform === "win32" ? "where" : "which", [b], { stdio: "ignore" }).status === 0;

/** Follow `orq handoff` redirects to the pane that now holds the conductor (stops at cycles and unreadable files). */
export function currentPane(pane: string): string {
  const seen = new Set<string>();
  while (!seen.has(pane) && existsSync(handoffFile(pane))) {
    seen.add(pane);
    let next: string;
    try { next = readFileSync(handoffFile(pane), "utf8").trim(); } catch { break; }
    if (!next || next === pane) break;
    pane = next;
  }
  return pane;
}

function realDeps(id: string, pane: string, issue?: string): Deps {
  let setting: unknown;
  try { setting = getPath(loadConfig().cfg, "ui.desktop_notify"); } catch { /* broken config: defaults */ }
  return {
    run: exec, sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (e) => append({ id, pane, ...(issue ? { issue } : {}), ...e }),
    desktop: desktopEnabled(setting, process.platform, hasBin("notify-send")),
  };
}

const CLI = fileURLToPath(new URL("./cli.js", import.meta.url));

/**
 * Tell the conductor's herdr pane. Returns at once: logs the notice, then starts `orq notice --send` detached so the
 * delivery (signals, retries, waiting out a dialog) survives the caller and nothing waits on it.
 */
export function notify(pane: string, line: string, start: (argv: string[]) => void = startDetached): void {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  pane = currentPane(pane);
  append({ id, ev: "notice", pane, loud: isLoud(line), line, ...(issueOf(line) ? { issue: issueOf(line) } : {}) });
  try { start(["notice", "--send", id, pane, line]); }
  catch { append({ id, ev: "failed", pane, detail: "could not start the delivery process" }); }
}

function startDetached(argv: string[]): void {
  spawn(process.execPath, [CLI, ...argv], { detached: true, stdio: "ignore" })
    .on("error", () => append({ id: argv[2], ev: "failed", pane: argv[3], detail: "could not start the delivery process" })).unref();
}

/** The delivery process: `orq notice --send <id> <pane> <line>`. */
export async function send(id: string, pane: string, line: string): Promise<boolean> {
  return deliver(id, pane, line, realDeps(id, pane, issueOf(line)));
}

/** Acknowledge an issue's failures: the conductor acted on it. Clears the "✗" pane titles it set. Never throws. */
export function ack(issue: string | undefined, run: Deps["run"] = exec, file = logFile()): void {
  if (!issue) return;
  try {
    const open = pendingNotices(readLog(file), Date.now(), WINDOW_MS, 0).filter((p) => p.issue === issue);
    if (!open.length) return;
    append({ id: `ack-${Date.now().toString(36)}`, ev: "ack", issue }, file);
    // Per pane: the title shows the newest failure still open there; cleared only when none remain.
    const evs = readLog(file), paneOf = (id: string) => evs.find((e) => e.id === id && e.ev === "notice")?.pane;
    const left = pendingNotices(evs, Date.now(), WINDOW_MS, 0);
    for (const pane of new Set(open.map((p) => paneOf(p.id)).filter((x): x is string => !!x))) {
      const next = left.find((p) => paneOf(p.id) === pane);
      run("herdr", ["pane", "report-metadata", "--source", "orq", ...(next ? ["--title", popup(next.line).title, "--ttl-ms", String(TITLE_TTL_MS)] : ["--clear-title"]), pane], 5_000);
    }
  } catch { /* best effort */ }
}
/** ack() for a run prefix (<ws>/.orquestra/<ID>/<name>). */
export const ackPrefix = (prefix: string): void => ack(issueOf(prefix.replace(/\\/g, "/")));

export const USAGE = "orq notice [--list] [-n N]   the delivery log of notices to conductors (what was sent, retried, failed)";

export async function noticeCmd(argv: string[]): Promise<number> {
  if (argv[0] === "--send") return (await send(argv[1], argv[2], argv.slice(3).join(" "))) ? 0 : 1;
  let n = 20;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-n") n = Number(argv[++i]); else if (argv[i] !== "--list") { console.error(USAGE); return 2; }
  }
  const evs = readLog();
  if (!evs.length) { console.log(m(`no notices yet (${logFile()})`, `nenhum aviso ainda (${logFile()})`)); return 0; }
  for (const e of evs.slice(-Math.max(1, n || 20))) {
    const t = new Date(e.at).toTimeString().slice(0, 8);
    console.log(`${t} ${e.id} ${e.ev}${e.loud ? " LOUD" : ""}${e.pane ? ` pane=${e.pane}` : ""}${e.issue ? ` issue=${e.issue}` : ""}${e.n ? ` try=${e.n}` : ""} ${e.line ?? e.detail ?? ""}`.trimEnd());
  }
  return 0;
}
