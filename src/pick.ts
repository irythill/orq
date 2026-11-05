// Picks agent, model, effort and account for a role (port of orq-pick, plus fixed roles).
//   fixed role: the first agent of [agent, ...fallback] that passes the filters wins — no scoring, never swapped
//               for an agent the user didn't list.
//   auto role:  every pool agent that passes is scored:
//     quality * delivery + tokens * economy + speed * quickness − rotation * (picks in the last `window`)
//     − reserve (agents with reserve = true) + explore (fewer than `min_samples` runs, fading with n, none after
//     `explore_streak` picks in a row). Each axis is (prior·k + observed·n)/(k + n), k = min_samples.
// Filters: --exclude-agent, orq block, nobody reviews their own code (unless no other agent can), cross-vendor rule, a model for the role/level,
// quota under the limits: policy.quota_week (95) on the weekly window, and on the 5h one policy.quota_5h per level
// (simple 90, medium 85, heavy 80): a heavy task needs more room left to finish.
// An agent's `headroom` (points) lowers both limits for it: that share of its accounts stays for the conductors.
// An account whose quota reading says the login expired is skipped, with the fix command in the note.
// Pacing: an account whose usage, at the pace so far in a window (used ÷ elapsed share), projects past
// that window's pick limit (the filter's) at its reset is passed over for another account under the limit when the agent has several,
// and otherwise loses policy.pacing_penalty (default 0.3, 0 = off) of score — soft, never a drop.
import { agentDef, usesPrompt } from "./agents.js";
import type { Obj } from "./config.js";
import { m } from "./i18n.js";
import { humanReset } from "./quota.js";
import { legacyRole, type PickRole, resolveRole, vendorOf } from "./roles.js";
import type { Row } from "./stats.js";

/** name → highest % of 5h/week; null = no data ("?"); -1 = no limit ("-"). */
export type QuotaMap = Record<string, number | null>;

/** name → each window's %; absent = the QuotaMap figure counts for both windows. resetFive/resetWeek (epoch seconds)
 *  come along when the quota line carries them. */
export type WindowMap = Record<string, { five?: number; week?: number; resetFive?: number; resetWeek?: number;
  spanFive?: number; spanWeek?: number; expired?: string; note?: string }>;

export interface PickInput {
  cfg: Obj; role: PickRole; level: string; implVendor?: string; implAgent?: string; exclude: Set<string>;
  stats: Row[]; quota: QuotaMap; windows?: WindowMap; blocks: Set<string>; recent: { agent: string }[]; now?: number /* epoch s */;
}
export interface Candidate {
  agent: string; model: string; effort?: string; acct?: string; score: number; why: string;
}
export interface PickResult { mode: "fixed" | "auto"; best?: Candidate; cands: Candidate[]; notes: string[] }

/** "<name> 5h=NN% week=NN% [note]" lines → QuotaMap (same reading as the old orq-pick). */
export function parseQuota(text: string): QuotaMap {
  const out: QuotaMap = {};
  for (const line of text.split(/\r?\n/)) {
    const p = line.split(/\s+/);
    if (p.length < 3) continue;
    const vals = p.slice(1, 3).map((x) => x.replace(/.*=/, ""));
    if (vals.some((v) => v.startsWith("?"))) { out[p[0]] = null; continue; }
    const nums = vals.map((v) => v.replace(/%$/, "")).filter((v) => /^\d+$/.test(v)).map(Number);
    out[p[0]] = nums.length ? Math.max(...nums) : -1;
  }
  return out;
}

