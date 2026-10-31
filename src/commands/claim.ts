// orq claim — owner of each issue among conductors of the same workspace (port of herdr-claim).
// .orquestra/<ID>/owner = "pane=<conductor id> kind=<k> account=<a> at=<iso> name=<what the user calls it>". Another
// conductor is refused while the owner is alive; a dead owner is taken over automatically.
//   name: the herdr workspace's label (the sidebar name, e.g. "emp: orq-cms-dsgn"), else ORQ_CONDUCTOR_ID. It is the
//   last field and may hold spaces. `--from <name>` finds a conductor's issues by any part of that name (or its pane).
//   conductor id: HERDR_PANE_ID (alive = `herdr agent get` answers) or ORQ_CONDUCTOR_ID (alive = claimed or refreshed
//   in the last ORQ_CLAIM_TTL_H hours, default 24 — any conductor, any terminal); neither → <user>@<host>.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { basename, join, resolve } from "node:path";
import { writeAtomic } from "../fsutil.js";
import { m } from "../i18n.js";
import { acquire, release } from "../lock.js";

export const USAGE = `orq claim [-w <workspace>] <ID> | -f <ID> | -r <ID> | -l | --register   issue owner among conductors (exit 1 = someone else's)
orq claim [-w <workspace>] --from <name> [-f]   a conductor's issues by its name (part of it is enough); -f takes them all`;

const field = (text: string, k: string) => new RegExp(`${k}=(\\S+)`).exec(text)?.[1] ?? "";
export const nameOf = (text: string) => / name=(.*)$/m.exec(text)?.[1].trim() ?? "";

/** The label of the herdr workspace holding `pane` (the name the user sees), or "". */
export function herdrName(pane: string): string {
  const res = (args: string[]) => {
    const r = spawnSync("herdr", args, { encoding: "utf8", timeout: 5_000 });
    try { return JSON.parse(r.stdout).result; } catch { return undefined; }
  };
  const ws = (res(["pane", "list"])?.panes as { pane_id: string; workspace_id?: string }[] | undefined)
    ?.find((p) => p.pane_id === pane)?.workspace_id;
  if (!ws) return "";
  return (res(["workspace", "list"])?.workspaces as { workspace_id: string; label?: string }[] | undefined)
    ?.find((w) => w.workspace_id === ws)?.label ?? "";
}

/** A `herdr agent get` result → owner alive. A timeout (busy daemon, slow herdr) must not read as a dead owner:
 *  only a clean non-zero exit means "not found". */
export function ownerAlive(r: { status: number | null; error?: NodeJS.ErrnoException }): boolean {
  if (r.error?.code === "ETIMEDOUT") return true;
  return r.status === 0;
}

export function aliveOwner(text: string): boolean {
  const id = field(text, "pane"), kind = field(text, "kind") || "herdr";
  if (kind === "herdr") return ownerAlive(spawnSync("herdr", ["agent", "get", id], { stdio: "ignore", timeout: 15_000 }));
  const ttl = Number(process.env.ORQ_CLAIM_TTL_H ?? 24) * 3600_000;
  return Date.now() - Date.parse(field(text, "at")) < ttl;
}

