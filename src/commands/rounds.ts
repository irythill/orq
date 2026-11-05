// orq rounds <ID> [-w <workspace>] [--json]   per-issue round metrics from .orquestra/<ID>/ (src/rounds.ts), no LLM
// orq rounds <ID> --diagnose [-w <workspace>]  warn/stop only: a cheap read only "watchdog" agent (another vendor than the
//   implementer when known) diagnoses why the rounds don't converge → .orquestra/<ID>/diagnosis-<rounds>.md (advisory)
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPath, loadConfig } from "../config.js";
import { buildPrompt, evidence, latestDiagnosis, recommendation } from "../diagnose.js";
import { m } from "../i18n.js";
import { expand } from "../paths.js";
import { collectRounds, mark, type Metrics, type Reason } from "../rounds.js";
import { alive } from "../lock.js";
import { wait } from "./wait.js";

export const USAGE = `orq rounds <ID> [-w <workspace>] [--json]   rounds vs max_rounds, time per round, repeated findings, alert level
orq rounds <ID> --diagnose [-w <workspace>]   on warn/stop: an independent cheap agent diagnoses why rounds don't converge (advisory; needed for orq agent -R -F)`;

export const WATCHDOG_TIMEOUT = 900; // seconds `orq rounds --diagnose` waits for the agent
const CLI = fileURLToPath(new URL("../cli.js", import.meta.url));

const dur = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.floor(s / 60) % 60).padStart(2, "0")}m` : s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`);

const why = (r: Reason) => ({
  over_max: m(`rounds ${r.n} > max_rounds ${r.max}`, `rodadas ${r.n} > max_rounds ${r.max}`),
  at_max: m(`rounds ${r.n} = max_rounds ${r.max}`, `rodadas ${r.n} = max_rounds ${r.max}`),
  same_finding: m(`same finding in ${r.n} reviews`, `mesmo achado em ${r.n} revisões`),
  repeated: m(`${r.n} repeated finding(s)`, `${r.n} achado(s) repetido(s)`),
  slow: m(`round ${r.rounds?.join(", ")} much slower than the others`, `rodada ${r.rounds?.join(", ")} bem mais lenta que as outras`),
})[r.code];

export async function rounds(argv: string[]): Promise<number> {
  let ws: string | undefined, id: string | undefined, json = false, diagnose = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-w") { if (!argv[i + 1]) { console.error(USAGE); return 2; } ws = expand(argv[++i]); }
    else if (argv[i] === "--json") json = true;
    else if (argv[i] === "--diagnose") diagnose = true;
    else if (!id && !argv[i].startsWith("-")) id = argv[i];
    else { console.error(USAGE); return 2; }
  }
  if (!id) { console.error(USAGE); return 2; }
  ws ??= (getPath(loadConfig().cfg, "_workspace") as string | null) ?? process.cwd();
  const { cfg } = loadConfig(ws); // the workspace's own policy.max_rounds
  const x = collectRounds(ws, id, Number(getPath(cfg, "policy.max_rounds") ?? 2));
  if (!x) { console.error(m(`no rounds recorded for ${id} in ${ws}/.orquestra`, `nenhuma rodada registrada para ${id} em ${ws}/.orquestra`)); return 1; }
  if (diagnose) return diagnoseIssue(ws, id, x);
  if (json) { console.log(JSON.stringify(x, null, 2)); return 0; }
  console.log(`${id}  ${mark(x)}  ${m("alert", "alerta")}: ${x.level}${x.reasons.length ? ` (${x.reasons.map(why).join("; ")})` : ""}`);
  console.log(m(`rounds ${x.rounds} of max ${x.max}; total time ${dur(x.secs)}; ${x.findings} finding(s) across reviews`,
    `rodadas ${x.rounds} de no máx. ${x.max}; tempo total ${dur(x.secs)}; ${x.findings} achado(s) nas revisões`));
  for (const r of x.perRound) console.log(`  ${r.round === 0 ? m("impl + review", "impl + revisão") : m(`fix ${r.round} + review`, `fix ${r.round} + revisão`)}: ${dur(r.secs)}`);
  if (x.repeats.length) console.log(m("repeated findings:", "achados repetidos:"));
  for (const r of x.repeats) console.log(`  [${m("rounds", "rodadas")} ${r.rounds.join(",")}] ${r.title.slice(0, 100)}`);
  const d = latestDiagnosis(join(ws, ".orquestra", id));
  if (d) console.log(`${m("diagnosis", "diagnóstico")} ${d.n}: ${d.line ?? m("(no RECOMMENDATION line)", "(sem linha RECOMMENDATION)")}`);
  return 0;
}

