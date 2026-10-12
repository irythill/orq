import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { merge } from "./config.js";
import { parseLocal } from "./commands/block.js";
import { setTomlString } from "./toml-set.js";
import { fromCache } from "./quota.js";

process.env.ORQ_LANG = "en"; // messages checked below are the English ones
const CLI = fileURLToPath(new URL("./cli.js", import.meta.url));

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "orq-test-"));
  const env = { ...process.env, XDG_CONFIG_HOME: join(root, "cfg"), XDG_STATE_HOME: join(root, "state"), ORQ_LANG: "en" };
  delete (env as Record<string, string | undefined>).ORQ_CONFIG;
  const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { env, cwd: root, encoding: "utf8" });
  return { root, env, run };
}

test("setTomlString: replaces, adds key, adds section, keeps the rest", () => {
  const src = "# mine\n[ui]\nlang = \"en\"\ntheme = \"lcd\"\n\n[machine]\ntui = true\n";
  assert.equal(setTomlString(src, "ui", "lang", "pt"), "# mine\n[ui]\nlang = \"pt\"\ntheme = \"lcd\"\n\n[machine]\ntui = true\n");
  assert.equal(setTomlString(src, "machine", "x", "1"), src.replace("tui = true\n", "tui = true\nx = \"1\"\n"));
  assert.equal(setTomlString(src, "ui", "new", "v"), "# mine\n[ui]\nlang = \"en\"\ntheme = \"lcd\"\nnew = \"v\"\n\n[machine]\ntui = true\n");
  assert.equal(setTomlString("", "ui", "lang", "pt"), "\n[ui]\nlang = \"pt\"\n");
  assert.equal(setTomlString("a = 1\r\n", "ui", "lang", "pt"), "a = 1\n\n[ui]\nlang = \"pt\"\n");
});

test("merge is deep, key by key", () => {
  assert.deepEqual(merge({ a: { x: 1, y: 2 }, b: 1 }, { a: { y: 3 }, c: [1] }), { a: { x: 1, y: 3 }, b: 1, c: [1] });
});

test("parseLocal reads a bare date as local midnight", () => {
  const d = parseLocal("2026-10-16");
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2026, 9, 16, 0]);
  assert.throws(() => parseLocal("not a date"));
});

test("config: defaults, layers, get, files", () => {
  const { root, env, run } = sandbox();
  assert.equal(run("config", "get", "machine.agent_mem_max").stdout.trim(), "4G");
  assert.equal(run("config", "files").stdout.trim(), "(no file; defaults only)");
  mkdirSync(join(env.XDG_CONFIG_HOME!, "orq"), { recursive: true });
  writeFileSync(join(env.XDG_CONFIG_HOME!, "orq", "config.toml"), "[machine]\nagent_mem_max = \"8G\"\n");
  mkdirSync(join(root, "ws", ".orq"), { recursive: true });
  writeFileSync(join(root, "ws", ".orq", "workspace.json"), JSON.stringify({ policy: { max_rounds: 3 } }));
  const all = JSON.parse(run("config", "-w", join(root, "ws")).stdout);
  assert.equal(all.machine.agent_mem_max, "8G");
  assert.equal(all.machine.test_slots, 1);
  assert.equal(all.policy.max_rounds, 3);
  assert.equal(all._workspace, join(root, "ws"));
  assert.equal(run("config", "get", "nope.nothing").status, 1);
  assert.equal(run("config", "get", "machine.tui").stdout.trim(), "false");
});

test("config: broken file exits 2", () => {
  const { env, run } = sandbox();
  mkdirSync(join(env.XDG_CONFIG_HOME!, "orq"), { recursive: true });
  writeFileSync(join(env.XDG_CONFIG_HOME!, "orq", "config.toml"), "[ui\n");
  const r = run("config");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /error reading/);
});

test("set and lang write the config file", () => {
  const { env, run } = sandbox();
  assert.equal(run("set", "ui", "theme", "lcd").status, 0);
  assert.equal(run("lang", "pt").stdout.trim(), "Idioma do orq: Português");
  assert.match(run("lang").stdout, /^pt \(ui.lang = pt\)/);
  assert.equal(run("lang", "toggle").stdout.trim(), "orq language: English");
  const text = readFileSync(join(env.XDG_CONFIG_HOME!, "orq", "config.toml"), "utf8");
  assert.equal(text, "\n[ui]\ntheme = \"lcd\"\nlang = \"en\"\n");
  assert.equal(run("lang", "xx").status, 2);
});

