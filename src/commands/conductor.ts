// orq conductor — opens the conductor (Claude Code) in the current terminal, with the workspace's conductor
// instructions, the chosen account and model (port of setup/herdr-conductor, for any terminal and OS).
//   orq conductor [account|-] [model] [-r <session>]
// Workspace: the current folder if it has .orquestra-conductor.md, else $CONDUCTOR_WS. $CONDUCTOR_FILE overrides the
// instructions file. The session is named conductor-<workspace folder>.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { claudeAccounts } from "../accounts.js";
import { m } from "../i18n.js";
import { runCapped } from "../process.js";
import { claim } from "./claim.js";

export const USAGE = `orq conductor [account|-] [model] [-r <session>]   open the conductor (Claude) here: instructions, account, model
  model: sonnet | opus | haiku | a full id; "-" as account = default account; -r resumes that conversation`;

export const MODELS: Record<string, string> = {
  sonnet: "claude-sonnet-5",
  opus: "claude-opus-5-5",
  haiku: "claude-haiku-4-5-20251001",
};

export const modelId = (alias: string): string => MODELS[alias] ?? alias;

export interface Args { account: string; model: string; resume: string; help: boolean; error?: string }

/** [account|-] [model] [-r|--resume <id>]; further positionals are ignored (as herdr-conductor did). */
export function parseArgs(argv: string[]): Args {
  const out: Args = { account: "", model: "", resume: "", help: false };
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-r" || a === "--resume") {
      const v = argv[++i];
      if (!v) { out.error = m("give the session id", "informe o id da sessão"); return out; }
      out.resume = v;
    } else if (a === "-h" || a === "--help") out.help = true;
    else pos.push(a);
  }
  [out.account = "", out.model = ""] = pos;
  return out;
}

/** The workspace folder: cwd when it holds .orquestra-conductor.md, else $CONDUCTOR_WS (resolved); undefined if neither. */
export function findWorkspace(cwd: string, env: NodeJS.ProcessEnv, exists: (p: string) => boolean = existsSync): string | undefined {
  if (exists(join(cwd, ".orquestra-conductor.md"))) return cwd;
  return env.CONDUCTOR_WS ? resolve(cwd, env.CONDUCTOR_WS) : undefined;
}

export const instructionsFile = (ws: string, env: NodeJS.ProcessEnv) => env.CONDUCTOR_FILE ? resolve(env.CONDUCTOR_FILE) : join(ws, ".orquestra-conductor.md");

/** The claude command line (without the executable). The instructions go by file, so no shell ever sees their text. */
export function claudeArgs(ws: string, a: Pick<Args, "model" | "resume">, file: string): string[] {
  return [...(a.resume ? ["--resume", a.resume] : []), "-n", `conductor-${basename(ws)}`,
    ...(a.model ? ["--model", modelId(a.model)] : []), "--append-system-prompt-file", file];
}

export async function conductor(argv: string[]): Promise<number> {
  const a = parseArgs(argv);
  if (a.help) { console.log(USAGE); return 0; }
  if (a.error) { console.error(a.error); return 2; }
  const ws = findWorkspace(process.cwd(), process.env);
  if (!ws) {
    console.error(m("no .orquestra-conductor.md here: cd into a workspace (orq setup --workspace <dir>) or set CONDUCTOR_WS",
      "não há .orquestra-conductor.md aqui: entre num workspace (orq setup --workspace <pasta>) ou defina CONDUCTOR_WS"));
    return 2;
  }
  const file = instructionsFile(ws, process.env);
  if (!existsSync(file)) { console.error(`${m("conductor instructions not found", "instruções do conductor não encontradas")}: ${file}`); return 2; }

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (a.account && a.account !== "-") {
    const accounts = claudeAccounts(), found = accounts.find((x) => x.name === a.account);
    if (!found) {
      console.error(m(`account '${a.account}' does not exist. Accounts:`, `a conta '${a.account}' não existe. Contas:`));
      for (const x of accounts) console.error(`${x.name} ${x.dir}`);
      return 1;
    }
    env.CLAUDE_CONFIG_DIR = found.dir;
  }

  if (process.env.HERDR_ENV === "1" && process.env.HERDR_PANE_ID)
    spawnSync("herdr", ["pane", "rename", process.env.HERDR_PANE_ID, "conductor"], { stdio: "ignore", timeout: 5_000 });

  process.chdir(ws);
  // Registration (.orquestra/.conductors) is a herdr thing (keyed by pane id; `claim --register` does nothing elsewhere),
  // so only inside herdr. claim reads the account from this process's env (best effort, silent).
  const saved = process.env.CLAUDE_CONFIG_DIR;
  if (env.CLAUDE_CONFIG_DIR) process.env.CLAUDE_CONFIG_DIR = env.CLAUDE_CONFIG_DIR;
  if (process.env.HERDR_PANE_ID) try { await claim(["-w", ws, "--register"]); } catch { /* best effort */ }
  if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = saved;

  return runCapped("claude", claudeArgs(ws, a, file), { mode: "off", env, cwd: ws, quote: true, tty: true });
}
