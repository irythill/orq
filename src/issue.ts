// The issue a branch or worktree belongs to, and which issues have an agent really running.
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { alive } from "./lock.js";
import { stateDir } from "./paths.js";

/** "<PROJ>-<N>" (as written in the name) from a branch or worktree name like "me/plane-proj-68-api-2";
 *  anything after the number ("-api-2", "-backfill") is a suffix and ignored. */
export function issueFromName(name: string): string | undefined {
  return /plane-([a-z][a-z0-9]*-\d+)(?=-|$)/i.exec(name)?.[1];
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
