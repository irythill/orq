// Guided setup: turns what a user knows (plans, trust, parallel tasks, RAM) into roles, weights and memory caps,
// with a reason for each choice. The rules are the ones the case study found by hand (docs/case-study.md):
//   shares quota with the conductor          → reserve
//   small plan / monthly allowance           → opinion only
//   pay-as-you-go                            → reviewer pool, not primary
//   no free shell when headless (agy)        → reviewer only, diff attached
//   trusted, else largest plan, not conductor → primary
//   vendor ≠ primary's                       → reviewer (cross review)
import { m } from "./i18n.js";
import { BUILTIN_VENDORS } from "./roles.js";

export type Plan = "free" | "small" | "large" | "payg";
export interface AgentAnswer { plan: Plan; vendor?: string; trust?: boolean; quota?: string[] }
export interface Answers {
  agents: Record<string, AgentAnswer>;
  conductor: string;          // an agent name, or "other" (a human / an agent orq doesn't run)
  parallel: number;           // tasks usually run at once
  ramGB: number;
  preset?: "economy" | "quality" | "single-agent";
}
export interface Proposal {
  agents: Record<string, { vendor: string; quota?: string[]; reserve?: boolean; roles: string[] }>;
  roles: Record<string, { agent?: string; fallback?: string[]; pick?: "auto"; pool?: string[]; rule?: string }>;
  weights: { quality: number; tokens: number; speed: number };
  machine: { agent_mem_max: string; test_mem_max: string };
  reasons: string[];
  notices: string[];
}

/** Agents that only read when headless (their CLI denies commands outside an allowlist). */
const READ_ONLY = new Set(["antigravity"]);
const RANK: Record<Plan, number> = { large: 3, free: 2, payg: 1, small: 0 };

export function suggestRoles(a: Answers): Proposal {
  const names = Object.keys(a.agents);
  if (!names.length) throw new Error(m("no agent to set up", "nenhum agente para configurar"));
  const vendor = (n: string) => a.agents[n].vendor ?? BUILTIN_VENDORS[n] ?? n;
  const reasons: string[] = [], notices: string[] = [];
  const isConductor = (n: string) => n === a.conductor;
  const canImpl = (n: string) => !READ_ONLY.has(n);
  const single = a.preset === "single-agent" || names.length === 1;

  // Primary: the trusted one, else the largest plan; avoid the conductor's quota, small plans and pay-as-you-go.
  const implCands = names.filter(canImpl);
  const byPlan = (xs: string[]) => [...xs].sort((x, y) =>
    Number(Boolean(a.agents[y].trust)) - Number(Boolean(a.agents[x].trust))
    || Number(isConductor(x)) - Number(isConductor(y))
    || RANK[a.agents[y].plan] - RANK[a.agents[x].plan]);
  const primary = byPlan(implCands.length ? implCands : names)[0];
  const why = a.agents[primary].trust ? m("the one you trust most", "o que você mais confia")
    : m("largest plan apart from the conductor's", "maior plano fora o do conductor");
  reasons.push(`primary = ${primary}: ${why}`);
  if (!canImpl(primary)) notices.push(m(`${primary} only reads when headless: it can't implement well`,
    `${primary} só lê no modo headless: não implementa bem`));

  const workers = implCands.filter((n) => n !== primary && !["small", "payg"].includes(a.agents[n].plan));
  const opinion = names.filter((n) => n !== primary && a.agents[n].plan === "small");
  const otherVendor = names.filter((n) => vendor(n) !== vendor(primary) && !opinion.includes(n));
  let reviewers = otherVendor.length ? otherVendor : names.filter((n) => !opinion.includes(n));
  const rule = otherVendor.length && !single ? "other-vendor" : "any";
  if (single) reviewers = [primary];

  if (single) {
    notices.push(m("One agent does everything; reviews run in a fresh session. Cross-vendor review catches more — consider a second agent.",
      "Um agente faz tudo; a revisão roda numa sessão nova. Revisão entre fornecedores pega mais erros — considere um segundo agente."));
  } else if (!otherVendor.length) {
    notices.push(m(`All agents are from ${vendor(primary)}: cross-vendor review is off (rule = "any"); review uses another session/model.`,
      `Todos os agentes são de ${vendor(primary)}: revisão entre fornecedores desligada (rule = "any"); a revisão usa outra sessão/modelo.`));
  } else {
    reasons.push(`reviewer = ${reviewers.join(", ")}: ` + m(`vendor different from ${primary}'s (cross review)`,
      `fornecedor diferente do de ${primary} (revisão cruzada)`));
  }

  const agents: Proposal["agents"] = {};
  for (const n of names) {
    const ans = a.agents[n], roles: string[] = [];
    if (n === primary || (!single && workers.includes(n))) roles.push("impl", "fix");
    if (reviewers.includes(n)) roles.push("review");
    if (opinion.includes(n) && !single) roles.push("opinion");
    agents[n] = { vendor: vendor(n), roles, ...(ans.quota ? { quota: ans.quota } : {}) };
    if (isConductor(n) && n !== primary && !single) {
      agents[n].reserve = true;
      reasons.push(`${n}: reserve — ` + m("shares quota with the conductor", "divide cota com o conductor"));
    }
    if (ans.plan === "small" && !single) reasons.push(`${n}: opinion — ` + m("small plan or monthly allowance", "plano pequeno ou franquia mensal"));
    if (ans.plan === "payg" && n !== primary) reasons.push(`${n}: ` + m("pay-as-you-go → reviews (few tokens)", "pague-por-uso → revisa (poucos tokens)"));
    if (READ_ONLY.has(n) && n !== primary) reasons.push(`${n}: ` + m("reviews only (reads when headless, diff attached)", "só revisa (só lê no headless, diff anexado)"));
  }

  const roles: Proposal["roles"] = {
    conductor: { agent: a.conductor },
    primary: { agent: primary, ...(workers.length ? { fallback: workers } : {}) },
    reviewer: { pick: "auto", pool: reviewers, rule },
  };
  if (workers.length) roles.workers = { pick: "auto", pool: [primary, ...workers] };
  if (opinion.length && !single) roles.opinion = { pick: "auto", pool: opinion };

  const quality = a.preset === "quality" || (a.preset !== "economy" && a.parallel <= 2);
  const weights = quality ? { quality: 0.55, tokens: 0.3, speed: 0.15 } : { quality: 0.4, tokens: 0.45, speed: 0.15 };
  reasons.push(quality ? m("weights favor quality (few tasks at once)", "pesos priorizam qualidade (poucas tarefas por vez)")
    : m("weights favor tokens (several tasks at once)", "pesos priorizam tokens (várias tarefas por vez)"));

  // Memory: ~60 % of RAM for agents; rarely more than two peak at once, so it is split by min(parallel, 2); 2–8 GB
  // each. Tests get a bit more, up to 40 % of RAM.
  const per = Math.max(2, Math.min(8, Math.floor((a.ramGB * 0.6) / Math.min(Math.max(1, a.parallel), 2))));
  const test = Math.max(2, Math.min(per + 2, Math.floor(a.ramGB * 0.4)));
  return { agents, roles, weights, machine: { agent_mem_max: `${per}G`, test_mem_max: `${test}G` }, reasons, notices };
}

