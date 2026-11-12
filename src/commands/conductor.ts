// orq conductor — opens the configured agent in the current terminal, with the workspace's conductor
// instructions, the chosen account and model (port of setup/herdr-conductor, for any terminal and OS).
//   orq conductor [agent] [account|-] [model] [-r <session>]
// Workspace: the current folder if it has .orquestra-conductor.md, else $CONDUCTOR_WS. $CONDUCTOR_FILE overrides the
// instructions file. The session is named conductor-<workspace folder>:<herdr label or ORQ_CONDUCTOR_ID> (see sessionName).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { claudeAccounts } from "../accounts.js";
import { ALIASES, expandTemplate, expandString, onPath } from "../agents.js";
import { getPath, loadConfig, type Obj } from "../config.js";
import { m } from "../i18n.js";
import { runCapped } from "../process.js";
import { claim, herdrName, sessionName } from "./claim.js";
import { instructions } from "./instructions.js";

export const USAGE = `orq conductor [agent] [account|-] [model] [-r <session>]   open the configured conductor here
  defaults: roles.conductor.agent/account/model; without config: claude
  legacy: orq conductor <Claude account|-> [model]; -r resumes that conversation
  --agent <name> disambiguates an agent from a Claude account with the same name
  templates: agents.<agent>.conductor.run/resume/models/accounts/env`;

export const MODELS: Record<string, string> = {
  sonnet: "claude-sonnet-5",
  opus: "claude-opus-5-5",
  haiku: "claude-haiku-4-5-20251001",
};

export const modelId = (alias: string): string => MODELS[alias] ?? alias;

export interface Args { agent?: string; account: string; model: string; resume: string; help: boolean; error?: string }

export interface ConductorDef {
  run: string;
  resume?: string;
  models?: Record<string, string>;
  accounts?: Record<string, Record<string, string>>;
  env?: Record<string, string>;
}

/** Interactive launch templates retain the conductor's MCPs and normal permission prompts. */
export const CONDUCTORS: Record<string, ConductorDef> = {
  claude: {
    run: "claude -n {name} [--model {model}] --append-system-prompt-file {instructions}",
    resume: "claude --resume {session} -n {name} [--model {model}] --append-system-prompt-file {instructions}",
    models: MODELS,
  },
  codex: { run: "codex [-m {model}] -C {dir} {prompt_text}",
    resume: "codex resume {session} [-m {model}] -C {dir} {prompt_text}" },
  opencode: { run: "opencode [-m {model}] --prompt {prompt_text} {dir}",
    resume: "opencode -s {session} [-m {model}] --prompt {prompt_text} {dir}" },
  copilot: { run: "copilot -C {dir} [--model {model}] -i {prompt_text}",
    resume: "copilot -C {dir} --resume={session} [--model {model}] -i {prompt_text}" },
  antigravity: { run: "agy [--model {model}] -i {prompt_text}",
    resume: "agy --conversation {session} [--model {model}] -i {prompt_text}" },
};

/** Optional agent, then [account|-] [model] [-r|--resume <id>]; old Claude positionals still parse. */
export function parseArgs(argv: string[], names = Object.keys(CONDUCTORS), accounts: string[] = []): Args {
  const out: Args = { account: "", model: "", resume: "", help: false };
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--agent") {
      const v = argv[++i];
      if (!v || v.startsWith("-")) { out.error = USAGE; return out; }
      out.agent = ALIASES[v] ?? v;
    } else if (a === "-r" || a === "--resume") {
      const v = argv[++i];
      if (!v || v.startsWith("-")) { out.error = m("give the session id", "informe o id da sessão"); return out; }
      out.resume = v;
    } else if (a === "-h" || a === "--help") out.help = true;
    else pos.push(a);
  }
  if (!out.agent && pos.length === 2 && pos[1] !== "-" && accounts.includes(pos[0])) {
    out.agent = "claude";
  } else if (!out.agent && pos.length && names.includes(ALIASES[pos[0]] ?? pos[0])) {
    const agent = pos.shift()!;
    out.agent = ALIASES[agent] ?? agent;
  }
  [out.account = "", out.model = ""] = pos;
  if (pos.length > 2) out.error = USAGE;
  return out;
}

