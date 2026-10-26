// orq lock — the portable test queue (src/lock.ts). Scripts hold a slot for their own pid:
//   orq lock wait verify --pid $$ --label "verify ABC-1 api"   blocks until it holds a slot (slots: machine.test_slots)
//   orq lock release verify --pid $$                         (also freed by itself when that process dies)
//   orq lock run verify [--label t] -- <cmd> [args]          runs a command holding a slot
//   orq lock status [verify] [--json]                        holders and waiters, in order
import { spawnSync } from "node:child_process";
import { getPath, loadConfig } from "../config.js";
import { m } from "../i18n.js";
import { acquire, release, status } from "../lock.js";

export const USAGE = `orq lock wait|release <name> [--pid P] [--label text]   test queue (slots = machine.test_slots)
orq lock run <name> [--label text] -- <cmd>...  ·  orq lock status [<name>] [--json]`;

const slots = () => Number(getPath(loadConfig().cfg, "machine.test_slots") ?? 1);
const since = (at: number) => `${Math.round((Date.now() - at) / 1000)}s`;

export async function lock(argv: string[]): Promise<number> {
  const [sub, name = "verify", ...rest] = argv;
  let pid = process.ppid, label = "", json = false;
  const dd = rest.indexOf("--");
  const opts = dd >= 0 ? rest.slice(0, dd) : rest, cmd = dd >= 0 ? rest.slice(dd + 1) : [];
  for (let i = 0; i < opts.length; i++) {
    if (opts[i] === "--pid") pid = Number(opts[++i]);
    else if (opts[i] === "--label") label = opts[++i];
    else if (opts[i] === "--json") json = true;
    else { console.error(USAGE); return 2; }
  }
  const waitMsg = () => console.log(m("another verification is running; waiting for my turn...",
    "outra verificação em andamento; aguardando a vez..."));
  switch (sub) {
    case "wait": await acquire(name, pid, label, slots(), waitMsg); return 0;
    case "release": release(name, pid); return 0;
    case "run": {
      if (!cmd.length) { console.error(USAGE); return 2; }
      await acquire(name, process.pid, label || cmd.join(" "), slots(), waitMsg);
      try { return spawnSync(cmd[0], cmd.slice(1), { stdio: "inherit", shell: process.platform === "win32" }).status ?? 1; }
      finally { release(name, process.pid); }
    }
    case "status": {
      const s = status(name);
      if (json) { console.log(JSON.stringify(s)); return 0; }
      for (const e of s.holders) console.log(`▶ ${e.pid} ${e.label} (${since(e.at)})`);
      s.waiters.forEach((e, i) => console.log(`${i + 1}. ${e.pid} ${e.label} (${m("waiting", "aguardando")} ${since(e.at)})`));
      if (!s.holders.length && !s.waiters.length) console.log(m("queue empty", "fila vazia"));
      return 0;
    }
    default: console.error(USAGE); return 2;
  }
}
