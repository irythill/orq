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
import { antigravityFromModels, copilotFromUser, fromCache } from "./quota.js";

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

test("quota: copilot premium requests become the monthly figure in the week slot", () => {
  const q = copilotFromUser({ quota_snapshots: { premium_interactions: { percent_remaining: 77, unlimited: false } },
    quota_reset_date: "2026-11-01" });
  assert.equal(q.five, "-"); assert.equal(q.week, 23); assert.match(q.note!, /2026-11-01/);
  assert.equal(copilotFromUser({ quota_snapshots: { premium_interactions: { unlimited: true } } }).week, "-");
  assert.equal(copilotFromUser({}).week, "?");
});

test("quota: antigravity takes the worst model per window (reset within 6 h = 5h window, later = week)", () => {
  const now = Date.parse("2026-10-12T17:00:00Z");
  const q = antigravityFromModels({
    a: { quotaInfo: { remainingFraction: 0.75, resetTime: "2026-10-12T22:00:00Z" } },
    b: { quotaInfo: { remainingFraction: 0.4, resetTime: "2026-10-19T17:00:00Z" } },
    c: { quotaInfo: { remainingFraction: 0.9, resetTime: "2026-10-19T17:00:00Z" } },
    d: { quotaInfo: { remainingFraction: 1 } },
  }, now);
  assert.equal(q.five.pct, 25); assert.equal(q.week.pct, 60); assert.equal(q.week.resetsAt, "2026-10-19T17:00:00Z");
  assert.equal(antigravityFromModels({}, now).five.pct, "-");
});

test("roles: legacy agents.roles become an auto pool; [roles] fixed and pool win", async () => {
  const { resolveRole } = await import("./roles.js");
  const agents = { codex: { roles: ["impl", "review"] }, claude: { roles: ["impl"] }, agy: { roles: ["review"] } };
  assert.deepEqual(resolveRole({ agents }, "worker"), { mode: "auto", pool: ["codex", "claude"], rule: "other-vendor", section: undefined });
  const cfg = { agents, policy: { review: "any" },
    roles: { primary: { agent: "codex", fallback: ["claude"] }, reviewer: { pick: "auto", pool: ["agy"], rule: "other-vendor" } } };
  assert.deepEqual(resolveRole(cfg, "impl"), { mode: "fixed", order: ["codex", "claude"], rule: "any", section: "primary" });
  assert.equal(resolveRole(cfg, "worker").mode, "fixed"); // no [roles.workers] → the primary's
  assert.deepEqual(resolveRole(cfg, "review"), { mode: "auto", pool: ["agy"], rule: "other-vendor", section: "reviewer" });
});

test("pick: fixed role takes the first usable agent in order, never one outside the list", async () => {
  const { pick, parseQuota } = await import("./pick.js");
  const agents = {
    codex: { quota: ["codex"], models: { impl: { default: "gpt-6-sol@low" } } },
    claude: { quota: ["work", "home"], models: { impl: { default: "claude-sonnet-5" } } },
    opencode: { vendor: "minimax", models: { impl: { default: "minimax/MiniMax-M3" }, review: { default: "minimax/MiniMax-M3" } } },
  };
  const base = { level: "medium", exclude: new Set<string>(), stats: [], blocks: new Set<string>(), recent: [] };
  const cfg = { agents, roles: { primary: { agent: "codex", fallback: ["claude"] } } };
  const quota = parseQuota("codex 5h=95% week=10%\nwork 5h=50% week=60%\nhome 5h=? week=?\n");
  assert.deepEqual(quota, { codex: 95, work: 60, home: null });
  const r = pick({ ...base, cfg, role: "impl", quota });
  assert.equal(r.mode, "fixed");
  assert.deepEqual([r.best?.agent, r.best?.acct], ["claude", "work"]);
  assert.match(r.notes[0], /^codex: quota >= 90%/);
  const none = pick({ ...base, cfg, role: "impl", quota: { codex: 95, work: 95, home: 95 } });
  assert.equal(none.best, undefined); // opencode is not in the list: no silent swap
  const auto = pick({ ...base, cfg: { agents, roles: { reviewer: { pool: ["claude", "opencode"] } } }, role: "review",
    implVendor: "anthropic", quota: {} });
  assert.equal(auto.best?.agent, "opencode"); // claude: same vendor (built-in vendor)
});

test("suggestRoles: the maintainer's setup comes out of plain answers", async () => {
  const { suggestRoles } = await import("./suggest.js");
  const p = suggestRoles({ conductor: "claude", parallel: 4, ramGB: 14, agents: {
    claude: { plan: "large" }, codex: { plan: "large", trust: true }, opencode: { plan: "payg", vendor: "minimax" },
    antigravity: { plan: "free" }, copilot: { plan: "small" } } });
  assert.deepEqual(p.roles.primary, { agent: "codex", fallback: ["claude"] });
  assert.deepEqual(p.roles.reviewer, { pick: "auto", pool: ["claude", "opencode", "antigravity"], rule: "other-vendor" });
  assert.deepEqual(p.roles.opinion, { pick: "auto", pool: ["copilot"] });
  assert.equal(p.agents.claude.reserve, true);
  assert.deepEqual(p.agents.antigravity.roles, ["review"]);
  assert.deepEqual(p.machine, { agent_mem_max: "4G", test_mem_max: "5G" });
  assert.equal(p.weights.tokens, 0.45);
});

