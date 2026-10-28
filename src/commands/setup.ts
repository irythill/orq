// orq setup — guided first configuration: detect agent CLIs, ask what the user knows, suggest roles (src/suggest.ts),
// and do what a fresh `npm i -g @irythill/orq` still needs (src/install.ts): skills for Claude Code, a conductor workspace.
//   orq setup                               interactive, in any terminal
//   orq setup --detect                      installed agent CLIs, as JSON (for a conductor driving the setup)
//   orq setup --answers <file|-> [--write]  proposal from answers JSON (see Answers in src/suggest.ts); --write saves it
//   orq setup --install                     no questions: what orq found, and the skills linked for Claude Code
//   orq setup --workspace <dir> [--conductor <agent>]   .orquestra, CLAUDE.md map, /issue playbook in its format
//   --preset economy|quality|single-agent
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { homedir, totalmem } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { writeAtomic } from "../fsutil.js";
import { banner, infoLines } from "../banner.js";
import { getPath, loadConfig } from "../config.js";
import { m } from "../i18n.js";
import { environment, installSkills, prepareWorkspace } from "../install.js";
import { expand, userConfigFile } from "../paths.js";
import { type Answers, type Plan, suggestRoles, toToml } from "../suggest.js";

export const USAGE = `orq setup [--preset economy|quality|single-agent]   guided first configuration (roles, weights, memory)
orq setup --detect | --answers <file|-> [--write] | --install | --workspace <dir> [--conductor <agent>]`;

/** Agent name → its CLI and a cheap headless smoke test. */
const CLIS: Record<string, { bin: string; test: string }> = {
  claude: { bin: "claude", test: 'claude -p "reply ok"' },
  codex: { bin: "codex", test: 'codex exec --skip-git-repo-check "reply ok"' },
  opencode: { bin: "opencode", test: 'opencode run "reply ok"' },
  antigravity: { bin: "agy", test: 'agy -p "reply ok"' },
  copilot: { bin: "copilot", test: 'copilot -p "reply ok" -s' },
};

/** Is `bin` on PATH? (PATHEXT on Windows: claude.cmd, codex.exe…) */
export function onPath(bin: string): boolean {
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  return (process.env.PATH ?? "").split(delimiter).some((d) => d && exts.some((e) => existsSync(join(d, bin + e))));
}

export const detect = () => Object.keys(CLIS).filter((n) => onPath(CLIS[n].bin));

