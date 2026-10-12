// Claude accounts (one CLAUDE_CONFIG_DIR folder per account), from the claude-accounts file: lines "<name> <folder>".
// File: $CLAUDE_ACCOUNTS_FILE, else claude-accounts next to orq's config folder (~/.config/claude-accounts on
// Linux/macOS, %APPDATA%\claude-accounts on Windows). No file → one account, "claude", in ~/.claude.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { configDir, expand } from "./paths.js";

export interface Account { name: string; dir: string }

export const accountsFile = () => process.env.CLAUDE_ACCOUNTS_FILE ?? join(dirname(configDir()), "claude-accounts");

export function claudeAccounts(): Account[] {
  const f = accountsFile();
  if (!existsSync(f)) return [{ name: "claude", dir: process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude") }];
  const seen = new Set<string>();
  return readFileSync(f, "utf8").split(/\r?\n/)
    .map((l) => l.replace(/#.*/, "").trim().split(/\s+/))
    .filter((p) => p.length >= 2 && !seen.has(p[1]) && seen.add(p[1]))
    .map(([name, dir]) => ({ name, dir: expand(dir) }));
}
