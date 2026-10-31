// CI/CD signal per claimed issue, for `orq ci` and the board's CI column: for each issue with a live owner
// (.orquestra/<ID>/owner, as orq claim keeps it), the branch its worktree carries (as orq gc matches it:
// <repo>-plane-<id-lower> under .worktrees) and that branch's PR checks via `gh pr view`, aggregated into
// queued | running | passed | failed | none. Cached in the state dir (board/ci.json), like quota — orq board
// never blocks on `gh`; a stale cache starts a background collection the same way quota does. `orq ci` itself is
// the exception: it is the user explicitly asking for CI status right now, so it runs collectCi() in the
// foreground (network and all) and prints the result — only `orq board` reads the cache.
// On a transition to passed or failed: a herdr desktop notification; on failed, one line to the owning
// conductor via testrun.ts's notify(), tracked by `${state}:${head SHA}` in the cache so a repeat collection of
// the same commit never repeats it, but a new commit that is still red does.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aliveOwner } from "./commands/claim.js";
import { writeAtomic } from "./fsutil.js";
import { m } from "./i18n.js";
import { alive } from "./lock.js";
import { stateDir } from "./paths.js";
import { notify } from "./testrun.js";

export type CiState = "queued" | "running" | "passed" | "failed" | "none";
export interface CiEntry { ws: string; issue: string; repo: string; branch: string; pr?: number; sha?: string; state: CiState; notified?: string; at: number }

const git = (cwd: string, ...args: string[]) => spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
const output = (cwd: string, ...args: string[]) => { const r = git(cwd, ...args); return r.status === 0 ? r.stdout.trim() : undefined; };
// ORQ_GH may be a .js file (tests: a fake gh that also runs on Windows), as orq gc already does it.
const gh = (cwd: string, args: string[]) => {
  const bin = process.env.ORQ_GH || "gh";
  return bin.endsWith(".js") ? spawnSync(process.execPath, [bin, ...args], { cwd, encoding: "utf8", timeout: 15_000 })
    : spawnSync(bin, args, { cwd, encoding: "utf8", timeout: 15_000 });
};

export const cacheFile = () => join(stateDir(), "board", "ci.json");

export function loadCache(): CiEntry[] {
  try { return JSON.parse(readFileSync(cacheFile(), "utf8")) as CiEntry[]; } catch { return []; }
}

export function saveCache(entries: CiEntry[]): void { writeAtomic(cacheFile(), JSON.stringify(entries, null, 1)); }

// A per-workspace "collected at" marker, separate from ci.json: collectCi() writes no cache entry for a workspace
// with no claimed issue that has a matching worktree, so ci.json alone can't tell "never collected" apart from
// "collected, found nothing" — the board would otherwise relaunch the collector every redraw forever in the
// latter case. Keyed by a hash of the workspace path since it doubles as a file name.
const wsKey = (ws: string) => createHash("sha1").update(ws).digest("hex").slice(0, 16);
const collectedFile = (ws: string) => join(stateDir(), "board", "ci", `${wsKey(ws)}.at`);

export function markCollected(ws: string, at: number): void { writeAtomic(collectedFile(ws), String(at)); }

/** When `ws` was last collected (collectCi ran for it, even if it found nothing), else undefined if never. */
export function collectedAt(ws: string): number | undefined {
  try { const n = Number(readFileSync(collectedFile(ws), "utf8")); return Number.isFinite(n) ? n : undefined; }
  catch { return undefined; }
}

/** Claimed issues of a workspace with a live owner (as `orq claim -l` lists them), issue id → owner pane + kind
 *  ("herdr" for a pane herdr-notify can reach, else a plain terminal conductor — see handoff.ts's same check). */
export function claimedIssues(ws: string): { id: string; owner: string; kind: string }[] {
  const O = join(ws, ".orquestra"), out: { id: string; owner: string; kind: string }[] = [];
  for (const d of existsSync(O) ? readdirSync(O).filter((x) => !x.startsWith(".")) : []) {
    const f = join(O, d, "owner");
    if (!existsSync(f)) continue;
    const t = readFileSync(f, "utf8").trim();
    if (aliveOwner(t)) out.push({ id: d, owner: /pane=(\S+)/.exec(t)?.[1] ?? "", kind: /kind=(\S+)/.exec(t)?.[1] ?? "herdr" });
  }
  return out;
}

