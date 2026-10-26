// Agent scoreboard from the .orquestra/ history: what each agent delivered and what it cost (port of orq-stats).
// Per run (<prefix>.run.sh + .log + .done + .out.md): agent, model, role (impl | fix | review | other), status,
// duration, tokens. "New" tokens = excluding cache reads (what actually weighs on quota); Codex without a session
// file only reports the total. Implementation delivery = the first review of the same repo in the issue said APPROVED.
// Limitation: follow-ups (-R) reuse the implementation prefix, so the "impl" row shows the last round of that prefix.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export interface Run {
  issue: string; name: string; agent: string; model: string; role: string; ok: boolean;
  secs: number; new: number; tot: number; repo: string; approved?: boolean;
}
export interface Row {
  role: string; agent: string; model: string; n: number; ok: number; approved: number | null; n_appr: number;
  min: number; new: number | null; tot: number | null;
}

const ROLE = /^(impl|fix\d*|review\d*|[a-z]+-review\d*)-?/;
const read = (f: string) => { try { return readFileSync(f, "utf8"); } catch { return ""; } };

export function agentModel(run: string, log: string): [string, string] {
  const a = /\b(codex exec|codex resume|codex|claude -p|claude|opencode run|opencode|agy)\b/.exec(run);
  const first = a ? a[1].split(" ")[0] : "?";
  const agent = first === "agy" ? "antigravity" : first;
  let model = /(?:\s-m|--model)\s+'?([^\s']+)/.exec(run)?.[1];
  if (agent === "codex" && !model) model = /^model: (\S+)/m.exec(log)?.[1] ?? "default";
  return [agent, (model ?? "default").split("/").pop()!];
}

function codexSession(sid: string): string | undefined {
  const root = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "sessions");
  const ls = (d: string) => { try { return readdirSync(d); } catch { return []; } };
  for (const y of ls(root)) for (const mo of ls(join(root, y))) for (const d of ls(join(root, y, mo))) {
    const f = ls(join(root, y, mo, d)).find((x) => x.startsWith("rollout-") && x.endsWith(`-${sid}.jsonl`));
    if (f) return join(root, y, mo, d, f);
  }
}

/** [new, total] — new excludes cache reads. */
export function tokens(agent: string, log: string, sid = ""): [number, number] {
  let neu = 0, tot = 0;
  if (agent === "codex") {
    const f = sid && codexSession(sid);
    if (f) {
      const last = read(f).split("\n").filter((l) => l.includes('"total_token_usage"')).pop();
      const u = last && /"total_token_usage":(\{[^}]*\})/.exec(last);
      if (u) {
        const j = JSON.parse(u[1]);
        return [j.total_tokens - (j.cached_input_tokens ?? 0), j.total_tokens];
      }
    }
    const all = [...log.matchAll(/tokens used\s*\n\s*([\d,]+)/g)];
    if (all.length) tot = neu = Number(all[all.length - 1][1].replace(/,/g, ""));
    return [neu, tot];
  }
  for (const line of log.split("\n")) {
    if (!line.startsWith("{")) continue;
    let e: any;
    try { e = JSON.parse(line); } catch { continue; }
    if (agent === "claude" && e.type === "result") {
      const u = e.usage ?? {};
      const n = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0);
      [neu, tot] = [n, n + (u.cache_read_input_tokens ?? 0)];
    } else if (agent === "opencode" && e.type === "step_finish") {
      const t = e.part?.tokens ?? {};
      neu += (t.total ?? 0) - (t.cache?.read ?? 0);
      tot += t.total ?? 0;
    } else if (agent === "antigravity" && e.event === "result") {
      const u = e.result?.usage ?? {};
      [neu, tot] = [u.total_tokens ?? 0, (u.total_tokens ?? 0) + (u.cache_read_tokens ?? 0)]; // agy's total excludes cache
    }
  }
  return [neu, tot];
}

export function collectRuns(ws: string, days: number): Run[] {
  const cutoff = Date.now() - days * 86400_000;
  const base = join(ws, ".orquestra");
  const runs: Run[] = [];
  const dirs = (() => { try { return readdirSync(base); } catch { return []; } })();
  for (const issue of dirs) {
    let files: string[];
    try { files = readdirSync(join(base, issue)); } catch { continue; }
    for (const f of files.filter((x) => x.endsWith(".run.sh"))) {
      const pre = join(base, issue, f.slice(0, -".run.sh".length));
      const runF = `${pre}.run.sh`, done = `${pre}.done`;
      const rs = statSync(runF);
      if (rs.mtimeMs < cutoff || !existsSync(done)) continue;
      const txt = read(runF);
      if (txt.includes("herdr-verify") || txt.includes("herdr-baseline")) continue;
      const log = read(`${pre}.log`);
      const [agent, model] = agentModel(txt, log);
      const name = basename(pre);
      const rm = ROLE.exec(name);
      const role = rm && rm[1].includes("review") ? "review"
        : name.startsWith("fix") || txt.includes("-R ") || txt.includes(" resume ") || txt.includes("--resume") ? "fix"
          : name.startsWith("impl") ? "impl" : "other";
      const out = read(`${pre}.out.md`);
      const [neu, tot] = tokens(agent, log, read(`${pre}.id`).trim());
      runs.push({ issue, name, agent, model, role, ok: read(done).includes("status=ok") && out.trim() !== "",
        secs: Math.max(0, Math.floor((statSync(done).mtimeMs - rs.mtimeMs) / 1000)), new: neu, tot,
        repo: name.includes("-") ? name.slice(name.indexOf("-") + 1) : "" });
    }
  }
  // Implementation delivery: the first review of the same repo in the issue.
  for (const r of runs.filter((x) => x.role === "impl")) {
    const rv = join(base, r.issue, `review-${r.repo}.out.md`);
    if (!existsSync(rv)) continue;
    // "non-blocking suggestion" shows up in approved reviews: the verdict is the word APPROVED (APROVADO in older runs).
    const t = read(rv).slice(0, 4000).toUpperCase();
    r.approved = (t.includes("APPROVED") || t.includes("APROVADO")) &&
      !["NOT APPROVED", "REPROVADO", "NÃO APROVADO"].some((x) => t.includes(x));
  }
  return runs;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

export function rows(runs: Run[]): Row[] {
  const groups = new Map<string, Run[]>();
  for (const r of runs) {
    const k = JSON.stringify([r.role, r.agent, r.model]);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.keys()].sort().map((k) => {
    const rs = groups.get(k)!, [role, agent, model] = JSON.parse(k) as string[];
    const withTok = rs.filter((r) => r.tot), appr = rs.filter((r) => r.approved !== undefined).map((r) => r.approved!);
    return { role, agent, model, n: rs.length, ok: Math.round(100 * rs.filter((r) => r.ok).length / rs.length),
      approved: appr.length ? Math.round(100 * appr.filter(Boolean).length / appr.length) : null, n_appr: appr.length,
      min: Math.round(median(rs.map((r) => r.secs)) / 6) / 10,
      new: withTok.length ? Math.floor(median(withTok.map((r) => r.new))) : null,
      tot: withTok.length ? Math.floor(median(withTok.map((r) => r.tot))) : null };
  });
}

export const scoreboard = (ws: string, days: number) => rows(collectRuns(ws, days));