/** The same lines → each window's %, plus its reset time (epoch seconds) when the line carries one. */
export function parseWindows(text: string): WindowMap {
  const out: WindowMap = {};
  const num = (v?: string) => (v && /^\d+%$/.test(v) ? Number(v.slice(0, -1)) : undefined);
  for (const l of text.split(/\r?\n/)) {
    const r = /^(\S+) 5h=(\S+) week=(\S+)(?: reset5h=(\d+))?(?: resetweek=(\d+))?(?: span5h=(\d+))?(?: spanweek=(\d+))?/.exec(l.trim());
    if (!r) continue;
    // "[login expired: run `agy models`; last reading, 5 min ago]" → the part before the first ";" (the fix to show)
    const note = /\[([^\]]*)\]\s*$/.exec(l)?.[1].split(";")[0].trim();
    out[r[1]] = { five: num(r[2]), week: num(r[3]), ...(r[4] ? { resetFive: Number(r[4]) } : {}),
      ...(r[5] ? { resetWeek: Number(r[5]) } : {}), ...(r[6] ? { spanFive: Number(r[6]) } : {}),
      ...(r[7] ? { spanWeek: Number(r[7]) } : {}), ...(note && EXPIRED.test(note) ? { expired: note } : note ? { note } : {}) };
  }
  return out;
}

// Both languages orq writes these notes in (the collectors' not-logged-in and expired-login texts).
/** agy's idle-token note (collector text, both languages). */
const IDLE = /token idle|token ocioso/i;
const EXPIRED = /login expired|login expirado|not logged in|no agy login|sem login/i;
/** Window lengths in seconds, unless the quota line publishes another (span5h/spanweek, minutes). */
const WINDOW_S = { five: 5 * 3600, week: 7 * 86400 };

/** Usage at the window's reset if the pace so far continues (used ÷ elapsed share); undefined when it can't be told:
 *  no figure or reset time, or under 10% of the window elapsed (too early to project). */
export function projected(pct: number | undefined, reset: number | undefined, size: number, now: number): number | undefined {
  if (pct === undefined || pct < 0 || reset === undefined) return undefined;
  const left = reset - now;
  if (left <= 0 || left > size) return undefined;
  const elapsed = (size - left) / size;
  return elapsed < 0.1 ? undefined : pct / elapsed;
}

const FIVE = { simple: 90, medium: 85, heavy: 80 } as Record<string, number>;
/** [5h limit, weekly limit] for a task level; an unknown level counts as medium. */
export function limitsFor(pol: Obj, level: string): [number, number] {
  const five = { ...FIVE, ...((pol.quota_5h ?? {}) as Record<string, number>) };
  return [Math.min(Number(five[level] ?? five.medium), Number(pol.quota_limit ?? 90)), Number(pol.quota_week ?? 95)];
}

export function modelFor(a: Obj, role: PickRole, level: string): [string, string | undefined] | undefined {
  if (a.models === undefined) return ["", undefined]; // no models configured: the CLI's default
  const models = a.models as Record<string, Record<string, string>>;
  const lr = legacyRole(role);
  const ms = models[lr] ?? (lr === "fix" ? models.impl : lr === "watchdog" ? models.opinion ?? models.review : undefined) ?? {};
  const spec = ms[level] ?? ms.default ?? ms.medium ?? ms.simple;
  if (!spec) return undefined;
  const [model, effort] = spec.split("@");
  return [model, effort || undefined];
}

// --- per-model quota ---------------------------------------------------------------------------------------------------
// A collector may add lines "<account>/<model> 5h=.. week=.." (antigravity: one bucket per model group). The model a pick is about
// to choose is checked against its own line, and an exhausted one gives way to a lighter model the agent has configured.
const LEVEL_RANK: Record<string, number> = { simple: 0, medium: 1, default: 1, heavy: 2 };

/** The quota line key for a configured model: the exact id, else the id without its -low/-medium/-high suffix, plain or
 *  as "<base>-tiered" (one bucket serves all three efforts of a tiered model). */
export function modelKey(model: string, keys: string[]): string | undefined {
  const id = model.split("/").pop() ?? model;
  const base = id.replace(/-(low|medium|high)$/, "");
  return [id, base, `${base}-tiered`].find((k) => keys.includes(k));
}