test("block: add, list, remove, expire", () => {
  const { env, run } = sandbox();
  assert.match(run("block", "-l").stdout, /no active blocks/);
  assert.match(run("block", "copilot", "--days", "2", "--reason", "franchise").stdout, /copilot out of orq-pick until/);
  const f = join(env.XDG_STATE_HOME!, "orq", "blocks.json");
  writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, "utf8")), old: { until: 1, reason: "" } }));
  const list = run("block", "-l").stdout;
  assert.match(list, /^copilot +until .* franchise$/m);
  assert.doesNotMatch(list, /old/);
  assert.match(run("block", "-r", "copilot").stdout, /copilot unblocked/);
  assert.match(run("block", "-l").stdout, /no active blocks/);
  assert.equal(run("block", "x", "--until", "garbage").status, 2);
});

test("unknown command exits 2", () => {
  assert.equal(sandbox().run("nope").status, 2);
});

test("codexFromSession: last rate_limits, windows by length, reset windows read 0", async () => {
  const { codexFromSession } = await import("./quota.js");
  const ev = (p: number, s: number, resets: number) => JSON.stringify({ payload: { rate_limits: {
    primary: { used_percent: p, window_minutes: 300, resets_at: resets },
    secondary: { used_percent: s, window_minutes: 10080, resets_at: resets + 1000 } } } });
  assert.deepEqual(codexFromSession(`${ev(10, 20, 2000)}\n{"x":1}\n${ev(42.7, 77, 2000)}\n`, 1000), { five: 42, week: 77 });
  assert.deepEqual(codexFromSession(ev(10, 20, 500), 1000), { five: 0, week: 20 });
  assert.equal(codexFromSession('{"nothing":true}', 1000), undefined);
});

test("collect: none, false, command and filtering by name", async () => {
  const { collect } = await import("./quota.js");
  const cmd = `"${process.execPath}" -e "console.log('mm 5h=10% week=20% [x]'); console.log('junk')"`;
  const lines = await collect({ opencode: "none", copilot: false, minimax: { command: cmd } });
  assert.deepEqual(lines, ["opencode 5h=- week=- [no quota collector]", "mm 5h=10% week=20% [x]"]);
  assert.deepEqual(await collect({ opencode: "none", minimax: { command: cmd } }, ["mm"]), ["mm 5h=10% week=20% [x]"]);
  assert.match((await collect({ broken: { command: "exit 1" } }))[0], /^broken 5h=\? week=\? \[collector failed\]$/);
});

test("quota: a failed reading falls back to the last good one, window by window", () => {
  const st = mkdtempSync(join(tmpdir(), "orq-q-"));
  const old = process.env.XDG_STATE_HOME; process.env.XDG_STATE_HOME = st;
  try {
    assert.deepEqual(fromCache("acc", "HTTP 429"), { name: "acc", five: "?", week: "?", note: "HTTP 429" });
    mkdirSync(join(st, "orq", "quota"), { recursive: true });
    const at = Date.parse("2026-10-12T12:00:00Z"), h = 3600_000;
    writeFileSync(join(st, "orq", "quota", "acc.json"), JSON.stringify({ at,
      five: { pct: 100, resetsAt: "2026-10-12T14:00:00Z" }, week: { pct: 8, resetsAt: "2026-10-18T04:00:00Z" } }));
    const q = fromCache("acc", "HTTP 429", at + 10 * 60_000);
    assert.equal(q.five, 100); assert.equal(q.week, 8); assert.match(q.note!, /HTTP 429; .*10 min/);
    const later = fromCache("acc", "HTTP 429", at + 3 * h);             // 5h window reset, week still open
    assert.equal(later.five, 0); assert.equal(later.week, 8);
    writeFileSync(join(st, "orq", "quota", "acc.json"), JSON.stringify({ at, five: { pct: 50 }, week: { pct: "-" } }));
    assert.equal(fromCache("acc", "x", at + h).five, 50);               // no reset time: kept up to 5 h
    assert.equal(fromCache("acc", "x", at + 6 * h).five, "?");
  } finally { if (old === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = old; }
});
