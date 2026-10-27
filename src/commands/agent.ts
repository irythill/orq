// orq agent — run a headless agent as a child of the conductor (port of herdr-agent), on its AgentDef (src/agents.ts),
// under its memory cap (src/process.ts), in a herdr tab, a tmux window or the background (src/terminal.ts).
// Writes <prefix>.out.md (final answer) / .log / .id (session, for -R) / .pane / .done ("status=ok|fail rc=N at=...").
// Returns at once; `orq wait <prefix>` blocks until .done. A conductor in herdr (HERDR_PANE_ID) also gets ONE line
// "[HERDR-AGENT DONE] <title> status=... answer: <prefix>.out.md" typed into its pane by herdr-notify.
// The launcher writes <prefix>.job.json and starts `orq agent --run <job>` on the terminal host; that runner does the rest.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, copyFileSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeAccounts } from "../accounts.js";
import { agentDef, ALIASES, expandString, expandTemplate, FORMATS, type Vars } from "../agents.js";
import { loadConfig, type Obj } from "../config.js";
import { writeAtomic } from "../fsutil.js";
import { m } from "../i18n.js";
import { stateDir } from "../paths.js";
import { killTree, type MemMode, parseSize, resolveMode, runCapped } from "../process.js";
import { closeOwnTab, detectHost, type Host, launch, shq } from "../terminal.js";

export const USAGE = "orq agent -a <agent> -t <title> -d <dir> -o <prefix> [-g group] [-m model] [-e effort] [-c account] [-i file]... [-b base] [-r] [-R session] -- <prompt.md>   run a child agent";

const CLI = fileURLToPath(new URL("../cli.js", import.meta.url));
const PF = ".herdr-agent-prompt.md"; // prompt_in_dir file name (kept from herdr-agent)

interface Job {
  agent: string; title: string; repo: string; dir: string; prefix: string; prompt: string; argv: string[];
  env: Record<string, string>; unset: string[]; stdin: boolean; format: string; answer: string;
  session?: string; fromLog?: string; parent: string; host: Host; unit: string; cap?: number; swap?: number;
  mode: MemMode; throwaway: boolean; promptInDir: boolean; closeAfter: number; keep: boolean;
}

const git = (dir: string, ...a: string[]) => {
  const r = spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : undefined;
};

