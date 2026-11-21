// Agent scoreboard from the .orquestra/ history: what each agent delivered and what it cost (port of orq-stats).
// Per run (<prefix>.run.sh + .log + .done + .out.md): agent, model, role (impl | fix | review | other), status,
// duration, tokens. "New" tokens = excluding cache reads (what actually weighs on quota); Codex without a session
// file only reports the total. Implementation delivery = the first review of the same repo in the issue said APPROVED.
// Limitation: follow-ups (-R) reuse the implementation prefix, so the "impl" row shows the last round of that prefix.
// Agent and model come from the job (<prefix>.job.json argv), then the pick (<prefix>.pick), then the log; a tool
// without models (a review CLI) has model "-". Time runs to the first turn on a screen run (<prefix>.turns): later
// turns wait on a person. Killed runs and older screen runs without .turns are counted but left out of the time median.
// Looping (implementer, per issue): the issue's rounds (src/rounds.ts) hit max_rounds or repeated a heavy finding, or
// needed a watchdog diagnosis. Hallucination: an implementer whose answer says the tests pass while `orq verify` of the
// same commit has new failures, or whose answer names repo files that don't exist (<prefix>.refs, written by orq agent);
// a reviewer with a finding the conductor marked invalid (`orq rounds <ID> --invalid`).
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { argvModel, tokenize } from "./agents.js";
import { doneStatus } from "./process.js";
import { collectRounds, parseFindings, readInvalid } from "./rounds.js";

export interface Run {
  issue: string; name: string; agent: string; model: string; role: string; ok: boolean;
  secs: number; timed: boolean; new: number; tot: number; repo: string; approved?: boolean;
  loop?: boolean; halluc?: boolean; // undefined = nothing to judge it by
}
export interface Row {
  role: string; agent: string; model: string; n: number; ok: number; approved: number | null; n_appr: number;
  min: number | null; new: number | null; tot: number | null;
  loop?: number | null; n_loop?: number; halluc?: number | null; n_halluc?: number; // % of the runs that could be judged
}

const ROLE = /^(impl|fix\d*|review\d*|[a-z]+-review\d*|watchdog\d*)-?/;
const read = (f: string) => { try { return readFileSync(f, "utf8"); } catch { return ""; } };

const BINS = /^(codex|claude|opencode|agy|copilot)$/;

/** The model a log says was used: Claude's init event, Codex's banner, opencode's step events. */
function logModel(log: string): string | undefined {
  return /"type"\s*:\s*"system"[^\n]*?"model"\s*:\s*"([^"]+)"/.exec(log)?.[1] ?? /^model: (\S+)/m.exec(log)?.[1]
    ?? /"modelID"\s*:\s*"([^"]+)"/.exec(log)?.[1];
}

/** The argv of a generated .run.sh: its command, shell-tokenized (quotes span lines), without leading VAR=value words. */
function runArgv(run: string): string[] {
  const body = run.split("\n").filter((l) => !l.startsWith("#") && !l.startsWith("cd ")).join("\n");
  const words = tokenize(body.replace(/\s<\s\S+\s*$/, "")).map((w) => w.text);
  while (words.length && /^\w+=/.test(words[0])) words.shift();
  return words;
}

/** [agent, model] of a run. `job` is <prefix>.job.json (argv + agent), `pick` the `-a … -m …` line it was dispatched with
 *  (used only when it names the same agent). */
export function agentModel(run: string, log: string, job?: { agent?: string; argv?: string[]; env?: Record<string, string> }, pick = ""): [string, string] {
  let argv = job?.argv ?? runArgv(run);
  const base = (w: string) => w.split(/[\\/]/).pop()!;
  // Older runs wrap the agent (systemd-run …, git worktree … && codex): start at the first agent CLI found.
  const at = job ? 0 : argv.findIndex((w) => BINS.test(base(w)));
  if (at > 0) argv = argv.slice(at);
  const bin = base(argv[0] ?? "");
  let agent = job?.agent || bin || "?";
  if (agent === "agy") agent = "antigravity";
  const picked = / -a (\S+)/.exec(` ${pick}`)?.[1] === agent ? / -m (\S+)/.exec(pick)?.[1] : undefined;
  // opencode's screen takes the model in its config env, not -m.
  const envModel = /"model":"([^"]+)"/.exec(job?.env?.OPENCODE_CONFIG_CONTENT ?? "")?.[1];
  const model = argvModel(argv) ?? envModel ?? picked ?? logModel(log);
  if (model) return [agent, model.split("/").pop()!];
  return [agent, /^(codex|claude|opencode|agy)$/.test(bin) ? "default" : "-"];
}

