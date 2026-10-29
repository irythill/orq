// ProcessHost — run a command under a memory cap, on any OS.
//   kernel    Linux with a systemd user session: `systemd-run --user --scope -p MemoryMax=` (the kernel kills only
//             that command, as orq always did)
//   watchdog  everywhere else (macOS, Windows, Linux without systemd): orq samples the command's process tree every
//             few seconds and kills the whole tree above the cap
//   off       no cap
// mode "auto" = kernel when available, else watchdog. (Windows Job Objects need a native addon: later, if the
// watchdog proves too coarse.)
import { type ChildProcess, execFile, spawn, spawnSync, type StdioOptions } from "node:child_process";
import { m } from "./i18n.js";

export type MemMode = "auto" | "kernel" | "watchdog" | "off";

/** "4G", "512M", "1.5G", "off" → bytes (undefined = no cap). */
export function parseSize(s: string | number | undefined): number | undefined {
  if (s === undefined || s === "" || s === "off" || s === false as unknown) return undefined;
  if (typeof s === "number") return s;
  const r = /^(\d+(?:\.\d+)?)\s*([KMGT]?)i?B?$/i.exec(s.trim());
  if (!r) throw new Error(m(`invalid size: ${s} (e.g. 4G, 512M, off)`, `tamanho inválido: ${s} (ex.: 4G, 512M, off)`));
  return Math.round(Number(r[1]) * 1024 ** "BKMGT".indexOf((r[2] || "B").toUpperCase()));
}

let kernelOk: boolean | undefined;
export function hasKernelCap(): boolean {
  if (process.platform !== "linux") return false;
  kernelOk ??= spawnSync("systemd-run", ["--user", "--scope", "-q", "--", "true"], { stdio: "ignore", timeout: 10_000 }).status === 0;
  return kernelOk;
}

// systemd-run expands ${...} in its arguments (the prompt!) unless told not to; the flag exists in systemd >= 254.
let noExpand: string[] | undefined;
const noExp = () => noExpand ??= /--expand-environment/.test(spawnSync("systemd-run", ["--help"], { encoding: "utf8" }).stdout ?? "")
  ? ["--expand-environment=no"] : [];

export function resolveMode(mode: MemMode, cap: number | undefined): "kernel" | "watchdog" | "off" {
  if (cap === undefined || mode === "off") return "off";
  if (mode === "kernel" || (mode === "auto" && hasKernelCap())) return "kernel";
  return "watchdog";
}

const LIST: [string, string[]] = process.platform === "win32"
  ? ["powershell", ["-NoProfile", "-NonInteractive", "-Command",
    "Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,WorkingSetSize | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId) $($_.WorkingSetSize)\" }"]]
  : ["ps", ["-A", "-o", "pid=,ppid=,rss="]];

/** pid → [ppid, bytes] for every process (ps on Linux/macOS, CIM on Windows). */
export function processTable(): Map<number, [number, number]> {
  return parseTable(spawnSync(LIST[0], LIST[1], { encoding: "utf8", timeout: 15_000 }).stdout ?? "");
}

/** Same, without blocking: PowerShell takes seconds on Windows and the watchdog must keep running meanwhile. */
export function processTableAsync(): Promise<Map<number, [number, number]>> {
  return new Promise((res) => execFile(LIST[0], LIST[1], { encoding: "utf8", timeout: 15_000, windowsHide: true },
    (_e, out) => res(parseTable(out ?? ""))));
}

function parseTable(text: string): Map<number, [number, number]> {
  const t = new Map<number, [number, number]>();
  for (const line of text.split(/\r?\n/)) {
    const [pid, ppid, mem] = line.trim().split(/\s+/).map(Number);
    if (pid) t.set(pid, [ppid, process.platform === "win32" ? mem : mem * 1024]);
  }
  return t;
}

/** `root` and all its descendants. */
export function treePids(root: number, table = processTable()): number[] {
  const kids = new Map<number, number[]>();
  for (const [pid, [ppid]] of table) kids.set(ppid, [...(kids.get(ppid) ?? []), pid]);
  const seen = new Set<number>(), todo = [root];
  while (todo.length) {
    const p = todo.pop()!;
    if (seen.has(p)) continue;
    seen.add(p);
    todo.push(...(kids.get(p) ?? []));
  }
  return [...seen];
}

