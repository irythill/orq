// AgentDef — how to run each agent, as command templates in the config. The five built-in agents below are defaults
// the user may override key by key in [agents.<name>]; any other CLI becomes usable by declaring `run` there.
//
//   [agents.acme]
//   run      = "acme exec [--model {model}] --prompt-file {prompt} {mode}"   # new session
//   resume   = "acme exec --resume {session} --prompt-file {prompt} {mode}"  # follow-up (-R)
//   readonly = "--sandbox read-only"       # {mode} in read-only runs (-r); appended to `run` when it has no {mode}
//   write    = "--sandbox workspace-write" # {mode} otherwise; false = the agent only runs read only
//   stdin    = true                        # the prompt goes on stdin (else use {prompt} or {prompt_text})
//   format   = "text"                      # text (answer = stdout) | claude | codex | opencode | antigravity
//   session  = { from_log = "session: (\\S+)" }   # or "uuid": orq makes one and passes it as {session}
//   answer   = "stdout"                    # stdout | file (the agent writes {out} itself)
//   env      = { ACME_NO_MCP = "1" }
//   tui      = "acme --on-turn-end {hook_cmd} {prompt_text}"   # -T: the agent's own screen (new session)
//   tui_resume = "acme --resume {session} --on-turn-end {hook_cmd} {prompt_text}"   # -T -R with the screen closed
//   ok_exit  = [0, 1]                     # exit codes that still count as a verdict (a review tool exits 1 on findings)
//   filter   = "jq -r '.findings[] | ...'" # shell line: gets the answer on stdin, its stdout becomes the answer
//
// Templates: words split on spaces ('...' or "..." keep spaces). {name} or {name:default}; a [group] is dropped when
// any placeholder in it is empty, and repeated for a list placeholder ({gitroots}). Placeholders: prompt (file),
// prompt_text, prompt_hint, out (answer file), dir (where the agent runs), repo (-d), base (-b), model, effort, session, gitdir,
// gitroots, gitroots_json, opencode_config, title, mode; in tui templates also the end-of-turn hook as hook_cmd (a
// shell line), hook_json (an argv array, Codex's notify) and hook_settings (Claude's --settings).
// The hook (`orq agent --turn <job> <turn_hook>`) reads the turn in the agent's own shape: claude (Stop hook JSON on
// stdin), codex (notify JSON as the last argument), opencode (<session id> <answer file>, from orq's plugin) or text
// (the answer on stdin, the session id as an argument).
import type { Obj } from "./config.js";
import { m } from "./i18n.js";

export interface AgentDef {
  vendor?: string;
  run: string;
  resume?: string;
  readonly?: string;
  write?: string | false;
  stdin?: boolean;
  format?: string;
  session?: "uuid" | { from_log: string };
  answer?: "stdout" | "file";
  throwaway?: boolean; // read-only runs on a throwaway worktree copy of HEAD (agents whose read-only sandbox breaks tools)
  prompt_in_dir?: boolean; // prompt copied into the folder ({prompt_hint} says "read it"): keeps long prompts off argv
  accounts?: boolean; // -c <Claude account> sets CLAUDE_CONFIG_DIR
  env?: Record<string, string>;
  unset_env?: string[];
  mem_max?: string;
  tui?: string; // -T: the agent's own interactive screen; {mode} is only used where the template says so
  tui_resume?: string;
  turn_hook?: "claude" | "codex" | "opencode" | "text";
  ok_exit?: number[]; // exit codes that are a verdict, not a failure (default [0])
  filter?: string; // shell line run on the answer (stdin → stdout), e.g. a tool's JSON → [blocker]/[suggestion]
}

