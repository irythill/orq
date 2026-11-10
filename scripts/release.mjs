#!/usr/bin/env node
// Release helper for CI (not shipped in the package). The version is derived from Conventional Commits since the last v* tag:
// feat → minor, fix/perf → patch, `type!:` or BREAKING CHANGE → major (minor while on 0.x); anything else → no release.
//   node scripts/release.mjs next    {"last","next","bump"} as JSON (next = null when nothing to release)
//   node scripts/release.mjs check   fails unless package.json, package-lock.json and both changelogs carry `next`
//   node scripts/release.mjs notes   markdown body for the dev → main PR
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
const RANK = { none: 0, patch: 1, minor: 2, major: 3 };

/** The highest v* tag in the repo. Not `git describe`: release tags sit on main's merge commits, which dev never contains. */
export function lastTag() {
  try { return git("tag", "--list", "v[0-9]*.[0-9]*.[0-9]*", "--sort=-v:refname").split("\n")[0] || undefined; } catch { return undefined; }
}

/** [{subject, body}] of the non-merge commits after `tag` up to `ref`. */
export function commits(tag, ref = "HEAD") {
  const out = git("log", "--no-merges", "--format=%s%x1f%b%x1e", tag ? `${tag}..${ref}` : ref);
  return out.split("\x1e").map((c) => c.trim()).filter(Boolean).map((c) => {
    const [subject, body = ""] = c.split("\x1f");
    return { subject, body };
  });
}

/** The bump one commit asks for. */
export function bumpOf({ subject, body }) {
  const m = /^(\w+)(\([^)]*\))?(!)?:/.exec(subject);
  if (!m) return "none";
  if (m[3] || /^BREAKING[ -]CHANGE:/m.test(body)) return "major";
  if (m[1] === "feat") return "minor";
  if (m[1] === "fix" || m[1] === "perf") return "patch";
  return "none";
}

export function next(last, list) {
  const bump = list.map(bumpOf).reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "none");
  if (bump === "none") return { last, next: null, bump };
  const [M, mi, p] = (last ?? "v0.0.0").replace(/^v/, "").split(".").map(Number);
  const eff = bump === "major" && M === 0 ? "minor" : bump;
  const v = eff === "major" ? `${M + 1}.0.0` : eff === "minor" ? `${M}.${mi + 1}.0` : `${M}.${mi}.${p + 1}`;
  return { last, next: v, bump: eff };
}

/** Problems that keep `version` from being released (empty = ready). */
export function problems(version, files) {
  const out = [];
  if (files.pkg.version !== version) out.push(`package.json has ${files.pkg.version}, expected ${version}`);
  if (files.lock.version !== version) out.push(`package-lock.json has ${files.lock.version}, expected ${version}`);
  for (const [name, text] of [["CHANGELOG.md", files.en], ["CHANGELOG.pt-BR.md", files.pt]]) {
    if (!text.includes(`## [${version}]`)) out.push(`${name} has no "## [${version}]" section`);
    const unreleased = /## \[Unreleased\]\n([\s\S]*?)\n## \[/.exec(text)?.[1] ?? "";
    if (/\S/.test(unreleased)) out.push(`${name}: [Unreleased] is not empty (move it under ${version})`);
  }
  return out;
}

function main(cmd) {
  const last = lastTag(), list = commits(last), n = next(last, list);
  if (cmd === "next") { console.log(JSON.stringify(n)); return 0; }
  if (cmd === "check") {
    if (!n.next) { console.log(`nothing to release since ${last ?? "the start"} (only chore/test/docs commits)`); return 0; }
    const read = (f) => readFileSync(f, "utf8");
    const p = problems(n.next, { pkg: JSON.parse(read("package.json")), lock: JSON.parse(read("package-lock.json")),
      en: read("CHANGELOG.md"), pt: read("CHANGELOG.pt-BR.md") });
    if (!p.length) { console.log(`ready: ${last ?? "-"} → v${n.next} (${n.bump})`); return 0; }
    console.error(`release v${n.next} (${n.bump} since ${last ?? "the start"}) is not ready:\n- ${p.join("\n- ")}`);
    return 1;
  }
  if (cmd === "notes") {
    const groups = { major: "Breaking", minor: "Features", patch: "Fixes", none: "Other" };
    const lines = [n.next ? `Next version: **v${n.next}** (${n.bump}, since ${last ?? "the start"}).` : `Nothing to release since ${last ?? "the start"}.`, ""];
    for (const k of ["major", "minor", "patch", "none"]) {
      const cs = list.filter((c) => bumpOf(c) === k);
      if (cs.length) lines.push(`**${groups[k]}**`, ...cs.map((c) => `- ${c.subject}`), "");
    }
    lines.push("Before merging: bump package.json (`npm version <v> --no-git-tag-version`) and move [Unreleased] to the new version in both changelogs; the `version` check enforces it. Merging tags and publishes.");
    console.log(lines.join("\n"));
    return 0;
  }
  console.error("usage: node scripts/release.mjs next|check|notes");
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv[2]));
