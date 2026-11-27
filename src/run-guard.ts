// Runtime guard of a child run: readings (turns, new tokens, context) and loop signs taken from the agent's own event
// stream (headless) or transcript (Claude -T), checked against [policy.budget] while the run goes. A soft limit warns
// the conductor; a hard limit or a loop stops the run (status=fail rc=3 reason=budget|loop) with the work left in the
// worktree. Only what the source reports is counted: an agent whose stream has no token usage shows no tokens.
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Obj } from "./config.js";
import { claimsPass, refPaths } from "./stats.js";

export interface Budget {
  turns: number[]; tokens: number[]; context: number[];
  same_file_edits: number; same_command: number; same_error: number; no_progress_turns: number; scope_new_files: number;
}

export interface Meter {
  turns: number; tokens?: number; context?: number;
  edits: Record<string, number>; cmds: Record<string, number>; err?: string; errRun: number;
  tree?: string; progressAt: number; ids: string[];
}

export interface Verdict { warn: string[]; stop?: { reason: "budget" | "loop"; why: string } }

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit", "edit", "write", "patch", "multiedit"]);
const SHELL_TOOLS = new Set(["Bash", "bash", "shell"]);
/** Message ids kept to tell a repeated usage line from a new turn (stream-json repeats it per content block). */
const KEEP_IDS = 64;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const pair = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number) : typeof v === "number" ? [v, v] : [0, 0]);
const limit = (v: unknown) => (v === false ? 0 : Number(v ?? 0) || 0);

/** The budget for a run: [policy.budget], then its role section (impl | review), then its level section. undefined = off. */
export function budgetFor(pol: Obj, role: "impl" | "review", level?: string): Budget | undefined {
  if (pol.guard === false) return undefined;
  const b = (pol.budget ?? {}) as Obj;
  const sub = (k?: string) => (k && typeof b[k] === "object" && b[k] !== null && !Array.isArray(b[k]) ? b[k] as Obj : {});
  const v: Obj = { ...b, ...sub(role), ...sub(level) };
  return {
    turns: pair(v.turns), tokens: pair(v.tokens), context: pair(v.context),
    same_file_edits: limit(v.same_file_edits), same_command: limit(v.same_command), same_error: limit(v.same_error),
    no_progress_turns: limit(v.no_progress_turns), scope_new_files: limit(v.scope_new_files),
  };
}

export const newMeter = (): Meter => ({ turns: 0, edits: {}, cmds: {}, errRun: 0, progressAt: 0, ids: [] });

/** A tool error's text with numbers and spacing folded, so the same tsc/lint error at a moved line still matches. */
const errKey = (t: string) => t.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().slice(0, 300);

const textOf = (c: unknown): string => typeof c === "string" ? c
  : Array.isArray(c) ? c.map((x) => (x && typeof x === "object" ? String((x as Obj).text ?? "") : String(x))).join("\n") : "";

function usage(m: Meter, u: Obj | undefined, main = true): void {
  if (!u) return;
  const input = num(u.input_tokens ?? u.input), cw = num(u.cache_creation_input_tokens ?? (u.cache as Obj | undefined)?.write);
  const cr = num(u.cache_read_input_tokens ?? (u.cache as Obj | undefined)?.read), out = num(u.output_tokens ?? u.output) + num(u.reasoning);
  if (!input && !cw && !cr && !out) return;
  m.tokens = (m.tokens ?? 0) + input + cw + out;
  if (main) m.context = input + cw + cr; // a subagent's own context is not the session's
}

function tool(m: Meter, name: string, input: Obj): void {
  if (EDIT_TOOLS.has(name)) {
    const f = String(input.file_path ?? input.filePath ?? input.notebook_path ?? input.path ?? "");
    if (f) m.edits[f] = (m.edits[f] ?? 0) + 1;
    m.cmds = {}; // an edit between two runs of a command is a new try, not a repeat
  } else if (SHELL_TOOLS.has(name)) {
    const c = String(input.command ?? input.cmd ?? "").trim();
    if (c) m.cmds[c] = (m.cmds[c] ?? 0) + 1;
  }
}

function toolResult(m: Meter, isError: boolean, text: string): void {
  if (!isError) return;
  const k = errKey(text);
  if (!k) return;
  if (k === m.err) m.errRun++; else { m.err = k; m.errRun = 1; }
}

