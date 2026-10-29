// orq agent — run a headless agent as a child of the conductor (port of herdr-agent), on its AgentDef (src/agents.ts),
// under its memory cap (src/process.ts), in a herdr tab, a tmux window or the background (src/terminal.ts).
// Writes <prefix>.out.md (final answer) / .log / .id (session, for -R) / .pane / .done ("status=ok|fail rc=N at=...").
// Returns at once; `orq wait <prefix>` blocks until .done. A conductor in herdr (HERDR_PANE_ID) also gets ONE line
// "[HERDR-AGENT DONE] <title> status=... answer: <prefix>.out.md" typed into its pane by herdr-notify.
// The launcher writes <prefix>.job.json and starts `orq agent --run <job>` on the terminal host; that runner does the rest.
// -T (or machine.tui / HERDR_AGENT_TUI=1): the agent's own screen (its `tui` template) in a herdr tab or tmux window,
// same cap and files. The agent calls `orq agent --turn <job> <kind>` at every end of turn, which writes .out.md/.id/
// .done and notifies; the screen stays open (holding memory) until you close it. -T -R with the screen still open types
// the follow-up into it; with the screen closed it reopens the session (tui_resume).
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, copyFileSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeAccounts } from "../accounts.js";
import { agentDef, ALIASES, expandString, expandTemplate, FORMATS, type Vars } from "../agents.js";
import { getPath, loadConfig, type Obj } from "../config.js";
import { writeAtomic } from "../fsutil.js";
import { m } from "../i18n.js";
import { alive } from "../lock.js";
import { stateDir } from "../paths.js";
import { killTree, type MemMode, parseSize, resolveMode, runCapped } from "../process.js";
import { closeOwnTab, detectHost, type Host, launch, screenOpen, shq, typeInto } from "../terminal.js";
import { dropWorktree, notify } from "../testrun.js";

export const USAGE = "orq agent -a <agent> -t <title> -d <dir> -o <prefix> [-g group] [-m model] [-e effort] [-c account] [-i file]... [-b base] [-r] [-R session [-F]] [-T] -- <prompt.md>   run a child agent";

const CLI = fileURLToPath(new URL("../cli.js", import.meta.url));
const PF = ".herdr-agent-prompt.md"; // prompt_in_dir file name (kept from herdr-agent)

interface Job {
  agent: string; title: string; repo: string; dir: string; prefix: string; prompt: string; argv: string[];
  env: Record<string, string>; unset: string[]; stdin: boolean; format: string; answer: string;
  session?: string; fromLog?: string; parent: string; host: Host; unit: string; cap?: number; swap?: number;
  mode: MemMode; throwaway: boolean; promptInDir: boolean; closeAfter: number; keep: boolean; tui?: boolean;
}

const git = (dir: string, ...a: string[]) => {
  const r = spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : undefined;
};

