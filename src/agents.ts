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
//   no_review = "Nothing to review"       # regex: a match on the answer's first line (or a short answer, 200 chars) = nothing reviewed → status=fail
//   commit   = false                      # the agent can't run git commit: orq commits a write run's changes for it
//   network  = false                      # the agent has no network: orq fetches origin before a write run (no fetch/pull/push for it)
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
  commit?: boolean; // false = orq commits a write run's changes itself (default true)
  network?: boolean; // false = orq fetches origin before a write run; the agent rebases locally (default true)
  no_review?: string; // regex: matched on the answer's first line (or all of a short one) = "nothing was reviewed" → status=fail, not a verdict
}

/** Does the agent's command take the prompt (stdin, a file in its folder or a {prompt*} placeholder)? A review tool like revtool does not. */
export const usesPrompt = (a: Pick<AgentDef, "run" | "stdin" | "prompt_in_dir">) =>
  Boolean(a.stdin || a.prompt_in_dir || /\{prompt(_text|_hint)?\}/.test(a.run ?? ""));

/** What orq does for a write run in a git repo that the agent itself can't: commit its changes, fetch origin. */
export const stepIns = (def: Pick<AgentDef, "commit" | "network">, ro: boolean, inGit: boolean) =>
  ({ commit: !ro && inGit && def.commit === false, fetch: !ro && inGit && def.network === false });

/** The note added to the prompt so the agent doesn't try what orq does for it. */
export function stepInNote(s: { commit: boolean; fetch: boolean }): string {
  const l: string[] = [];
  if (s.fetch) l.push("- You have no network access. orq already ran `git fetch origin`, so the origin/* refs are fresh: rebase or diff against them locally. Don't run git fetch, pull or push.");
  if (s.commit) l.push("- You can't run `git commit`. Leave your changes in the working tree; orq commits them after you finish. Start your final answer with a one-line commit message in the form `Commit: <message>`.");
  return l.length ? `\n\n## Environment (from orq)\n${l.join("\n")}\n` : "";
}

