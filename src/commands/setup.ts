// orq setup — guided first configuration: detect agent CLIs, ask what the user knows, suggest roles (src/suggest.ts).
//   orq setup                               interactive, in any terminal
//   orq setup --detect                      installed agent CLIs, as JSON (for a conductor driving the setup)
//   orq setup --answers <file|-> [--write]  proposal from answers JSON (see Answers in src/suggest.ts); --write saves it
//   --preset economy|quality|single-agent
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { totalmem } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { writeAtomic } from "../fsutil.js";
import { m } from "../i18n.js";
import { userConfigFile } from "../paths.js";
import { type Answers, type Plan, suggestRoles, toToml } from "../suggest.js";

export const USAGE = `orq setup [--preset economy|quality|single-agent]   guided first configuration (roles, weights, memory)
orq setup --detect | --answers <file|-> [--write]`;

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
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q: string, def = "") => ((await rl.question(def ? `${q} [${def}] ` : `${q} `)).trim() || def);
  const yes = async (q: string, def = "n") => /^[ysYS]/.test(await ask(`${q} (y/n)`, def));
  try {
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
    return 0;
  } finally { rl.close(); }
}

export async function setup(argv: string[]): Promise<number> {
  let preset: Answers["preset"], answers: string | undefined, doWrite = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--detect") { console.log(JSON.stringify(detect())); return 0; }
    if (a === "--preset") preset = argv[++i] as Answers["preset"];
    else if (a === "--answers") answers = argv[++i];
    else if (a === "--write") doWrite = true;
    else { console.error(USAGE); return 2; }
  }
  if (!answers) return interactive(preset);
  const a = JSON.parse(readFileSync(answers === "-" ? 0 : answers, "utf8")) as Answers;
  const toml = show({ ...a, preset: preset ?? a.preset });
  if (doWrite) console.error(m(`written: ${write(toml)}`, `gravado: ${write(toml)}`));
  return 0;
}
