// orq run — run a command under a memory cap on any OS (src/process.ts).
//   orq run [--agent <name> | --test] [--mem 4G|off] [--swap 1G] [--mode auto|kernel|watchdog|off] [--unit name] -- <cmd>...
// Cap: --mem, else agents.<name>.mem_max (with --agent), else machine.test_mem_max (--test) or machine.agent_mem_max.
// Mode: --mode, else machine.mem_enforce. Exit code = the command's; 137 = killed for memory.
import { loadConfig, type Obj } from "../config.js";
import { type MemMode, parseSize, resolveMode, runCapped } from "../process.js";

export const USAGE = "orq run [--agent <a> | --test] [--mem 4G|off] [--mode auto|kernel|watchdog|off] -- <cmd>...   memory-capped run";

export async function run(argv: string[]): Promise<number> {
  const dd = argv.indexOf("--");
  if (dd < 0 || dd === argv.length - 1) { console.error(USAGE); return 2; }
  const opts = argv.slice(0, dd), cmd = argv.slice(dd + 1);
  let agent: string | undefined, test = false, mem: string | undefined, swap: string | undefined;
  let mode: MemMode | undefined, unit: string | undefined, explain = false;
  for (let i = 0; i < opts.length; i++) {
    const a = opts[i];
    if (a === "--agent") agent = opts[++i]; else if (a === "--test") test = true;
    else if (a === "--mem") mem = opts[++i]; else if (a === "--swap") swap = opts[++i];
    else if (a === "--mode") mode = opts[++i] as MemMode; else if (a === "--unit") unit = opts[++i];
    else if (a === "--explain") explain = true;
    else { console.error(USAGE); return 2; }
  }
  const { cfg } = loadConfig();
  const mach = (cfg.machine ?? {}) as Obj;
  const agentCap = agent ? (((cfg.agents ?? {}) as Record<string, Obj>)[agent]?.mem_max as string | undefined) : undefined;
  const cap = parseSize(mem ?? agentCap ?? String((test ? mach.test_mem_max : mach.agent_mem_max) ?? "off"));
  const m = mode ?? (mach.mem_enforce as MemMode | undefined) ?? "auto";
  if (explain) console.error(`orq run: cap=${cap ?? "off"} mode=${resolveMode(m, cap)}`);
  return runCapped(cmd[0], cmd.slice(1), { cap, mode: m, unit, swap: parseSize(swap ?? (mach.agent_swap_max as string | undefined)) });
}