/** The models of an agent's role section lighter than `level`, the closest first, without repeats of `tried`. */
export function lighterModels(a: Obj, role: PickRole, level: string, tried: string[]): [string, string | undefined][] {
  const models = a.models as Record<string, Record<string, string>> | undefined;
  if (!models) return [];
  const lr = legacyRole(role);
  const ms = models[lr] ?? (lr === "fix" ? models.impl : lr === "watchdog" ? models.opinion ?? models.review : undefined) ?? {};
  const rank = LEVEL_RANK[level] ?? 1, seen = new Set(tried);
  const out: [string, string | undefined][] = [];
  for (const [, spec] of Object.entries(ms).filter(([lv]) => (LEVEL_RANK[lv] ?? 1) < rank)
      .sort((x, y) => (LEVEL_RANK[y[0]] ?? 1) - (LEVEL_RANK[x[0]] ?? 1))) {
    const [model, effort] = spec.split("@");
    if (seen.has(model)) continue;
    seen.add(model); out.push([model, effort || undefined]);
  }
  return out;
}

const WEIGHTS = { quality: 0.4, tokens: 0.45, speed: 0.15, rotation: 0.2, reserve: 0.3, explore: 0.1, explore_streak: 2, min_samples: 8, window: 6 };
export const weights = (cfg: Obj) =>
  ({ ...WEIGHTS, ...((((cfg.policy ?? {}) as Obj).weights ?? {}) as Partial<typeof WEIGHTS>) });

/** The merged definition (built-in + config) takes a prompt; an agent that can't be resolved doesn't. */
function takesPrompt(cfg: Obj, name: string): boolean {
  try { return usesPrompt(agentDef(cfg, name)); } catch { return false; }
}