const orq = (...a: string[]) => spawnSync(process.execPath, [CLI, ...a], { encoding: "utf8" });

/** --diagnose: pick a watchdog, run it read only on the evidence, keep its answer as diagnosis-<rounds>.md. */
async function diagnoseIssue(ws: string, id: string, x: Metrics): Promise<number> {
  if (x.level === "ok") { console.log(m(`${id}: level is ok, no diagnosis needed`, `${id}: nível ok, não precisa de diagnóstico`)); return 0; }
  const dir = join(ws, ".orquestra", id), prefix = join(dir, `watchdog-${x.rounds}-${Date.now()}`), out = join(dir, `diagnosis-${x.rounds}.md`);
  // The implementer, when known (impl-<repo>.pick saved by the playbook): the watchdog must be another vendor.
  const implPick = readdirSync(dir).filter((n) => /^impl-.+\.pick$/.test(n)).map((n) => /(?:^|\s)-a (\S+)/.exec(readFileSync(join(dir, n), "utf8"))?.[1]).find(Boolean);
  // A watchdog still running for this issue (a previous --diagnose that timed out or was interrupted): don't start another.
  for (const n of readdirSync(dir).filter((f) => /^watchdog-.+\.pid$/.test(f))) {
    const pid = Number(readFileSync(join(dir, n), "utf8"));
    if (pid && alive(pid)) { console.error(m(`a watchdog for ${id} is still running (${n}, pid ${pid}); wait for it or stop it first`, `um watchdog de ${id} ainda está rodando (${n}, pid ${pid}); espere ou encerre antes`)); return 1; }
  }
  const ev = evidence(dir);
  writeFileSync(`${prefix}.md`, buildPrompt(x, ev.fixes, ev.reviews));
  // A failed watchdog (e.g. a model catalog timeout) gets one retry with the next candidate, never the same agent.
  const excluded: string[] = [];
  let first: { rc: number; agent?: string } | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const p = orq("pick", "watchdog", "--level", "simple", "-w", ws, ...(implPick ? ["--impl-agent", implPick] : []), ...excluded.flatMap((e) => ["--exclude-agent", e]));
    if (p.status !== 0) {
      if (first) { console.error(m("the watchdog agent failed; no diagnosis written", "o agente watchdog falhou; diagnóstico não gravado")); return first.rc; }
      console.error(p.stderr.trim() || `orq pick watchdog: exit ${p.status}`); return p.status ?? 1;
    }
    const picked = p.stdout.trim().split(/\s+/), agent = /(?:^|\s)-a (\S+)/.exec(p.stdout)?.[1];
    // The agent runs in a scratch folder (everything it needs is in the prompt): it can't touch the issue files, even write sandboxed.
    const scratch = mkdtempSync(join(tmpdir(), "orq-watchdog-"));
    const run = `${prefix}-${attempt}`;
    try {
      writeFileSync(`${run}.md`, readFileSync(`${prefix}.md`));
      const a = orq("agent", ...picked, "-r", "-t", `${id} watchdog`, "-d", scratch, "-g", "watchdog", "-o", run, "--", `${run}.md`);
      process.stderr.write(a.stderr); process.stdout.write(a.stdout);
      const rc = a.status !== 0 ? a.status ?? 1 : await finish(await wait(["--timeout", String(WATCHDOG_TIMEOUT), run]), run, out, agent, attempt === 1 || !agent);
      if (rc === 0 || rc === 124 || !agent) return rc;
      if (attempt === 0) console.error(m(`watchdog ${agent} failed; retrying with another agent`, `watchdog ${agent} falhou; tentando com outro agente`));
      first = { rc }; excluded.push(agent);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  }
  return first?.rc ?? 1;
}

async function finish(rc: number, prefix: string, out: string, agent?: string, final = true): Promise<number> {
  if (rc === 124) { console.error(m(`diagnosis not written: the watchdog agent did not finish in ${WATCHDOG_TIMEOUT}s`, `diagnóstico não gravado: o agente watchdog não terminou em ${WATCHDOG_TIMEOUT}s`)); return 124; }
  if (rc !== 0 || !existsSync(`${prefix}.out.md`)) { if (final) console.error(m("the watchdog agent failed; no diagnosis written", "o agente watchdog falhou; diagnóstico não gravado")); return 1; }
  copyFileSync(`${prefix}.out.md`, out);
  console.log(m(`diagnosis saved to ${out}${agent ? ` (by ${agent})` : ""}`, `diagnóstico gravado em ${out}${agent ? ` (por ${agent})` : ""}`));
  console.log(recommendation(readFileSync(out, "utf8")) ?? m("(no RECOMMENDATION line in the answer)", "(sem linha RECOMMENDATION na resposta)"));
  return 0;
}