/** The commit message an agent proposed (`Commit: ...` line in its answer), else the fallback. */
export const commitMessage = (answer: string, fallback: string) =>
  /^\W*commit:\s*`?([^`\n]+?)`?\s*$/im.exec(answer)?.[1]?.trim() || fallback;

/** Read only runs of a `throwaway` agent get a worktree copy of HEAD, but only where there is a git repo to copy. */
export const useThrowaway = (def: Pick<AgentDef, "throwaway">, ro: boolean, resume: boolean, inGit: boolean) =>
  Boolean(def.throwaway && ro && !resume && inGit);

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
    readonly: "", write: "[--add-dir {gitroots}]", stdin: true, format: "codex", answer: "file", throwaway: true, network: false,
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
    // --sandbox + accept-edits (no skip-permissions); headless denies commands outside agy's allowlist (see agy-impl.json);
    // a run that only had commands denied still counts when the worktree changed (see the antigravity format). The prompt goes in a file in its folder (excluded from git) and -p only says "read it".
    run: `${AGY} {mode} -p {prompt_hint}`, resume: `${AGY} --conversation {session} {mode} -p {prompt_hint}`,
    readonly: "--mode plan", write: "--mode accept-edits --add-dir {gitdir}",
    format: "antigravity", throwaway: true, prompt_in_dir: true, commit: false,
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
    const got = expandWords(words.slice(i, j).map((w) => w.text), vars, g >= 0);
    // `--flag {placeholder}` with the placeholder empty: drop the flag too, or it would swallow the next argument.
    const ph = g < 0 ? /^\{(\w+)(?::[^}]*)?\}$/.exec(words[i].text) : null, prev = words[i - 1];
    if (!got.length && ph && !Array.isArray(vars[ph[1]]) && prev && prev.group < 0 && /^-[^\s{]/.test(prev.text)
        && out[out.length - 1] === prev.text) out.pop();
    else out.push(...got);
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
  finish(log: string, stdout: string): { answer?: string; session?: string; rc?: number; denied?: string[];
    /** The run ended because the model's quota is gone: `secs` until it resets, when the agent said. */
    exhausted?: { secs?: number; message: string } };
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
      const evs = jsonLines(log) as J[];
      const res = evs.filter((j) => j.event === "result").map((j) => j.result ?? {});
      let answer = lastOf(res.map((r) => String(r.response ?? ""))) ?? "";
      const errs = log.split(/\r?\n/).filter((l) => l.startsWith("jetski: "));
      // Denied commands: ERROR steps with the command line, plus denied_actions on the result.
      const denied: string[] = [];
      let text = "", textId: unknown, lastCmd = "", sawResult = false; // lastCmd: last CommandLine streamed before the result
      const hinted = res.some((r) => Array.isArray(r.denied_actions) && r.denied_actions.length) || errs.some((l) => /permission/.test(l));
      for (const e of evs) {
        if (e.event === "result") sawResult = true;
        const s = e.event === "step_update" ? e.step_update : undefined;
        if (!s) continue;
        const seen = (s.tool_info ?? e.tool_info)?.parameters?.CommandLine;
        if (!sawResult && typeof seen === "string" && seen.trim()) lastCmd = seen.trim();
        if (s.step_type === "agent_response") {
          const id = s.step_id ?? s.step_index ?? s.id;
          if (id !== textId) { textId = id; if (s.text_delta) text = ""; }
          text += String(s.text_delta ?? "");
        }
        if (s.state === "ERROR") {
          const ti = s.tool_info ?? e.tool_info, cmd = ti?.parameters?.CommandLine, msg = String(s.error?.message ?? "");
          if (/permission check failed|not allowed|denied/i.test(msg) || (cmd && !msg && hinted)) {
            const d = `${cmd ? `\`${cmd}\`` : "(command)"}${msg ? ` — ${msg}` : ""}`;
            if (!denied.includes(d)) denied.push(d);
          }
        }
      }
      const acts = res.flatMap((r) => (Array.isArray(r.denied_actions) ? r.denied_actions : []));
      const wasDenied = denied.length > 0 || acts.length > 0 || errs.some((l) => /permission/.test(l));
      // denied_actions only says "RunCommand": the command is the last one the stream showed before the result.
      if (!denied.length && lastCmd && acts.length && acts.every((a: Obj) => a.display_name === "RunCommand")) denied.push(`denied: ${lastCmd}`);
      if (wasDenied && !answer.trim()) answer = text.trim();
      if (wasDenied) {
        answer += `${answer ? "\n\n" : ""}## Denied commands\n` +
          "agy denied commands outside its allowlist (headless, nobody to approve). Retry with a different command, or add a glob rule such as command(/usr/bin/*) to agy's allowlist (~/.config/orq/agy-impl.json, see examples/agy-impl.json) -- usually that is the fix.\n" +
          (denied.length ? denied.map((d) => `- ${d}`).join("\n") : acts.map((a: Obj) => `- ${a.action ?? "command"} (${a.display_name ?? "?"})`).join("\n")) + "\n";
      }
      if (errs.length) answer += (answer ? "\n" : "") + errs.join("\n") + "\n";
      const exhausted = agyExhausted(log, res);
      return { exhausted, session: lastOf(res.map((r) => r.conversation_id).filter(Boolean)), answer, rc: errs.length || wasDenied ? 3 : undefined,
        denied: wasDenied ? (denied.length ? denied : ["(command)"]) : undefined };
    },
  },
};

/** "Resets in 123h12m32s" → seconds (undefined without such a duration). */
export function parseResetIn(text: string): number | undefined {
  const r = /Resets in\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?/i.exec(text);
  if (!r || !(r[1] || r[2] || r[3])) return undefined;
  return Number(r[1] ?? 0) * 3600 + Number(r[2] ?? 0) * 60 + Number(r[3] ?? 0);
}

/** agy's quota failure (RESOURCE_EXHAUSTED / "quota reached"), from the result's error or the AGY_ERROR line. */
function agyExhausted(log: string, res: Obj[]): { secs?: number; message: string } | undefined {
  const msgs = res.filter((r) => r.status === "ERROR" || r.error).map((r) => String(r.error ?? ""));
  for (const l of log.split(/\r?\n/)) {
    if (!l.startsWith("AGY_ERROR:")) continue;
    const j = json(l.slice(10).trim());
    if (j) msgs.push(`${j.status ?? ""} ${j.short_error ?? ""}`);
  }
  const text = msgs.find((t) => /RESOURCE_EXHAUSTED|quota reached/i.test(t));
  if (!text) return undefined;
  return { secs: parseResetIn(text), message: text.replace(/^.*?(?:\(code 429\):\s*)/, "").trim() };
}

/** The model in an agent's argv (-m / --model / --model=x), without the provider prefix. */
export function argvModel(a: string[]): string | undefined {
  const i = a.findIndex((x) => x === "-m" || x === "--model");
  const v = i >= 0 ? a[i + 1] : a.find((x) => x.startsWith("--model="))?.slice(8);
  return v?.split("/").pop();
}
