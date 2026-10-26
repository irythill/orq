// orq pick — agent, model, effort and account for a role, from [roles] (fixed or auto), the history, quota and blocks.
// Prints the runner arguments (e.g. `-a codex -m gpt-6-sol -e low -c work`); each pick is recorded in
// <state dir>/picks.jsonl (that feeds rotation). Exit 3 = no candidate: ask the user.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type Obj } from "../config.js";
import { m } from "../i18n.js";
import { asArgs, parseQuota, pick as choose } from "../pick.js";
import { expand, stateDir } from "../paths.js";
import { collect, type Source } from "../quota.js";
import { PICK_ROLES, type PickRole, vendorOf } from "../roles.js";
import { collectRuns, rows } from "../stats.js";
import { load as loadBlocks } from "./block.js";

export const USAGE = `orq pick <impl|fix|worker|review|opinion> [--level simple|medium|heavy] [--impl-vendor <v>|--impl-agent <a>]
         [--exclude-agent <a>]... [-w <workspace>] [--explain] [--no-record]`;

// The board refreshes this file; fresher than 10 min → no new quota requests.
const QCACHE = join(process.env.XDG_RUNTIME_DIR ?? tmpdir(), "herdr-board.quota");

async function quotaText(cfg: Obj): Promise<string> {
  if (existsSync(QCACHE) && Date.now() - statSync(QCACHE).mtimeMs < 600_000) return readFileSync(QCACHE, "utf8");
  return (await collect((cfg.quota ?? {}) as Record<string, Source>)).join("\n");
}

export async function pick(argv: string[]): Promise<number> {
  const role = argv[0] as PickRole;
  if (!PICK_ROLES.includes(role)) { console.error(USAGE); return 2; }
  let level = "medium", implVendor: string | undefined, implAgent: string | undefined, ws: string | undefined;
  let explain = false, record = true;
  const exclude = new Set<string>();
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--level") level = argv[++i];
    else if (a === "--impl-vendor") implVendor = argv[++i];
    else if (a === "--impl-agent") implAgent = argv[++i];
    else if (a === "--exclude-agent") exclude.add(argv[++i]);
    else if (a === "-w") ws = expand(argv[++i]);
    else if (a === "--explain") explain = true;
    else if (a === "--no-record") record = false;
    else { console.error(USAGE); return 2; }
  }
  const { cfg } = loadConfig(ws);
  const agents = (cfg.agents ?? {}) as Record<string, Obj>;
  if (implAgent && !implVendor) implVendor = vendorOf(implAgent, agents[implAgent]);
  const w = ((cfg.policy ?? {}) as Obj);
  const stats = rows(collectRuns((ws ?? cfg._workspace ?? process.cwd()) as string, Number(w.history_days ?? 30)));
  const picksF = join(stateDir(), "picks.jsonl");
  const window = Number((((w.weights ?? {}) as Obj).window) ?? 6);
  const recent = (existsSync(picksF) ? readFileSync(picksF, "utf8").split("\n").filter(Boolean).slice(-200) : [])
    .map((l) => { try { return JSON.parse(l); } catch { return {}; } })
    .filter((p) => p.role === role).slice(-window);
  const res = choose({ cfg, role, level, implVendor, exclude, stats, quota: parseQuota(await quotaText(cfg)),
    blocks: new Set(Object.keys(loadBlocks())), recent });
  if (!res.best) {
    console.error(`orq pick: ${m("no candidate for ", "nenhum candidato para ")}${role}`
      + (res.notes.length ? `; ${res.notes.join("; ")}` : ""));
    return 3;
  }
  if (explain) {
    for (const c of res.cands)
      console.error(`${c === res.best ? "→" : " "} ${res.mode === "fixed" ? "  fixed" : (c.score >= 0 ? "+" : "") + c.score.toFixed(3)}  `
        + `${c.agent.padEnd(12)} ${c.model.padEnd(24)} ${c.why}`);
    for (const n of res.notes) console.error(`  ${m("out", "fora")}: ${n}`);
  }
  if (record) {
    mkdirSync(stateDir(), { recursive: true });
    appendFileSync(picksF, JSON.stringify({ t: Math.floor(Date.now() / 1000), role, level, agent: res.best.agent,
      model: res.best.model }) + "\n");
  }
  console.log(asArgs(res.best));
  return 0;
}
