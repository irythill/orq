// Stop processes whose current working directory is inside a worktree before git removes its files.
import { readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

function inside(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return !!rel && !rel.startsWith("..") && !isAbsolute(rel);
}

/** Processes whose cwd is under `dir`; other platforms skip this check. */
export function worktreeProcesses(dir: string): number[] {
  if (process.platform !== "linux") return [];
  let root: string;
  try { root = realpathSync(dir); } catch { root = resolve(dir); }
  const pids: number[] = [];
  let entries: string[];
  try { entries = readdirSync("/proc"); } catch { return []; }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid === process.pid) continue;
    try { if (inside(root, resolve(readlinkSync(`/proc/${entry}/cwd`)))) pids.push(pid); } catch { /* process exited or inaccessible */ }
  }
  return pids;
}

/** SIGTERM matching processes, wait up to five seconds, then SIGKILL survivors. */
export function stopWorktreeProcesses(dir: string): number[] {
  const pids = worktreeProcesses(dir);
  for (const pid of pids) try { process.kill(pid, "SIGTERM"); } catch { /* already exited */ }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && pids.some(alive)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  for (const pid of pids) if (alive(pid)) try { process.kill(pid, "SIGKILL"); } catch { /* already exited */ }
  return pids;
}

function alive(pid: number): boolean {
  if (process.platform === "linux") try { if (/^\d+ \(.*\) Z /.test(readFileSync(`/proc/${pid}/stat`, "utf8"))) return false; } catch { return false; }
  try { process.kill(pid, 0); return true; } catch { return false; }
}
