// orq verify — tests related to what changed in a worktree (port of herdr-verify), run by the conductor and not by the
// child (the child hits its 4 GB cap with jest/vitest). One suite at a time on the machine (the "verify" queue,
// machine.test_slots) under its own memory cap (machine.test_mem_max, or $VERIFY_MEM_MAX). Returns at once: the run goes
// to a herdr tab, a tmux window or the background (src/terminal.ts); -x runs it here, in the foreground.
//   output: <prefix>.txt — NEW failures and failures that already exist on the base; <prefix>.done "status=ok|fail new=N".
//   status=ok only with no new failure. On-demand base check: only if some test fails, the SAME test files run in a
//   temporary worktree at origin/<base> (fetched right then); whatever fails there is pre-existing.
// Same protocol as orq agent: `orq wait <prefix>`, or "[HERDR-AGENT DONE] verify <repo> ..." in the conductor's herdr pane.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { getPath, loadConfig } from "../config.js";
import { m } from "../i18n.js";
import { type Ctx, dropWorktree, failures, git, inJob, JS_EXT, launchJob, linkModules, runnerArgs, runnerOf, runTests, type TestJob,
  testCap, today, unsupported } from "../testrun.js";

export const USAGE = "orq verify -w <workspace> -r <repo> -d <worktree> -b <base> -o <prefix> [-g group] [-x]   tests of the diff, new vs pre-existing failures";

export async function verify(argv: string[]): Promise<number> {
  if (argv[0] === "--run") return run(JSON.parse(readFileSync(argv[1], "utf8")) as TestJob);
  const o: Record<string, string> = {};
  let here = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-x") here = true;
    else if (/^-[wrdbog]$/.test(a) && i + 1 < argv.length) o[a[1]] = argv[++i];
    else { console.error(USAGE); return 2; }
  }
  for (const f of "wrdbo") if (!o[f]) { console.error(`${m("missing", "faltou")} -${f}\n${USAGE}`); return 2; }
  const out = resolve(o.o);
  mkdirSync(dirname(out), { recursive: true });
  rmSync(`${out}.done`, { force: true }); rmSync(`${out}.txt`, { force: true });
  // Title "<ID> verify <repo>" (ID = the prefix's folder, .orquestra/<ID>/) so closing the issue finds the tab.
  const j = { cmd: "verify" as const, title: `${basename(dirname(out))} verify ${o.r}`, ws: resolve(o.w), repo: o.r, wt: resolve(o.d), base: o.b, out };
  const { cfg } = loadConfig(j.ws);
  if (here) return run({ ...j, parent: process.env.HERDR_NOTIFY_PANE ?? "", host: "plain", closeAfter: 0, keep: true });
  console.log(`[orq verify] ${j.title} → ${launchJob(cfg, j, o.g || "agents")}`);
  return 0;
}

async function run(j: TestJob): Promise<number> {
  const O = j.out, R = j.repo, B = j.base, WT = j.wt;
  const { cfg } = loadConfig(j.ws);
  let NEW = 0;
  return inJob(j, `verify ${basename(dirname(O))} ${R}`, Number(getPath(cfg, "machine.test_slots") ?? 1), async (c) => {
    const diff = git(WT, "diff", "--name-only", "--diff-filter=d", `origin/${B}...HEAD`);
    if (diff === undefined) throw new Error(m(`git diff against origin/${B} failed in ${WT}`, `o git diff contra origin/${B} falhou em ${WT}`));
    const files = diff.split(/\r?\n/).filter((f) => JS_EXT.test(f));
    const head = git(WT, "rev-parse", "--short", "HEAD") ?? "?";
    if (!files.length) {
      writeFileSync(`${O}.txt`, `# verify ${R} ${head}: no JS/TS file changed relative to origin/${B}\n`);
      return true;
    }
    const { runner, script } = runnerOf(WT);
    if (!runner) throw new Error(unsupported(script));
    const cap = testCap(cfg);
    // One run → "<file> :: <test>" for each failure (undefined = the runner left no JSON report).
    const tests = async (dir: string, mode: "related" | "files", list: string[]) => {
      const json = join(tmpdir(), `orq-verify-${process.pid}-${Date.now()}.json`);
      try {
        await runTests(dir, runner, runnerArgs(runner, mode, list, json), cap, c);
        const r = failures(json, dir);
        if (!r) c.say(m(`no JSON result in ${dir} (did the runner die? see ${O}.log)`, `sem resultado JSON em ${dir} (o runner morreu? veja ${O}.log)`));
        return r;
      } finally { rmSync(json, { force: true }); }
    };
    const mine = await tests(WT, "related", files);
    if (!mine) throw new Error(m("the test run failed", "a execução dos testes falhou"));
    const failed = mine.failed;
    let baseFailed: string[] = [], baseInfo = "no failure on the branch: base not checked";
    if (failed.length) baseInfo = await onBase(j, c, failed, async (dir, list) => (await tests(dir, "files", list))?.failed, (f) => { baseFailed = f; });
    const newList = failed.filter((f) => !baseFailed.includes(f)), oldList = failed.filter((f) => baseFailed.includes(f));
    NEW = newList.length;
    const text = [`# verify ${R} ${head} ${today()}: ${mine.total} tests related to ${files.length} changed files`, `# base: ${baseInfo}`,
      "", `## New failures (${NEW})`, ...(newList.length ? newList : ["none"]),
      "", `## Already failing on origin/${B}`, ...(oldList.length ? oldList : ["none"])].join("\n") + "\n";
    writeFileSync(`${O}.txt`, text);
    process.stdout.write(text);
    return NEW === 0;
  }, (st) => ({ fields: `status=${st} new=${NEW}`, notice: `verify ${R} status=${st} new=${NEW} answer: ${O}.txt` }));
}

/** The failing test files again, on a fresh origin/<base> in a temporary worktree (only those that exist there). */
async function onBase(j: TestJob, c: Ctx, failed: string[], tests: (dir: string, files: string[]) => Promise<string[] | undefined>,
  set: (f: string[]) => void): Promise<string> {
  const REPO = join(j.ws, j.repo), B = j.base, BWT = join(j.ws, ".worktrees", `verifybase-${j.repo}-${process.pid}`);
  if (git(REPO, "fetch", "-q", "origin", B) === undefined)
    c.say(m(`WARNING: fetching origin/${B} failed; using the local origin/${B}`, `AVISO: o fetch de origin/${B} falhou; usando o origin/${B} local`));
  if (git(REPO, "worktree", "add", "-q", "--detach", BWT, `origin/${B}`) === undefined)
    return `WARNING: could not create a worktree at origin/${B}; every failure counts as new`;
  const drop = () => dropWorktree(REPO, BWT);
  c.cleanup.push(drop);
  try {
    linkModules(REPO, BWT);
    const files = [...new Set(failed.map((f) => f.replace(/ :: .*/, "")))].filter((f) => existsSync(join(BWT, f)));
    const info = `${files.length} failing file(s) run on origin/${B} ${git(REPO, "rev-parse", "--short", `origin/${B}`) ?? "?"}`;
    if (!files.length) return info;
    const base = await tests(BWT, files);
    if (!base) return `WARNING: the base run failed (see ${j.out}.log); every failure counts as new`;
    set(base);
    return info;
  } finally {
    c.cleanup.splice(c.cleanup.indexOf(drop), 1);
    drop();
  }
}