const q = (s: string) => JSON.stringify(s);
const list = (xs: string[]) => `[${xs.map(q).join(", ")}]`;

/** The proposal as a commented config.toml (new installs; agent models are left to the CLI defaults). */
export function toToml(p: Proposal): string {
  const out = ["# Written by `orq setup`. Edit freely: everything here is a suggestion (docs/portability.md §4).", "",
    "[machine]", `agent_mem_max = ${q(p.machine.agent_mem_max)}`, `test_mem_max  = ${q(p.machine.test_mem_max)}`, ""];
  for (const [n, a] of Object.entries(p.agents)) {
    out.push(`[agents.${n}]`, `vendor = ${q(a.vendor)}`, `roles  = ${list(a.roles)}`);
    if (a.quota) out.push(`quota  = ${list(a.quota)}`);
    if (a.reserve) out.push("reserve = true");
    out.push("# models.<role>.<level> = \"model[@effort]\" — without models, the CLI's default model is used", "");
  }
  for (const [r, v] of Object.entries(p.roles)) {
    out.push(`[roles.${r}]`);
    if (v.agent) out.push(`agent = ${q(v.agent)}`);
    if (v.fallback) out.push(`fallback = ${list(v.fallback)}`);
    if (v.pick) out.push(`pick = ${q(v.pick)}`);
    if (v.pool) out.push(`pool = ${list(v.pool)}`);
    if (v.rule) out.push(`rule = ${q(v.rule)}`);
    out.push("");
  }
  out.push("[policy.weights]", `quality = ${p.weights.quality}`, `tokens  = ${p.weights.tokens}`, `speed   = ${p.weights.speed}`, "");
  out.push("# Why:", ...p.reasons.map((r) => `#   ${r}`), ...p.notices.map((n) => `# ! ${n}`), "");
  return out.join("\n");
}
