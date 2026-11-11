// Stop processes whose current working directory is inside a worktree before git removes its files.
import { readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

function inside(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function stat(pid: number): string | undefined {
  try { return readFileSync(`/proc/${pid}/stat`, "utf8"); } catch { return undefined; }
}

/** orq itself and every ancestor (the shell or tmux pane that launched it), which must never be stopped. */
function ownChain(): Set<number> {
  const chain = new Set<number>();
  for (let pid = process.pid; pid > 1 && !chain.has(pid);) {
    chain.add(pid);
    const ppid = Number(/\) \S+ (\d+)/.exec(stat(pid) ?? "")?.[1]);
    if (!ppid) break;
    pid = ppid;
  }
  return chain;
}

/** Processes whose cwd is under `dir`, excluding orq and its ancestors; other platforms skip this check. */
export function worktreeProcesses(dir: string): number[] {
  if (process.platform !== "linux") return [];
  let root: string;
  try { root = realpathSync(dir); } catch { root = resolve(dir); }
  let entries: string[];
  try { entries = readdirSync("/proc"); } catch { return []; }
  const skip = ownChain(), pids: number[] = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (skip.has(pid)) continue;
    try { if (inside(root, resolve(readlinkSync(`/proc/${entry}/cwd`)))) pids.push(pid); } catch { /* process exited or inaccessible */ }
  }
  return pids;
}

/** `pid (name)` for output, so the user sees what is (or would be) stopped. */
export function describe(pid: number): string {
  try { return `${pid} (${readFileSync(`/proc/${pid}/comm`, "utf8").trim()})`; } catch { return String(pid); }
}

/** SIGTERM matching processes, wait up to five seconds, then SIGKILL survivors. Returns `describe`d entries. */
export function stopWorktreeProcesses(dir: string): string[] {
  const pids = worktreeProcesses(dir), names = pids.map(describe);
  for (const pid of pids) try { process.kill(pid, "SIGTERM"); } catch { /* already exited */ }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && pids.some(alive)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  for (const pid of pids) if (alive(pid)) try { process.kill(pid, "SIGKILL"); } catch { /* already exited */ }
  return names;
}

function alive(pid: number): boolean {
  if (process.platform === "linux") { const s = stat(pid); if (s === undefined || /^\d+ \(.*\) Z /.test(s)) return false; }
  try { process.kill(pid, 0); return true; } catch { return false; }
}
