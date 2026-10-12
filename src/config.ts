// The orq configuration, merged in layers (each overrides the previous, key by key):
//   1. built-in defaults (DEFAULTS, below)
//   2. personal:  $ORQ_CONFIG, or <config dir>/config.toml | config.json
//   3. workspace: <workspace>/.orq/workspace.toml | workspace.json  (searched from -w or the current folder, upwards)
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import { configDir, expand } from "./paths.js";
import { m } from "./i18n.js";

export type Obj = Record<string, unknown>;

export const DEFAULTS: Obj = {
  machine: {
    agent_mem_max: "4G", // memory cap per agent
    agent_swap_max: "1G",
    test_mem_max: "6G", // cap per test suite (herdr-verify)
    test_slots: 1, // test suites in parallel on the machine
    close_tab_after: 20, // seconds until a finished child tab closes (0 = never)
    tui: false, // children in the agent's own screen (-T) by default
  },
  agents: {}, // only agents declared here are available
  policy: {
    quota_limit: 90, // quota % from which an agent/account is skipped
    max_rounds: 2, // fix rounds before stopping and calling the user
    review: "other-vendor", // other-vendor | any
  },
  ui: { lang: "auto", theme: "gunmetal" }, // lang: auto | en | pt · theme: gunmetal | chrome | lcd | terminal
  // Where quota comes from, per agent: "builtin" | "none" | false | { command = "..." } (see src/quota.ts).
  // "claude" covers every account in claude-accounts.
  quota: { claude: "builtin", codex: "builtin", opencode: "none", antigravity: "builtin", copilot: "builtin" },
  tracker: { kind: "none" }, // plane | none
  repos: {}, // defined by the workspace
};

export class ConfigError extends Error {}

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export function merge(base: Obj, over: Obj): Obj {
  const out: Obj = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(out[k]) ? merge(out[k] as Obj, v) : v;
  return out;
}

function expandAll(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(expandAll);
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expandAll(x)]));
  return typeof v === "string" ? expand(v) : v;
}

export function loadFile(path: string): Obj {
  const text = readFileSync(path, "utf8");
  try {
    return (path.endsWith(".json") ? JSON.parse(text) : parseToml(text)) as Obj;
  } catch (e) {
    throw new ConfigError(m(`orq config: error reading ${path}: ${(e as Error).message}`,
      `orq config: erro lendo ${path}: ${(e as Error).message}`));
  }
}

const firstFile = (...c: (string | undefined)[]) => c.find((f) => f && existsSync(f));

export function findWorkspace(start: string): { root?: string; file?: string } {
  for (let d = resolve(start); ; d = dirname(d)) {
    const file = firstFile(join(d, ".orq", "workspace.toml"), join(d, ".orq", "workspace.json"));
    if (file) return { root: d, file };
    if (dirname(d) === d) return {};
  }
}

export interface Loaded { cfg: Obj; files: string[] }

export function loadConfig(workspace?: string): Loaded {
  const user = firstFile(process.env.ORQ_CONFIG && expand(process.env.ORQ_CONFIG),
    join(configDir(), "config.toml"), join(configDir(), "config.json"));
  const ws = findWorkspace(workspace ?? process.cwd());
  let cfg = DEFAULTS;
  const files: string[] = [];
  for (const f of [user, ws.file]) {
    if (!f) continue;
    cfg = merge(cfg, loadFile(f));
    files.push(f);
  }
  cfg = expandAll(cfg) as Obj;
  cfg._workspace = ws.root ?? null;
  return { cfg, files };
}

/** Value at a dotted path (a.b.c), or undefined. */
export function getPath(cfg: Obj, path: string): unknown {
  let v: unknown = cfg;
  for (const part of path.split(".")) {
    if (!isObj(v) || !(part in v)) return undefined;
    v = v[part];
  }
  return v;
}
