// The issue a branch or worktree belongs to, and which issues have an agent really running.
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { getPath, loadConfig } from "./config.js";
import { alive } from "./lock.js";
import { stateDir } from "./paths.js";

/** Finds "<LETTERS>-<DIGITS>" anywhere in the name, as its own token; anything after the number is a suffix. */
export const DEFAULT_ISSUE_PATTERN = "(?<![a-z0-9])(?<issue>[a-z][a-z0-9]*-\\d+)(?![a-z0-9])";

/** The issue ID (as written in the name) from a branch or worktree name like "me/plane-proj-68-api-2" or
 *  "feature/ABC-123". `pattern` is [git] issue_pattern: a case-insensitive regex whose named group "issue"
 *  (else group 1, else the whole match) is the ID. */
export function issueFromName(name: string, pattern: string = DEFAULT_ISSUE_PATTERN): string | undefined {
  let re: RegExp;
  try { re = new RegExp(pattern, "i"); } catch (e) { throw new Error(`git.issue_pattern: ${(e as Error).message}`); }
  const r = re.exec(name);
  return r ? (r.groups?.issue ?? r[1] ?? r[0]) : undefined;
}

/** [git] issue_pattern of the workspace's merged config (default when unset). */
export function issuePattern(ws: string): string {
  const v = getPath(loadConfig(ws).cfg, "git.issue_pattern");
  return typeof v === "string" && v ? v : DEFAULT_ISSUE_PATTERN;
}

/** Issue directories (basename of the run prefix's folder) with an agent whose state says running and whose pid is
 *  alive: the same rule the board uses for "running". */
export function issuesWithLiveAgent(): Set<string> {
  const dir = join(stateDir(), "agents"), out = new Set<string>();
  let files: string[] = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { /* no runs yet */ }
  for (const f of files) {
    try {
      const s = JSON.parse(readFileSync(join(dir, f), "utf8")) as Record<string, unknown>;
      if (s.status === "ok" || s.status === "fail" || s.status === "killed" || !alive(Number(s.pid))) continue;
      out.add(basename(dirname(String(s.prefix ?? ""))));
    } catch { /* unreadable state: ignore */ }
  }
  return out;
}