/** Feeds one event (a JSON line of the agent's stream or Claude transcript) into the meter. */
export function feed(m: Meter, line: string): void {
  if (!line.startsWith("{")) return;
  let e: Obj;
  try { e = JSON.parse(line) as Obj; } catch { return; }
  // Claude: stream-json and the session transcript share the message shape.
  if (e.type === "assistant" && e.message && typeof e.message === "object") {
    const msg = e.message as Obj, id = String(msg.id ?? e.uuid ?? "");
    if (!id || !m.ids.includes(id)) {
      if (id) { m.ids.push(id); if (m.ids.length > KEEP_IDS) m.ids.shift(); }
      m.turns++;
      usage(m, msg.usage as Obj | undefined, !e.parent_tool_use_id && e.isSidechain !== true);
    }
    for (const c of (Array.isArray(msg.content) ? msg.content : []) as Obj[])
      if (c.type === "tool_use") tool(m, String(c.name ?? ""), (c.input ?? {}) as Obj);
    return;
  }
  if (e.type === "user" && e.message && typeof e.message === "object") {
    for (const c of (Array.isArray((e.message as Obj).content) ? (e.message as Obj).content : []) as Obj[])
      if (c.type === "tool_result") toolResult(m, c.is_error === true, textOf(c.content));
    return;
  }
  // OpenCode: a step is a turn; tools carry their input and state.
  const part = (e.part ?? {}) as Obj;
  if (e.type === "step_finish") { m.turns++; usage(m, part.tokens as Obj | undefined); return; }
  if (e.type === "tool_use") {
    const st = (part.state ?? {}) as Obj;
    tool(m, String(part.tool ?? ""), (st.input ?? {}) as Obj);
    if (st.status === "error" || st.status === "completed") toolResult(m, st.status === "error", String(st.error ?? st.output ?? ""));
  }
}

/** Records the worktree's state (a hash of HEAD + status + diff); a change is progress at the current turn. */
export function progress(m: Meter, tree: string | undefined): void {
  if (tree === undefined) return;
  const h = createHash("sha1").update(tree).digest("hex");
  if (h !== m.tree) { m.tree = h; m.progressAt = m.turns; }
}

export const kfmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

/** "turns=412 tokens=1.2M ctx=180k" — only the readings the source gave. */
export const meterLine = (m: Pick<Meter, "turns" | "tokens" | "context">) =>
  [`turns=${m.turns}`, m.tokens !== undefined ? `tokens=${kfmt(m.tokens)}` : "", m.context !== undefined ? `ctx=${kfmt(m.context)}` : ""].filter(Boolean).join(" ");

/**
 * Checks the meter against the budget. `warned` holds the soft limits already reported (it is updated), so each one
 * warns once. `write` = a write run (no-progress only applies there: a reviewer never changes the tree).
 */
export function judge(m: Meter, b: Budget, warned: Set<string>, write: boolean): Verdict {
  const warn: string[] = [];
  const reading: [string, number | undefined, number[]][] = [["turns", m.turns, b.turns], ["tokens", m.tokens, b.tokens], ["context", m.context, b.context]];
  for (const [k, v, [soft, hard]] of reading) {
    if (v === undefined) continue;
    if (hard > 0 && v >= hard) return { warn, stop: { reason: "budget", why: `${k}=${kfmt(v)} >= ${kfmt(hard)}` } };
    if (soft > 0 && v >= soft && !warned.has(k)) { warned.add(k); warn.push(`${k}=${kfmt(v)} >= ${kfmt(soft)} (soft)`); }
  }
  if (b.same_file_edits > 0) {
    const [f, n] = Object.entries(m.edits).sort((x, y) => y[1] - x[1])[0] ?? ["", 0];
    if (n >= b.same_file_edits) return { warn, stop: { reason: "loop", why: `${f} edited ${n} times` } };
  }
  if (b.same_command > 0) {
    const [c, n] = Object.entries(m.cmds).sort((x, y) => y[1] - x[1])[0] ?? ["", 0];
    if (n >= b.same_command) return { warn, stop: { reason: "loop", why: `\`${c.slice(0, 80)}\` run ${n} times with no edit between` } };
  }
  if (b.same_error > 0 && m.errRun >= b.same_error)
    return { warn, stop: { reason: "loop", why: `the same tool error ${m.errRun} times in a row: ${m.err!.slice(0, 120)}` } };
  if (write && b.no_progress_turns > 0 && m.tree !== undefined && m.turns - m.progressAt >= b.no_progress_turns)
    return { warn, stop: { reason: "loop", why: `${m.turns - m.progressAt} turns with no change in the worktree` } };
  return { warn };
}

