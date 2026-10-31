// orq gc — find issue worktrees whose branch is already safe to remove.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { getPath, loadConfig } from "../config.js";
import { m } from "../i18n.js";
import { aliveOwner } from "./claim.js";

export const USAGE = "orq gc [-w <workspace>] [--yes] [--days N] [--json]   remove merged issue worktrees";
type Row = { repo: string; worktree: string; branch: string; verdict: "KEEP" | "REMOVABLE" | "STALE"; reason: string; path: string };
const git = (cwd: string, ...args: string[]) => spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
// Paths as git prints them can differ from ours (macOS /var → /private/var, Windows C:/ vs C:\): compare real paths.
const real = (p: string) => { try { return realpathSync.native(p); } catch { return resolve(p); } };
const inside = (dir: string, p: string) => { const r = relative(dir, p); return !!r && !r.startsWith("..") && !isAbsolute(r); };
// ORQ_GH may be a .js file (tests: a fake gh that also runs on Windows).
const gh = (cwd: string, args: string[]) => {
  const bin = process.env.ORQ_GH || "gh";
  return bin.endsWith(".js") ? spawnSync(process.execPath, [bin, ...args], { cwd, encoding: "utf8" })
    : spawnSync(bin, args, { cwd, encoding: "utf8" });
};
const output = (cwd: string, ...args: string[]) => { const r = git(cwd, ...args); return r.status === 0 ? r.stdout.trim() : undefined; };