export async function agent(argv: string[]): Promise<number> {
  if (argv[0] === "--run") return runJob(argv[1]);
  if (argv[0] === "--turn") return turn(argv[1], argv[2], argv.slice(3));
  let a = process.env.AGENT || "codex", g = "", t = "", d = "", o = "", model = "", effort = "", acc = "", resume = "", base = "";
  let ro = false, tui = false, force = false, prompt: string | undefined;
  const inc: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i], v = () => argv[++i] ?? "";
    if (x === "--") { prompt = argv[i + 1]; break; }
    if (x === "-a") a = v(); else if (x === "-g") g = v(); else if (x === "-t") t = v(); else if (x === "-d") d = v();
    else if (x === "-o") o = v(); else if (x === "-m") model = v(); else if (x === "-e") effort = v();
    else if (x === "-c") acc = v(); else if (x === "-i") inc.push(resolve(v())); else if (x === "-R") resume = v();
    else if (x === "-b") base = v(); else if (x === "-p") v(); else if (x === "-r") ro = true; else if (x === "-T") tui = true; else if (x === "-F") force = true;
    else if (!x.startsWith("-") && prompt === undefined) prompt = x;
    else { console.error(USAGE); return 2; }
  }
  if (!prompt) { console.error(m("give the prompt file", "informe o arquivo de prompt")); return 2; }
  for (const [f, val] of [["t", t], ["d", d], ["o", o]]) if (!val) { console.error(`${m("missing", "faltou")} -${f}`); return 2; }
  a = ALIASES[a] ?? a;
  const { cfg } = loadConfig();
  const def = agentDef(cfg, a);
  if (!ro && def.write === false) { console.error(m(`${a} only runs read only (-r)`, `o ${a} só roda em modo leitura (-r)`)); return 2; }
  if (acc && !def.accounts) { console.error(m(`-c only applies to agents with Claude accounts (claude)`, `-c só vale para agentes com contas Claude (claude)`)); return 2; }
  const mach = (cfg.machine ?? {}) as Obj;
  const host = detectHost(cfg);
  // Screen by default (machine.tui, HERDR_AGENT_TUI=1) only where it can be: a terminal host and an agent with a screen.
  if (!tui && (process.env.HERDR_AGENT_TUI === "1" || mach.tui === true) && host !== "plain" && def.tui && (!resume || def.tui_resume)) tui = true;
  if (tui && !def.tui) { console.error(m(`-T: ${a} has no screen mode (agents.${a}.tui)`, `-T: ${a} não tem modo tela (agents.${a}.tui)`)); return 2; }
  if (resume && !tui && !def.resume) { console.error(m(`${a} has no resume template (agents.${a}.resume)`, `${a} não tem template de resume (agents.${a}.resume)`)); return 2; }
  if (tui && resume && !def.tui_resume) { console.error(m(`-T -R: ${a} has no tui_resume template`, `-T -R: ${a} não tem template tui_resume`)); return 2; }
  if (tui && host === "plain") {
    console.error(m("-T shows the agent's own screen: it needs herdr or tmux (run inside one, or set ORQ_TERMINAL)",
      "-T mostra a tela do próprio agente: precisa do herdr ou do tmux (rode dentro de um, ou defina ORQ_TERMINAL)"));
    return 2;
  }
  const repo = resolve(d), O = resolve(o);
  // Fix rounds: every -R on the same session counts, whatever the prefix is called. policy.max_rounds is enforced here,
  // not left to the conductor to remember (a 7-round fix loop is what burns the tokens). -F = the user said go on.
  if (resume) {
    const max = Number(getPath(cfg, "policy.max_rounds") ?? 2), cf = join(dirname(O), `.rounds-${resume}`);
    let n = 0;
    try { n = Number(readFileSync(cf, "utf8")) || 0; } catch { /* first follow-up */ }
    if (n >= max && !force) {
      console.error(m(`round limit: session ${resume} already had ${n} follow-up(s) (policy.max_rounds = ${max}). Stop and tell the user; with their OK, repeat with -F.`,
        `limite de rodadas: a sessão ${resume} já teve ${n} follow-up(s) (policy.max_rounds = ${max}). Pare e avise o usuário; com o OK dele, repita com -F.`));
      return 4;
    }
    mkdirSync(dirname(O), { recursive: true });
    writeFileSync(cf, String(n + 1));
  }
  let P = resolve(prompt);
  if (!existsSync(repo)) { console.error(m(`no folder ${repo}`, `pasta ${repo} não existe`)); return 2; }
  if (!existsSync(P)) { console.error(m(`no prompt file ${P}`, `arquivo de prompt ${P} não existe`)); return 2; }
  mkdirSync(dirname(O), { recursive: true });
  // -b <base>: attaches `git diff origin/<base>...HEAD` (review without running git; required for Antigravity).
  if (base) {
    const r = spawnSync("git", ["-C", repo, "diff", `origin/${base}...HEAD`], { encoding: "utf8", maxBuffer: 1 << 30 });
    if (r.status !== 0) { console.error(m(`could not build the diff against origin/${base}`, `não consegui gerar o diff contra origin/${base}`)); return 2; }
    writeFileSync(`${O}.diff`, r.stdout); inc.push(`${O}.diff`);
  }
  if (inc.length) {
    let text = readFileSync(P, "utf8");
    for (const f of inc) text += `\n--- ${basename(f)} ---\n${readFileSync(f, "utf8")}\n--- end of ${basename(f)} ---\n`;
    writeFileSync(`${O}.prompt.md`, text); P = `${O}.prompt.md`;
  }
  // Follow-ups (-R) reuse the prefix: remove the previous round's result so ".done exists" means "this one finished".
  // -T -R with the screen still open: the follow-up is typed into it (its runner, and .pid, carry on). Open = the agent
  // is still running there, not just the pane: after it exits the pane may hold a shell, which must never get the text.
  let open = "", pid = 0;
  try { open = readFileSync(`${O}.pane`, "utf8").trim(); pid = Number(readFileSync(`${O}.pid`, "utf8")); } catch { /* first run or ended */ }
  if (tui && resume && alive(pid) && screenOpen(open)) {
    for (const s of [".done", ".out.md"]) rmSync(O + s, { force: true });
    typeInto(open, readFileSync(P, "utf8"));
    console.log(`[orq agent] ${t} → ${open} ${m("(follow-up typed into the open screen)", "(follow-up digitado na tela aberta)")}`);
    return 0;
  }
  for (const s of [".done", ".out.md", ".pid"]) rmSync(O + s, { force: true });
  const throwaway = Boolean(def.throwaway && ro && !resume);
  const dir = throwaway ? `${repo}.review-${process.pid}` : repo;
  const gd = git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir");
  const wg = git(repo, "rev-parse", "--absolute-git-dir");
  const roots = gd && wg ? [...new Set([wg, `${gd}/objects`, `${gd}/refs`, `${gd}/logs`])].sort() : [];
  let nm = "";
  try { nm = realpathSync(join(repo, "node_modules")); } catch { /* none */ }
  const session = resume || (def.session === "uuid" ? randomUUID() : "");
  const tpl = tui ? (resume ? def.tui_resume! : def.tui!) : resume ? def.resume! : def.run;
  // End of turn (-T): the agent runs `orq agent --turn <job> <kind>`; Claude gets it as a Stop hook, Codex as notify,
  // OpenCode through a plugin orq writes next to the job.
  const hook = [process.execPath, CLI, "agent", "--turn", `${O}.job.json`, def.turn_hook ?? "text"];
  // OpenCode v2 drops a partial MCP entry without a word: each one turned off needs its type and command too.
  const off = { type: "local", command: ["true"], enabled: false };
  const ocCfg: Obj = {
    mcp: { plane: off, shadcn: off, "linear-server": off },
    permission: { bash: "allow", question: "deny", webfetch: "deny",
      external_directory: { "*": "deny", ...(gd ? { [`${gd}/*`]: "allow" } : {}), "/tmp/*": "allow", ...(nm ? { [`${nm}/*`]: "allow" } : {}) },
      edit: ro ? "deny" : "allow" },
  };
  if (tui && def.turn_hook === "opencode") {
    mkdirSync(`${O}.opencode`, { recursive: true }); // a v2 plugin is a folder with index.js
    writeFileSync(join(`${O}.opencode`, "index.js"), opencodePlugin(O, hook));
    ocCfg.plugin = [`${O}.opencode`];
    if (model && model !== "auto") ocCfg.model = model; // the screen has no -m
  }
  const vars: Vars = {
    prompt: P, prompt_text: tpl.includes("{prompt_text}") ? readFileSync(P, "utf8") : "",
    prompt_hint: `Read the file ${PF} (in the current folder, with your file-reading tool): it holds your complete instructions for this task. Follow them. ${PF} is not part of the code: don't review or edit it.`,
    out: `${O}.out.md`, dir, repo, title: t, model: model === "auto" ? "" : model, effort, session,
    gitdir: gd ?? "", gitroots: roots, gitroots_json: JSON.stringify(roots), mode: [], opencode_config: JSON.stringify(ocCfg),
    hook_cmd: hook.map(shq).join(" "), hook_json: JSON.stringify(hook),
    hook_settings: JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: hook.map(shq).join(" ") }] }] } }),
  };
  vars.mode = expandTemplate((ro ? def.readonly : def.write) || "", vars);
  const cmd = expandTemplate(tpl, vars);
  if (!tpl.includes("{mode}") && !resume && !tui) cmd.push(...(vars.mode as string[]));
  const env: Record<string, string> = {};
  for (const [k, val] of Object.entries(def.env ?? {})) env[k] = expandString(String(val), vars);
  if (acc) {
    const ac = claudeAccounts().find((x) => x.name === acc);
    if (!ac) { console.error(m(`account '${acc}' does not exist`, `a conta '${acc}' não existe`)); return 2; }
    env.CLAUDE_CONFIG_DIR = ac.dir;
  }
  const closeAfter = Number(process.env.HERDR_CLOSE_DELAY ?? mach.close_tab_after ?? 20);
  const unit = `herdr-agent-${Math.floor(Date.now() / 1000)}-${process.pid}`; // herdr-board lists herdr-agent-* scopes
  const job: Job = {
    agent: a, title: t, repo, dir, prefix: O, prompt: P, argv: cmd, env, unset: def.unset_env ?? [], stdin: Boolean(def.stdin),
    format: def.format ?? "text", answer: def.answer ?? "stdout", session: session || undefined,
    fromLog: typeof def.session === "object" ? def.session.from_log : undefined, parent: process.env.HERDR_PANE_ID ?? "",
    host, unit, cap: parseSize(def.mem_max ?? (mach.agent_mem_max as string | undefined) ?? "off"),
    swap: parseSize(mach.agent_swap_max as string | undefined), mode: (mach.mem_enforce as MemMode | undefined) ?? "auto",
    throwaway, promptInDir: Boolean(def.prompt_in_dir), closeAfter,
    keep: process.env.HERDR_KEEP_TAB === "1" || process.env.ORQ_KEEP_TAB === "1" || closeAfter <= 0, tui,
  };
  writeAtomic(`${O}.job.json`, JSON.stringify(job, null, 1));
  // Readable copy of the command (also what orq stats and herdr-board read).
  writeFileSync(`${O}.run.sh`, `#!/usr/bin/env bash\n# orq agent (generated; the run itself is \`orq agent --run ${O}.job.json\`) --unit=${unit} \n` +
    `cd ${shq(dir)}\n${Object.entries(env).map(([k, val]) => `${k}=${shq(val)} `).join("")}${cmd.map(shq).join(" ")}${job.stdin ? ` < ${shq(P)}` : ""}\n`);
  const where = launch(host, { group: g || "agents", title: t, dir: repo, argv: [process.execPath, CLI, "agent", "--run", `${O}.job.json`], id: unit, keep: job.keep });
  writeFileSync(`${O}.pane`, `${where}\n`);
  console.log(`[orq agent] ${t} → ${where}${tui ? " (TUI)" : ""}`);
  return 0;
}