function codexSession(sid: string): string | undefined {
  const root = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "sessions");
  const ls = (d: string) => { try { return readdirSync(d); } catch { return []; } };
  for (const y of ls(root)) for (const mo of ls(join(root, y))) for (const d of ls(join(root, y, mo))) {
    const f = ls(join(root, y, mo, d)).find((x) => x.startsWith("rollout-") && x.endsWith(`-${sid}.jsonl`));
    if (f) return join(root, y, mo, d, f);
  }
}

/** [new, total] — new excludes cache reads. */
export function tokens(agent: string, log: string, sid = ""): [number, number] {
  let neu = 0, tot = 0;
  if (agent === "codex") {
    const f = sid && codexSession(sid);
    if (f) {
      const last = read(f).split("\n").filter((l) => l.includes('"total_token_usage"')).pop();
      const u = last && /"total_token_usage":(\{[^}]*\})/.exec(last);
      if (u) {
        const j = JSON.parse(u[1]);
        return [j.total_tokens - (j.cached_input_tokens ?? 0), j.total_tokens];
      }
    }
    const all = [...log.matchAll(/tokens used\s*\n\s*([\d,]+)/g)];
    if (all.length) tot = neu = Number(all[all.length - 1][1].replace(/,/g, ""));
    return [neu, tot];
  }
  for (const line of log.split("\n")) {
    if (!line.startsWith("{")) continue;
    let e: any;
    try { e = JSON.parse(line); } catch { continue; }
    if (agent === "claude" && e.type === "result") {
      const u = e.usage ?? {};
      const n = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0);
      [neu, tot] = [n, n + (u.cache_read_input_tokens ?? 0)];
    } else if (agent === "opencode" && e.type === "step_finish") {
      const t = e.part?.tokens ?? {};
      // Newer opencode has no total: input + output + reasoning + cache.
      const all = t.total ?? (t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0) + (t.cache?.read ?? 0) + (t.cache?.write ?? 0);
      neu += all - (t.cache?.read ?? 0);
      tot += all;
    } else if (agent === "antigravity" && e.event === "result") {
      const u = e.result?.usage ?? {};
      [neu, tot] = [u.total_tokens ?? 0, (u.total_tokens ?? 0) + (u.cache_read_tokens ?? 0)]; // agy's total excludes cache
    }
  }
  return [neu, tot];
}

/** Does an answer say the tests pass? (A child is told not to run them, so the claim is either false or unchecked.) */
export function claimsPass(text: string): boolean {
  return text.split("\n").some((l) => /\b(?:tests?|specs?|test suite|jest|vitest|testes?)\b[^.\n]{0,40}?\b(?:pass(?:es|ed|ing)?|green|succeed(?:s|ed)?|passam|passaram|passando|verdes?)\b/i.test(l)
    && !/\b(?:not|never|didn'?t|did not|don'?t|no|without|n[ãa]o|sem|nenhum)\b[^.\n]{0,20}?\b(?:run|ran|rodei|rodar|executei|executar|rodad)/i.test(l));
}

