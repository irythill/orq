// orq deps — the worktree's node_modules is a LINK to the main repo's (never install in a worktree: ~1 GB and tens of
// thousands of files per copy). If the main repo's deps are behind origin/<base> and it is clean and on <base>:
// fast-forward + ONE install there. One install per repo at a time (orq lock); the second waits, then only links.
// Windows: a directory junction (no admin rights needed); elsewhere a symlink.
//   orq deps -r <main repo> -b <base> -w <worktree>     exit 0 = linked · 3 = main repo dirty or not on <base>: ASK THE USER
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { m } from "../i18n.js";
import { acquire, release } from "../lock.js";

export const USAGE = "orq deps -r <main repo> -b <base> -w <worktree>   link node_modules into a worktree (exit 3 = ask the user)";

const git = (cwd: string, ...a: string[]) => spawnSync("git", ["-C", cwd, ...a], { encoding: "utf8" });

export function installer(repo: string): string[] {
  const has = (f: string) => existsSync(join(repo, f));
  if (has("bun.lock") || has("bun.lockb")) return ["bun", "install"];
  if (has("pnpm-lock.yaml")) return ["pnpm", "install"];
  if (has("yarn.lock")) return ["yarn", "install"];
  return ["npm", "install"];
}

export function link(target: string, at: string): void {
  try { if (lstatSync(at)) rmSync(at, { recursive: true, force: true }); } catch { /* not there */ }
  symlinkSync(target, at, process.platform === "win32" ? "junction" : "dir");
}

export async function deps(argv: string[]): Promise<number> {
  let R = "", B = "", WT = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-r") R = resolve(argv[++i]); else if (argv[i] === "-b") B = argv[++i];
    else if (argv[i] === "-w") WT = resolve(argv[++i]); else { console.error(USAGE); return 2; }
  }
  if (!R || !B || !WT) { console.error(USAGE); return 2; }
  const gd = git(R, "rev-parse", "--path-format=absolute", "--git-common-dir").stdout.trim();
  const ex = join(gd, "info", "exclude");
  if (!(existsSync(ex) ? readFileSync(ex, "utf8") : "").split(/\r?\n/).includes("node_modules")) appendFileSync(ex, "node_modules\n");
  const name = `deps-${basename(R)}`;
  await acquire(name, process.pid, `deps ${basename(R)}`, 1, () => console.log(m(
    `another conductor is installing dependencies in ${basename(R)}; waiting...`,
    `outro conductor está instalando dependências em ${basename(R)}; aguardando...`)));
  try {
    git(R, "fetch", "-q", "origin", B);
    const locks = ["package.json", "bun.lock", "bun.lockb", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"]
      .filter((f) => existsSync(join(R, f)));
    const stale = git(R, "diff", "--quiet", "HEAD", `origin/${B}`, "--", ...locks).status !== 0;
    if (stale || !existsSync(join(R, "node_modules"))) {
      const br = git(R, "branch", "--show-current").stdout.trim();
      if (br !== B || git(R, "status", "--porcelain", "--untracked-files=no").stdout.trim()) {
        console.log(m(`deps are stale, but ${basename(R)} is on '${br}' or has changes: not touching it. Ask the user.`,
          `deps defasadas, mas ${basename(R)} está em '${br}' ou com alterações: não mexo. Pergunte ao usuário.`));
        return 3;
      }
      git(R, "merge", "-q", "--ff-only", `origin/${B}`);
      const cmd = installer(R);
      console.log(`${m("installing dependencies in", "instalando dependências em")} ${basename(R)} (${cmd.join(" ")})...`);
      const r = spawnSync(cmd[0], cmd.slice(1), { cwd: R, stdio: "ignore", shell: process.platform === "win32" });
      if (r.status !== 0) { console.error(`${cmd.join(" ")}: exit ${r.status}`); return 1; }
    }
    link(join(R, "node_modules"), join(WT, "node_modules"));
    console.log(`ok: ${join(WT, "node_modules")} -> ${join(R, "node_modules")}`);
    return 0;
  } finally { release(name, process.pid); }
}
