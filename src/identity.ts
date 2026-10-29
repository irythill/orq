// Who is logged in behind an agent or account name — only to tell that the login CHANGED. `orq block` records it, and a
// block made for one login is dropped once another is there (a new account has its own quota). Ids are short hashes of
// something stable per login (never the secret itself); undefined = cannot tell, so the block stays until its date.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { claudeAccounts } from "./accounts.js";
import { agyToken, minimaxKey } from "./quota.js";

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const json = (f: string): any => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return undefined; } };

/** Claude Code keeps the logged-in account in .claude.json: inside the config dir, or in ~ for the default ~/.claude. */
function claudeId(dir: string): string | undefined {
  const files = [join(dir, ".claude.json"), ...(resolve(dir) === join(homedir(), ".claude") ? [join(homedir(), ".claude.json")] : [])];
  for (const f of files) { const id = json(f)?.oauthAccount?.accountUuid; if (id) return String(id); }
  return undefined;
}

function copilotId(): string | undefined {
  const r = spawnSync("gh", ["api", "/user", "-q", ".id"], { encoding: "utf8", timeout: 15_000 });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : undefined;
}

/** The login id for a block name (an agent, or a Claude account), or undefined when it cannot be told. */
export function loginId(name: string): string | undefined {
  const accs = claudeAccounts();
  const acc = accs.find((a) => a.name === name);
  if (acc) return claudeId(acc.dir);
  if (name === "claude") { // the whole vendor: any account changing counts
    const ids = accs.map((a) => claudeId(a.dir));
    return ids.every(Boolean) ? hash(ids.sort().join(",")) : undefined;
  }
  if (name === "codex") {
    const t = json(join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "auth.json"))?.tokens;
    return t?.account_id ?? undefined;
  }
  if (name === "antigravity" || name === "agy") return agyToken()?.acct;
  if (name === "copilot") return copilotId();
  if (name === "opencode" || name === "minimax") { const k = minimaxKey(); return k ? hash(k) : undefined; }
  return undefined;
}
