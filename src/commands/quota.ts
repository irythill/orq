// orq quota [name...]   quota of each source in [quota] (default: all) — lines "<name> 5h=NN% week=NN% [note]", with
//                       reset5h=/resetweek= epochs shown as human times at the end (e.g. "5h=92% week=40% (5h resets 14:30)")
// orq quota --line      one line for a status bar (herdr's tab_bar_right command entry): the board's cache, never
//                       the network — a stale cache starts the board's background collection, like the board does.
import { getPath, loadConfig } from "../config.js";
import { m } from "../i18n.js";
import { limitsFor } from "../pick.js";
import { collect, humanReset, type Source } from "../quota.js";
import { type Quota, quota as cached } from "./board.js";
import { load as loadBlocks } from "./block.js";

export const USAGE = `orq quota [name...]                   quota per agent/account ([quota] in the config)
orq quota --line                      one line for a status bar, from the board's cache (e.g. herdr tab_bar_right)`;

const pct = (p: string) => (/^\d+%$/.test(p) ? Number(p.slice(0, -1)) : undefined);

/** A "name 5h=.. reset5h=<epoch> week=.. resetweek=<epoch> [note]" line → the same "name 5h=.. week=.." kept intact,
 *  with the raw epoch fields dropped and human reset times ("resets 14:30") moved to the end of the line, before
 *  any [note]. */
export function humanizeQuotaLine(line: string, now = Date.now()): string {
  const r5 = /reset5h=(\d+)/.exec(line), rw = /resetweek=(\d+)/.exec(line);
  if (!r5 && !rw) return line;
  let out = line.replace(/ reset5h=\d+/, "").replace(/ resetweek=\d+/, "");
  const parts: string[] = [];
  if (r5) parts.push(`${m("5h", "5h")} ${m("resets", "renova")} ${humanReset(Number(r5[1]), now)}`);
  if (rw) parts.push(`${m("week", "semana")} ${m("resets", "renova")} ${humanReset(Number(rw[1]), now)}`);
  const reset = `(${parts.join(", ")})`;
  const note = /(\[.*\])$/.exec(out);
  return note ? `${out.slice(0, note.index).trimEnd()} ${reset} ${note[1]}` : `${out.trimEnd()} ${reset}`;
}

/** "work 64 · home 93! · codex 81 · minimax ?": the tighter of the two windows per source; ! when either window is
 *  at or over the medium-task pick limit for that window (5h: `policy.quota_5h.medium`/`quota_limit`, week:
 *  `policy.quota_week`) — the same thresholds `orq pick` applies for an unspecified task level; ⊘ blocked
 *  (orq block), ? no data; sources with no window at all ("-" and "-") are left out. */
export function quotaLine(lines: Quota[], limit5: number, limitWeek: number, blocked: Set<string>, age?: number): string {
  const parts = lines.filter((q) => q.five !== "-" || q.week !== "-").map((q) => {
    if (blocked.has(q.name)) return `${q.name} ⊘`;
    const five = pct(q.five), week = pct(q.week);
    const ns = [five, week].filter((n): n is number => n !== undefined);
    if (!ns.length) return `${q.name} ?`;
    const top = Math.max(...ns);
    const over = (five !== undefined && five >= limit5) || (week !== undefined && week >= limitWeek);
    return `${q.name} ${top}${over ? "!" : ""}`;
  });
  if (!parts.length) return age === undefined ? m("quota: collecting...", "cota: coletando...") : "";
  const old = age !== undefined && age > 15 * 60_000 ? ` (${Math.round(age / 60_000)} min)` : "";
  return parts.join(" · ") + old;
}

export async function quota(argv: string[]): Promise<number> {
  const { cfg } = loadConfig();
  if (argv[0] === "--line") {
    const q = cached(Date.now());
    const [limit5, limitWeek] = limitsFor((getPath(cfg, "policy") ?? {}) as Record<string, unknown>, "medium");
    console.log(quotaLine(q.lines, limit5, limitWeek, new Set(Object.keys(loadBlocks())), q.age));
    return 0;
  }
  const sources = (getPath(cfg, "quota") ?? {}) as Record<string, Source>;
  for (const l of await collect(sources, argv)) console.log(humanizeQuotaLine(l));
  return 0;
}