export function pick(inp: PickInput): PickResult {
  const { cfg, role, level } = inp;
  const agents = (cfg.agents ?? {}) as Record<string, Obj>;
  const pol = (cfg.policy ?? {}) as Obj;
  const [base5, baseWeek] = limitsFor(pol, level);
  const w = weights(cfg);
  const now = inp.now ?? Date.now() / 1000;
  const penalty = Number(pol.pacing_penalty ?? 0.3);
  const res = resolveRole(cfg, role);
  const names = res.mode === "fixed" ? res.order : res.pool;
  const notes: string[] = [];
  const out = (n: string, why: string) => { notes.push(`${n}: ${why}`); };
  const pass: (Omit<Candidate, "score" | "why"> & { a: Obj; st?: Row; pace?: number; hot?: boolean })[] = [];

  // Only with someone else to ask: a single agent must still be able to review.
  const someoneElse = names.some((n) => n !== inp.implAgent && agents[n]);
  const otherVendor = names.some((n) => n !== inp.implAgent && agents[n] && vendorOf(n, agents[n]) !== inp.implVendor);
  for (const name of names) {
    const a = agents[name];
    if (!a) { out(name, m("not declared in [agents]", "não declarado em [agents]")); continue; }
    if (inp.exclude.has(name)) { out(name, m("excluded (--exclude-agent)", "excluído (--exclude-agent)")); continue; }
    if (inp.blocks.has(name)) { out(name, m("blocked (orq block -l)", "bloqueado (orq block -l)")); continue; }
    if ((role === "review" || role === "opinion" || role === "watchdog") && name === inp.implAgent && someoneElse) {
      out(name, m("it implemented this code", "foi quem implementou")); continue;
    }
    if ((role === "review" || role === "opinion" || role === "watchdog") && res.rule === "other-vendor" && inp.implVendor && otherVendor
        && vendorOf(name, a) === inp.implVendor) {
      out(name, m("same vendor as the implementer", "mesmo fornecedor do implementador")); continue;
    }
    if (role === "watchdog" && !takesPrompt(cfg, name)) { out(name, m("ignores prompts (a review tool)", "ignora prompts (ferramenta de revisão)")); continue; }
    const mf = modelFor(a, role, level);
    if (!mf) { out(name, m(`no model for ${role}/${level}`, `sem modelo para ${role}/${level}`)); continue; }
    // Quota: an agent with several accounts (claude) prefers one not projecting past the limit, then the least used.
    const qn = (a.quota as string[] | undefined) ?? [];
    const headroom = Math.max(0, Number(a.headroom ?? 0));
    const limit5 = base5 - headroom, limitWeek = baseWeek - headroom;
    const accs = qn.filter((n) => !inp.blocks.has(n)).map((n) => [n, n in inp.quota ? inp.quota[n] : -1] as const);
    if (qn.length && !accs.length) { out(name, m("all accounts blocked", "todas as contas bloqueadas")); continue; }
    const fix = accs.map(([n]) => inp.windows?.[n]?.expired).filter((x): x is string => Boolean(x));
    if (accs.length && fix.length === accs.length) { out(name, fix[0]); continue; }
    // An idle agy token with nothing cached: the fix is one agy run, not a quota number.
    const noRead = m("no reading yet: run `agy models` once", "sem leitura ainda: rode `agy models` uma vez");
    const idleNoData = ([n, v]: readonly [string, number | null]) => v === null && IDLE.test(inp.windows?.[n]?.note ?? "");
    if (accs.length && accs.every(idleNoData)) { out(name, noRead); continue; }
    const under = ([n, v]: readonly [string, number | null]) => {
      const q = inp.windows?.[n];
      return !q?.expired && v !== null && (q?.five ?? (q ? -1 : v)) < limit5 && (q?.week ?? (q ? -1 : v)) < limitWeek;
    };
    const usable = accs.filter(under);
    if (accs.length && !usable.length) {
      const detail = accs.map(([n, v]) => {
        const q = inp.windows?.[n], vn = v ?? -1;
        if (q?.expired) return `${n}: ${q.expired}`;
        if (idleNoData([n, v])) return `${n}: ${noRead}`;
        const five = q?.five ?? (q ? -1 : vn), week = q?.week ?? (q ? -1 : vn);
        const fiveOver = five >= limit5, weekOver = week >= limitWeek;
        // The account is usable again only once every over-limit window has reset: the latest of their reset times.
        // If one of them has no reset time, that time can't be promised at all.
        const known = [fiveOver ? q?.resetFive : undefined, weekOver ? q?.resetWeek : undefined]
          .filter((t): t is number => t !== undefined);
        const allKnown = (fiveOver || weekOver) && (!fiveOver || q?.resetFive !== undefined) && (!weekOver || q?.resetWeek !== undefined);
        return `${n}=${v}` + (q?.note ? ` (${q.note})` : "") + (allKnown ? ` (${m("back", "volta")} ${humanReset(Math.max(...known))})` : "");
      }).join(", ");
      out(name, `${m("quota", "cota")} >= 5h ${limit5}% / ${m("week", "semana")} ${limitWeek}% ${m("or no data", "ou sem dados")}`
        + (headroom ? ` (headroom ${headroom})` : "") + ` (${detail})`);
      continue;
    }
    const paceOf = (n: string) => {
      const q = inp.windows?.[n];
      const p5 = projected(q?.five, q?.resetFive, (q?.spanFive ? q.spanFive * 60 : WINDOW_S.five), now);
      const pw = projected(q?.week, q?.resetWeek, (q?.spanWeek ? q.spanWeek * 60 : WINDOW_S.week), now);
      const paces = [p5, pw].filter((x): x is number => x !== undefined);
      // Hot: past the same per-window limit the filter uses (5h by level, week), headroom included, when pacing is on.
      return { pace: paces.length ? Math.max(...paces) : undefined,
        hot: penalty > 0 && ((p5 !== undefined && p5 > limit5) || (pw !== undefined && pw > limitWeek)) };
    };
    // The chosen account's per-model buckets: an exhausted model gives way to a lighter one of the same agent.
    let mfx = mf;
    const acc0 = usable.length ? [...usable].sort((x, y) => x[1]! - y[1]!)[0][0] : undefined;
    const mkeys = acc0 ? Object.keys(inp.windows ?? {}).filter((k) => k.startsWith(`${acc0}/`)).map((k) => k.slice(acc0.length + 1)) : [];
    if (acc0 && mkeys.length) {
      const over = (model: string) => {
        const k = modelKey(model, mkeys), q = k ? inp.windows?.[`${acc0}/${k}`] : undefined;
        if (!q) return undefined;
        const five = (q.five ?? -1) >= limit5, week = (q.week ?? -1) >= limitWeek;
        if (!five && !week) return undefined;
        const at = [five ? q.resetFive : undefined, week ? q.resetWeek : undefined].filter((t): t is number => t !== undefined);
        return `${model} ${five ? `5h ${q.five}%` : `${m("week", "semana")} ${q.week}%`}`
          + (at.length ? ` (${m("back", "volta")} ${humanReset(Math.max(...at))})` : "");
      };
      const tried: string[] = [], skipped: string[] = [];
      let found: [string, string | undefined] | undefined;
      for (const cand of [mf, ...lighterModels(a, role, level, [mf[0]])]) {
        const why = over(cand[0]);
        if (!why) { found = cand; break; }
        tried.push(cand[0]); skipped.push(why);
      }
      if (!found) { out(name, `${m("every model over its quota", "todo modelo acima da cota")}: ${skipped.join(", ")}`); continue; }
      if (skipped.length) out(name, `${m("quota exhausted", "cota esgotada")}: ${skipped.join(", ")}; ${m("using", "usando")} ${found[0]}`);
      mfx = found;
    }
    const ranked = usable.map(([n, v]) => ({ n, v: v!, ...paceOf(n) }))
      .sort((x, y) => Number(x.hot) - Number(y.hot) || x.v - y.v);
    const chosen = ranked[0];
    const acct = qn.length > 1 ? chosen?.n : undefined;
    const statRole = role === "fix" || role === "worker" ? "impl" : role;
    const stOf = (sr: string) => inp.stats.find((r) => r.role === sr && r.agent === name && r.model === (mfx[0].split("/").pop() || "default"));
    const st = stOf(statRole) ?? (role === "watchdog" ? stOf("review") : undefined); // no watchdog runs yet: its review record
    pass.push({ agent: name, model: mfx[0], effort: mfx[1], acct, a, st, pace: chosen?.pace, hot: Boolean(chosen?.hot) });
    if (res.mode === "fixed") break; // the first that passes wins
  }

  if (res.mode === "fixed") {
    const c = pass[0];
    const best = c && { agent: c.agent, model: c.model, effort: c.effort, acct: c.acct, score: 0,
      why: m(`fixed by [roles.${res.section}]`, `fixo em [roles.${res.section}]`) };
    return { mode: "fixed", best, cands: best ? [best] : [], notes };
  }

  // Each axis blends the agent's prior with what was measured, (prior·k + observed·n) / (k + n) with k = min_samples,
  // so a couple of runs already move the score instead of being ignored until the threshold.
  const k = Math.max(0, w.min_samples);
  const few = (st?: Row) => (st?.n ?? 0) < k;
  const blend = (prior: number, obs: number | undefined, n: number) =>
    obs === undefined || k + n <= 0 ? prior : (prior * k + obs * n) / (k + n);
  // The reference cost/time is the best of the well-sampled agents, or of everyone measured when none is.
  const best = (vals: { v: number; solid: boolean }[]) => {
    const solid = vals.filter((x) => x.solid);
    const use = solid.length ? solid : vals;
    return use.length ? Math.min(...use.map((x) => x.v)) : undefined;
  };
  const refTok = best(pass.filter((c) => c.st?.new).map((c) => ({ v: c.st!.new!, solid: !few(c.st) })));
  const refMin = best(pass.filter((c) => c.st?.min).map((c) => ({ v: Math.max(c.st!.min, 0.1), solid: !few(c.st) })));
  const axis = (label: string, prior: number, obs: number | undefined, n: number) => {
    const v = blend(prior, obs, n);
    return { v, txt: `${label}=${v.toFixed(2)}` + (obs === undefined ? "" : `(${prior.toFixed(2)}→${obs.toFixed(2)})`) };
  };
  const cands: Candidate[] = pass.map((c) => {
    const prior = Number(c.a.prior ?? 0.6), n = c.st?.n ?? 0, reserve = Boolean(c.a.reserve);
    const appr = role === "impl" && c.st?.approved != null && c.st.n_appr >= 3;
    const deliv = appr ? c.st!.approved! / 100 : c.st ? c.st.ok / 100 : undefined;
    const d = axis(m("delivery", "entrega"), prior, deliv, appr ? c.st!.n_appr : n);
    const t = axis(m("economy", "economia"), prior, c.st?.new && refTok ? Math.min(1, refTok / c.st.new) : undefined, n);
    const s = axis(m("speed", "rapidez"), prior, c.st?.min && refMin ? Math.min(1, refMin / Math.max(c.st.min, 0.1)) : undefined, n);
    const used = inp.recent.filter((p) => p.agent === c.agent).length;
    // Exploration fades as samples come in and stops after explore_streak picks of the agent in a row.
    let streak = 0;
    for (let i = inp.recent.length - 1; i >= 0 && inp.recent[i].agent === c.agent; i--) streak++;
    const capped = few(c.st) && streak >= w.explore_streak;
    const explore = few(c.st) && !capped ? w.explore * (k - n) / k : 0;
    const hot = Boolean(c.hot) && penalty > 0;
    const score = w.quality * d.v + w.tokens * t.v + w.speed * s.v - w.rotation * used
      - (reserve ? w.reserve : 0) + explore - (hot ? penalty : 0);
    const why = `${d.txt} ${t.txt} ${s.txt} ${m("rotation", "rodízio")}=-${used} `
      + (reserve ? m("reserve ", "reserva ") : "")
      + (hot ? `${m("pace", "ritmo")}=${Math.round(c.pace!)}%→-${penalty} ` : "")
      + (explore ? `${m("explore", "explorar")}=+${explore.toFixed(2)} ` : "")
      + (capped ? `${m("explore capped", "exploração limitada")}(${streak}x) ` : "")
      + (few(c.st) ? `${m("few samples", "poucos dados")}(n=${n})` : `n=${n}`);
    return { agent: c.agent, model: c.model, effort: c.effort, acct: c.acct, score, why };
  }).sort((x, y) => y.score - x.score);
  return { mode: "auto", best: cands[0], cands, notes };
}

const EFFORTS = ["low", "medium", "high"];

/** A fix continues the implementer's session: the same runner arguments (agent, model, account) with the effort one
 *  level up, capped at high. Keeping the model keeps the session's prompt cache; an unknown or absent effort stays. */
export function escalate(args: string): string {
  const p = args.trim().split(/\s+/);
  const i = p.indexOf("-e");
  const at = i >= 0 ? EFFORTS.indexOf(p[i + 1]) : -1;
  if (at >= 0) p[i + 1] = EFFORTS[Math.min(at + 1, EFFORTS.length - 1)];
  return p.join(" ");
}

/** The arguments for the agent runner, e.g. "-a codex -m gpt-6-sol -e low -c work". */
export const asArgs = (c: Candidate) =>
  `-a ${c.agent}` + (c.model ? ` -m ${c.model}` : "") + (c.effort ? ` -e ${c.effort}` : "") + (c.acct ? ` -c ${c.acct}` : "");
