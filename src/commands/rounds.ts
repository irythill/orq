// orq rounds <ID> [-w <workspace>] [--json]   per-issue round metrics from .orquestra/<ID>/ (src/rounds.ts), no LLM
import { getPath, loadConfig } from "../config.js";
import { m } from "../i18n.js";
import { expand } from "../paths.js";
import { collectRounds, mark } from "../rounds.js";

export const USAGE = "orq rounds <ID> [-w <workspace>] [--json]   rounds vs max_rounds, time per round, repeated findings, alert level";

const dur = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.floor(s / 60) % 60).padStart(2, "0")}m` : s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`);

export function rounds(argv: string[]): number {
  let ws: string | undefined, id: string | undefined, json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-w") ws = expand(argv[++i]);
    else if (argv[i] === "--json") json = true;
    else if (!id && !argv[i].startsWith("-")) id = argv[i];
    else { console.error(USAGE); return 2; }
  }
  if (!id) { console.error(USAGE); return 2; }
  const { cfg } = loadConfig();
  ws ??= (getPath(cfg, "_workspace") as string | null) ?? process.cwd();
  const x = collectRounds(ws, id, Number(getPath(cfg, "policy.max_rounds") ?? 2));
  if (!x) { console.error(m(`no rounds recorded for ${id} in ${ws}/.orquestra`, `nenhuma rodada registrada para ${id} em ${ws}/.orquestra`)); return 1; }
  if (json) { console.log(JSON.stringify(x, null, 2)); return 0; }
  console.log(`${id}  ${mark(x)}  ${m("alert", "alerta")}: ${x.level}${x.reasons.length ? ` (${x.reasons.join("; ")})` : ""}`);
  console.log(m(`rounds ${x.rounds} of max ${x.max}; total time ${dur(x.secs)}; ${x.findings} finding(s) across reviews`,
    `rodadas ${x.rounds} de no máx. ${x.max}; tempo total ${dur(x.secs)}; ${x.findings} achado(s) nas revisões`));
  for (const r of x.perRound) console.log(`  ${r.round === 0 ? m("impl + review", "impl + revisão") : m(`fix ${r.round} + review`, `fix ${r.round} + revisão`)}: ${dur(r.secs)}`);
  if (x.repeats.length) console.log(m("repeated findings:", "achados repetidos:"));
  for (const r of x.repeats) console.log(`  [${m("rounds", "rodadas")} ${r.rounds.join(",")}] ${r.title.slice(0, 100)}`);
  return 0;
}
