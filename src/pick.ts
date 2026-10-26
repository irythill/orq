// Picks agent, model, effort and account for a role (port of orq-pick, plus fixed roles).
//   fixed role: the first agent of [agent, ...fallback] that passes the filters wins — no scoring, never swapped
//               for an agent the user didn't list.
//   auto role:  every pool agent that passes is scored:
//     quality * delivery + tokens * economy + speed * quickness − rotation * (picks in the last `window`)
//     − reserve (agents with reserve = true) + explore (fewer than `min_samples` runs)
// Filters: --exclude-agent, orq block, cross-vendor rule, a model for the role/level, quota under the limit.
import type { Obj } from "./config.js";
import { m } from "./i18n.js";
import { legacyRole, type PickRole, resolveRole, vendorOf } from "./roles.js";
import type { Row } from "./stats.js";

/** name → highest % of 5h/week; null = no data ("?"); -1 = no limit ("-"). */
export type QuotaMap = Record<string, number | null>;

export interface PickInput {
  cfg: Obj; role: PickRole; level: string; implVendor?: string; exclude: Set<string>;
  stats: Row[]; quota: QuotaMap; blocks: Set<string>; recent: { agent: string }[];
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

export function modelFor(a: Obj, role: PickRole, level: string): [string, string | undefined] | undefined {
  if (a.models === undefined) return ["", undefined]; // no models configured: the CLI's default
  const models = a.models as Record<string, Record<string, string>>;
  const lr = legacyRole(role);
  const ms = models[lr] ?? (lr === "fix" ? models.impl : undefined) ?? {};
  const spec = ms[level] ?? ms.default ?? ms.medium ?? ms.simple;
  if (!spec) return undefined;
  const [model, effort] = spec.split("@");
  return [model, effort || undefined];
}

const WEIGHTS = { quality: 0.4, tokens: 0.45, speed: 0.15, rotation: 0.2, reserve: 0.3, explore: 0.1, min_samples: 8, window: 6 };
export const weights = (cfg: Obj) =>
  ({ ...WEIGHTS, ...((((cfg.policy ?? {}) as Obj).weights ?? {}) as Partial<typeof WEIGHTS>) });

export function pick(inp: PickInput): PickResult {
  const { cfg, role, level } = inp;
  const agents = (cfg.agents ?? {}) as Record<string, Obj>;
  const pol = (cfg.policy ?? {}) as Obj;
  const limit = Number(pol.quota_limit ?? 90);
  const w = weights(cfg);
  const res = resolveRole(cfg, role);
  const names = res.mode === "fixed" ? res.order : res.pool;
  const notes: string[] = [];
  const out = (n: string, why: string) => { notes.push(`${n}: ${why}`); };
  const pass: (Omit<Candidate, "score" | "why"> & { a: Obj; st?: Row })[] = [];

  for (const name of names) {
    const a = agents[name];
    if (!a) { out(name, m("not declared in [agents]", "não declarado em [agents]")); continue; }
    if (inp.exclude.has(name)) { out(name, m("excluded (--exclude-agent)", "excluído (--exclude-agent)")); continue; }
    if (inp.blocks.has(name)) { out(name, m("blocked (orq block -l)", "bloqueado (orq block -l)")); continue; }
    if ((role === "review" || role === "opinion") && res.rule === "other-vendor" && inp.implVendor
        && vendorOf(name, a) === inp.implVendor) {
      out(name, m("same vendor as the implementer", "mesmo fornecedor do implementador")); continue;
    }
    const mf = modelFor(a, role, level);
    if (!mf) { out(name, m(`no model for ${role}/${level}`, `sem modelo para ${role}/${level}`)); continue; }
    // Quota: an agent with several accounts (claude) uses the least used one under the limit.
    const qn = (a.quota as string[] | undefined) ?? [];
    const accs = qn.filter((n) => !inp.blocks.has(n)).map((n) => [n, n in inp.quota ? inp.quota[n] : -1] as const);
    if (qn.length && !accs.length) { out(name, m("all accounts blocked", "todas as contas bloqueadas")); continue; }
    const usable = accs.filter(([, v]) => v !== null && v < limit);
    if (accs.length && !usable.length) {
      out(name, `${m("quota", "cota")} >= ${limit}% ${m("or no data", "ou sem dados")} (${accs.map(([n, v]) => `${n}=${v}`).join(", ")})`);
      continue;
    }
    const acct = accs.length > 1 ? [...usable].sort((x, y) => x[1]! - y[1]!)[0][0] : undefined;
    const statRole = role === "fix" || role === "worker" ? "impl" : role;
    const st = inp.stats.find((r) => r.role === statRole && r.agent === name && r.model === (mf[0].split("/").pop() || "default"));
    pass.push({ agent: name, model: mf[0], effort: mf[1], acct, a, st });
    if (res.mode === "fixed") break; // the first that passes wins
  }

  if (res.mode === "fixed") {
    const c = pass[0];
    const best = c && { agent: c.agent, model: c.model, effort: c.effort, acct: c.acct, score: 0,
      why: m(`fixed by [roles.${res.section}]`, `fixo em [roles.${res.section}]`) };
    return { mode: "fixed", best, cands: best ? [best] : [], notes };
  }

  const few = (st?: Row) => (st?.n ?? 0) < w.min_samples;
  const toks = pass.filter((c) => c.st?.new && !few(c.st)).map((c) => c.st!.new!);
  const mins = pass.filter((c) => c.st?.min && !few(c.st)).map((c) => c.st!.min);
  const cands: Candidate[] = pass.map((c) => {
    const prior = Number(c.a.prior ?? 0.6), n = c.st?.n ?? 0, reserve = Boolean(c.a.reserve);
    const deliv = role === "impl" && c.st?.approved != null && c.st.n_appr >= 3 ? c.st.approved / 100
      : c.st ? c.st.ok / 100 : undefined;
    const d = few(c.st) || deliv === undefined ? prior : deliv;
    const t = few(c.st) || !c.st?.new || !toks.length ? prior : Math.min(...toks) / c.st.new;
    const s = few(c.st) || !c.st?.min || !mins.length ? prior : Math.min(...mins) / Math.max(c.st.min, 0.1);
    const used = inp.recent.filter((p) => p.agent === c.agent).length;
    const score = w.quality * d + w.tokens * t + w.speed * s - w.rotation * used
      - (reserve ? w.reserve : 0) + (few(c.st) ? w.explore : 0);
    const why = `${m("delivery", "entrega")}=${d.toFixed(2)} ${m("economy", "economia")}=${t.toFixed(2)} `
      + `${m("speed", "rapidez")}=${s.toFixed(2)} ${m("rotation", "rodízio")}=-${used} `
      + (reserve ? m("reserve ", "reserva ") : "") + (few(c.st) ? `${m("few samples", "poucos dados")}(n=${n})` : `n=${n}`);
    return { agent: c.agent, model: c.model, effort: c.effort, acct: c.acct, score, why };
  }).sort((x, y) => y.score - x.score);
  return { mode: "auto", best: cands[0], cands, notes };
}

/** The arguments for the agent runner, e.g. "-a codex -m gpt-6-sol -e low -c work". */
export const asArgs = (c: Candidate) =>
  `-a ${c.agent}` + (c.model ? ` -m ${c.model}` : "") + (c.effort ? ` -e ${c.effort}` : "") + (c.acct ? ` -c ${c.acct}` : "");
