// Portable FIFO lock with N slots (the test queue), made of plain files — no flock, no /proc/locks.
//   <state dir>/locks/<name>/<ms>-<pid>.json   one entry per process that asked: {pid, label, at, held}
// Holders are the entries with held = true whose process is alive. A waiter takes a slot when fewer than `slots` are
// held and it is the oldest live non-held entry, after its file has existed for SETTLE_MS (so an older entry still
// being written is seen first). Dead processes' entries are swept by whoever looks, so a crash never leaves the queue
// stuck. Works the same on Linux, macOS and Windows (process.kill(pid, 0) checks liveness everywhere).
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./fsutil.js";
import { stateDir } from "./paths.js";

export interface Entry { pid: number; label: string; at: number; held: boolean; file: string }
const SETTLE_MS = 250;

const dir = (name: string) => join(stateDir(), "locks", name);

export function alive(pid: number): boolean {
  if (!(pid > 0)) return false; // kill(0, …) would signal our own process group and "succeed"
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

/** Live entries in queue order (dead ones are removed). */
export function entries(name: string): Entry[] {
  let files: string[];
  try { files = readdirSync(dir(name)).filter((f) => f.endsWith(".json")); } catch { return []; }
  const out: Entry[] = [];
  for (const f of files) {
    const file = join(dir(name), f);
    try {
      const e = { ...JSON.parse(readFileSync(file, "utf8")), file } as Entry;
      if (alive(e.pid)) out.push(e); else rmSync(file, { force: true });
    } catch { /* being written or removed: skip this round */ }
  }
  return out.sort((a, b) => a.at - b.at || a.pid - b.pid);
}

export const status = (name: string) => {
  const all = entries(name);
  return { holders: all.filter((e) => e.held), waiters: all.filter((e) => !e.held) };
};

/** Queue `pid` and resolve once it holds a slot. `onWait` is called once if it has to wait. */
export async function acquire(name: string, pid: number, label: string, slots = 1, onWait?: (ahead: number) => void,
  pollMs = 500): Promise<void> {
  mkdirSync(dir(name), { recursive: true });
  const mine = entries(name).find((e) => e.pid === pid);
  if (mine?.held) return; // re-entrant for the same process
  const at = mine?.at ?? Date.now();
  const file = mine?.file ?? join(dir(name), `${at}-${pid}.json`);
  writeAtomic(file, JSON.stringify({ pid, label, at, held: false }));
  let told = false;
  for (;;) {
    const all = entries(name), held = all.filter((e) => e.held).length;
    const first = all.find((e) => !e.held);
    const settled = Date.now() - statSync(file).mtimeMs >= SETTLE_MS || Date.now() - at >= SETTLE_MS;
    if (held < Math.max(1, slots) && first?.pid === pid && settled) {
      writeAtomic(file, JSON.stringify({ pid, label, at, held: true }));
      return;
    }
    if (!told && (held >= slots || first?.pid !== pid)) { onWait?.(all.findIndex((e) => e.pid === pid) - held + 1); told = true; }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

export function release(name: string, pid: number): boolean {
  const e = entries(name).find((x) => x.pid === pid);
  if (e) rmSync(e.file, { force: true });
  return Boolean(e);
}
