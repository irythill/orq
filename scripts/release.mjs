#!/usr/bin/env node
// Release helper for CI (not shipped in the package). The version is derived from Conventional Commits since the last v* tag:
// feat → minor, fix/perf → patch, `type!:` or BREAKING CHANGE → major (minor while on 0.x); anything else → no release.
//   node scripts/release.mjs next    {"last","next","bump"} as JSON (next = null when nothing to release)
//   node scripts/release.mjs check   fails unless package.json, package-lock.json and both changelogs carry `next`
//   node scripts/release.mjs notes   markdown body for the dev → main PR
//   node scripts/release.mjs bump    writes `next` into package.json, package-lock.json and both changelogs
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
const RANK = { none: 0, patch: 1, minor: 2, major: 3 };

/** The highest v* tag in the repo. Not `git describe`: release tags sit on main's merge commits, which dev never contains. */
export function lastTag() {
  try { return git("tag", "--list", "v[0-9]*.[0-9]*.[0-9]*", "--sort=-v:refname").split("\n")[0] || undefined; } catch { return undefined; }
}

/** Match a squashed release to its original tree on the target branch; otherwise retain the tag as the base. */
export function releaseBase(tag, ref = "HEAD") {
  const tree = git("rev-parse", `${tag}^{tree}`);
  const match = git("log", "--first-parent", "--format=%H %T", `${tag}..${ref}`).split("\n")
    .find((line) => line.split(" ")[1] === tree);
  return match?.split(" ")[0] ?? tag;
}

/** [{subject, body}] of the non-merge commits not yet included in the tagged release. */
export function commits(tag, ref = "HEAD") {
  const out = git("log", "--no-merges", "--format=%s%x1f%b%x1e", tag ? `${releaseBase(tag, ref)}..${ref}` : ref);
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

/** The release files with `version` applied: package and lock versions, and a `## [<version>] — <date>` heading under
 *  [Unreleased] in each changelog (left alone when it already has one). */
export function bumped(version, date, files) {
  const json = (o) => JSON.stringify(o, null, 2) + "\n";
  const lock = { ...files.lock, version };
  if (lock.packages?.[""]) lock.packages = { ...lock.packages, "": { ...lock.packages[""], version } };
  const log = (t) => (t.includes(`## [${version}]`) ? t : t.replace(/^## \[Unreleased\]\n/m, `## [Unreleased]\n\n## [${version}] — ${date}\n`));
  return { pkg: json({ ...files.pkg, version }), lock: json(lock), en: log(files.en), pt: log(files.pt) };
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
    if (n.next) lines.push(`Before merging: merge the \`chore(release): ${n.next}\` PR into dev (opened by the release-pr workflow); the \`version\` check waits for it. Merging this one tags and publishes.`);
    console.log(lines.join("\n"));
    return 0;
  }
  if (cmd === "bump") {
    if (!n.next) { console.log(`nothing to release since ${last ?? "the start"}`); return 0; }
    const read = (f) => readFileSync(f, "utf8");
    const out = bumped(n.next, new Date().toISOString().slice(0, 10), { pkg: JSON.parse(read("package.json")),
      lock: JSON.parse(read("package-lock.json")), en: read("CHANGELOG.md"), pt: read("CHANGELOG.pt-BR.md") });
    writeFileSync("package.json", out.pkg); writeFileSync("package-lock.json", out.lock);
    writeFileSync("CHANGELOG.md", out.en); writeFileSync("CHANGELOG.pt-BR.md", out.pt);
    console.log(n.next);
    return 0;
  }
  console.error("usage: node scripts/release.mjs next|check|notes|bump");
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv[2]));