/** OpenCode (v2) plugin for -T: when the main session's run ends, its last answer goes to `orq agent --turn`. */
function opencodePlugin(O: string, hook: string[]): string {
  return `// orq agent -T end of turn (generated)
import { writeFileSync } from "fs"; import { spawn } from "child_process";
export default {
  id: "orq-turn",
  setup: async (ctx) => {
    const sub = new Set(), text = new Map(); // child sessions (subagents); answer text per session
    (async () => {
      for await (const e of ctx.event.subscribe()) {
        const d = e.data ?? {}, id = d.sessionID;
        if (e.type === "session.created" && d.parentID) sub.add(id);
        if (!id || sub.has(id)) continue;
        if (e.type === "session.execution.started") text.set(id, { msg: "", parts: [] });
        else if (e.type === "session.text.ended") {
          const t = text.get(id) ?? { msg: "", parts: [] };
          if (t.msg !== d.assistantMessageID) { t.msg = d.assistantMessageID; t.parts = []; } // only the last message
          t.parts[d.ordinal ?? t.parts.length] = d.text ?? ""; text.set(id, t);
        } else if (e.type.startsWith("session.execution.") && e.type !== "session.execution.started") {
          const f = ${JSON.stringify(`${O}.turn.md`)};
          writeFileSync(f, (text.get(id)?.parts ?? []).filter((x) => x !== undefined).join("\\n"));
          spawn(${JSON.stringify(hook[0])}, [...${JSON.stringify(hook.slice(1))}, id, f], { detached: true, stdio: "ignore" }).unref();
        }
      }
    })().catch(() => {});
    return {};
  },
};
`;
}

