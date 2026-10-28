// What a fresh `npm i -g @irythill/orq` still needs, done by `orq setup` on any OS (install.sh is a Linux extra):
//   skills      orq's skills (skills/*/SKILL.md, shipped in the package) linked into ~/.claude/skills and each Claude
//               account's skills folder — a junction on Windows (no admin rights), a copy if linking fails. A real
//               folder, or a link to another live copy (a clone of the repo), is never touched.
//   workspace   <folder>/.orquestra, .worktrees, CLAUDE.md from the template (only if missing) and the /issue playbook
//               in the conductor's format (orq instructions)
//   environment what orq found: git, terminal host, memory cap, keyring, the shell's completion line
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { claudeAccounts } from "./accounts.js";
import { type Obj } from "./config.js";
import { writeAtomic } from "./fsutil.js";
import { m } from "./i18n.js";
import { backend } from "./keyring.js";
import { hasKernelCap } from "./process.js";
import { detectHost } from "./terminal.js";

export const PKG = fileURLToPath(new URL("..", import.meta.url));
const SKILLS = join(PKG, "skills");

const real = (p: string) => { try { return realpathSync(p); } catch { return undefined; } };

/** Skill folders of every Claude account (~/.claude always, like install.sh). */
export function skillRoots(): string[] {
  return [...new Set([join(homedir(), ".claude"), ...claudeAccounts().map((a) => a.dir)].map((d) => join(d, "skills")))];
}

/** Link each of orq's skills into each root; one line per skill and root. */
export function installSkills(roots = skillRoots()): string[] {
  const out: string[] = [];
  const skills = readdirSync(SKILLS).filter((s) => existsSync(join(SKILLS, s, "SKILL.md")));
  for (const root of roots) for (const s of skills) {
    const src = join(SKILLS, s), dst = join(root, s);
    let st;
    try { st = lstatSync(dst); } catch { /* missing */ }
    if (st && !st.isSymbolicLink()) {
      // A copy made by an earlier `orq setup` (no links on this system) is refreshed; anything else is the user's.
      if (existsSync(join(dst, ".orq-copy"))) { rmSync(dst, { recursive: true, force: true }); st = undefined; }
      else { out.push(`  ${m("skip", "pulei")}    ${dst} ${m("(a real folder, not a link: move it away to install)", "(uma pasta de verdade, não um link: tire-a do caminho para instalar)")}`); continue; }
    }
    if (st) {
      const to = real(dst);
      if (to === real(src)) { out.push(`  ok      ${dst}`); continue; }
      if (to && existsSync(join(to, "SKILL.md"))) { out.push(`  ${m("keep", "mantive")}  ${dst} → ${readlinkSync(dst)}`); continue; }
      rmSync(dst, { force: true }); // dangling (e.g. an old node version's global folder)
    }
    mkdirSync(root, { recursive: true });
    try {
      symlinkSync(src, dst, process.platform === "win32" ? "junction" : "dir");
      out.push(`  link    ${dst} → ${src}`);
    } catch {
      cpSync(src, dst, { recursive: true });
      writeAtomic(join(dst, ".orq-copy"), m("copied by orq setup; refreshed on every run\n", "copiado pelo orq setup; atualizado a cada execução\n"));
      out.push(`  ${m("copy", "cópia")}    ${dst}`);
    }
  }
  return out;
}

/** Prepare a conductor's workspace folder; `fmt` = claude (SKILL.md) | agents (AGENTS.md). */
export function prepareWorkspace(dir: string, fmt: "claude" | "agents", name = basename(resolve(dir))): string[] {
  const ws = resolve(dir), out: string[] = [];
  for (const d of [".orquestra", ".worktrees"]) mkdirSync(join(ws, d), { recursive: true });
  const map = join(ws, "CLAUDE.md");
  if (!existsSync(map)) {
    const t = readFileSync(join(PKG, "templates", "workspace.CLAUDE.md"), "utf8");
    writeAtomic(map, t.split("{{WORKSPACE}}").join(ws).split("{{NAME}}").join(name));
    out.push(m(`  created ${map} — fill in repos, group, base branch, Plane and issue standard`,
      `  criado ${map} — preencha repos, grupo, branch base, Plane e padrão de issue`));
  } else out.push(m(`  ok      ${map} (kept)`, `  ok      ${map} (mantido)`));
  const r = spawnSync(process.execPath, [join(PKG, "dist", "cli.js"), "instructions", fmt, "-w", ws], { encoding: "utf8" });
  out.push(`  ${(r.stdout || r.stderr).trim()}`);
  return out;
}

const SHELLS = ["bash", "zsh", "fish", "powershell"] as const;
export type Shell = typeof SHELLS[number];

/** The user's shell, from $SHELL (PowerShell on Windows without one). */
export function userShell(): Shell | undefined {
  const s = basename(process.env.SHELL ?? "").replace(/\.exe$/i, "");
  if (s === "pwsh") return "powershell";
  if ((SHELLS as readonly string[]).includes(s)) return s as Shell;
  return process.platform === "win32" ? "powershell" : undefined;
}

/** The line that turns completion on, per shell. */
export const completionLine = (s: Shell) => ({
  bash: `echo 'eval "$(orq completion bash)"' >> ~/.bashrc`,
  zsh: `echo 'eval "$(orq completion zsh)"' >> ~/.zshrc   # ${m("after compinit", "depois do compinit")}`,
  fish: "orq completion fish > ~/.config/fish/completions/orq.fish",
  powershell: "Add-Content $PROFILE 'orq completion powershell | Out-String | Invoke-Expression'",
}[s]);

/** What orq found on this machine, one line each (required things first). */
export function environment(cfg: Obj): string[] {
  const has = (c: string, a = ["--version"]) => spawnSync(c, a, { stdio: "ignore", timeout: 10_000 }).status === 0;
  const row = (k: string, v: string) => `  ${k.padEnd(10)} ${v}`;
  let host: string;
  try { host = detectHost(cfg); } catch (e) { host = (e as Error).message; }
  const mode = String(((cfg.machine ?? {}) as Obj).mem_enforce ?? "auto");
  const kb = backend(), sh = userShell();
  return [
    row("node", process.version),
    row("git", has("git") ? "ok" : m("MISSING — required (worktrees, diffs, tests): install git", "FALTANDO — obrigatório (worktrees, diffs, testes): instale o git")),
    row("terminal", `${host} ${m("(children: herdr tab, tmux window or background; machine.terminal)", "(filhos: aba do herdr, janela do tmux ou segundo plano; machine.terminal)")}`),
    row(m("memory", "memória"), mode === "off" ? "off" : mode === "watchdog" || !hasKernelCap()
      ? m("watchdog (samples the process tree; machine.mem_enforce)", "vigia (amostra a árvore de processos; machine.mem_enforce)")
      : m("kernel (systemd scope)", "kernel (scope do systemd)")),
    row("keyring", kb === "native" ? "ok" : kb === "cli" ? m("OS command (native module did not load)", "comando do SO (o módulo nativo não carregou)")
      : m("none — Antigravity/macOS Claude quota shows ?", "nenhum — a cota do Antigravity/Claude no macOS mostra ?")),
    row("shell", sh ? `${sh} — ${m("completion", "autocompletar")}: ${completionLine(sh)}` : m("unknown — orq completion bash|zsh|fish|powershell", "desconhecido — orq completion bash|zsh|fish|powershell")),
  ];
}
