// Watchdog layer 2: `orq rounds <ID> --diagnose` asks a cheap, independent agent WHY the rounds don't converge.
// Advisory only (read only agent, no edits). Its answer is kept in .orquestra/<ID>/diagnosis-<rounds>.md; `orq agent -R -F`
// past policy.max_rounds needs that file for the current round count, newer than the latest fix/review file.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { countRounds, type Metrics, type Reason } from "./rounds.js";

export const DIAG_CAP = 24000; // characters of fix/review text put in the prompt
export const RECOMMENDATIONS = ["continue", "split", "change-implementer", "ask-user"] as const;
export interface Doc { name: string; text: string }
export interface FileTime { name: string; mtimeMs: number }

/** Keep the start and the end of a long text (the verdict is usually at one of them). */
export function trim(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = Math.ceil(max * 0.6), tail = max - head;
  return `${s.slice(0, head)}\n[... ${s.length - max} characters trimmed ...]\n${s.slice(s.length - tail)}`;
}

const reason = (r: Reason) => ({
  over_max: `rounds ${r.n} is over max_rounds ${r.max}`,
  at_max: `rounds ${r.n} reached max_rounds ${r.max}`,
  same_finding: `the same heavy finding came back in ${r.n} reviews`,
  repeated: `${r.n} heavy finding(s) repeated across reviews`,
  slow: `round ${r.rounds?.join(", ")} was much slower than the others`,
})[r.code];

const mins = (s: number) => `${Math.round(s / 60)} min`;

/** The pure part: metrics + fix files + review outputs → the watchdog prompt. Each document is trimmed to its share of `cap`. */
export function buildPrompt(x: Metrics, fixes: Doc[], reviews: Doc[], cap = DIAG_CAP): string {
  const docs = [...fixes, ...reviews], each = docs.length ? Math.max(1500, Math.floor(cap / docs.length)) : 0;
  const block = (d: Doc) => `--- ${d.name} ---\n${trim(d.text.trim(), each)}\n--- end of ${d.name} ---`;
  return [
    `You are an independent watchdog for issue ${x.issue}. An implementer agent and a reviewer agent have been going back and forth`,
    `and the review/fix loop is not converging (alert: ${x.level}). Diagnose WHY. You are advisory only: do not edit, create or run anything;`,
    `answer from the material below.`,
    ``,
    `## Metrics`,
    `- fix rounds: ${x.rounds} (policy.max_rounds = ${x.max}); total time ${mins(x.secs)}; ${x.findings} finding(s) across reviews`,
    ...x.perRound.map((r) => `- ${r.round === 0 ? "implementation + first review" : `fix ${r.round} + review`}: ${mins(r.secs)}`),
    ...(x.reasons.length ? [`- why the alert: ${x.reasons.map(reason).join("; ")}`] : []),
    ...(x.repeats.length ? [`- heavy findings that repeat:`, ...x.repeats.map((r) => `  - rounds ${r.rounds.join(",")}: ${r.file ? `${r.file} ` : ""}${r.title.slice(0, 160)}`)] : []),
    ``,
    `## What to decide`,
    `Look for the real cause, for example: reviewer and implementer disagree about the requirement or the style; the scope is too big for one`,
    `branch; a flaky or environment-dependent test; an ambiguous spec or acceptance criterion; fixes that fix the symptom of each review and`,
    `introduce the next one; a reviewer that keeps raising new things instead of checking the previous ones.`,
    ``,
    `## Answer format`,
    `A short diagnosis (at most 15 lines): the cause, with the evidence (which round, which file or finding). Then, as the LAST line, exactly:`,
    `RECOMMENDATION: <${RECOMMENDATIONS.join(" | ")}> - one sentence why`,
    `where continue = one more round is likely to converge, split = split the issue into smaller ones, change-implementer = another`,
    `implementer should take over, ask-user = a decision or information only the user has is blocking.`,
    ``,
    `## Material`,
    docs.length ? docs.map(block).join("\n\n") : "(no fix or review files)",
    ``,
  ].join("\n");
}

/** The "RECOMMENDATION: ..." line of a diagnosis (the last one), without markdown emphasis; undefined when there is none. */
export function recommendation(text: string): string | undefined {
  const ls = text.split("\n").map((l) => l.replace(/[*_`]/g, "").trim()).filter((l) => /^RECOMMENDATION\s*:/i.test(l));
  return ls.length ? ls[ls.length - 1] : undefined;
}

const num = (re: RegExp, n: string) => { const r = re.exec(n); return r ? Number(r[1]) : undefined; };

/** The pure gate for `orq agent -R -F` past max_rounds. ok = diagnosis-<rounds>.md exists and is not older than the latest
 *  fix-<n>.md / review-*.out.md; missing = no such file; stale = it is older than one of them (the loop went on after it). */
export function diagnosisGate(rounds: number, files: FileTime[]): "ok" | "missing" | "stale" {
  const d = files.find((f) => num(/^diagnosis-(\d+)\.md$/, f.name) === rounds);
  if (!d) return "missing";
  const latest = Math.max(0, ...files.filter((f) => /^(fix-\d+\.md|review-.+\.out\.md)$/.test(f.name)).map((f) => f.mtimeMs));
  return d.mtimeMs >= latest ? "ok" : "stale";
}

const times = (dir: string): FileTime[] => {
  try { return readdirSync(dir).map((name) => ({ name, mtimeMs: statSync(join(dir, name)).mtimeMs })); } catch { return []; }
};
const read = (f: string) => { try { return readFileSync(f, "utf8"); } catch { return ""; } };

/** The impure part of the gate: the folder .orquestra/<ID>/ → verdict and the round count it was judged for. */
export function gateFor(dir: string): { verdict: "ok" | "missing" | "stale"; rounds: number } {
  const files = times(dir), rounds = countRounds(dir, files.map((f) => f.name)); // the same count `orq rounds` shows
  return { verdict: diagnosisGate(rounds, files), rounds };
}

/** fix-<n>.md and review-*.out.md of an issue folder, in round order, as documents for buildPrompt. */
export function evidence(dir: string): { fixes: Doc[]; reviews: Doc[] } {
  const names = times(dir).map((f) => f.name);
  const fixes = names.filter((n) => /^fix-\d+\.md$/.test(n)).sort((a, b) => num(/(\d+)/, a)! - num(/(\d+)/, b)!);
  const rv = (n: string) => num(/-(\d+)\.out\.md$/, n) ?? 0;
  const reviews = names.filter((n) => /^review-.+\.out\.md$/.test(n)).sort((a, b) => rv(a) - rv(b) || a.localeCompare(b));
  const doc = (n: string): Doc => ({ name: n, text: read(join(dir, n)) });
  return { fixes: fixes.map(doc), reviews: reviews.map(doc) };
}

/** Highest diagnosis-<n>.md of an issue folder → its recommendation line (for `orq rounds`). */
export function latestDiagnosis(dir: string): { n: number; line?: string } | undefined {
  const ns = times(dir).map((f) => num(/^diagnosis-(\d+)\.md$/, f.name)).filter((n): n is number => n !== undefined);
  if (!ns.length) return undefined;
  const n = Math.max(...ns);
  return { n, line: recommendation(read(join(dir, `diagnosis-${n}.md`))) };
}