function write(toml: string): string {
  const f = userConfigFile();
  if (existsSync(f)) {
    const bak = `${f}.bak-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
    copyFileSync(f, bak);
    console.log(m(`previous config saved as ${bak}`, `config anterior salvo em ${bak}`));
  }
  writeAtomic(f, toml);
  return f;
}

function show(a: Answers): string {
  const p = suggestRoles(a), toml = toToml(p);
  console.log(toml);
  return toml;
}

async function interactive(preset?: Answers["preset"]): Promise<number> {
  process.stdout.write(banner([...infoLines({}).slice(0, 3), m("setup — let's build your orchestra", "setup — vamos montar sua orquestra")]));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Input closed mid-question (Ctrl+D, empty stdin): cancel cleanly instead of hanging.
  const closed = new Promise<never>((_, rej) => rl.once("close", () => rej(new Error("closed"))));
  closed.catch(() => {});
  const ask = async (q: string, def = "") =>
    ((await Promise.race([rl.question(def ? `${q} [${def}] ` : `${q} `), closed])).trim() || def);
  const yes = async (q: string, def = "n") => /^[ysYS]/.test(await ask(`${q} (y/n)`, def));
  try {
    env();
    const found = detect();
    if (!found.length) {
      console.log(m("No agent CLI found (claude, codex, opencode, agy, copilot). Install one and run orq setup again.",
        "Nenhuma CLI de agente encontrada (claude, codex, opencode, agy, copilot). Instale uma e rode orq setup de novo."));
      return 1;
    }
    console.log(m(`Found: ${found.join(", ")}`, `Encontrados: ${found.join(", ")}`));
    const agents: Answers["agents"] = {};
    for (const n of found) {
      if (await yes(m(`Smoke-test ${n}? (costs a few tokens)`, `Testar ${n}? (gasta alguns tokens)`))) {
        const r = spawnSync(CLIS[n].test, { shell: true, encoding: "utf8", timeout: 120_000 });
        const ok = r.status === 0;
        console.log(ok ? "  ok" : m("  failed — probably not logged in", "  falhou — provavelmente sem login"));
        if (!ok && !(await yes(m(`Keep ${n} anyway?`, `Manter ${n} mesmo assim?`)))) continue;
      } else if (!(await yes(m(`Use ${n}?`, `Usar ${n}?`), "y"))) continue;
      const plan = await ask(m(`${n} plan: free | small (Pro, Copilot Pro) | large (Max, high tiers) | payg`,
        `Plano do ${n}: free | small (Pro, Copilot Pro) | large (Max, planos altos) | payg (pague-por-uso)`), "large");
      agents[n] = { plan: (["free", "small", "large", "payg"].includes(plan) ? plan : "large") as Plan };
    }
    const names = Object.keys(agents);
    if (!names.length) return 1;
    const trust = await ask(m(`Which do you trust most to write code? (${names.join(", ")}, or empty)`,
      `Em qual você mais confia para escrever código? (${names.join(", ")}, ou vazio)`));
    if (agents[trust]) agents[trust].trust = true;
    const conductor = await ask(m(`Where will you talk to orq (the conductor)? (${names.join(", ")}, other)`,
      `Onde você vai conversar com o orq (o conductor)? (${names.join(", ")}, other)`), names.includes("claude") ? "claude" : names[0]);
    const parallel = Number(await ask(m("How many tasks do you usually run at once?", "Quantas tarefas você costuma rodar ao mesmo tempo?"), "2")) || 2;
    const ramGB = Number(await ask(m("RAM agents may use, in GB", "RAM que os agentes podem usar, em GB"),
      String(Math.round(totalmem() / 2 ** 30)))) || 8;
    const toml = show({ agents, conductor, parallel, ramGB, preset });
    if (await yes(m(`Write this to ${userConfigFile()}?`, `Gravar em ${userConfigFile()}?`)))
      console.log(m(`written: ${write(toml)}`, `gravado: ${write(toml)}`));
    if (names.includes("claude") || existsSync(join(homedir(), ".claude"))) skills();
    const ws = await ask(m("Folder that groups your repos, for the conductor (empty = later: orq setup --workspace <dir>)",
      "Pasta que agrupa seus repos, para o conductor (vazio = depois: orq setup --workspace <pasta>)"));
    if (ws) workspace(ws, conductor);
    next();
    return 0;
  } catch (e) {
    if ((e as Error).message !== "closed") throw e;
    console.log("\n" + m("setup cancelled — nothing was written", "setup cancelado — nada foi gravado"));
    return 1;
  } finally { rl.close(); }
}

function env(): void {
  console.log(m("Environment", "Ambiente"));
  let cfg = {};
  try { cfg = loadConfig().cfg; } catch { /* a broken config is reported by orq config */ }
  for (const l of environment(cfg)) console.log(l);
}

function skills(): void {
  console.log(m("Skills for Claude Code (/issue, /orq-setup, /orq-status)", "Skills do Claude Code (/issue, /orq-setup, /orq-status)"));
  for (const l of installSkills()) console.log(l);
}

/** claude → .claude/skills/issue/SKILL.md; any other conductor → AGENTS.md. */
function workspace(dir: string, conductor?: string): void {
  let c = conductor;
  if (!c) { try { c = getPath(loadConfig().cfg, "roles.conductor.agent") as string | undefined; } catch { /* none */ } }
  c ??= onPath("claude") ? "claude" : "agents";
  const d = expand(dir); // typed at the prompt: ~ is not expanded by any shell
  console.log(`Workspace ${d}`);
  for (const l of prepareWorkspace(d, c === "claude" ? "claude" : "agents")) console.log(l);
}

const next = () => console.log(m(`Next: fill in the workspace CLAUDE.md, open your conductor in that folder and say "/issue <ID>".
Board: orq board · quota: orq quota · completion: orq completion <shell>`,
`Próximo: preencha o CLAUDE.md do workspace, abra o seu conductor nessa pasta e diga "/issue <ID>".
Painel: orq board · cota: orq quota · autocompletar: orq completion <shell>`));

export async function setup(argv: string[]): Promise<number> {
  let preset: Answers["preset"], answers: string | undefined, doWrite = false, ws: string | undefined, conductor: string | undefined;
  let install = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--detect") { console.log(JSON.stringify(detect())); return 0; }
    if (a === "--preset") preset = argv[++i] as Answers["preset"];
    else if (a === "--answers") answers = argv[++i];
    else if (a === "--write") doWrite = true;
    else if (a === "--install") install = true;
    else if (a === "--workspace" && argv[i + 1]) ws = argv[++i];
    else if (a === "--conductor" && argv[i + 1]) conductor = argv[++i];
    else { console.error(USAGE); return 2; }
  }
  if (install || ws) {
    if (install) { env(); skills(); }
    if (ws) workspace(ws, conductor);
    return 0;
  }
  if (!answers) return interactive(preset);
  const a = JSON.parse(readFileSync(answers === "-" ? 0 : answers, "utf8")) as Answers;
  const toml = show({ ...a, preset: preset ?? a.preset });
  if (doWrite) console.error(m(`written: ${write(toml)}`, `gravado: ${write(toml)}`));
  return 0;
}
