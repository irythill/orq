// Roles, set by the user. A [roles.<name>] section is either fixed (`agent`, then `fallback` in order, no scoring)
// or auto (`pick = "auto"`, scored within `pool`). Without [roles], the old format still works: every agent that
// lists the role in `agents.<name>.roles` is in an auto pool.
//
//   [roles.primary]  agent = "codex"  fallback = ["claude"]
//   [roles.reviewer] pick = "auto"    pool = ["antigravity", "opencode"]   rule = "other-vendor"
import type { Obj } from "./config.js";

/** What the conductor asks for (orq pick <role>) → the [roles] section that answers it. */
export const PICK_ROLES = ["impl", "fix", "worker", "review", "opinion"] as const;
export type PickRole = (typeof PICK_ROLES)[number];
const SECTION: Record<PickRole, string[]> = {
  impl: ["primary"], fix: ["primary"], worker: ["workers", "primary"], review: ["reviewer"], opinion: ["opinion"],
};
/** The role name used in the old agents.<name>.roles lists. */
export const legacyRole = (r: PickRole) => (r === "worker" ? "impl" : r);

/** Vendors of the built-in agents, so a config may leave `vendor` out. */
export const BUILTIN_VENDORS: Record<string, string> = {
  claude: "anthropic", codex: "openai", antigravity: "google", copilot: "github",
};
export const vendorOf = (name: string, a: Obj | undefined) => (a?.vendor as string | undefined) ?? BUILTIN_VENDORS[name];

export type Resolved =
  | { mode: "fixed"; order: string[]; rule: string; section: string }
  | { mode: "auto"; pool: string[]; rule: string; section?: string };

export function resolveRole(cfg: Obj, role: PickRole): Resolved {
  const agents = (cfg.agents ?? {}) as Record<string, Obj>;
  const roles = (cfg.roles ?? {}) as Record<string, Obj>;
  const policyRule = String(((cfg.policy ?? {}) as Obj).review ?? "other-vendor");
  const section = SECTION[role].find((s) => roles[s]);
  const r = section ? roles[section] : undefined;
  const rule = String(r?.rule ?? policyRule);
  if (r && typeof r.agent === "string")
    return { mode: "fixed", order: [r.agent, ...((r.fallback as string[] | undefined) ?? [])], rule, section: section! };
  if (r && Array.isArray(r.pool)) return { mode: "auto", pool: r.pool as string[], rule, section };
  const legacy = legacyRole(role);
  const pool = Object.entries(agents).filter(([, a]) => ((a.roles as string[] | undefined) ?? []).includes(legacy))
    .map(([n]) => n);
  return { mode: "auto", pool, rule, section };
}
