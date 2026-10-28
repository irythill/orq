// orq baseline — which tests ALREADY fail on origin/<base> (port of herdr-baseline): the full suite in a temporary
// worktree detached at origin/<base> (node_modules = link to the main clone), in the same queue and under the same cap
// as orq verify. Outside the issue flow (orq verify checks the base on demand): a manual snapshot of the base.
//   output: <workspace>/.orquestra/baseline/<repo>-<base>.txt  (1st line "# sha <sha> <date> ..."; then 1 test per line)
//   Already up to date for the current origin/<base> → says so and runs nothing. -p is accepted and ignored.
// Same protocol as orq agent: `orq wait <output>`, or "[HERDR-AGENT DONE] baseline <repo> ..." in the conductor's pane.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getPath, loadConfig } from "../config.js";
import { m } from "../i18n.js";
import { dropWorktree, failures, git, inJob, launchJob, linkModules, runnerArgs, runnerOf, runTests, type TestJob, testCap, today,
  unsupported } from "../testrun.js";

export const USAGE = "orq baseline -w <workspace> -r <repo> -b <base> [-g group] [-x]   tests already failing on origin/<base> (full suite)";

const current = (out: string, sha: string) => {
  try { return readFileSync(out, "utf8").split("\n", 1)[0].includes(`sha ${sha} `); } catch { return false; }
};

export async function baseline(argv: string[]): Promise<number> {
  if (argv[0] === "--run") return run(JSON.parse(readFileSync(argv[1], "utf8")) as TestJob);
  const o: Record<string, string> = {};
  let here = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-x") here = true;
    else if (/^-[pwrbg]$/.test(a) && i + 1 < argv.length) o[a[1]] = argv[++i];
    else { console.error(USAGE); return 2; }
  }
  for (const f of "wrb") if (!o[f]) { console.error(`${m("missing", "faltou")} -${f}\n${USAGE}`); return 2; }
  const ws = resolve(o.w), repo = join(ws, o.r), dir = join(ws, ".orquestra", "baseline"), out = join(dir, `${o.r}-${o.b}.txt`);
  mkdirSync(dir, { recursive: true });
  const j = { cmd: "baseline" as const, title: `baseline ${o.r} ${o.b}`, ws, repo: o.r, wt: join(ws, ".worktrees", `baseline-${o.r}`), base: o.b, out };
  if (here) return run({ ...j, parent: process.env.HERDR_NOTIFY_PANE ?? "", host: "plain", closeAfter: 0, keep: true });
  if (git(repo, "fetch", "-q", "origin", o.b) === undefined) { console.error(m(`fetching origin/${o.b} failed`, `o fetch de origin/${o.b} falhou`)); return 1; }
  const sha = git(repo, "rev-parse", "--short", `origin/${o.b}`) ?? "";
  if (current(out, sha)) { console.log(`${m("baseline already up to date", "baseline já está atual")} (${sha}): ${out}`); return 0; }
  rmSync(`${out}.done`, { force: true });
  console.log(`[orq baseline] ${j.title} → ${launchJob(loadConfig(ws).cfg, j, o.g || "agents")}`);
  return 0;
}

async function run(j: TestJob): Promise<number> {
  const OUT = j.out, R = j.repo, B = j.base, REPO = join(j.ws, R), WT = j.wt;
  const { cfg } = loadConfig(j.ws);
  let sha = git(REPO, "rev-parse", "--short", `origin/${B}`) ?? "?";
  // Same queue as orq verify: one test suite at a time on the machine (each may use up to machine.test_mem_max).
  return inJob(j, `baseline — ${R}`, Number(getPath(cfg, "machine.test_slots") ?? 1), async (c) => {
    // An identical baseline may have finished while this one waited: check again before running the full suite.
    git(REPO, "fetch", "-q", "origin", B);
    sha = git(REPO, "rev-parse", "--short", `origin/${B}`) ?? sha;
    if (current(OUT, sha)) { c.say(`${m("baseline already up to date", "baseline já está atual")} (${sha})`); return true; }
    const drop = () => dropWorktree(REPO, WT);
    drop();
    if (git(REPO, "worktree", "add", "-q", "--detach", WT, `origin/${B}`) === undefined)
      throw new Error(m(`could not create a worktree at origin/${B}`, `não consegui criar um worktree em origin/${B}`));
    c.cleanup.push(drop);
    linkModules(REPO, WT);
    const { runner, script } = runnerOf(WT);
    if (!runner) throw new Error(unsupported(script));
    const json = join(tmpdir(), `orq-baseline-${process.pid}-${Date.now()}.json`);
    let r;
    try {
      await runTests(WT, runner, runnerArgs(runner, "all", [], json), testCap(cfg), c, false); // full suite: too loud for the log
      r = failures(json, WT);
    } finally { rmSync(json, { force: true }); }
    if (!r) throw new Error(m("no JSON result", "sem resultado JSON"));
    const deps = git(REPO, "diff", "--quiet", "HEAD", `origin/${B}`, "--", "package.json", "package-lock.json", "bun.lock") === undefined
      ? ` (WARNING: the main clone's node_modules is behind origin/${B})` : "";
    writeFileSync(`${OUT}.tmp`, [`# sha ${sha} ${today()} — tests already failing on origin/${B}${deps}`, ...r.failed].join("\n") + "\n");
    renameSync(`${OUT}.tmp`, OUT);
    c.say(`${r.failed.length} ${m("tests failing on the base", "testes falhando na base")}`);
    return true;
  }, (st) => ({ fields: `status=${st} sha=${sha}`, notice: `baseline ${R} ${B} status=${st} sha=${sha} answer: ${OUT}` }));
}