const NOMCP_CODEX = "-c mcp_servers.plane.enabled=false -c mcp_servers.shadcn.enabled=false";
const CLAUDE = "claude -p --strict-mcp-config --output-format stream-json --verbose [--model {model}] --effort {effort:low}";
const CLAUDE_TUI = "claude --strict-mcp-config [--model {model}] --effort {effort:low}";
const OPENCODE ="opencode run --standalone --format json [-m {model}]"; // v2: effort goes in the model, "provider/model#variant"
const AGY = "agy --output-format stream-json --sandbox [--model {model}] [--effort {effort}]";
const COPILOT = "-s -C {dir} --disable-builtin-mcps --disable-mcp-server plane --allow-tool 'shell(git diff:*)' " +
  "--allow-tool 'shell(git log:*)' --allow-tool 'shell(git show:*)' --deny-tool write [--model {model}] " +
  "[--reasoning-effort {effort}] -p {prompt_text}";

/** What herdr-agent did per agent, as templates. */
export const BUILTIN_AGENTS: Record<string, AgentDef> = {
  claude: {
    // stream-json shows live progress; a fixed --session-id lets the follow-up --resume. No MCP; the child must not
    // report state on the conductor's herdr pane.
    run: `${CLAUDE} --session-id {session} {mode}`, resume: `${CLAUDE} --resume {session} {mode}`,
    readonly: "--permission-mode plan", write: "--permission-mode auto --add-dir {gitdir}",
    stdin: true, format: "claude", session: "uuid", accounts: true, unset_env: ["HERDR_PANE_ID"],
    tui: `${CLAUDE_TUI} --session-id {session} {mode} --settings {hook_settings} {prompt_text}`,
    tui_resume: `${CLAUDE_TUI} --resume {session} {mode} --settings {hook_settings} {prompt_text}`, turn_hook: "claude",
  },
  codex: {
    // Codex treats any .git inside a writable root as read only: the folders a commit needs are granted one by one.
    // Read only: its read-only sandbox doesn't even let jest write its cache, so it runs on a throwaway worktree.
    run: `codex exec [-m {model}] -c model_reasoning_effort={effort:low} -s workspace-write -C {dir} ` +
      `--skip-git-repo-check {mode} ${NOMCP_CODEX} -o {out} -`,
    resume: `codex exec resume {session} -c model_reasoning_effort={effort:low} ` +
      `-c sandbox_workspace_write.writable_roots={gitroots_json} ${NOMCP_CODEX} -o {out} -`,
    readonly: "", write: "[--add-dir {gitroots}]", stdin: true, format: "codex", answer: "file", throwaway: true,
    // The screen: no approvals (nobody to approve), the same sandbox as exec; notify = end of turn.
    tui: `codex [-m {model}] -c model_reasoning_effort={effort:low} -s workspace-write -a never -C {dir} {mode} ` +
      `${NOMCP_CODEX} -c notify={hook_json} {prompt_text}`,
    tui_resume: `codex resume {session} -c model_reasoning_effort={effort:low} -s workspace-write -a never ` +
      `-c sandbox_workspace_write.writable_roots={gitroots_json} ${NOMCP_CODEX} -c notify={hook_json} {prompt_text}`,
    turn_hook: "codex",
  },
  opencode: {
    // Permissions and MCPs off via OPENCODE_CONFIG_CONTENT. Headless has nobody to approve, so write = --auto (only
    // ever in a worktree) and read only = throwaway worktree with the edit tool denied.
    run: `${OPENCODE} {mode} {prompt_text}`, resume: `${OPENCODE} -s {session} {mode} {prompt_text}`, readonly: "", write: "--auto",
    format: "opencode", throwaway: true, env: { OPENCODE_CONFIG_CONTENT: "{opencode_config}" },
    // The screen: no --auto ("ask" shows up for you); the model and orq's end-of-turn plugin go in the config.
    tui: "opencode --standalone --prompt {prompt_text} {dir}", tui_resume: "opencode --standalone -s {session} --prompt {prompt_text} {dir}",
    turn_hook: "opencode",
  },
  antigravity: {
    // --sandbox + accept-edits (no skip-permissions); headless denies commands outside agy's allowlist, so in practice
    // it reviews. The prompt goes in a file in its folder (excluded from git) and -p only says "read it".
    run: `${AGY} {mode} -p {prompt_hint}`, resume: `${AGY} --conversation {session} {mode} -p {prompt_hint}`,
    readonly: "--mode plan", write: "--mode accept-edits --add-dir {gitdir}",
    format: "antigravity", throwaway: true, prompt_in_dir: true,
  },
  copilot: {
    // Second opinion, always read only: git reads allowed, anything else denied by -p without asking.
    run: `copilot --session-id={session} ${COPILOT}`, resume: `copilot --resume={session} ${COPILOT}`,
    readonly: "", write: false, session: "uuid",
  },
};
export const ALIASES: Record<string, string> = { agy: "antigravity" };