export async function gc(argv: string[], clock: () => number = Date.now): Promise<number> {
  let ws = process.cwd(), yes = false, json = false, days = 14;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-w" && argv[i + 1]) ws = resolve(argv[++i]);
    else if (argv[i] === "--yes") yes = true;
    else if (argv[i] === "--json") json = true;
    else if (argv[i] === "--days" && argv[i + 1] && /^\d+$/.test(argv[i + 1])) days = Number(argv[++i]);
    else { console.error(USAGE); return 2; }
  }
  const { cfg } = loadConfig(ws), rows: Row[] = [];
  let ghUnavailable = false, fetchWarned = false;
  const root = join(ws, ".worktrees");
  const orq = join(ws, ".orquestra");
  const issues = existsSync(orq) ? readdirSync(orq).filter((x) => !x.startsWith(".")) : [];
  for (const repoName of readdirSync(ws, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    const repo = join(ws, repoName);
    if (!existsSync(join(repo, ".git"))) continue;
    const listings = output(repo, "worktree", "list", "--porcelain");
    if (listings === undefined) continue;
    const worktrees = listings.split(/\n\n/).map((block) => Object.fromEntries(block.split("\n").map((line) => {
      const i = line.indexOf(" "); return [i < 0 ? line : line.slice(0, i), i < 0 ? "" : line.slice(i + 1)];
    })) as Record<string, string>);
    const main = real(worktrees[0]?.worktree ?? repo);
    const conf = (cfg.repos as Record<string, { prod_ref?: string }> | undefined)?.[repoName];
    const head = output(repo, "symbolic-ref", "refs/remotes/origin/HEAD")?.replace("refs/remotes/", "");
    const prod = conf?.prod_ref || head || "origin/main";
    const fetchRef = prod.replace(/^origin\//, "");
    if (git(repo, "fetch", "origin", fetchRef).status !== 0 && !fetchWarned) {
      console.error(m("WARNING: git fetch failed; using local refs", "AVISO: git fetch falhou; usando as refs locais")); fetchWarned = true;
    }
    const prodTree = output(repo, "rev-parse", `${prod}^{tree}`);
    for (const wt of worktrees) {
      const path = real(wt.worktree ?? "");
      if (!wt.worktree || path === main || !inside(real(root), path)) continue;
      const branch = wt.branch?.replace(/^refs\/heads\//, "") ?? "";
      if (!branch) continue;
      // The branch carries the ID in lowercase (plane-abc-123); .orquestra/ keeps it as written (ABC-123).
      const id = /^.*?plane-(.+)$/.exec(branch)?.[1];
      const issue = id && issues.find((d) => d.toLowerCase() === id.toLowerCase());
      const status = output(path, "status", "--porcelain");
      const unpushed = output(repo, "rev-list", branch, "--not", "--remotes");
      let reason = "", verdict: Row["verdict"] = "REMOVABLE";
      if (status) { verdict = "KEEP"; reason = m("uncommitted changes", "alterações não commitadas"); }
      const ownerFile = issue && join(ws, ".orquestra", issue, "owner");
      if (verdict !== "KEEP" && ownerFile && existsSync(ownerFile) && aliveOwner(readFileSync(ownerFile, "utf8"))) {
        verdict = "KEEP"; reason = m("issue has a live owner", "issue tem um responsável ativo");
      }
      // A .pane/.id without a same-stem .done is treated as a running child.
      const issueDir = issue && join(ws, ".orquestra", issue);
      if (verdict !== "KEEP" && issueDir && existsSync(issueDir)) {
        const files = readdirSync(issueDir), running = files.some((f) => /\.(pane|id)$/.test(f) && !existsSync(join(issueDir, `${f.replace(/\.(pane|id)$/, "")}.done`)));
        if (running) { verdict = "KEEP"; reason = m("child agent may still be running", "um agente filho pode estar em execução"); }
      }
      let merged = false;
      if (verdict !== "KEEP") {
        // Merged counts only if the PR's head is the local head: a commit made after the merge must not be lost.
        const pr = gh(repo, ["pr", "list", "--head", branch, "--state", "merged", "--json", "number,headRefOid", "--limit", "1"]);
        const local = output(repo, "rev-parse", branch);
        if (pr.status === 0) {
          try { const p = JSON.parse(pr.stdout)[0]; merged = !!p && (!p.headRefOid || p.headRefOid === local); } catch { ghUnavailable = true; }
        } else ghUnavailable = true;
      }
      const inBase = verdict !== "KEEP" && !!prodTree && output(repo, "merge-tree", "--write-tree", prod, branch) === prodTree;
      if (verdict !== "KEEP" && unpushed && !merged && !inBase) { verdict = "KEEP"; reason = m("commits not contained in remote refs", "commits fora das refs remotas"); }
      else if (verdict !== "KEEP" && (merged || inBase)) { verdict = "REMOVABLE"; reason = merged ? "PR merged" : m("content is in base", "conteúdo já está na base"); }
      else if (verdict !== "KEEP") {
        const closed = gh(repo, ["pr", "list", "--head", branch, "--state", "closed", "--json", "number", "--limit", "1"]);
        const isClosed = closed?.status === 0 && (() => { try { return JSON.parse(closed.stdout).length > 0; } catch { return false; } })();
        const commit = output(repo, "log", "-1", "--format=%ct", branch), old = commit !== undefined && clock() - Number(commit) * 1000 > days * 86400_000;
        verdict = "STALE"; reason = isClosed ? m("PR closed without merge", "PR fechada sem merge") : old ? m(`last commit is older than ${days} days`, `último commit tem mais de ${days} dias`) : m("not merged", "não integrado");
      }
      rows.push({ repo: repoName, worktree: basename(path), branch, verdict, reason, path });
    }
  }
  if (ghUnavailable) console.error(m("NOTE: gh unavailable or failed; PR signals were skipped", "NOTA: gh indisponível ou falhou; sinais de PR ignorados"));
  let failed = false;
  if (yes) for (const row of rows.filter((r) => r.verdict === "REMOVABLE")) {
    const removed = git(join(ws, row.repo), "worktree", "remove", row.path);
    if (removed.status !== 0) { failed = true; row.reason += `; ${m("worktree removal failed", "falha ao remover worktree")}`; continue; }
    if (git(join(ws, row.repo), "branch", "-D", row.branch).status !== 0) { failed = true; row.reason += `; ${m("branch deletion failed", "falha ao excluir branch")}`; }
    git(join(ws, row.repo), "worktree", "prune");
  }
  if (json) console.log(JSON.stringify(rows));
  else {
    const table = [["REPO", "WORKTREE", "BRANCH", "VERDICT", "REASON"], ...rows.map((r) => [r.repo, r.worktree, r.branch, r.verdict, r.reason])];
    const w = table[0].map((_, i) => Math.max(...table.map((t) => t[i].length)));
    console.log(table.map((t) => t.map((c, i) => i < t.length - 1 ? c.padEnd(w[i]) : c).join("  ")).join("\n"));
  }
  return failed ? 1 : 0;
}
