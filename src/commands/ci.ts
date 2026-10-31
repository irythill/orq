// orq ci [-w <workspace>]... [--json]   CI/CD signal per claimed issue with a PR: queued | running | passed |
// failed | none. This is the one caller of src/ci.ts's collectCi() that runs it in the foreground (network and
// all) instead of reading its cache — the user asked for CI status right now, so it collects right now; `orq
// board`'s CI column is the one that stays off the network and only reads the cache this same collectCi() fills.
import { resolve } from "node:path";
import { collectCi, type CiEntry } from "../ci.js";
import { getPath, loadConfig } from "../config.js";
import { m } from "../i18n.js";
import { expand } from "../paths.js";
import { notify } from "../testrun.js";

export const USAGE = "orq ci [-w <workspace>]... [--json]   CI/CD status per claimed issue (queued|running|passed|failed|none)";

const label = (s: CiEntry["state"]) => ({ queued: m("queued", "na fila"), running: m("running", "rodando"),
  passed: m("passed", "passou"), failed: m("failed", "falhou"), none: m("none", "nenhum") })[s];

export async function ci(argv: string[]): Promise<number> {
  const wss: string[] = [];
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-w") wss.push(resolve(expand(argv[++i] ?? ".")));
    else if (a === "--json") json = true;
    else if (a === "-h" || a === "--help") { console.log(USAGE); return 0; }
    else { console.error(USAGE); return 2; }
  }
  if (!wss.length) wss.push((getPath(loadConfig().cfg, "_workspace") as string | null) ?? process.cwd());
  // --json's stdout must be only the JSON: a herdr owner's notice goes to a detached herdr-notify (stdio ignore)
  // instead of the default foreground one (which inherits stdout), and a non-herdr owner's notice goes to
  // stderr instead of stdout — either one would otherwise interleave a stray line in front of the JSON.
  const hooks = json ? { owner: (pane: string, line: string) => notify(pane, line, true), notice: (line: string) => console.error(line) } : {};
  const entries = wss.flatMap((ws) => collectCi(ws, hooks));
  if (json) { console.log(JSON.stringify(entries)); return 0; }
  if (!entries.length) { console.log(m("no claimed issue has a PR", "nenhuma issue reivindicada tem PR")); return 0; }
  for (const e of entries) console.log(`${e.issue} ${e.repo} ${e.branch} ${e.pr ? `#${e.pr}` : "-"} ${label(e.state)}`);
  return 0;
}
