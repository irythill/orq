// orq wait — Notifier for any conductor: block until children started by `orq agent` (or herdr-verify/-baseline) write
// <prefix>.done, then print one line each: "[ORQ AGENT DONE] <title> status=ok rc=0 ... answer: <file>".
// Exit 0 = all ok, 1 = some failed (or its runner died without .done), 124 = timeout. With --any, returns at the first.
// Claude Code: run it as a background task; it wakes the conductor when it exits.
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { m } from "../i18n.js";
import { alive } from "../lock.js";

export const USAGE = "orq wait [--any] [--timeout <s>] [--answer] <prefix>...   block until child agents finish (exit 1 = one failed)";

const read = (f: string) => { try { return readFileSync(f, "utf8"); } catch { return undefined; } };

/** Finished? → its summary line and whether it went well. */
export function doneLine(prefix: string): { line: string; ok: boolean } | undefined {
  let done = read(`${prefix}.done`)?.trim();
  if (done === undefined) {
    const pid = Number(read(`${prefix}.pid`));
    if (!pid || alive(pid) || existsSync(`${prefix}.done`)) return undefined;
    done = `status=died ${m("(the runner exited without writing .done)", "(o runner saiu sem escrever .done)")}`;
  }
  let title = basename(prefix);
  try { title = JSON.parse(read(`${prefix}.job.json`) ?? "").title || title; } catch { /* verify/baseline: no job */ }
  const answer = [`${prefix}.out.md`, `${prefix}.txt`].find(existsSync) ?? prefix;
  return { line: `[ORQ AGENT DONE] ${title} ${done} answer: ${answer}`, ok: /\bstatus=ok\b/.test(done) };
}

export async function wait(argv: string[]): Promise<number> {
  let any = false, timeout = 0, answer = false;
  const pending: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--any") any = true; else if (a === "--answer") answer = true;
    else if (a === "--timeout") timeout = Number(argv[++i]);
    else if (!a.startsWith("-")) pending.push(a.replace(/\.(done|out\.md)$/, ""));
    else { console.error(USAGE); return 2; }
  }
  if (!pending.length || Number.isNaN(timeout)) { console.error(USAGE); return 2; }
  const end = timeout > 0 ? Date.now() + timeout * 1000 : Infinity;
  let failed = false;
  for (;;) {
    for (const p of [...pending]) {
      const d = doneLine(p);
      if (!d) continue;
      pending.splice(pending.indexOf(p), 1);
      console.log(d.line);
      if (answer) { const t = read(`${p}.out.md`); if (t) console.log(t.trimEnd()); }
      failed ||= !d.ok;
      if (any) return d.ok ? 0 : 1;
    }
    if (!pending.length) return failed ? 1 : 0;
    if (Date.now() > end) {
      console.log(m(`still running: ${pending.join(" ")}`, `ainda rodando: ${pending.join(" ")}`));
      return 124;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