export async function claim(argv: string[]): Promise<number> {
  let ws = process.cwd(), mode = "claim", id: string | undefined, from: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-w") ws = resolve(argv[++i]);
    else if (a === "--from") from = argv[++i];
    else if (a === "-f") mode = "force"; else if (a === "-r") mode = "release"; else if (a === "-l") mode = "list";
    else if (a === "--register") mode = "register";
    else if (!a.startsWith("-")) id = a; else { console.error(USAGE); return 2; }
  }
  const O = join(ws, ".orquestra");
  if (mode === "list") {
    for (const d of existsSync(O) ? readdirSync(O).filter((x) => !x.startsWith(".")) : []) {
      const f = join(O, d, "owner");
      if (!existsSync(f)) continue;
      const t = readFileSync(f, "utf8").trim();
      const alive = aliveOwner(t);
      // The herdr workspace's current label while the pane is alive; the name stored at claim time otherwise
      // (the user may have renamed the workspace since, or it may not be a herdr conductor at all).
      const n = (alive && (field(t, "kind") || "herdr") === "herdr" ? herdrName(field(t, "pane")) : "") || nameOf(t);
      console.log(`${d} ${n ? `"${n}" ` : ""}${t.replace(/ name=.*$/, "")} (${alive ? "alive" : "dead"})`);
    }
    return 0;
  }
  const kind = process.env.HERDR_PANE_ID ? "herdr" : "id";
  const me = process.env.HERDR_PANE_ID || process.env.ORQ_CONDUCTOR_ID || `${userInfo().username}@${hostname()}`;
  const myName = (kind === "herdr" ? herdrName(me) : "") || process.env.ORQ_CONDUCTOR_ID || "";
  const account = basename(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"));
  const ownerLine = () => `pane=${me} kind=${kind} account=${account} at=${new Date().toISOString()}`
    + (myName ? ` name=${myName}` : "") + "\n";
  if (mode === "register") {
    if (kind !== "herdr") return 0;
    const dir = join(O, ".conductors"); mkdirSync(dir, { recursive: true });
    writeAtomic(join(dir, me.replace(/[^A-Za-z0-9_-]/g, "_")),
      `pane=${me} kind=herdr account=${account} at=${new Date().toISOString()} name=${myName || me}\n`);
    return 0;
  }
  if (from !== undefined) {
    if (!from) { console.error(USAGE); return 2; }
    const q = from.toLowerCase();
    const hits = (existsSync(O) ? readdirSync(O).filter((x) => !x.startsWith(".")) : []).flatMap((d) => {
      const f = join(O, d, "owner");
      if (!existsSync(f)) return [];
      const t = readFileSync(f, "utf8").trim(), pane = field(t, "pane"), alive = aliveOwner(t);
      const name = (alive && (field(t, "kind") || "herdr") === "herdr" ? herdrName(pane) : "") || nameOf(t);
      return pane !== me && (name.toLowerCase().includes(q) || pane.toLowerCase().includes(q))
        ? [{ id: d, f, pane, name, alive }] : [];
    });
    if (!hits.length) { console.log(m(`no issue owned by a conductor matching "${from}"`, `nenhuma issue de um conductor que bata com "${from}"`)); return 1; }
    const owners = [...new Set(hits.map((h) => h.pane))];
    if (owners.length > 1) {
      console.log(m(`"${from}" matches more than one conductor; be more specific:`, `"${from}" bate com mais de um conductor; seja mais específico:`));
      for (const o of owners) console.log(`  ${hits.find((h) => h.pane === o)!.name || o} (${o})`);
      return 3;
    }
    for (const h of hits) console.log(`${h.id} "${h.name || h.pane}" (${h.alive ? "alive" : "dead"})`);
    if (mode !== "force") return 0;
    await acquire("claims", process.pid, `claim --from ${from}`);
    try { for (const h of hits) writeAtomic(h.f, ownerLine()); } finally { release("claims", process.pid); }
    console.log(m(`taken over: ${hits.map((h) => h.id).join(" ")} (now ${myName || me})`, `assumidas: ${hits.map((h) => h.id).join(" ")} (agora ${myName || me})`));
    return 0;
  }
  if (!id) { console.error(m("give the issue ID", "informe o ID da issue")); return 2; }
  mkdirSync(join(O, id), { recursive: true });
  const F = join(O, id, "owner");
  await acquire("claims", process.pid, `claim ${id}`); // one claim at a time
  try {
    const cur = existsSync(F) ? readFileSync(F, "utf8").trim() : "";
    const owner = field(cur, "pane");
    if (mode === "release") {
      if (cur && owner !== me) { console.log(m(`${id} belongs to ${owner}; not releasing it`, `${id} é de ${owner}; não libero`)); return 1; }
      rmSync(F, { force: true }); console.log(m(`${id} released`, `${id} liberada`)); return 0;
    }
    if (cur && mode === "claim" && owner !== me) {
      if (aliveOwner(cur)) {
        console.log(m(`${id} is owned by another conductor (${cur}). Do not run it; tell the user (-f only with their OK).`,
          `${id} já está com outro conductor (${cur}). Não execute; avise o usuário (-f só com o OK dele).`));
        return 1;
      }
      console.log(m(`previous owner (${owner}) is gone; taking over ${id}`, `o dono anterior (${owner}) não existe mais; assumindo ${id}`));
    }
    writeAtomic(F, ownerLine());
    console.log(cur && owner === me && mode === "claim" ? m(`${id} is already yours`, `${id} já é sua`) : m(`${id} is yours (${me})`, `${id} é sua (${me})`));
    return 0;
  } finally { release("claims", process.pid); }
}