test("suggestRoles: one agent, one vendor, two vendors", async () => {
  const { suggestRoles } = await import("./suggest.js");
  const one = suggestRoles({ conductor: "codex", parallel: 1, ramGB: 8, agents: { codex: { plan: "large" } } });
  assert.deepEqual(one.roles.reviewer, { pick: "auto", pool: ["codex"], rule: "any" });
  assert.match(one.notices[0], /second agent/);
  assert.equal(one.weights.quality, 0.55);
  const same = suggestRoles({ conductor: "other", parallel: 2, ramGB: 16,
    agents: { claude: { plan: "large" }, mine: { plan: "large", vendor: "anthropic" } } });
  assert.equal(same.roles.reviewer.rule, "any");
  assert.match(same.notices[0], /cross-vendor review is off/);
  const two = suggestRoles({ conductor: "claude", parallel: 2, ramGB: 16,
    agents: { claude: { plan: "large" }, codex: { plan: "large" } } });
  assert.equal(two.roles.primary.agent, "codex"); // keeps the conductor's quota free
  assert.deepEqual(two.roles.reviewer.pool, ["claude"]);
});

test("lock: FIFO with slots, re-entrant, dead holders are swept", async () => {
  const { acquire, release, status } = await import("./lock.js");
  const { spawn } = await import("node:child_process");
  const st = mkdtempSync(join(tmpdir(), "orq-l-"));
  const old = process.env.XDG_STATE_HOME; process.env.XDG_STATE_HOME = st;
  const kid = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"]);
  try {
    await acquire("t", kid.pid!, "kid", 1, undefined, 20);
    await acquire("t", kid.pid!, "kid", 1, undefined, 20); // same process again: no deadlock
    let waited = 0, got = false;
    const me = acquire("t", process.pid, "me", 1, (n) => { waited = n; }, 20).then(() => { got = true; });
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(got, false);
    assert.equal(waited, 1);
    assert.deepEqual(status("t").waiters.map((e) => e.label), ["me"]);
    kid.kill(); await new Promise((r) => kid.once("exit", r)); // the holder dies without releasing
    await me;
    assert.deepEqual(status("t").holders.map((e) => e.label), ["me"]);
    release("t", process.pid);
    assert.deepEqual(status("t"), { holders: [], waiters: [] });
    await acquire("two", process.pid, "a", 2, undefined, 20); // 2 slots: a second process would not wait
    assert.equal(status("two").holders.length, 1);
  } finally {
    kid.kill();
    if (old === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = old;
  }
});

test("claim: claim, refuse, release, take over a stale owner", () => {
  const { root, env, run } = sandbox();
  const as = (who: string, ...a: string[]) => spawnSync(process.execPath, [CLI, "claim", "-w", root, ...a],
    { env: { ...env, HERDR_PANE_ID: "", ORQ_CONDUCTOR_ID: who }, encoding: "utf8" });
  delete (env as Record<string, string | undefined>).HERDR_PANE_ID;
  assert.match(as("a", "X-1").stdout, /X-1 is yours \(a\)/);
  assert.match(as("a", "X-1").stdout, /already yours/);
  const r = as("b", "X-1");
  assert.equal(r.status, 1); assert.match(r.stdout, /owned by another conductor/);
  const f = join(root, ".orquestra", "X-1", "owner");
  writeFileSync(f, "pane=a kind=id account=x at=2000-01-01T00:00:00Z\n");
  assert.match(as("b", "X-1").stdout, /previous owner \(a\) is gone/);
  assert.equal(as("a", "-r", "X-1").status, 1);
  assert.equal(as("b", "-r", "X-1").status, 0);
  void run;
});

test("process: sizes, tree memory, and the watchdog kills a tree over the cap", async () => {
  const { parseSize, treeMem, runCapped } = await import("./process.js");
  assert.equal(parseSize("4G"), 4 * 2 ** 30); assert.equal(parseSize("512M"), 512 * 2 ** 20);
  assert.equal(parseSize("1.5g"), 1.5 * 2 ** 30); assert.equal(parseSize("off"), undefined);
  assert.throws(() => parseSize("lots"));
  const t = new Map<number, [number, number]>([[1, [0, 10]], [2, [1, 5]], [3, [2, 1]], [4, [9, 100]]]);
  assert.equal(treeMem(1, t), 16); assert.equal(treeMem(2, t), 6);
  const hog = "const a=[];setInterval(()=>a.push(Buffer.alloc(50e6,1)),100);setTimeout(()=>process.exit(0),20000)";
  assert.equal(await runCapped(process.execPath, ["-e", hog], { cap: 300 * 2 ** 20, mode: "watchdog", intervalMs: 300 }), 137);
  assert.equal(await runCapped(process.execPath, ["-e", "process.exit(3)"], { cap: 2 ** 30, mode: "watchdog" }), 3);
  assert.equal(await runCapped(process.execPath, ["-e", "0"], { mode: "auto" }), 0); // no cap
});
