// Test runs for orq verify / orq baseline: detect jest or vitest from package.json "test", run it under the test
// memory cap (src/process.ts) and read its JSON report into "<file relative to the repo> :: <full test name>" lines.
// The runner's own bin (node_modules/<runner>/package.json "bin") runs with this node, so Windows needs no shell;
// without it, npx as before. Also the background job both share (launch on a TerminalHost, queue, .pid/.done, notify).
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, lstatSync, readFileSync, realpathSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
  type WriteStream } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { type Obj } from "./config.js";
import { writeAtomic } from "./fsutil.js";
import { m } from "./i18n.js";
import { acquire, release } from "./lock.js";
import { stateDir } from "./paths.js";
import { killTree, type MemMode, parseSize, runCapped } from "./process.js";
import { closeOwnTab, detectHost, type Host, launch } from "./terminal.js";

export type Runner = "jest" | "vitest";
export const JS_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;

export const git = (dir: string, ...a: string[]) => {
  const r = spawnSync("git", ["-C", dir, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });
  return r.status === 0 ? r.stdout.trim() : undefined;
};

/** jest | vitest from the "test" script (vitest first, as herdr-verify did). */
export function runnerOf(dir: string): { runner?: Runner; script: string } {
  let script = "";
  try { script = String(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).scripts?.test ?? ""); } catch { /* none */ }
  return { runner: script.includes("vitest") ? "vitest" : script.includes("jest") ? "jest" : undefined, script };
}

/** Runner arguments: "related" = tests related to these sources, "files" = these test files, "all" = full suite. */
export function runnerArgs(runner: Runner, mode: "related" | "files" | "all", files: string[], json: string): string[] {
  const some = mode !== "all";
  if (runner === "vitest")
    return [mode === "related" ? "related" : "run", ...files, ...(some ? ["--run", "--passWithNoTests"] : []),
      "--reporter=json", `--outputFile=${json}`, "--maxWorkers=2"];
  return [...(mode === "related" ? ["--findRelatedTests"] : mode === "files" ? ["--runTestsByPath"] : []), ...files,
    ...(some ? ["--passWithNoTests"] : []), "--json", `--outputFile=${json}`, "--maxWorkers=2", "--workerIdleMemoryLimit=1G"];
}

/** The runner's own JS entry in <dir>/node_modules, if any. */
export function localBin(dir: string, runner: Runner): string | undefined {
  try {
    const pj = join(dir, "node_modules", runner, "package.json");
    const bin = JSON.parse(readFileSync(pj, "utf8")).bin;
    const rel = typeof bin === "string" ? bin : bin?.[runner];
    return rel && existsSync(join(dirname(pj), rel)) ? join(dirname(pj), rel) : undefined;
  } catch { return undefined; }
}

/** Memory cap for a test suite: $VERIFY_MEM_MAX, else machine.test_mem_max. */
export function testCap(cfg: Obj): { cap?: number; mode: MemMode } {
  const mach = (cfg.machine ?? {}) as Obj;
  return { cap: parseSize(process.env.VERIFY_MEM_MAX || String(mach.test_mem_max ?? "off")), mode: (mach.mem_enforce as MemMode | undefined) ?? "auto" };
}

/** Run the runner in `dir` under the cap; its output goes to the screen and log (unless !show). Resolves to the exit code. */
export function runTests(dir: string, runner: Runner, args: string[], cap: { cap?: number; mode: MemMode }, c: Ctx,
  show = true): Promise<number> {
  const bin = localBin(dir, runner);
  const [cmd, argv] = bin ? [process.execPath, [bin, ...args]] : ["npx", [runner, ...args]];
  return runCapped(cmd, argv, {
    ...cap, cwd: dir, quote: true, stdio: show ? ["ignore", "pipe", "pipe"] : "ignore",
    onSpawn: (p) => {
      c.child = p.pid;
      if (show) for (const s of [p.stdout, p.stderr]) s?.setEncoding("utf8").on("data", (d: string) => { for (const l of d.replace(/\r?\n$/, "").split(/\r?\n/)) c.say(l); });
    },
  }).finally(() => { c.child = undefined; });
}