/** Resolve a conductor without reusing worker templates (which disable MCPs and permissions). */
export function launch(cfg: Obj, a: Args, ws: string, file: string, name = "") {
  const agent = a.agent ?? String(getPath(cfg, "roles.conductor.agent") ?? "claude");
  const user = (getPath(cfg, `agents.${agent}.conductor`) ?? {}) as Partial<ConductorDef>;
  const base = CONDUCTORS[agent];
  const def = { ...base, ...user, models: { ...base?.models, ...user.models } };
  const template = a.resume ? def.resume : def.run;
  if (!template) throw new Error(`orq conductor: ${agent} needs agents.${agent}.conductor.${a.resume ? "resume" : "run"}`);
  const same = !a.agent || a.agent === getPath(cfg, "roles.conductor.agent");
  const account = a.account || (same ? String(getPath(cfg, "roles.conductor.account") ?? "") : "");
  const model = a.model || (same ? String(getPath(cfg, "roles.conductor.model") ?? "") : "");
  const vars = { dir: ws, instructions: file, name: sessionName(ws, name), session: a.resume,
    account: account === "-" ? "" : account, model: def.models[model] ?? model,
    prompt_text: `Read ${JSON.stringify(file)} for your conductor instructions and follow them. Read AGENTS.md for the issue playbook. Read ORQ.md for the workspace map; in an older workspace without ORQ.md, read CLAUDE.md.` };
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(def.env ?? {})) env[k] = expandString(v, vars);
  if (account && account !== "-") {
    const custom = def.accounts?.[account];
    if (custom) Object.assign(env, custom);
    else if (agent === "claude") {
      const accounts = claudeAccounts(), found = accounts.find((x) => x.name === account);
      if (!found) throw new Error(`account '${account}' does not exist. Accounts: ${accounts.map((x) => `${x.name} ${x.dir}`).join(", ")}`);
      env.CLAUDE_CONFIG_DIR = found.dir;
    } else throw new Error(`orq conductor: account '${account}' needs agents.${agent}.conductor.accounts.${account}`);
  }
  env.ORQ_CONDUCTOR_AGENT = agent;
  env.ORQ_CONDUCTOR_ACCOUNT = account && account !== "-" ? account : "default";
  return { agent, argv: expandTemplate(template, vars), env };
}

/** The workspace folder: cwd when it holds .orquestra-conductor.md, else $CONDUCTOR_WS (resolved); undefined if neither. */
export function findWorkspace(cwd: string, env: NodeJS.ProcessEnv, exists: (p: string) => boolean = existsSync): string | undefined {
  if (exists(join(cwd, ".orquestra-conductor.md"))) return cwd;
  return env.CONDUCTOR_WS ? resolve(cwd, env.CONDUCTOR_WS) : undefined;
}

export const instructionsFile = (ws: string, env: NodeJS.ProcessEnv) => env.CONDUCTOR_FILE ? resolve(env.CONDUCTOR_FILE) : join(ws, ".orquestra-conductor.md");

/** The claude command line (without the executable). The instructions go by file, so no shell ever sees their text. */
export function claudeArgs(ws: string, a: Pick<Args, "model" | "resume">, file: string, name = ""): string[] {
  return [...(a.resume ? ["--resume", a.resume] : []), "-n", sessionName(ws, name),
    ...(a.model ? ["--model", modelId(a.model)] : []), "--append-system-prompt-file", file];
}

export async function conductor(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) { console.log(USAGE); return 0; }
  const ws = findWorkspace(process.cwd(), process.env);
  const { cfg } = loadConfig(ws);
  const a = parseArgs(argv, [...Object.keys(CONDUCTORS), ...Object.keys((cfg.agents ?? {}) as Obj)], claudeAccounts().map((a) => a.name));
  if (a.help) { console.log(USAGE); return 0; }
  if (a.error) { console.error(a.error); return 2; }
  if (!ws) {
    console.error(m("no .orquestra-conductor.md here: cd into a workspace (orq setup --workspace <dir>) or set CONDUCTOR_WS",
      "não há .orquestra-conductor.md aqui: entre num workspace (orq setup --workspace <pasta>) ou defina CONDUCTOR_WS"));
    return 2;
  }
  const file = instructionsFile(ws, process.env);
  if (!existsSync(file)) { console.error(`${m("conductor instructions not found", "instruções do conductor não encontradas")}: ${file}`); return 2; }

  const name = (process.env.HERDR_PANE_ID ? herdrName(process.env.HERDR_PANE_ID) : "") || process.env.ORQ_CONDUCTOR_ID || "";
  let command;
  try { command = launch(cfg, a, ws, file, name); }
  catch (e) { console.error((e as Error).message); return 1; }
  const { env } = command;
  if (!command.argv.length || !onPath(command.argv[0])) { console.error(`orq conductor: executable not found: ${command.argv[0] ?? "(empty template)"}`); return 1; }
  if (command.agent !== "claude") await instructions(["agents", "-w", ws]);

  if (process.env.HERDR_ENV === "1" && process.env.HERDR_PANE_ID)
    spawnSync("herdr", ["pane", "rename", process.env.HERDR_PANE_ID, "conductor"], { stdio: "ignore", timeout: 5_000 });

  process.chdir(ws);
  // Registration (.orquestra/.conductors) is a herdr thing (keyed by pane id; `claim --register` does nothing elsewhere),
  // so only inside herdr. claim reads the account from this process's env (best effort, silent).
  const keys = ["CLAUDE_CONFIG_DIR", "ORQ_CONDUCTOR_AGENT", "ORQ_CONDUCTOR_ACCOUNT"];
  const saved = keys.map((k) => process.env[k]);
  try {
    for (const k of keys) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
    if (process.env.HERDR_PANE_ID) await claim(["-w", ws, "--register"]);
  } catch { /* best effort */ }
  finally { keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; }); }
  return runCapped(command.argv[0], command.argv.slice(1), { mode: "off", env, cwd: ws, quote: true, tty: true });
}