/** The definition of `name`: built-in defaults, then [agents.<name>] from the config. */
export function agentDef(cfg: Obj, name: string): AgentDef {
  const user = ((cfg.agents ?? {}) as Record<string, Obj>)[name] ?? {};
  const def = { ...(BUILTIN_AGENTS[name] ?? {}), ...user } as AgentDef;
  if (typeof def.run !== "string")
    throw new Error(m(`unknown agent: ${name} (built in: ${Object.keys(BUILTIN_AGENTS).join(", ")}; others need agents.${name}.run in the config)`,
      `agente desconhecido: ${name} (embutidos: ${Object.keys(BUILTIN_AGENTS).join(", ")}; outros precisam de agents.${name}.run no config)`));
  return def;
}

export type Vars = Record<string, string | string[] | undefined>;
interface Word { text: string; group: number }

/** Split a template into words, remembering which [group] each belongs to. */
export function tokenize(t: string): Word[] {
  const out: Word[] = [];
  let cur = "", q = "", has = false, g = -1, gid = 0, close = false;
  const push = () => {
    if (has) out.push({ text: cur, group: g });
    if (close) { g = -1; close = false; }
    cur = ""; has = false;
  };
  for (const c of t) {
    if (q) { if (c === q) q = ""; else cur += c; continue; }
    if (c === "'" || c === '"') { q = c; has = true; continue; }
    if (/\s/.test(c)) { push(); continue; }
    if (c === "[" && !has && g < 0) { g = gid++; continue; }
    if (c === "]" && g >= 0) { close = true; push(); continue; }
    cur += c; has = true;
  }
  push();
  return out;
}

const PH = /\{(\w+)(?::([^}]*))?\}/g;

function expandWords(ws: string[], vars: Vars, optional: boolean): string[] {
  const names = ws.flatMap((w) => [...w.matchAll(PH)].map((x) => x[1]));
  for (const n of names) if (!(n in vars)) throw new Error(m(`unknown placeholder {${n}}`, `placeholder desconhecido {${n}}`));
  const list = optional ? names.find((n) => Array.isArray(vars[n])) : undefined;
  if (list) return (vars[list] as string[]).flatMap((v) => expandWords(ws, { ...vars, [list]: v }, true));
  const out: string[] = [];
  for (const w of ws) {
    const whole = /^\{(\w+)(?::([^}]*))?\}$/.exec(w);
    const wv = whole ? vars[whole[1]] : undefined;
    if (Array.isArray(wv)) { out.push(...wv); continue; }
    let empty = false;
    const s = w.replace(PH, (_, n: string, d?: string) => {
      const v = vars[n], x = (Array.isArray(v) ? v.join(" ") : v) || d || "";
      if (!x) empty = true;
      return x;
    });
    if (empty && optional) return [];
    if (!(whole && !s)) out.push(s);
  }
  return out;
}