/** A test file path from the report, relative to the repo folder (forward slashes, as on Linux). */
export function relTo(dir: string, file: string): string {
  const dirs = [dir];
  try { dirs.push(realpathSync(dir)); } catch { /* gone */ }
  for (const d of dirs) {
    const r = relative(d, file);
    if (r && !r.startsWith("..") && !isAbsolute(r)) return r.split("\\").join("/");
  }
  return file.split("\\").join("/");
}

/** Failed tests in a jest/vitest JSON report → sorted unique "<file> :: <test>" lines, plus numTotalTests. */
export function failures(report: string, dir: string): { failed: string[]; total: number } | undefined {
  let j: { numTotalTests?: number; testResults?: { name: string; assertionResults?: { status: string; fullName: string }[] }[] };
  try { j = JSON.parse(readFileSync(report, "utf8")); } catch { return undefined; }
  const failed = new Set<string>();
  for (const f of j.testResults ?? [])
    for (const a of f.assertionResults ?? []) if (a.status === "failed") failed.add(`${relTo(dir, f.name)} :: ${a.fullName}`);
  return { failed: [...failed].sort(), total: j.numTotalTests ?? 0 };
}

/** node_modules of the main clone into a temporary worktree (a junction on Windows: no admin rights needed). */
export function linkModules(from: string, to: string): void {
  try { symlinkSync(realpathSync(join(from, "node_modules")), join(to, "node_modules"), process.platform === "win32" ? "junction" : "dir"); }
  catch { /* none */ }
}

/**
 * Remove a temporary worktree. The node_modules link goes first, by itself: git on Windows can't remove a junction
 * (and must never walk into the main clone's node_modules through it).
 */
export function dropWorktree(repo: string, dir: string): void {
  const nm = join(dir, "node_modules");
  try { if (lstatSync(nm).isSymbolicLink() || process.platform === "win32") unlinkSync(nm); } catch { try { rmdirSync(nm); } catch { /* none */ } }
  if (git(repo, "worktree", "remove", "--force", dir) === undefined && existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
    git(repo, "worktree", "prune");
  }
}

