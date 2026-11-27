// Quota guard for a running child agent on a Claude account. orq pick keeps a child off an account past
// `limit - headroom`, but only at launch: a long run could still drain the account to 100 % (and starve the
// conductors that share it). The runner re-reads the account's usage every few minutes and, once it reaches the
// pick limits, stops the agent so the conductor re-picks (another account) and resumes the same session (-R).
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Account } from "./accounts.js";
import type { QuotaLine } from "./quota.js";

export interface QuotaGuard { account: string; dir: string; limit5: number; limitWeek: number }

/** Why the reading is at or over the guard's limits ("5h=98% ≥ 75%"), or undefined while under (or unknown). */
export function quotaBreach(q: Pick<QuotaLine, "five" | "week">, g: Pick<QuotaGuard, "limit5" | "limitWeek">): string | undefined {
  if (typeof q.five === "number" && q.five >= g.limit5) return `5h=${Math.floor(q.five)}% >= ${g.limit5}%`;
  if (typeof q.week === "number" && q.week >= g.limitWeek) return `week=${Math.floor(q.week)}% >= ${g.limitWeek}%`;
  return undefined;
}

/** The guard for a child on `account`: the pick limits for its level minus the agent's headroom. */
export function guardFor(account: Account, limits: [number, number], headroom: number): QuotaGuard {
  const h = Math.max(0, headroom || 0);
  return { account: account.name, dir: account.dir, limit5: limits[0] - h, limitWeek: limits[1] - h };
}

/**
 * -R on another account: Claude keeps sessions per account (<dir>/projects/<slug>/<session>.jsonl), so a session
 * started on one account is not found from another. Copy it over (same slug) when the target lacks it.
 * Returns the source account's name, or undefined when nothing was copied.
 */
export function carrySession(accounts: Account[], target: string, session: string): string | undefined {
  const to = accounts.find((a) => a.name === target);
  if (!to || !/^[\w-]+$/.test(session)) return undefined;
  const file = `${session}.jsonl`;
  const has = (dir: string) => {
    try { return readdirSync(join(dir, "projects")).find((s) => existsSync(join(dir, "projects", s, file))); } catch { return undefined; }
  };
  if (has(to.dir)) return undefined;
  for (const from of accounts) {
    if (from.name === target) continue;
    const slug = has(from.dir);
    if (!slug) continue;
    mkdirSync(join(to.dir, "projects", slug), { recursive: true });
    copyFileSync(join(from.dir, "projects", slug, file), join(to.dir, "projects", slug, file));
    return from.name;
  }
  return undefined;
}

/** Re-reads the account every `everyMs` and calls `stop(why)` once on a breach. Returns the timer (cleared by the caller). */
export function watchQuota(g: QuotaGuard, read: (g: QuotaGuard) => Promise<Pick<QuotaLine, "five" | "week">>, stop: (why: string) => void,
  everyMs: number): NodeJS.Timeout {
  let fired = false, busy = false;
  const t = setInterval(async () => {
    if (fired || busy) return;
    busy = true;
    try {
      const why = quotaBreach(await read(g), g);
      if (why) { fired = true; clearInterval(t); stop(why); }
    } catch { /* a failed reading never stops the agent */ } finally { busy = false; }
  }, everyMs);
  t.unref();
  return t;
}
