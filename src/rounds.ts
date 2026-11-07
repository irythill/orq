// Watchdog layer 1: per-issue round metrics from the files already in .orquestra/<ID>/, no LLM and no extra recording.
//   fix-<n>.md                    the blockers sent to the implementer in fix round n (its mtime = the round started)
//   review-<repo>.out.md          the first review (round 0);  review-<repo>-<n>.out.md  the review after fix round n
// Rounds = highest fix-<n> (or the .rounds-<session> counter `orq agent -R` keeps). Findings are the tagged list items
// of each review ("- [blocker] src/a.ts:10 title", or a leading bold severity word in PT/EN: "1. **Bloqueante** — ...",
// "- **Sugestão — `a.ts:7–8`:** ..."; "**Critério 1**" is not one). Files may be markdown links; a ".worktrees/<dir>/" prefix is
// stripped so a file matches across rounds. A finding "repeats" when a later review has one on the same file
// with similar words (token overlap, see similar()).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type Level = "ok" | "warn" | "stop";
export interface Finding { round: number; severity: string; file: string; title: string }
export interface Repeat { file: string; title: string; rounds: number[] }
export interface RoundTime { round: number; secs: number }
export interface Metrics {
  issue: string; rounds: number; max: number; secs: number; perRound: RoundTime[];
  findings: number; repeats: Repeat[]; level: Level; reasons: Reason[];
  followups?: Record<string, number>; // -R follow-ups per reason; only "review" counts in `rounds`
}
/** Why the level is not ok: a code plus numbers, translated where it is shown (orq rounds), kept as is in --json. */
export interface Reason { code: "over_max" | "at_max" | "same_finding" | "repeated" | "fresh" | "slow"; n: number; max?: number; rounds?: number[] }
export interface Facts { rounds: number; max: number; perRound: RoundTime[]; findings: Finding[]; secs: number }

export const SIMILAR_FILE = 0.4; // token overlap needed when both findings name the same file
export const SIMILAR_LOOSE = 0.6; // ... when a file is missing on either side
export const SLOW_FACTOR = 2; // a round this many times slower than the median of the others is flagged
export const SLOW_MIN_SECS = 600; // ... but only if it also took at least this long
export const REPEAT_WARN = 2; // a finding seen in this many reviews: warn
export const REPEAT_STOP = 3; // ... in this many: stop (it came back after two fix rounds)
export const FRESH_WARN = 2; // fix rounds whose review brings heavy findings never seen before: the branch is too big, split it
export const HEAVY = new Set(["blocker", "major", "critical"]); // only these count towards repeats and the alert

const read = (f: string) => { try { return readFileSync(f, "utf8"); } catch { return ""; } };
const STOP = new Set(["the", "a", "an", "of", "in", "on", "to", "is", "are", "and", "or", "for", "with", "not", "no", "this", "that", "it",
  "de", "do", "da", "o", "os", "as", "um", "uma", "em", "no", "na", "para", "com", "que", "se", "não"]);

const words = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, " ").split(" ").filter((w) => w.length > 2 && !STOP.has(w)));