/** "2026-10-27" in local time (date -I). */
export const today = () => {
  const d = new Date(), p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** A line to both the screen and the run's log. */
export const teller = (log: WriteStream) => (l: string) => { process.stdout.write(`${l}\n`); log.write(`${l}\n`); };

export const unsupported = (script: string) => m(`unsupported runner: '${script}' (jest or vitest)`, `runner não suportado: '${script}' (jest ou vitest)`);

// --- the background job: launched on the TerminalHost like orq agent; .pid while running, .done at the end ----------
export interface TestJob {
  cmd: "verify" | "baseline"; title: string; ws: string; repo: string; wt: string; base: string; out: string;
  parent: string; host: Host; closeAfter: number; keep: boolean;
}

const CLI = fileURLToPath(new URL("./cli.js", import.meta.url));

/** Write <out>.job.json and start `orq <cmd> --run <job>` on the host (herdr tab, tmux window or background). */
export function launchJob(cfg: Obj, j: Omit<TestJob, "parent" | "host" | "closeAfter" | "keep">, group: string): string {
  const mach = (cfg.machine ?? {}) as Obj;
  const closeAfter = Number(process.env.HERDR_CLOSE_DELAY ?? mach.close_tab_after ?? 20);
  const job: TestJob = { ...j, parent: process.env.HERDR_PANE_ID ?? "", host: detectHost(cfg), closeAfter,
    keep: process.env.HERDR_KEEP_TAB === "1" || process.env.ORQ_KEEP_TAB === "1" || closeAfter <= 0 };
  writeAtomic(`${j.out}.job.json`, JSON.stringify(job, null, 1));
  return launch(job.host, { group, title: j.title, dir: j.cmd === "verify" ? j.wt : j.repo, keep: job.keep,
    argv: [process.execPath, CLI, j.cmd, "--run", `${j.out}.job.json`], id: `${j.cmd}-${Math.floor(Date.now() / 1000)}-${process.pid}` });
}

export interface Ctx { say: (l: string) => void; slots: number; child?: number; cleanup: (() => void)[] }

/**
 * Run `body` as the job's runner: holds a slot in the "verify" queue (label shown by orq board), writes <out>.pid
 * meanwhile and <out>.done after (`done(status)` gives its fields), notifies the conductor's herdr pane, closes its
 * own tab. A signal (tab closed, Ctrl+C) still frees the slot, removes temporary worktrees and writes .done.
 */
export async function inJob(j: TestJob, label: string, slots: number, body: (c: Ctx) => Promise<boolean>,
  done: (st: string) => { fields: string; notice: string }): Promise<number> {
  const O = j.out;
  writeFileSync(`${O}.pid`, String(process.pid));
  const log = createWriteStream(`${O}.log`), say = teller(log);
  const c: Ctx = { say, slots, cleanup: [] };
  let st = "fail", ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    for (const f of c.cleanup.splice(0)) try { f(); } catch { /* best effort */ }
    release("verify", process.pid);
    const { fields, notice } = done(st);
    writeAtomic(`${O}.done`, `${fields} at=${new Date().toISOString()}\n`);
    rmSync(`${O}.pid`, { force: true });
    if (j.parent) notify(j.parent, `[HERDR-AGENT DONE] ${notice}`);
    say(`[${j.cmd} ${m("finished", "terminou")}: ${fields}] ${notice.replace(/.* answer: /, "")}`);
  };
  const stop = () => { if (c.child) killTree(c.child); finish(); process.exit(130); };
  const sigs: NodeJS.Signals[] = process.platform === "win32" ? ["SIGINT", "SIGBREAK", "SIGHUP"] : ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const s of sigs) process.on(s, stop);
  try {
    await acquire("verify", process.pid, label, slots, () => say(m("another verification is running; waiting for my turn...",
      "outra verificação em andamento; aguardando a vez...")));
    if (await body(c)) st = "ok";
  } catch (e) {
    say(`orq ${j.cmd}: ${(e as Error).message}`);
  } finally {
    finish();
    for (const s of sigs) process.off(s, stop);
  }
  await new Promise((r) => log.end(r));
  if (j.host !== "plain" && !j.keep) { await new Promise((r) => setTimeout(r, j.closeAfter * 1000)); closeOwnTab(j.host); }
  return st === "ok" ? 0 : 1;
}

/** Where `orq handoff` records the pane that replaced a conductor's. */
export const handoffFile = (pane: string) => join(stateDir(), "handoff", pane.replace(/\W/g, "_"));

/** The conductor is a herdr pane: type the line into it (herdr-notify waits for it to leave a dialog). In the
 * background when the caller must not wait for that (an agent's end-of-turn hook holds its screen meanwhile). */
export function notify(pane: string, line: string, background = false): void {
  const seen = new Set<string>();
  while (!seen.has(pane) && existsSync(handoffFile(pane))) {
    seen.add(pane);
    let next: string;
    try { next = readFileSync(handoffFile(pane), "utf8").trim(); } catch { break; } // gone between the two calls
    if (!next || next === pane) break;
    pane = next; // follow repeated handoffs to the current conductor
  }
  const local = join(dirname(CLI), "..", "setup", "herdr-notify"), cmd = existsSync(local) ? local : "herdr-notify";
  if (background) spawn(cmd, [pane, line], { detached: true, stdio: "ignore" }).unref();
  else spawnSync(cmd, [pane, line], { stdio: "inherit" });
}