/** End of a turn on the agent's screen: answer, session and .done from the agent's own hook payload. Never fails the agent. */
function turn(file: string, kind: string, rest: string[]): number {
  try {
    const j = JSON.parse(readFileSync(file, "utf8")) as Job, O = j.prefix;
    let answer = "", sid: string | undefined;
    if (kind === "codex") {
      const e = JSON.parse(rest[rest.length - 1] ?? "{}") as Obj;
      if (e.type !== "agent-turn-complete") return 0;
      answer = String(e["last-assistant-message"] ?? ""); sid = e["thread-id"] as string | undefined;
    } else if (kind === "claude") {
      const e = JSON.parse(readFileSync(0, "utf8")) as Obj;
      if (e.stop_hook_active) return 0;
      sid = e.session_id as string | undefined;
      answer = String(e.last_assistant_message ?? "") || lastClaudeText(String(e.transcript_path ?? ""));
    } else if (kind === "opencode") {
      sid = rest[0];
      try { answer = readFileSync(rest[1], "utf8"); rmSync(rest[1], { force: true }); } catch { /* none */ }
    } else { sid = rest[0]; answer = readFileSync(0, "utf8"); }
    writeFileSync(`${O}.out.md`, answer);
    if (sid) writeFileSync(`${O}.id`, `${sid}\n`);
    const st = /\S/.test(answer) ? "ok" : "fail";
    writeAtomic(`${O}.done`, `status=${st} rc=0 at=${new Date().toISOString()} agent=${j.agent} mode=tui\n`);
    if (j.parent) notify(j.parent, `[HERDR-AGENT DONE] ${j.title} status=${st} rc=0 answer: ${O}.out.md`, true);
  } catch (e) { console.error(`orq agent --turn: ${(e as Error).message}`); }
  return 0;
}