export async function agent(argv: string[]): Promise<number> {
  if (argv[0] === "--run") return runJob(argv[1]);
  let a = process.env.AGENT || "codex", g = "", t = "", d = "", o = "", model = "", effort = "", acc = "", resume = "", base = "";
  let ro = false, prompt: string | undefined;
  const inc: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i], v = () => argv[++i] ?? "";
    if (x === "--") { prompt = argv[i + 1]; break; }
    if (x === "-a") a = v(); else if (x === "-g") g = v(); else if (x === "-t") t = v(); else if (x === "-d") d = v();
    else if (x === "-o") o = v(); else if (x === "-m") model = v(); else if (x === "-e") effort = v();
    else if (x === "-c") acc = v(); else if (x === "-i") inc.push(resolve(v())); else if (x === "-R") resume = v();
    else if (x === "-b") base = v(); else if (x === "-p") v(); else if (x === "-r") ro = true;
    else if (x === "-T") {
      console.error(m("-T (the agent's own TUI) only exists in herdr: use herdr-agent -T", "-T (a TUI do próprio agente) só existe no herdr: use herdr-agent -T"));
      return 2;
    } else if (!x.startsWith("-") && prompt === undefined) prompt = x;
    else { console.error(USAGE); return 2; }
  }
  if (!prompt) { console.error(m("give the prompt file", "informe o arquivo de prompt")); return 2; }
  for (const [f, val] of [["t", t], ["d", d], ["o", o]]) if (!val) { console.error(`${m("missing", "faltou")} -${f}`); return 2; }
  a = ALIASES[a] ?? a;
  const { cfg } = loadConfig();
  const def = agentDef(cfg, a);
  if (!ro && def.write === false) { console.error(m(`${a} only runs read only (-r)`, `o ${a} só roda em modo leitura (-r)`)); return 2; }
  if (acc && !def.accounts) { console.error(m(`-c only applies to agents with Claude accounts (claude)`, `-c só vale para agentes com contas Claude (claude)`)); return 2; }
  if (resume && !def.resume) { console.error(m(`${a} has no resume template (agents.${a}.resume)`, `${a} não tem template de resume (agents.${a}.resume)`)); return 2; }
  const repo = resolve(d), O = resolve(o);
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
  // Follow-ups (-R) reuse the prefix: remove the previous round's result so ".done exists" means "this one finished".
  for (const s of [".done", ".out.md", ".pid"]) rmSync(O + s, { force: true });
  if (inc.length) {
    let text = readFileSync(P, "utf8");
    for (const f of inc) text += `\n--- ${basename(f)} ---\n${readFileSync(f, "utf8")}\n--- end of ${basename(f)} ---\n`;
    writeFileSync(`${O}.prompt.md`, text); P = `${O}.prompt.md`;
  }
  const throwaway = Boolean(def.throwaway && ro && !resume);
  const dir = throwaway ? `${repo}.review-${process.pid}` : repo;
  const gd = git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir");
  const wg = git(repo, "rev-parse", "--absolute-git-dir");
  const roots = gd && wg ? [...new Set([wg, `${gd}/objects`, `${gd}/refs`, `${gd}/logs`])].sort() : [];
  let nm = "";
  try { nm = realpathSync(join(repo, "node_modules")); } catch { /* none */ }
  const session = resume || (def.session === "uuid" ? randomUUID() : "");
  const vars: Vars = {
    prompt: P, prompt_text: def.run.includes("{prompt_text}") || def.resume?.includes("{prompt_text}") ? readFileSync(P, "utf8") : "",
    prompt_hint: `Read the file ${PF} (in the current folder, with your file-reading tool): it holds your complete instructions for this task. Follow them. ${PF} is not part of the code: don't review or edit it.`,
    out: `${O}.out.md`, dir, repo, title: t, model: model === "auto" ? "" : model, effort, session,
    gitdir: gd ?? "", gitroots: roots, gitroots_json: JSON.stringify(roots), mode: [],
    opencode_config: JSON.stringify({
      mcp: { plane: { enabled: false }, shadcn: { enabled: false }, "linear-server": { enabled: false } },
      permission: { bash: "allow", question: "deny", webfetch: "deny",
        external_directory: { "*": "deny", ...(gd ? { [`${gd}/*`]: "allow" } : {}), "/tmp/*": "allow", ...(nm ? { [`${nm}/*`]: "allow" } : {}) },
        edit: ro ? "deny" : "allow" },
    }),
  };
  vars.mode = expandTemplate((ro ? def.readonly : def.write) || "", vars);
  const tpl = resume ? def.resume! : def.run;
  const cmd = expandTemplate(tpl, vars);
  if (!tpl.includes("{mode}") && !resume) cmd.push(...(vars.mode as string[]));
  const env: Record<string, string> = {};
  for (const [k, val] of Object.entries(def.env ?? {})) env[k] = expandString(String(val), vars);
  if (acc) {
    const ac = claudeAccounts().find((x) => x.name === acc);
    if (!ac) { console.error(m(`account '${acc}' does not exist`, `a conta '${acc}' não existe`)); return 2; }
    env.CLAUDE_CONFIG_DIR = ac.dir;
  }
  const mach = (cfg.machine ?? {}) as Obj;
  const closeAfter = Number(process.env.HERDR_CLOSE_DELAY ?? mach.close_tab_after ?? 20);
  const host = detectHost(cfg);
  const unit = `herdr-agent-${Math.floor(Date.now() / 1000)}-${process.pid}`; // herdr-board lists herdr-agent-* scopes
  const job: Job = {
    agent: a, title: t, repo, dir, prefix: O, prompt: P, argv: cmd, env, unset: def.unset_env ?? [], stdin: Boolean(def.stdin),
    format: def.format ?? "text", answer: def.answer ?? "stdout", session: session || undefined,
    fromLog: typeof def.session === "object" ? def.session.from_log : undefined, parent: process.env.HERDR_PANE_ID ?? "",
    host, unit, cap: parseSize(def.mem_max ?? (mach.agent_mem_max as string | undefined) ?? "off"),
    swap: parseSize(mach.agent_swap_max as string | undefined), mode: (mach.mem_enforce as MemMode | undefined) ?? "auto",
    throwaway, promptInDir: Boolean(def.prompt_in_dir), closeAfter,
    keep: process.env.HERDR_KEEP_TAB === "1" || process.env.ORQ_KEEP_TAB === "1" || closeAfter <= 0,
  };
  writeAtomic(`${O}.job.json`, JSON.stringify(job, null, 1));
  // Readable copy of the command (also what orq stats and herdr-board read).
  writeFileSync(`${O}.run.sh`, `#!/usr/bin/env bash\n# orq agent (generated; the run itself is \`orq agent --run ${O}.job.json\`) --unit=${unit} \n` +
    `cd ${shq(dir)}\n${Object.entries(env).map(([k, val]) => `${k}=${shq(val)} `).join("")}${cmd.map(shq).join(" ")}${job.stdin ? ` < ${shq(P)}` : ""}\n`);
  const where = launch(host, { group: g || "agents", title: t, dir: repo, argv: [process.execPath, CLI, "agent", "--run", `${O}.job.json`], id: unit, keep: job.keep });
  writeFileSync(`${O}.pane`, `${where}\n`);
  console.log(`[orq agent] ${t} → ${where}`);
  return 0;
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
  const log = createWriteStream(`${O}.log`);
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
    if (j.throwaway) spawnSync("git", ["-C", j.repo, "worktree", "remove", "--force", j.dir], { stdio: "ignore" });
  };
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

/** The conductor is a herdr pane: type the line into it (herdr-notify waits for it to leave a dialog). */
function notify(pane: string, line: string): void {
  const local = join(dirname(CLI), "..", "setup", "herdr-notify");
  spawnSync(existsSync(local) ? local : "herdr-notify", [pane, line], { stdio: "inherit" });
}