/** Total memory of `root` and all its descendants. */
export function treeMem(root: number, table = processTable()): number {
  return treePids(root, table).reduce((t, p) => t + (table.get(p)?.[1] ?? 0), 0);
}

export function killTree(pid: number, group = true): void {
  if (process.platform === "win32") spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore" });
  else if (group) try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
  else for (const p of treePids(pid)) try { process.kill(p, "SIGKILL"); } catch { /* gone */ } // no group of its own
}

export interface RunOpts {
  cap?: number; swap?: number; mode?: MemMode; unit?: string; intervalMs?: number; cwd?: string;
  stdio?: StdioOptions; env?: NodeJS.ProcessEnv; onSpawn?: (c: ChildProcess) => void;
  quote?: boolean; // Windows shell (.cmd shims): quote each argument instead of passing a command line as is
  tty?: boolean; // an interactive screen (-T): stays in the terminal's session; the watchdog kills its tree pid by pid
}

/** cmd.exe quoting for one argument (only used when Windows needs a shell). */
export const winQuote = (a: string) => /[\s"&|<>^%()]/.test(a) || a === "" ? `"${a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"` : a;

const gb = (b: number) => `${(b / 2 ** 30).toFixed(1)} GB`;

/** Run `cmd args` with stdio inherited, under the cap; resolves to the exit code (137 = killed for memory). */
export function runCapped(cmd: string, args: string[], o: RunOpts = {}): Promise<number> {
  const mode = resolveMode(o.mode ?? "auto", o.cap);
  if (mode === "kernel") {
    const sd = ["--user", "--scope", "-q", ...noExp(), ...(o.unit ? [`--unit=${o.unit}`] : []), "-p", `MemoryMax=${o.cap}`,
      ...(o.swap !== undefined ? ["-p", `MemorySwapMax=${o.swap}`] : []), "--", cmd, ...args];
    const c = spawn("systemd-run", sd, { stdio: o.stdio ?? "inherit", cwd: o.cwd, env: o.env });
    o.onSpawn?.(c);
    return wait(c);
  }
  const win = process.platform === "win32";
  // Own process group on Linux/macOS, so the whole tree can be killed at once (not for a screen: it needs the terminal).
  // Windows: a shell only for .cmd/.bat shims (npx, claude…); an .exe runs directly (paths with spaces stay intact).
  const shell = win && !/\.exe$/i.test(cmd), q = shell && o.quote;
  const child = spawn(q ? winQuote(cmd) : cmd, q ? args.map(winQuote) : args,
    { stdio: o.stdio ?? "inherit", cwd: o.cwd, env: o.env, detached: !win && !o.tty, shell, windowsHide: true });
  o.onSpawn?.(child);
  if (mode === "off" || !child.pid) return wait(child);
  const fwd = (sig: NodeJS.Signals) => () => { try { process.kill(-child.pid!, sig); } catch { child.kill(sig); } };
  const onInt = fwd("SIGINT"), onTerm = fwd("SIGTERM");
  if (!win && !o.tty) { process.on("SIGINT", onInt); process.on("SIGTERM", onTerm); }
  let killed = false, sampling = false;
  const timer = setInterval(async () => {
    if (sampling || killed) return; // a slow sample (Windows) never overlaps the next
    sampling = true;
    const used = treeMem(child.pid!, await processTableAsync());
    sampling = false;
    if (used > o.cap! && !killed) {
      killed = true;
      console.error(m(`orq: memory ${gb(used)} over the cap (${gb(o.cap!)}): killing the process tree`,
        `orq: memória ${gb(used)} acima do limite (${gb(o.cap!)}): encerrando a árvore de processos`));
      killTree(child.pid!, !o.tty);
    }
  }, o.intervalMs ?? 1000);
  return wait(child).then((code) => {
    clearInterval(timer);
    process.off("SIGINT", onInt); process.off("SIGTERM", onTerm);
    return killed ? 137 : code;
  });
}

const wait = (c: ReturnType<typeof spawn>) => new Promise<number>((res) => {
  c.on("error", (e) => { console.error(`orq: ${e.message}`); res(127); });
  c.on("exit", (code, sig) => res(code ?? (sig ? 128 + 9 : 1)));
});