/** The last text Claude wrote, from its transcript (older Stop hooks have no last_assistant_message). */
function lastClaudeText(transcript: string): string {
  let text = "";
  try {
    for (const l of readFileSync(transcript, "utf8").split(/\r?\n/)) {
      try {
        const e = JSON.parse(l) as { type?: string; message?: { content?: { type: string; text?: string }[] } };
        if (e.type !== "assistant") continue;
        const t = (e.message?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
        if (t) text = t;
      } catch { /* not JSON */ }
    }
  } catch { /* no transcript */ }
  return text;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Splits a stream into lines for `each`. */
function lines(s: NodeJS.ReadableStream | null, each: (l: string) => void): Promise<void> {
  return new Promise((res) => {
    if (!s) return res();
    let buf = "";
    s.setEncoding("utf8");
    s.on("data", (c: string) => { buf += c; let i; while ((i = buf.indexOf("\n")) >= 0) { each(buf.slice(0, i).replace(/\r$/, "")); buf = buf.slice(i + 1); } });
    s.on("end", () => { if (buf) each(buf); res(); });
    s.on("error", () => res());
  });
}

async function runJob(file: string): Promise<number> {
  const j = JSON.parse(readFileSync(file, "utf8")) as Job, O = j.prefix;
  writeFileSync(`${O}.pid`, String(process.pid));
  const stateF = join(stateDir(), "agents", `${j.unit}.json`);
  const at = new Date().toISOString();
  const state = (extra: Obj = {}) => { try { writeAtomic(stateF, JSON.stringify({ pid: process.pid, prefix: O, title: j.title, agent: j.agent, host: j.host, cap: j.cap, at, ...extra })); } catch { /* best effort */ } };
  state();
  const fmt = FORMATS[j.format] ?? FORMATS.text;
  let rc = 0, stdout = "", logText = "";
  const pre = (): boolean => {
    if (j.throwaway) {
      // Throwaway worktree: detached copy of HEAD with the repo's node_modules linked; removed at the end.
      if (spawnSync("git", ["-C", j.repo, "worktree", "add", "-q", "--detach", j.dir, "HEAD"], { stdio: "inherit" }).status !== 0) return false;
      try { symlinkSync(realpathSync(join(j.repo, "node_modules")), join(j.dir, "node_modules"), process.platform === "win32" ? "junction" : "dir"); } catch { /* none */ }
    }
    if (j.promptInDir) {
      copyFileSync(j.prompt, join(j.dir, PF));
      const ex = git(j.dir, "rev-parse", "--git-path", "info/exclude");
      if (ex) {
        const f = resolve(j.dir, ex);
        let cur = ""; try { cur = readFileSync(f, "utf8"); } catch { /* new */ }
        if (!cur.split(/\r?\n/).includes(PF)) { mkdirSync(dirname(f), { recursive: true }); appendFileSync(f, `${PF}\n`); }
      }
    }
    return true;
  };
  const post = () => {
    if (j.promptInDir) rmSync(join(j.dir, PF), { force: true });
    if (j.throwaway) dropWorktree(j.repo, j.dir);
  };
  if (j.tui) {
    // The agent's own screen: the terminal is its; answers come from the end-of-turn hook (`--turn`).
    let ended = false;
    const end = (code: number): string => {
      if (ended) return "fail";
      ended = true;
      post();
      // Closed before any turn ended (or mid follow-up): a failure, so `orq wait` doesn't hang.
      const ok = /\bstatus=ok\b/.test(existsSync(`${O}.done`) ? readFileSync(`${O}.done`, "utf8") : "");
      if (!existsSync(`${O}.done`)) {
        writeAtomic(`${O}.done`, `status=fail rc=${code} at=${new Date().toISOString()} agent=${j.agent} mode=tui\n`);
        if (j.parent) notify(j.parent, `[HERDR-AGENT DONE] ${j.title} status=fail rc=${code} answer: ${O}.out.md`, true);
      }
      rmSync(`${O}.pid`, { force: true });
      return ok ? "ok" : "fail";
    };
    if (!pre()) rc = 2;
    else {
      const env: NodeJS.ProcessEnv = { ...process.env, ...j.env };
      for (const k of j.unset) delete env[k];
      // Ctrl+C belongs to the agent (it reaches us too, as part of the terminal's foreground group). The screen going
      // away (tab or tmux server closed) still ends the agent and cleans up.
      let child: number | undefined;
      process.on("SIGINT", () => { /* the agent's */ });
      const gone = () => { if (child) killTree(child, false); end(129); process.exit(0); };
      for (const sig of ["SIGHUP", "SIGTERM"] as NodeJS.Signals[]) process.on(sig, gone);
      rc = await runCapped(j.argv[0], j.argv.slice(1), { cap: j.cap, swap: j.swap, mode: j.mode, unit: j.unit, cwd: j.dir, env, quote: true, tty: true,
        onSpawn: (c) => { child = c.pid; } });
    }
    const st = end(rc);
    state({ status: st, rc, end: new Date().toISOString() });
    console.log(`\n[${j.agent} (TUI) ${m("exited", "encerrado")}] ${m("answer", "resposta")}: ${O}.out.md`);
    if (!j.keep) { await sleep(j.closeAfter * 1000); closeOwnTab(j.host); }
    return 0;
  }
  const log = createWriteStream(`${O}.log`);
  if (!pre()) rc = 2;
  else {
    const env: NodeJS.ProcessEnv = { ...process.env, ...j.env };
    for (const k of j.unset) delete env[k];
    const kmode = resolveMode(j.mode, j.cap);
    let lastLine = "", lastAt = Date.now(), watch: NodeJS.Timeout | undefined, streams: Promise<unknown> = Promise.resolve();
    const onLine = (l: string, isOut: boolean) => {
      log.write(`${l}\n`); logText += `${l}\n`; lastLine = l; lastAt = Date.now();
      if (j.format === "text") { if (isOut) { stdout += `${l}\n`; process.stdout.write(`${l}\n`); } return; }
      const s = fmt.show(l);
      if (s) process.stdout.write(s);
    };
    try {
      rc = await runCapped(j.argv[0], j.argv.slice(1), {
        cap: j.cap, swap: j.swap, mode: j.mode, unit: j.unit, cwd: j.dir, env, quote: true,
        stdio: [j.stdin ? openSync(j.prompt, "r") : "ignore", "pipe", "pipe"],
        onSpawn: (c) => {
          streams = Promise.all([lines(c.stdout, (l) => onLine(l, true)), lines(c.stderr, (l) => onLine(l, false))]);
          // OpenCode sometimes doesn't exit after its final event (helpers hold the pipe): stop it after 30 s of quiet.
          if (fmt.idle) watch = setInterval(() => {
            if (!fmt.idle!(lastLine) || Date.now() - lastAt < 30_000) return;
            console.log(m("[orq agent] the agent finished but did not exit; stopping it", "[orq agent] o agente terminou mas não encerrou; parando"));
            clearInterval(watch);
            if (kmode === "kernel") spawnSync("systemctl", ["--user", "stop", `${j.unit}.scope`], { stdio: "ignore" });
            else if (c.pid) killTree(c.pid);
          }, 10_000);
        },
      });
    } finally { clearInterval(watch); }
    await Promise.race([streams, sleep(5000)]);
  }
  await new Promise((r) => log.end(r));
  post();
  const res = fmt.finish(logText, stdout);
  if (j.answer !== "file") writeFileSync(`${O}.out.md`, res.answer ?? "");
  const sid = j.fromLog ? new RegExp(j.fromLog, "m").exec(logText)?.[1] : res.session ?? j.session;
  if (sid) writeFileSync(`${O}.id`, `${sid}\n`);
  if (rc === 0 && res.rc) rc = res.rc;
  let answer = ""; try { answer = readFileSync(`${O}.out.md`, "utf8"); } catch { /* none */ }
  const st = rc === 0 && /\S/.test(answer) ? "ok" : "fail"; // whitespace-only answer = failure
  writeAtomic(`${O}.done`, `status=${st} rc=${rc} at=${new Date().toISOString()} agent=${j.agent}\n`);
  rmSync(`${O}.pid`, { force: true });
  state({ status: st, rc, end: new Date().toISOString() });
  if (j.parent) notify(j.parent, `[HERDR-AGENT DONE] ${j.title} status=${st} rc=${rc} answer: ${O}.out.md`);
  console.log(`\n[${j.agent} ${m("finished", "terminou")}: exit ${rc} status=${st}] ${m("answer", "resposta")}: ${O}.out.md`);
  if (j.host !== "plain" && !j.keep) { await sleep(j.closeAfter * 1000); closeOwnTab(j.host); }
  return 0;
}