/** The meter as saved in <prefix>.meter.json (and the board's state file): readings, top edited files, warnings. */
export function snapshot(m: Meter, warnings: string[]): Obj {
  const top = Object.entries(m.edits).sort((x, y) => y[1] - x[1]).slice(0, 20);
  return { turns: m.turns, ...(m.tokens !== undefined ? { tokens: m.tokens } : {}), ...(m.context !== undefined ? { context: m.context } : {}),
    edits: Object.fromEntries(top), ...(warnings.length ? { warnings } : {}) };
}

/** Claude's transcript of `session` under a config dir (<dir>/projects/<slug>/<session>.jsonl), if there. */
export function claudeTranscript(dir: string, session: string): string | undefined {
  if (!/^[\w-]+$/.test(session)) return undefined;
  try {
    for (const s of readdirSync(join(dir, "projects"))) {
      const f = join(dir, "projects", s, `${session}.jsonl`);
      if (existsSync(f)) return f;
    }
  } catch { /* no projects */ }
  return undefined;
}

/** Reads what a file gained since `from` (whole lines only). Returns the lines and the new offset. */
export function tailLines(file: string, from: number): { lines: string[]; at: number } {
  let size = 0;
  try { size = statSync(file).size; } catch { return { lines: [], at: from }; }
  if (size < from) from = 0; // rewritten
  if (size === from) return { lines: [], at: from };
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(size - from);
    readSync(fd, buf, 0, buf.length, from);
    const text = buf.toString("utf8"), cut = text.lastIndexOf("\n");
    if (cut < 0) return { lines: [], at: from };
    return { lines: text.slice(0, cut).split("\n"), at: from + Buffer.byteLength(text.slice(0, cut + 1)) };
  } finally { closeSync(fd); }
}

/** The context the last turn of a Claude transcript re-sent (input + cache), for the -R warning. */
export function lastContext(file: string): number | undefined {
  let text = "";
  try {
    const size = statSync(file).size, fd = openSync(file, "r"), n = Math.min(size, 1 << 20), buf = Buffer.alloc(n);
    try { readSync(fd, buf, 0, n, size - n); } finally { closeSync(fd); }
    text = buf.toString("utf8");
  } catch { return undefined; }
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const mt = newMeter();
    feed(mt, lines[i]);
    if (mt.context !== undefined) return mt.context;
  }
  return undefined;
}

/** Files a follow-up names that the earlier prompt didn't and the run never edited: how much a -R widens the scope. */
export function newScope(followUp: string, earlier: string, edited: string[]): string[] {
  const known = new Set([...refPaths(earlier), ...edited.map((f) => f.replace(/\\/g, "/"))]);
  const hit = (p: string) => known.has(p) || [...known].some((k) => k.endsWith(`/${p}`) || p.endsWith(`/${k}`));
  return refPaths(followUp).filter((p) => !hit(p));
}

/** The meter a previous run on the prefix saved, if any. */
export function readMeter(prefix: string): (Obj & { context?: number; edits?: Record<string, number> }) | undefined {
  try { return JSON.parse(readFileSync(`${prefix}.meter.json`, "utf8")) as Obj; } catch { return undefined; }
}

/**
 * Runs in an issue folder whose answer says the tests pass on the very commit a failing `orq verify` just tested
 * (their <prefix>.refs head). Each one also gets the finding in its <prefix>.guard. Returns their prefix names.
 */
export function falsePassClaims(dir: string, head: string, verify: string): string[] {
  if (!head) return [];
  const out: string[] = [];
  let names: string[] = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith(".refs")); } catch { return []; }
  for (const n of names) {
    const pre = join(dir, n.slice(0, -".refs".length));
    try {
      const h = /head=(\S+)/.exec(readFileSync(`${pre}.refs`, "utf8"))?.[1] ?? "";
      if (!h || !(h.startsWith(head) || head.startsWith(h)) || !claimsPass(readFileSync(`${pre}.out.md`, "utf8"))) continue;
      appendFileSync(`${pre}.guard`, `${new Date().toISOString()} warn the answer says the tests pass, but ${verify} fails on the same commit ${head.slice(0, 12)}\n`);
      out.push(n.slice(0, -".refs".length));
    } catch { /* gone */ }
  }
  return out.sort();
}