const SEV: Record<string, string> = { // looked up with Object.hasOwn: "constructor" and friends are not severities
 
  bloqueante: "blocker", bloqueador: "blocker", blocker: "blocker", critico: "critical", critical: "critical",
  importante: "major", important: "major", major: "major", menor: "minor", minor: "minor",
  sugestao: "suggestion", suggestion: "suggestion", nit: "nit",
};
const fold = (w: string) => w.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const URL = /^[a-z][a-z0-9+.-]*:\/\//i;
// GitHub-style ".../blob/<ref>/<path>" → "<path>" (no query, no #L4), so URL mentions match plain-path mentions.
const blobPath = (u: string) => /^[a-z][a-z0-9+.-]*:\/\/[^/]+\/[^/]+\/[^/]+\/blob\/[^/]+\/([^#?\s)]+)/i.exec(u)?.[1];
const LINK = /\[([^\]]*)\]\(([^)\s]*)\)/g;
// Reviews run in a different worktree per round (".worktrees/<repo>-<id>.review-<pid>/"): drop it so the same file matches across rounds.
const repoRel = (f: string) => f.replace(/\\/g, "/").replace(/^.*\.worktrees\/[^/]+\//, "");

/** One review-list item → finding. Only items carrying a severity (a "[blocker]" tag or a leading bold "**Bloqueante**") count. */
export function parseFindings(text: string, round: number): Finding[] {
  const out: Finding[] = [];
  for (const line of text.split("\n")) {
    // A list item, or a bare line that starts with a severity tag ("[blocker] src/a.ts:10 ...", as some reviewers write).
    const it = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line) ?? /^\s*(\[(?:blocker|major|minor|nit|suggestion|important|critical)\].*)$/i.exec(line);
    if (!it) continue;
    const sevOf = (w?: string) => { const k = fold(w ?? ""); return Object.hasOwn(SEV, k) ? SEV[k] : undefined; };
    let m0 = /^\*\*\s*(\p{L}+)/u.exec(it[1]); // a leading bold severity wins over a [tag]
    if (!sevOf(m0?.[1])) m0 = /\[(blocker|major|minor|nit|suggestion|important|critical)\]/i.exec(it[1]);
    const sev = sevOf(m0?.[1]);
    if (!m0 || !sev) continue;
    const rest = it[1].replace(m0[0], " ");
    const byTarget = rest.replace(LINK, (_, t, p) => ` ${URL.test(p) ? blobPath(p) ?? t : repoRel(p)} `)
      .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, (u) => ` ${blobPath(u) ?? ""} `);
    const m = /([\w@./\\-]+\.\w+)(?::\d+(?:[-\u2013]\d+)?)?/.exec(byTarget);
    const file = m ? repoRel(m[1]) : "";
    out.push({ round, severity: sev, file, title: rest.replace(LINK, "$1").replace(/[`*_]/g, "").replace(/\s+/g, " ").trim() });
  }
  return out;
}

/** Same finding? Same file (when both name one) and enough shared words; without a file, a stricter overlap. */
// An explicit "nothing to fix" verdict, PT or EN, on a line of its own or as a heading/label.
const APPROVED = /^\s*(?:[#>*_`-]+\s*)*(?:verdict|veredito|status|resultado)?\s*[:—-]?\s*\**\s*(approved|approve|lgtm|aprovad[oa]|no (?:blocking )?(?:findings|issues|blockers)|nenhum (?:achado|problema|blocker|bloqueante)|sem (?:achados|bloqueantes|blockers))\b/im;

/** Does a review answer carry a verdict: at least one finding with a severity, or an explicit approval?
 *  "I'll start by exploring the repo..." (a reviewer that stopped before reviewing) has neither. */
export function hasVerdict(text: string): boolean {
  return parseFindings(text, 0).length > 0 || APPROVED.test(text);
}

export function similar(a: Pick<Finding, "file" | "title">, b: Pick<Finding, "file" | "title">): boolean {
  const wa = words(a.title), wb = words(b.title);
  if (!wa.size || !wb.size) return false;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  const j = inter / (wa.size + wb.size - inter), both = a.file && b.file;
  if (both && a.file !== b.file) return false;
  return j >= (both ? SIMILAR_FILE : SIMILAR_LOOSE);
}

/** Findings that reappear in more than one round. Each group is matched against its first member. */
export function repeats(fs: Finding[]): Repeat[] {
  const groups: Finding[][] = [];
  for (const f of [...fs].sort((a, b) => a.round - b.round)) {
    const g = groups.find((x) => similar(x[0], f));
    if (g) g.push(f); else groups.push([f]);
  }
  return groups.map((g) => ({ file: g[0].file, title: g[0].title, rounds: [...new Set(g.map((x) => x.round))] }))
    .filter((r) => r.rounds.length >= REPEAT_WARN);
}

/** Fix rounds (k ≥ 1) whose review raised a heavy finding not similar to any earlier one: a reviewer re-reading a big branch. */
export function freshRounds(fs: Finding[]): number[] {
  const out = new Set<number>();
  for (const f of fs) if (f.round > 0 && !fs.some((e) => e.round < f.round && similar(e, f))) out.add(f.round);
  return [...out].sort((a, b) => a - b);
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };

/** Fix rounds far above the median of the other fix rounds (round 0 is the implementation: never compared; needs 3 fix rounds). */
export function slowRounds(all: RoundTime[]): number[] {
  const per = all.filter((r) => r.round > 0);
  if (per.length < 3) return [];
  return per.filter((r) => r.secs >= SLOW_MIN_SECS && r.secs > SLOW_FACTOR * median(per.filter((x) => x !== r).map((x) => x.secs))).map((r) => r.round);
}

/** The pure part: facts from the files → numbers, alert level and why. */
export function metrics(issue: string, f: Facts): Metrics {
  const heavy = f.findings.filter((x) => HEAVY.has(x.severity)), reps = repeats(heavy), reasons: Reason[] = [];
  let level: Level = "ok";
  const raise = (l: Level, why: Reason) => { reasons.push(why); if (l === "stop" || level === "ok") level = l; };
  if (f.rounds > f.max) raise("stop", { code: "over_max", n: f.rounds, max: f.max });
  else if (f.rounds >= f.max && f.max > 0) raise("warn", { code: "at_max", n: f.rounds, max: f.max });
  const worst = Math.max(0, ...reps.map((r) => r.rounds.length));
  if (worst >= REPEAT_STOP) raise("stop", { code: "same_finding", n: worst });
  else if (reps.length) raise("warn", { code: "repeated", n: reps.length });
  const fresh = freshRounds(heavy);
  if (fresh.length >= FRESH_WARN) raise("warn", { code: "fresh", n: fresh.length, rounds: fresh });
  const slow = slowRounds(f.perRound);
  if (slow.length) raise("warn", { code: "slow", n: slow.length, rounds: slow });
  return { issue, rounds: f.rounds, max: f.max, secs: f.secs, perRound: f.perRound, findings: f.findings.length, repeats: reps, level, reasons };
}

/** Rounds of an issue folder: the highest .rounds-<session> counter or fix-<n>.md. Shared by `orq rounds` and the -F gate. */
export function countRounds(dir: string, names: string[]): number {
  let n = 0;
  for (const f of names) {
    const fx = /^fix-(\d+)\.md$/.exec(f);
    if (fx) n = Math.max(n, Number(fx[1]));
    else if (f.startsWith(".rounds-") && !f.endsWith(".log")) n = Math.max(n, Number(read(join(dir, f))) || 0);
  }
  return n;
}

/** Follow-ups per reason (review|verify|unblock) from the .rounds-<session>.log files `orq agent -R` appends to. */
export function roundReasons(dir: string, names: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of names) {
    if (!/^\.rounds-.+\.log$/.test(f)) continue;
    for (const line of read(join(dir, f)).split("\n")) { const r = line.split(" ")[1]; if (r) out[r] = (out[r] ?? 0) + 1; }
  }
  return out;
}

/** The impure part: read .orquestra/<issue>/. undefined when the issue has no fix or review files at all. */
export function collectRounds(ws: string, issue: string, max: number): Metrics | undefined {
  const dir = join(ws, ".orquestra", issue);
  let names: string[];
  try { names = readdirSync(dir); } catch { return undefined; }
  const mt = (n: string) => statSync(join(dir, n)).mtimeMs;
  const fixes = new Map<number, number>(), reviews = new Map<number, string[]>();
  for (const n of names) {
    const fx = /^fix-(\d+)\.md$/.exec(n);
    if (fx) fixes.set(Number(fx[1]), mt(n));
  }
  for (const n of names) {
    // A trailing -<n> is a round only when fix-<n>.md exists; otherwise it is part of the repo name (round 0).
    const rv = /^review-(.+?)(?:-(\d+))?\.out\.md$/.exec(n), k = rv && rv[2] !== undefined && fixes.has(Number(rv[2])) ? Number(rv[2]) : 0;
    if (rv) reviews.set(k, [...(reviews.get(k) ?? []), n]);
  }
  if (!reviews.size && !fixes.size) return undefined;
  const rounds = countRounds(dir, names);
  const all = names.filter((n) => !n.startsWith(".") && !/^(diagnosis|watchdog)-/.test(n)).map(mt), t0 = Math.min(...all), t1 = Math.max(...all);
  // Round k runs from fix-k.md (round 0: the oldest file) to the next fix, the last one to the newest file.
  const starts = [t0, ...Array.from({ length: rounds }, (_, i) => fixes.get(i + 1) ?? NaN)];
  const perRound: RoundTime[] = starts.map((s, k) => {
    const next = k < rounds ? starts[k + 1] : t1;
    return { round: k, secs: Number.isNaN(s) || Number.isNaN(next) ? 0 : Math.max(0, Math.round((next - s) / 1000)) };
  });
  const findings = [...reviews].flatMap(([k, fs]) => fs.flatMap((n) => parseFindings(read(join(dir, n)), k)));
  const x = metrics(issue, { rounds, max, perRound, findings, secs: Math.round((t1 - t0) / 1000) });
  const fu = roundReasons(dir, names);
  return Object.keys(fu).length ? { ...x, followups: fu } : x;
}

/** Cheap change signature of an issue folder (names + mtimes, no reads) for caching collectRounds between redraws. */
export function roundsSig(ws: string, issue: string): string {
  const dir = join(ws, ".orquestra", issue);
  try { return readdirSync(dir).filter((n) => /^(fix-\d+\.md|review-.+\.out\.md|\.rounds-.+)$/.test(n)).map((n) => `${n}:${statSync(join(dir, n)).mtimeMs}`).join("|"); } catch { return ""; }
}

/** Board marker: "r2/2 ⚠", "r3/2 ✗"; just "r1/2" when ok. */
export const mark = (x: Pick<Metrics, "rounds" | "max" | "level">) =>
  `r${x.rounds}/${x.max}${x.level === "warn" ? " ⚠" : x.level === "stop" ? " ✗" : ""}`;
