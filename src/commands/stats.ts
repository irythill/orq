// orq stats [-w <workspace>] [--days N] [--json]   agent scoreboard from the .orquestra/ history (src/stats.ts)
import { getPath, loadConfig } from "../config.js";
import { m } from "../i18n.js";
import { expand } from "../paths.js";
import { collectRuns, rows } from "../stats.js";

export const USAGE = "orq stats [-w <workspace>] [--days N] [--json]   scoreboard: delivery, time and tokens per agent";

const k = (n: number | null) => (n === null ? "-" : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
const ORDER = ["impl", "fix", "review", "other"];

export function stats(argv: string[]): number {
  let ws: string | undefined, days = 30, json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-w") ws = expand(argv[++i]);
    else if (argv[i] === "--days") days = Number(argv[++i]);
    else if (argv[i] === "--json") json = true;
    else { console.error(USAGE); return 2; }
  }
  // Default workspace: the config's (nearest .orq/ upwards), else the current folder.
  ws ??= (getPath(loadConfig().cfg, "_workspace") as string | null) ?? process.cwd();
  const runs = collectRuns(ws, days), rs = rows(runs);
  if (json) { console.log(JSON.stringify(rs, null, 2)); return 0; }
  console.log(m(`Scoreboard for the last ${days} days in ${ws} (${runs.length} runs; medians per run)`,
    `Placar dos últimos ${days} dias em ${ws} (${runs.length} execuções; medianas por execução)`) + "\n");
  const hdr = `${m("role", "papel").padEnd(7)} ${m("agent", "agente").padEnd(12)} ${m("model", "modelo").padEnd(22)} ${"n".padStart(4)} `
    + `${"ok%".padStart(5)} ${m("approved%", "aprov%").padStart(12)} ${"min".padStart(6)} ${m("new tok", "tok novos").padStart(10)} `
    + `${m("total tok", "tok total").padStart(10)}`;
  console.log(hdr + "\n" + "-".repeat(hdr.length));
  for (const x of [...rs].sort((a, b) => ORDER.indexOf(a.role) - ORDER.indexOf(b.role) || b.n - a.n)) {
    const ap = x.approved !== null ? `${x.approved}% (${x.n_appr})` : "-";
    console.log(`${x.role.padEnd(7)} ${x.agent.padEnd(12)} ${x.model.slice(0, 22).padEnd(22)} ${String(x.n).padStart(4)} `
      + `${String(x.ok).padStart(5)} ${ap.padStart(12)} ${String(x.min).padStart(6)} ${k(x.new).padStart(10)} ${k(x.tot).padStart(10)}`);
  }
  return 0;
}
