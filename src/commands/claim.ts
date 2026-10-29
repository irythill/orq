// orq claim — owner of each issue among conductors of the same workspace (port of herdr-claim).
// .orquestra/<ID>/owner = "pane=<conductor id> account=<a> at=<iso>". Another conductor is refused while the owner is
// alive; a dead owner is taken over automatically.
//   conductor id: HERDR_PANE_ID (alive = `herdr agent get` answers) or ORQ_CONDUCTOR_ID (alive = claimed or refreshed
//   in the last ORQ_CLAIM_TTL_H hours, default 24 — any conductor, any terminal); neither → <user>@<host>.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { basename, join, resolve } from "node:path";
import { writeAtomic } from "../fsutil.js";
import { m } from "../i18n.js";
import { acquire, release } from "../lock.js";

export const USAGE = `orq claim [-w <workspace>] <ID> | -f <ID> | -r <ID> | -l   issue owner among conductors (exit 1 = someone else's)`;

const field = (text: string, k: string) => new RegExp(`${k}=(\\S+)`).exec(text)?.[1] ?? "";

export function aliveOwner(text: string): boolean {
  const id = field(text, "pane"), kind = field(text, "kind") || "herdr";
  if (kind === "herdr") return spawnSync("herdr", ["agent", "get", id], { stdio: "ignore" }).status === 0;
  const ttl = Number(process.env.ORQ_CLAIM_TTL_H ?? 24) * 3600_000;
  return Date.now() - Date.parse(field(text, "at")) < ttl;
}

export async function claim(argv: string[]): Promise<number> {
  let ws = process.cwd(), mode = "claim", id: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-w") ws = resolve(argv[++i]);
    else if (a === "-f") mode = "force"; else if (a === "-r") mode = "release"; else if (a === "-l") mode = "list";
    else if (!a.startsWith("-")) id = a; else { console.error(USAGE); return 2; }
  }
  const O = join(ws, ".orquestra");
  if (mode === "list") {
    for (const d of existsSync(O) ? readdirSync(O) : []) {
      const f = join(O, d, "owner");
      if (!existsSync(f)) continue;
      const t = readFileSync(f, "utf8").trim();
      console.log(`${d} ${t} (${aliveOwner(t) ? "alive" : "dead"})`);
    }
    return 0;
  }
  if (!id) { console.error(m("give the issue ID", "informe o ID da issue")); return 2; }
  const kind = process.env.HERDR_PANE_ID ? "herdr" : "id";
  const me = process.env.HERDR_PANE_ID || process.env.ORQ_CONDUCTOR_ID || `${userInfo().username}@${hostname()}`;
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
    const account = basename(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"));
    writeAtomic(F, `pane=${me} kind=${kind} account=${account} at=${new Date().toISOString()}\n`);
    console.log(cur && owner === me && mode === "claim" ? m(`${id} is already yours`, `${id} já é sua`) : m(`${id} is yours (${me})`, `${id} é sua (${me})`));
    return 0;
  } finally { release("claims", process.pid); }
}
