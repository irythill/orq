// TerminalHost — where a child agent's live output goes. machine.terminal (or $ORQ_TERMINAL): auto | herdr | tmux | plain.
//   herdr  a tab in the herdr workspace named after the group (created if missing), without stealing focus (herdr-tab)
//   tmux   a background window in the current tmux session
//   plain  a detached background process; its screen output goes to <state dir>/agents/<run>.log
// auto = herdr inside a herdr pane (HERDR_PANE_ID), else tmux inside tmux (TMUX), else plain.
// The agent's own screen (-T) needs herdr or tmux; follow-ups are typed into it while it is open.
import { spawn, spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import type { Obj } from "./config.js";
import { m } from "./i18n.js";
import { stateDir } from "./paths.js";

export type Host = "herdr" | "tmux" | "plain";

export function detectHost(cfg: Obj): Host {
  const want = String(process.env.ORQ_TERMINAL || ((cfg.machine ?? {}) as Obj).terminal || "auto");
  if (want === "herdr" || want === "tmux" || want === "plain") return want;
  if (want !== "auto") throw new Error(m(`unknown terminal: ${want} (auto | herdr | tmux | plain)`, `terminal desconhecido: ${want} (auto | herdr | tmux | plain)`));
  if (process.env.HERDR_PANE_ID && spawnSync("herdr", ["status", "server"], { stdio: "ignore" }).status === 0) return "herdr";
  if (process.env.TMUX) return "tmux";
  return "plain";
}

/** POSIX shell quoting (herdr and tmux type the command into a shell). */
export const shq = (s: string) => /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;

function herdr(args: string[]): Obj {
  const r = spawnSync("herdr", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`herdr ${args.slice(0, 2).join(" ")}: ${(r.stderr || r.stdout || "").trim()}`);
  try { return JSON.parse(r.stdout || "{}") as Obj; } catch { return {}; }
}

export interface Launch { group: string; title: string; dir: string; argv: string[]; id: string; keep: boolean }

/** Start `argv` on the host; returns where it runs (pane id, tmux pane, or pid:<n>). */
export function launch(host: Host, l: Launch): string {
  const line = l.argv.map(shq).join(" ");
  if (host === "herdr") {
    if (spawnSync("herdr", ["status", "server"], { stdio: "ignore" }).status !== 0)
      throw new Error(m("the herdr server is not running (systemctl --user start herdr)", "o servidor do herdr não está rodando (systemctl --user start herdr)"));
    const ws = ((herdr(["workspace", "list"]).result as Obj)?.workspaces ?? []) as Obj[];
    const w = ws.find((x) => x.label === l.group)?.workspace_id as string | undefined;
    let r: Obj;
    if (!w) {
      r = herdr(["workspace", "create", "--cwd", l.dir, "--label", l.group, "--no-focus"]).result as Obj;
      spawnSync("herdr", ["tab", "rename", String((r?.tab as Obj)?.tab_id), l.title], { stdio: "ignore" });
    } else r = herdr(["tab", "create", "--workspace", w, "--cwd", l.dir, "--label", l.title, "--no-focus"]).result as Obj;
    const pane = (r?.root_pane as Obj)?.pane_id as string | undefined;
    if (!pane) throw new Error(m("herdr returned no pane", "o herdr não devolveu um pane"));
    spawnSync("herdr", ["pane", "rename", pane, l.title], { stdio: "ignore" });
    herdr(["pane", "run", pane, line]);
    return pane;
  }
  if (host === "tmux") {
    const cmd = l.keep ? `${line}; exec "\${SHELL:-sh}"` : line;
    const r = spawnSync("tmux", ["new-window", "-d", "-P", "-F", "#{pane_id}", "-n", l.title, "-c", l.dir, cmd], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`tmux new-window: ${(r.stderr || "").trim()}`);
    return `tmux:${r.stdout.trim()}`;
  }
  mkdirSync(join(stateDir(), "agents"), { recursive: true });
  const fd = openSync(join(stateDir(), "agents", `${l.id}.log`), "a");
  const c = spawn(l.argv[0], l.argv.slice(1), { cwd: l.dir, detached: true, stdio: ["ignore", fd, fd], windowsHide: true });
  c.unref();
  closeSync(fd);
  return `pid:${c.pid}`;
}

/** Is the screen `launch` returned still open? (herdr pane or tmux pane; a background pid has no screen) */
export function screenOpen(where: string): boolean {
  if (where.startsWith("tmux:")) return spawnSync("tmux", ["display-message", "-p", "-t", where.slice(5), "#{pane_id}"], { stdio: "ignore" }).status === 0;
  if (!where || where.startsWith("pid:")) return false;
  return spawnSync("herdr", ["pane", "get", where], { stdio: "ignore" }).status === 0;
}

/** Type `text` into an open screen and submit it (a follow-up to an agent's own TUI). */
export function typeInto(where: string, text: string): void {
  if (where.startsWith("tmux:")) {
    // A bracketed paste keeps a multi-line prompt as one message; then Enter sends it.
    const t = where.slice(5), run = (a: string[], input?: string) => {
      const r = spawnSync("tmux", a, { input, encoding: "utf8" });
      if (r.status !== 0) throw new Error(`tmux ${a[0]}: ${(r.stderr || "").trim()}`);
    };
    run(["load-buffer", "-b", "orq-prompt", "-"], text);
    run(["paste-buffer", "-p", "-d", "-b", "orq-prompt", "-t", t]);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300); // let the TUI take the paste before Enter
    run(["send-keys", "-t", t, "Enter"]);
    return;
  }
  herdr(["agent", "prompt", where, text]);
}

/** After a run: close our own herdr tab (the result stays in the files). tmux windows close when the runner exits. */
export function closeOwnTab(host: Host): void {
  const p = process.env.HERDR_PANE_ID;
  if (host !== "herdr" || !p) return;
  try {
    const tab = ((herdr(["pane", "get", p]).result as Obj)?.pane as Obj)?.tab_id as string | undefined;
    if (tab) spawnSync("herdr", ["tab", "close", tab], { stdio: "ignore" });
  } catch { /* already gone */ }
}