/** Every worktree branch in the workspace's repos, one `git worktree list` per repo — called once per workspace
 *  per collection (collectCi memoizes it across issues) rather than once per claimed issue. */
export function listWorktrees(ws: string): { repo: string; branch: string }[] {
  if (!existsSync(join(ws, ".worktrees"))) return [];
  const out: { repo: string; branch: string }[] = [];
  for (const repoName of readdirSync(ws, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    const repo = join(ws, repoName);
    if (!existsSync(join(repo, ".git"))) continue;
    const listings = output(repo, "worktree", "list", "--porcelain");
    if (!listings) continue;
    for (const block of listings.split(/\n\n/)) {
      const rec = Object.fromEntries(block.split("\n").map((line) => {
        const i = line.indexOf(" "); return [i < 0 ? line : line.slice(0, i), i < 0 ? "" : line.slice(i + 1)];
      })) as Record<string, string>;
      const branch = rec.branch?.replace(/^refs\/heads\//, "") ?? "";
      if (branch) out.push({ repo: repoName, branch });
    }
  }
  return out;
}

/** The repo + branch an issue's worktree carries, the same match `orq gc` uses: a worktree branch ending in
 *  "plane-<id, lowercase>" under <ws>/.worktrees. An issue can have one per repo (several repos in play).
 *  `all` lets a caller looping over several issues pass its own listWorktrees(ws) once instead of one per issue. */
export function issueBranches(ws: string, issue: string, all = listWorktrees(ws)): { repo: string; branch: string }[] {
  const suffix = `plane-${issue.toLowerCase()}`;
  return all.filter((b) => b.branch.toLowerCase().endsWith(suffix));
}

export interface RollupItem { __typename?: string; status?: string; conclusion?: string; state?: string }
// GitHub's statusCheckRollup mixes CheckRun (status/conclusion, the GitHub Actions / Checks API shape) with the
// legacy commit-status shape (StatusContext: just `state`, no status/conclusion at all) for repos whose CI still
// posts plain commit statuses (Jenkins, CircleCI, old GitLab integrations). Left unmapped, every StatusContext
// item reads as still-running forever: conclusion is undefined (never "failed"), status is undefined (never
// "queued"), and `status !== "COMPLETED"` is always true.
const STATUS_STATE: Record<string, { status: string; conclusion?: string }> = {
  SUCCESS: { status: "COMPLETED", conclusion: "SUCCESS" }, FAILURE: { status: "COMPLETED", conclusion: "FAILURE" },
  ERROR: { status: "COMPLETED", conclusion: "ERROR" }, PENDING: { status: "PENDING" },
};
const normalize = (c: RollupItem): { status?: string; conclusion?: string } =>
  c.__typename === "StatusContext" ? (STATUS_STATE[c.state ?? ""] ?? { status: c.status, conclusion: c.conclusion }) : c;

/** The worst signal across a PR's checks: any failure beats a pending one, which beats still running, which beats
 *  all green; no checks at all (none configured, or not registered yet) reads as "none", not a false "passed". */
export function aggregateChecks(rollup: RollupItem[]): CiState {
  if (!rollup.length) return "none";
  const checks = rollup.map(normalize);
  if (checks.some((c) => ["FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "CANCELLED", "ERROR"].includes(c.conclusion ?? ""))) return "failed";
  if (checks.some((c) => c.status === "QUEUED" || c.status === "PENDING" || c.status === "WAITING" || c.status === "REQUESTED")) return "queued";
  if (checks.some((c) => c.status !== "COMPLETED")) return "running";
  return "passed";
}

/** `gh pr view --json number,headRefOid,statusCheckRollup`'s stdout → the PR's number, head SHA and CI state;
 *  no PR (empty/garbage JSON, or no "number") reads as "none". Pure: no network, so it needs no fake gh to test. */
export function parsePrStatus(json: string): { pr?: number; sha?: string; state: CiState } {
  try {
    const j = JSON.parse(json) as { number?: number; headRefOid?: string; statusCheckRollup?: RollupItem[] };
    if (!j.number) return { state: "none" };
    return { pr: j.number, sha: j.headRefOid, state: aggregateChecks(j.statusCheckRollup ?? []) };
  } catch { return { state: "none" }; }
}

/** The branch's PR and CI state; no `gh`, no PR, or a `gh` failure all read as "none" — never an error. */
function prStatus(repo: string, branch: string): { pr?: number; sha?: string; state: CiState } {
  const r = gh(repo, ["pr", "view", branch, "--json", "number,headRefOid,statusCheckRollup"]);
  return r.status === 0 ? parsePrStatus(r.stdout) : { state: "none" };
}

// `orq ci -w ws2` (foreground) and the board's detached `orq board --collect-ci` for ws1 can run at the same
// time; both do a read-modify-write of the single shared ci.json, so without a lock the last one to save erases
// the other's entries for its own workspace (and can drop a `notified` mark, causing a repeat notification).
// A short-lived exclusive lock file around just the read-merge-write (never around the `gh`/network calls above
// it) keeps that atomic; a stale lock (holder process died mid-write) is detected via lock.ts's `alive()` and
// cleared instead of being waited on forever.
function withCacheLock<T>(fn: () => T): T {
  const dir = join(stateDir(), "board"), lf = join(dir, "ci.lock");
  mkdirSync(dir, { recursive: true });
  for (;;) {
    try { writeFileSync(lf, String(process.pid), { flag: "wx" }); break; }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      try { if (!alive(Number(readFileSync(lf, "utf8").trim() || "0"))) { rmSync(lf, { force: true }); continue; } }
      catch { continue; } // lock file vanished mid-check: retry the exclusive create
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try { return fn(); } finally { rmSync(lf, { force: true }); }
}

function notifyDesktop(issue: string, repo: string, state: CiState): void {
  const title = state === "passed" ? m("CI passed", "CI passou") : m("CI failed", "CI falhou");
  spawnSync("herdr", ["notification", "show", title, "--body", `${issue} ${repo}`], { stdio: "ignore" });
}

/**
 * This workspace's current CI entries, merged into the cache (other workspaces' entries untouched). On a genuine
 * transition (a known previous sighting, now a different head commit) to passed or failed: a herdr desktop
 * notification, and on failed one line to the owning conductor — gated by `${state}:${sha}` in `notified`, so a
 * repeat collection of the same head commit never notifies twice, but a new commit that is still red does (the
 * mark carries the sha, so it is never redundant with the `prev` gate that skips a first sighting).
 * A non-herdr owner (a plain terminal conductor, same check as handoff.ts) has no pane herdr-notify can reach, so
 * the line goes through `hooks.notice` (console.log by default) instead — never silently dropped, and never a
 * crash from `herdr agent get` failing.
 * `hooks` lets tests swap the notifiers for ones with no side effects, and lets `orq ci --json` keep its stdout
 * to just the JSON (both default notifiers can otherwise write a stray line in front of it); production code
 * that isn't `--json` never passes it.
 */
export function collectCi(ws: string, hooks: { desktop?: typeof notifyDesktop; owner?: typeof notify; notice?: (line: string) => void } = {}): CiEntry[] {
  const desktop = hooks.desktop ?? notifyDesktop, toOwner = hooks.owner ?? notify, notice = hooks.notice ?? ((l: string) => console.log(l));
  const cache = loadCache(), mine: CiEntry[] = [];
  const now = Date.now(), worktrees = listWorktrees(ws);
  for (const { id, owner, kind } of claimedIssues(ws)) {
    for (const { repo, branch } of issueBranches(ws, id, worktrees)) {
      const prev = cache.find((e) => e.ws === ws && e.issue === id && e.repo === repo && e.branch === branch);
      const { pr, sha, state } = prStatus(join(ws, repo), branch);
      let notified = prev?.notified;
      const mark = sha ? `${state}:${sha}` : undefined;
      if (prev && (state === "passed" || state === "failed") && mark && notified !== mark) {
        desktop(id, repo, state);
        if (state === "failed" && owner) {
          const line = `[ORQ CI] ${id} ${repo} failed (${sha!.slice(0, 7)})`;
          if (kind === "herdr") toOwner(owner, line); else notice(line);
        }
        notified = mark;
      }
      mine.push({ ws, issue: id, repo, branch, ...(pr !== undefined ? { pr } : {}), ...(sha ? { sha } : {}), state, ...(notified ? { notified } : {}), at: now });
    }
  }
  withCacheLock(() => saveCache([...loadCache().filter((e) => e.ws !== ws), ...mine]));
  markCollected(ws, now);
  return mine;
}