/** Repo-relative file paths an answer names ("src/a.ts", "`lib/x.py:12`"); orq's own files and dependencies are left out. */
export function refPaths(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:^|[\s`'"(\[])((?:[\w@.-]+\/)+[\w@-][\w@.-]*\.[A-Za-z]\w{0,5})(?=[\s`'"),\]:;]|\.(?:\s|$)|$)/gm)) {
    const p = m[1].replace(/^\.\//, "");
    if (/(?:^|\/)(?:\.orquestra|\.worktrees|node_modules|\.git)\//.test(p) || p.startsWith("../")) continue;
    out.add(p);
  }
  return [...out];
}

const gitOut = (dir: string, ...a: string[]) => {
  const r = spawnSync("git", ["-C", dir, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });
  return r.status === 0 ? r.stdout : undefined;
};

/** The paths in `text` that exist neither in the worktree nor in HEAD's or `start`'s tree (a file the run deleted counts
 *  as existing). A path also matches a tracked file it is the tail of ("Foo.tsx" said from inside a package). */
export function missingRefs(dir: string, text: string, start?: string): { head?: string; checked: number; missing: string[] } {
  const paths = refPaths(text), head = gitOut(dir, "rev-parse", "HEAD")?.trim();
  if (!paths.length || !head) return { head, checked: 0, missing: [] };
  const tracked = new Set<string>();
  for (const rev of [head, start]) if (rev) for (const f of (gitOut(dir, "ls-tree", "-r", "--name-only", rev) ?? "").split("\n")) if (f) tracked.add(f);
  const known = (p: string) => existsSync(join(dir, p)) || tracked.has(p) || [...tracked].some((f) => f.endsWith(`/${p}`));
  const missing = paths.filter((p) => !known(p));
  return { head, checked: paths.length, missing };
}

/** <prefix>.refs: "head=<sha> checked=<n> missing=<a,b>" (missing may be empty). */
export const refsLine = (r: ReturnType<typeof missingRefs>) => `head=${r.head ?? ""} checked=${r.checked} missing=${r.missing.join(",")}\n`;
function parseRefs(text: string): { head: string; missing: number } | undefined {
  const r = /head=(\S*) checked=\d+ missing=(\S*)/.exec(text);
  return r ? { head: r[1], missing: r[2] ? r[2].split(",").length : 0 } : undefined;
}

const LOOPING = new Set(["over_max", "at_max", "same_finding", "repeated"]);

export function collectRuns(ws: string, days: number, maxRounds = 2): Run[] {
  const cutoff = Date.now() - days * 86400_000;
  const base = join(ws, ".orquestra");
  const runs: Run[] = [];
  const dirs = (() => { try { return readdirSync(base); } catch { return []; } })();
  for (const issue of dirs) {
    let files: string[];
    try { files = readdirSync(join(base, issue)); } catch { continue; }
    for (const f of files.filter((x) => x.endsWith(".run.sh"))) {
      const pre = join(base, issue, f.slice(0, -".run.sh".length));
      const runF = `${pre}.run.sh`, done = `${pre}.done`;
      const rs = statSync(runF);
      if (rs.mtimeMs < cutoff || !existsSync(done)) continue;
      const txt = read(runF);
      if (txt.includes("herdr-verify") || txt.includes("herdr-baseline")) continue;
      const log = read(`${pre}.log`);
      let job: { agent?: string; argv?: string[]; env?: Record<string, string> } | undefined;
      try { job = JSON.parse(read(`${pre}.job.json`)); } catch { /* older run */ }
      const [agent, model] = agentModel(txt, log, job, read(`${pre}.pick`));
      const dt = read(done), turns = read(`${pre}.turns`).split("\n").filter(Boolean);
      const first = turns.length ? Date.parse(turns[0]) : NaN;
      const end = Number.isFinite(first) ? first : statSync(done).mtimeMs;
      const timed = Number.isFinite(first) || (!/\bmode=tui\b/.test(dt) && doneStatus(dt) !== "killed");
      const name = basename(pre);
      const rm = ROLE.exec(name);
      const role = rm && rm[1].includes("review") ? "review"
        : rm && rm[1].startsWith("watchdog") ? "watchdog"
        : name.startsWith("fix") || txt.includes("-R ") || txt.includes(" resume ") || txt.includes("--resume") ? "fix"
          : name.startsWith("impl") ? "impl" : "other";
      const out = read(`${pre}.out.md`);
      const [neu, tot] = tokens(agent, log, read(`${pre}.id`).trim());
      runs.push({ issue, name, agent, model, role, ok: doneStatus(dt) === "ok" && out.trim() !== "",
        secs: Math.max(0, Math.floor((end - rs.mtimeMs) / 1000)), timed, new: neu, tot,
        repo: name.includes("-") ? name.slice(name.indexOf("-") + 1) : "" });
    }
  }
  // Implementation delivery: the first review of the same repo in the issue.
  for (const r of runs.filter((x) => x.role === "impl")) {
    const rv = join(base, r.issue, `review-${r.repo}.out.md`);
    if (!existsSync(rv)) continue;
    // "non-blocking suggestion" shows up in approved reviews: the verdict is the word APPROVED (APROVADO in older runs).
    const t = read(rv).slice(0, 4000).toUpperCase();
    r.approved = (t.includes("APPROVED") || t.includes("APROVADO")) &&
      !["NOT APPROVED", "REPROVADO", "NÃO APROVADO"].some((x) => t.includes(x));
  }
  judge(ws, runs, maxRounds);
  return runs;
}

/** Sets loop/halluc on the runs that can be judged (see the header). */
function judge(ws: string, runs: Run[], maxRounds: number): void {
  const base = join(ws, ".orquestra");
  const loops = new Map<string, boolean | undefined>(), invalid = new Map<string, Map<string, Set<number>>>();
  const loopOf = (issue: string) => {
    if (!loops.has(issue)) {
      const x = collectRounds(ws, issue, maxRounds);
      let diag = false;
      try { diag = readdirSync(join(base, issue)).some((n) => /^diagnosis-\d+\.md$/.test(n)); } catch { /* gone */ }
      loops.set(issue, x ? diag || x.reasons.some((r) => LOOPING.has(r.code)) : undefined);
    }
    return loops.get(issue);
  };
  for (const r of runs) {
    const dir = join(base, r.issue), pre = join(dir, r.name);
    if (r.name.startsWith("impl-") && (r.role === "impl" || r.role === "fix")) {
      r.loop = loopOf(r.issue);
      const refs = parseRefs(read(`${pre}.refs`)), vdone = read(join(dir, `verify-${r.repo}.done`));
      let falsePass: boolean | undefined;
      if (vdone) {
        const failed = /\bstatus=fail\b/.test(vdone) && Number(/\bnew=(\d+)/.exec(vdone)?.[1] ?? 0) > 0;
        const vhead = /^# verify \S+ (\S+)/.exec(read(join(dir, `verify-${r.repo}.txt`)))?.[1] ?? "";
        // The same commit when both are known (either may be abbreviated); else the verify that ran after this answer.
        const same = refs?.head && vhead && vhead !== "?" ? refs.head.startsWith(vhead) || vhead.startsWith(refs.head)
          : statSync(join(dir, `verify-${r.repo}.done`)).mtimeMs >= statSync(`${pre}.done`).mtimeMs;
        if (same) falsePass = failed && claimsPass(read(`${pre}.out.md`));
      }
      if (refs || falsePass !== undefined) r.halluc = Boolean(falsePass) || (refs?.missing ?? 0) > 0;
    } else if (r.role === "review") {
      const n = parseFindings(read(`${pre}.out.md`), 0).length;
      if (!n) continue; // nothing claimed, nothing to be wrong about
      if (!invalid.has(r.issue)) invalid.set(r.issue, readInvalid(dir));
      r.halluc = (invalid.get(r.issue)!.get(r.name)?.size ?? 0) > 0;
    }
  }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

export function rows(runs: Run[]): Row[] {
  const groups = new Map<string, Run[]>();
  for (const r of runs) {
    const k = JSON.stringify([r.role, r.agent, r.model]);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.keys()].sort().map((k) => {
    const rs = groups.get(k)!, [role, agent, model] = JSON.parse(k) as string[];
    const withTok = rs.filter((r) => r.tot), appr = rs.filter((r) => r.approved !== undefined).map((r) => r.approved!);
    const pct = (xs: boolean[]) => (xs.length ? Math.round(100 * xs.filter(Boolean).length / xs.length) : null);
    const lp = rs.filter((r) => r.loop !== undefined).map((r) => r.loop!), hl = rs.filter((r) => r.halluc !== undefined).map((r) => r.halluc!);
    return { role, agent, model, n: rs.length, ok: Math.round(100 * rs.filter((r) => r.ok).length / rs.length),
      approved: appr.length ? Math.round(100 * appr.filter(Boolean).length / appr.length) : null, n_appr: appr.length,
      min: rs.some((r) => r.timed) ? Math.round(median(rs.filter((r) => r.timed).map((r) => r.secs)) / 6) / 10 : null,
      new: withTok.length ? Math.floor(median(withTok.map((r) => r.new))) : null,
      tot: withTok.length ? Math.floor(median(withTok.map((r) => r.tot))) : null,
      loop: pct(lp), n_loop: lp.length, halluc: pct(hl), n_halluc: hl.length };
  });
}

export const scoreboard = (ws: string, days: number, maxRounds = 2) => rows(collectRuns(ws, days, maxRounds));