/** Template → argv. */
export function expandTemplate(t: string, vars: Vars): string[] {
  const words = tokenize(t), out: string[] = [];
  for (let i = 0; i < words.length;) {
    const g = words[i].group;
    let j = i + 1;
    if (g >= 0) while (j < words.length && words[j].group === g) j++;
    out.push(...expandWords(words.slice(i, j).map((w) => w.text), vars, g >= 0));
    i = j;
  }
  return out;
}

/** Placeholders inside a single string (env values): no splitting. */
export const expandString = (s: string, vars: Vars) =>
  s.replace(PH, (_, n: string, d?: string) => { const v = vars[n]; return (Array.isArray(v) ? v.join(" ") : v) || d || ""; });

// Output formats: what to show live from each line of output, and how to read the answer and session at the end.
export interface Format {
  show(line: string): string | undefined;
  finish(log: string, stdout: string): { answer?: string; session?: string; rc?: number };
  /** True when the agent has finished but may not exit (OpenCode): the runner stops it after a quiet period. */
  idle?(last: string): boolean;
}
const json = (l: string): Obj | undefined => { try { const v = JSON.parse(l); return v && typeof v === "object" ? v : undefined; } catch { return undefined; } };
const jsonLines = (log: string) => log.split(/\r?\n/).filter((l) => l.startsWith("{")).map(json).filter((x): x is Obj => !!x);
const lastOf = <T>(xs: T[]) => xs.length ? xs[xs.length - 1] : undefined;
type J = any; // parsed agent output: shapes vary by version

export const FORMATS: Record<string, Format> = {
  text: { show: (l) => `${l}\n`, finish: (_log, stdout) => ({ answer: stdout }) },
  codex: { show: (l) => `${l}\n`, finish: (log) => ({ session: /session id:?\s*(\S+)/.exec(log)?.[1] }) },
  claude: {
    show(l) {
      const j = json(l) as J;
      if (j?.type !== "assistant") return undefined;
      const parts = ((j.message?.content ?? []) as J[]).map((c) => c.type === "text" ? c.text : c.type === "tool_use" ? `· ${c.name}` : undefined)
        .filter((x) => x !== undefined);
      return parts.length ? parts.join("\n") + "\n" : undefined;
    },
    finish: (log) => ({ answer: lastOf(jsonLines(log).filter((j) => j.type === "result").map((j) => String((j as J).result ?? ""))) ?? "" }),
  },
  opencode: {
    show(l) {
      const j = json(l) as J;
      return j?.type === "text" ? `${j.part?.text ?? ""}\n` : j?.type === "tool_use" ? `· ${j.part?.tool ?? "tool"}\n` : undefined;
    },
    finish(log) {
      const js = jsonLines(log) as J[];
      return { session: lastOf(js.filter((j) => j.sessionID).map((j) => String(j.sessionID))),
        answer: lastOf(js.filter((j) => j.type === "text").map((j) => String(j.part?.text ?? ""))) ?? "" };
    },
    idle: (last) => { const j = json(last) as J; return j?.type === "step_finish" && j.part?.reason === "stop"; },
  },
  antigravity: {
    show(l) {
      const j = json(l) as J, s = j?.event === "step_update" ? j.step_update : undefined;
      if (!s) return undefined;
      if (s.step_type === "agent_response") return s.text_delta || undefined;
      return s.step_type === "tool" && s.state === "DONE" ? "\n· tool\n" : undefined;
    },
    finish(log) {
      const res = (jsonLines(log) as J[]).filter((j) => j.event === "result").map((j) => j.result ?? {});
      let answer = lastOf(res.map((r) => String(r.response ?? ""))) ?? "";
      // An agy error (e.g. a denied command) is a failure, even with an answer.
      const errs = log.split(/\r?\n/).filter((l) => l.startsWith("jetski: "));
      if (errs.length) answer += (answer ? "\n" : "") + errs.join("\n") + "\n";
      return { session: lastOf(res.map((r) => r.conversation_id).filter(Boolean)), answer, rc: errs.length ? 3 : undefined };
    },
  },
};
