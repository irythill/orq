import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
  // A fake home too: nothing a test runs may reach the real ~/.claude, ~/.config/orq or ~/.local/state/orq.
  const env = { ...process.env, XDG_CONFIG_HOME: join(root, "cfg"), XDG_STATE_HOME: join(root, "state"), ORQ_LANG: "en",
    HOME: join(root, "home"), USERPROFILE: join(root, "home"), APPDATA: join(root, "appdata"), LOCALAPPDATA: join(root, "localappdata") };
  for (const k of ["ORQ_CONFIG", "CLAUDE_CONFIG_DIR", "CLAUDE_ACCOUNTS_FILE"]) delete (env as Record<string, string | undefined>)[k];
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
  // Free plan: a single 30-day window. It must count (it used to read "-", i.e. no limit, at 80 %).
  const free = JSON.stringify({ payload: { rate_limits: { primary: { used_percent: 80, window_minutes: 43200, resets_at: 9000 },
    secondary: null } } });
  assert.deepEqual(codexFromSession(free, 1000), { five: "-", week: 80, span: 43200 });
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

test("pick: a fix keeps the implementer's agent, model and account, one effort level up", async () => {
  const { escalate } = await import("./pick.js");
  assert.equal(escalate("-a codex -m gpt-6-sol -e low\n"), "-a codex -m gpt-6-sol -e medium");
  assert.equal(escalate("-a claude -m claude-sonnet-5 -e medium -c work"), "-a claude -m claude-sonnet-5 -e high -c work");
  assert.equal(escalate("-a codex -m gpt-6-sol -e high"), "-a codex -m gpt-6-sol -e high");
  assert.equal(escalate("-a opencode -m minimax/MiniMax-M3"), "-a opencode -m minimax/MiniMax-M3");
  assert.equal(escalate("-a codex -m gpt-6-sol -e xhigh"), "-a codex -m gpt-6-sol -e xhigh");
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
  // The hog stops at ~1 GB: unbounded growth starved the (slow) Windows sampler on CI runners and the test flaked.
  const hog ="const a=[];setInterval(()=>a.length<20&&a.push(Buffer.alloc(50e6,1)),100);setTimeout(()=>process.exit(0),90000)";
  assert.equal(await runCapped(process.execPath, ["-e", hog], { cap: 300 * 2 ** 20, mode: "watchdog", intervalMs: 300 }), 137);
  assert.equal(await runCapped(process.execPath, ["-e", "process.exit(3)"], { cap: 2 ** 30, mode: "watchdog" }), 3);
  assert.equal(await runCapped(process.execPath, ["-e", "0"], { mode: "auto" }), 0); // no cap
});

test("banner: only in a terminal, plain ASCII without color, roles beside the orc", async () => {
  const { banner, colorMode, infoLines, ORC } = await import("./banner.js");
  assert.equal(banner(["x"], "none", false), ""); // piped: nothing, ever
  const plain = banner(infoLines({ agents: { codex: {} }, roles: { primary: { agent: "codex" }, reviewer: { pool: ["claude"] } } }), "none", true);
  assert.doesNotMatch(plain, /\x1b/);
  assert.ok(ORC.every((l) => /^[\x20-\x7e]*$/.test(l))); // pure ASCII: renders in any console
  assert.match(plain, /primary  codex/); assert.match(plain, /reviewer    auto \(claude\)/);
  assert.match(banner(["x"], "true", true), /\x1b\[38;2;155;209;74m/);
  assert.equal(colorMode({ NO_COLOR: "1" }, true), "none");
  assert.equal(colorMode({ COLORTERM: "truecolor" }, true), "true");
  assert.equal(colorMode({}, true), "basic");
  assert.equal(colorMode({ COLORTERM: "truecolor" }, false), "none");
});

test("cli: --version is plain when piped; bare orq without a terminal keeps exit 2", () => {
  const { run } = sandbox();
  assert.match(run("--version").stdout, /^\d+\.\d+\.\d+\n$/);
  assert.equal(run().status, 2);
});

test("instructions: SKILL.md for Claude, an AGENTS.md block that keeps the user's text", () => {
  const { root, run } = sandbox();
  const ws = join(root, "ws");
  assert.equal(run("instructions", "claude", "-w", ws).status, 0);
  assert.match(readFileSync(join(ws, ".claude", "skills", "issue", "SKILL.md"), "utf8"), /^---\r?\nname: issue/);
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, "AGENTS.md"), "# Mine\nkeep me\n");
  assert.equal(run("instructions", "agents", "-w", ws).status, 0);
  assert.equal(run("instructions", "agents", "-w", ws).status, 0);
  const a = readFileSync(join(ws, "AGENTS.md"), "utf8");
  assert.match(a, /^# Mine\nkeep me\n\n<!-- orq:issue begin/);
  assert.equal(a.split("orq:issue begin").length, 2); // replaced, not appended twice
  assert.doesNotMatch(a, /^name: issue/m);
  assert.match(a, /orq wait/);
  assert.equal(run("instructions", "nope").status, 2);
});

test("agents: templates expand with optional groups, defaults, lists and quotes", async () => {
  const { expandTemplate, agentDef, BUILTIN_AGENTS } = await import("./agents.js");
  const v = { model: "", effort: "high", roots: ["/a", "/b"], mode: ["--x", "y"], p: "my file" };
  assert.deepEqual(expandTemplate("run [-m {model}] -e {effort} -M {model:def} [--add {roots}] {mode} 'q a' {p}", v),
    ["run", "-e", "high", "-M", "def", "--add", "/a", "--add", "/b", "--x", "y", "q a", "my file"]);
  assert.throws(() => expandTemplate("x {nope}", v), /unknown placeholder/);
  assert.equal(agentDef({ agents: { codex: { mem_max: "6G" } } }, "codex").run, BUILTIN_AGENTS.codex.run);
  assert.equal(agentDef({ agents: { acme: { run: "acme" } } }, "acme").run, "acme");
  assert.throws(() => agentDef({}, "acme"), /unknown agent/);
});

test("agent + wait: a fake agent from the config runs in the background, wait reports it", () => {
  const { root, env, run } = sandbox();
  for (const k of ["HERDR_PANE_ID", "TMUX", "AGENT"]) delete (env as Record<string, string | undefined>)[k];
  (env as Record<string, string>).ORQ_TERMINAL = "plain";
  const fake = join(root, "fake.mjs");
  writeFileSync(fake, `let s = ""; process.stdin.on("data", (d) => s += d).on("end", () => {
  console.log("session id: abc123"); console.error("noise");
  console.log("ANSWER " + s.trim().split(/\\r?\\n/)[0] + " " + process.argv.slice(2).join(","));
  process.exit(s.includes("FAIL") ? 1 : 0); });\n`);
  mkdirSync(join(env.XDG_CONFIG_HOME!, "orq"), { recursive: true });
  writeFileSync(join(env.XDG_CONFIG_HOME!, "orq", "config.json"), JSON.stringify({ agents: { fake: {
    run: `'${process.execPath}' '${fake}' [-m {model}] {mode}`, readonly: "ro", write: false, stdin: true,
    session: { from_log: "session id: (\\S+)" }, mem_max: "off" } } }));
  mkdirSync(join(root, "w"));
  writeFileSync(join(root, "p.md"), "hello\n");
  writeFileSync(join(root, "extra.txt"), "attached\n");
  const O = join(root, "out", "x");
  assert.equal(run("agent", "-a", "fake", "-t", "T one", "-d", join(root, "w"), "-o", O, "--", join(root, "p.md")).status, 2); // write: false
  const r = run("agent", "-a", "fake", "-t", "T one", "-d", join(root, "w"), "-o", O, "-r", "-m", "mm", "-i", join(root, "extra.txt"), "--", join(root, "p.md"));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /T one → pid:\d+/);
  const w = run("wait", "--timeout", "60", "--answer", O);
  assert.equal(w.status, 0, w.stdout + w.stderr);
  assert.match(w.stdout, /^\[ORQ AGENT DONE\] T one status=ok rc=0 .*answer: .*x\.out\.md/m);
  assert.match(readFileSync(`${O}.out.md`, "utf8"), /ANSWER hello -m,mm,ro/);
  assert.equal(readFileSync(`${O}.id`, "utf8").trim(), "abc123");
  assert.match(readFileSync(`${O}.log`, "utf8"), /noise/);
  assert.match(readFileSync(`${O}.prompt.md`, "utf8"), /--- extra\.txt ---\nattached/);
  // A failing run: .done says fail and wait exits 1; a prefix that never runs times out.
  writeFileSync(join(root, "p.md"), "FAIL\n");
  assert.equal(run("agent", "-a", "fake", "-t", "T two", "-d", join(root, "w"), "-o", O, "-r", "--", join(root, "p.md")).status, 0);
  const f = run("wait", "--timeout", "60", O);
  assert.equal(f.status, 1);
  assert.match(f.stdout, /status=fail rc=1/);
  assert.equal(run("wait", "--timeout", "1", join(root, "nothing")).status, 124);
  assert.equal(run("agent", "-a", "nope", "-t", "x", "-d", root, "-o", O, "--", join(root, "p.md")).status, 2);
});

test("board: agents, queue, claims, quota and blocks from fake state files, plain when piped", () => {
  const { root, env, run } = sandbox(), st = join(root, "state", "orq"), ws = join(root, "ws"), now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString(), dead = spawnSync(process.execPath, ["-e", ""]).pid!;
  const pre = join(ws, ".orquestra", "ABC-1", "impl-api");
  mkdirSync(join(st, "agents"), { recursive: true }); mkdirSync(dirname(pre), { recursive: true });
  mkdirSync(join(st, "locks", "verify"), { recursive: true }); mkdirSync(join(st, "board"), { recursive: true });
  writeFileSync(`${pre}.job.json`, JSON.stringify({ argv: ["claude", "-p", "--model", "claude-opus-5"] }));
  writeFileSync(`${pre}.log`, `start\n${JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit" }] } })}\n`);
  const agent = (unit: string, o: object) => writeFileSync(join(st, "agents", `${unit}.json`),
    JSON.stringify({ prefix: pre, title: "ABC-1 impl api", agent: "claude", host: "plain", cap: 2 ** 32, at: iso(now - 90_000), ...o }));
  agent("u-run", { pid: process.pid });
  agent("u-dead", { pid: dead });
  agent("u-done", { pid: dead, status: "fail", rc: 3, end: iso(now - 60_000) });
  agent("u-old", { pid: dead, status: "ok", rc: 0, at: iso(now - 7200_000), end: iso(now - 7000_000) });
  writeFileSync(join(st, "locks", "verify", `${now - 5000}-${process.pid}.json`), JSON.stringify({ pid: process.pid, label: "verify ABC-1 api", at: now - 5000, held: true }));
  writeFileSync(join(ws, ".orquestra", "ABC-1", "owner"), `pane=me@box kind=id account=work at=${iso(now)}\n`);
  writeFileSync(join(st, "blocks.json"), JSON.stringify({ copilot: { until: now / 1000 + 86400, reason: "out" } }));
  writeFileSync(join(st, "board", "quota.txt"), "work 5h=42% week=7%\nopencode 5h=- week=- [no quota collector]\n");

  const r = run("board", "--json", "-w", ws);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j.agents.map((a: { unit: string; state: string }) => [a.unit, a.state]), [["u-run", "running"], ["u-dead", "died"], ["u-done", "fail"]]);
  const a = j.agents[0];
  assert.deepEqual([a.issue, a.label, a.model, a.activity, a.cap], ["ABC-1", "impl-api", "claude-opus-5", "· Edit", 2 ** 32]);
  assert.ok(a.secs >= 89 && a.mem > 0, `secs=${a.secs} mem=${a.mem}`);
  assert.equal(j.queue.holders[0].label, "verify ABC-1 api");
  assert.deepEqual(j.conductors, [{ id: "me@box", kind: "id", account: "work", alive: true, issues: ["ABC-1"] }]);
  assert.deepEqual(j.quota.lines[0], { name: "work", five: "42%", week: "7%" });
  assert.equal(j.blocks.copilot.reason, "out");

  const o = run("board", "--once", "-w", ws);
  assert.equal(o.status, 0, o.stderr);
  assert.ok(!o.stdout.includes("\x1b"), "no escape codes when piped");
  for (const s of ["TRANSPORT", "verify ABC-1 api", "impl-api", "claude-opus-5", "· Edit", "runner gone", "rc=3", "me@box", "42%",
    "no quota collector: opencode", "copilot", "CHARTS"]) assert.ok(o.stdout.includes(s), `missing ${s}\n${o.stdout}`);
  const pt = spawnSync(process.execPath, [CLI, "board", "--once", "-w", ws], { env: { ...env, ORQ_LANG: "pt" }, encoding: "utf8" });
  assert.ok(pt.stdout.includes("fila de testes"), pt.stdout);
});

test("board: render colors only when asked, activity from the log tail", async () => {
  const { render, activity, dur } = await import("./commands/board.js");
  const s = { at: new Date().toISOString(), mem: { used: 1, total: 2 }, workspaces: ["/w"], queue: { holders: [], waiters: [] },
    agents: [], conductors: [], quota: { lines: [] }, blocks: {}, scoreboard: [] };
  assert.ok(!render(s, "gunmetal", 80, "none").join("\n").includes("\x1b"));
  assert.ok(render(s, "gunmetal", 80, "true").join("\n").includes("\x1b[48;2;25;27;29m"));
  assert.ok(render(s, "gunmetal", 80, "basic").join("\n").includes("\x1b[36m"));
  assert.equal(activity(`{"type":"text","part":{"text":"hello"}}\n{"partial`), "hello");
  assert.equal(activity("a\nlast words\n\n"), "last words");
  assert.deepEqual([dur(5), dur(65), dur(3700), dur(90000)], ["5s", "1m05s", "1h01m", "1d01h"]);
});

test("verify + baseline: new vs pre-existing failures with a fake jest, in the queue, worktrees cleaned up", async () => {
  const { runnerArgs, failures } = await import("./testrun.js");
  assert.deepEqual(runnerArgs("vitest", "related", ["a.ts"], "j"), ["related", "a.ts", "--run", "--passWithNoTests", "--reporter=json", "--outputFile=j", "--maxWorkers=2"]);
  assert.deepEqual(runnerArgs("jest", "all", [], "j"), ["--json", "--outputFile=j", "--maxWorkers=2", "--workerIdleMemoryLimit=1G"]);
  assert.equal(failures(join(tmpdir(), "orq-no-such.json"), "/x"), undefined);

  const { root, env, run } = sandbox(), ws = join(root, "ws"), repo = join(ws, "api");
  Object.assign(env, { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", ORQ_TERMINAL: "plain" });
  const git = (...a: string[]) => {
    const r = spawnSync("git", a, { cwd: repo, env, encoding: "utf8" });
    assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`);
  };
  mkdirSync(join(repo, "node_modules", "jest"), { recursive: true });
  // The fake jest: every *.test.js line "FAIL <name>" / "PASS <name>" is a test; --runTestsByPath limits the files.
  writeFileSync(join(repo, "node_modules", "jest", "package.json"), JSON.stringify({ bin: { jest: "bin.js" } }));
  writeFileSync(join(repo, "node_modules", "jest", "bin.js"), `const fs = require("fs"), path = require("path");
const a = process.argv.slice(2), out = a.find((x) => x.startsWith("--outputFile=")).slice(13);
const only = a.includes("--runTestsByPath") ? a.filter((x) => !x.startsWith("-")) : null;
const files = fs.readdirSync(".").filter((f) => f.endsWith(".test.js") && (!only || only.includes(f)));
let total = 0;
const testResults = files.map((f) => ({ name: path.join(process.cwd(), f), assertionResults: fs.readFileSync(f, "utf8").split(/\\r?\\n/).filter(Boolean)
  .map((l) => { total++; const [s, n] = l.split(" "); return { status: s === "FAIL" ? "failed" : "passed", fullName: n }; }) }));
console.log("ran " + files.join(","));
fs.writeFileSync(out, JSON.stringify({ numTotalTests: total, testResults }));\n`);
  writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { test: "jest" } }));
  writeFileSync(join(repo, ".gitignore"), "node_modules\n");
  writeFileSync(join(repo, "a.test.js"), "FAIL old\nPASS fine\n");
  writeFileSync(join(repo, "src.js"), "1\n");
  git("init", "-q", "-b", "main"); git("add", "."); git("commit", "-qm", "base");
  spawnSync("git", ["init", "-q", "--bare", join(root, "origin.git")]);
  git("remote", "add", "origin", join(root, "origin.git")); git("push", "-q", "origin", "main"); git("fetch", "-q", "origin");
  const O = join(ws, ".orquestra", "X-1", "verify-api");
  const verify = () => run("verify", "-x", "-w", ws, "-r", "api", "-d", repo, "-b", "main", "-o", O);

  let r = verify();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(readFileSync(`${O}.txt`, "utf8"), /^# verify api \w+: no JS\/TS file changed relative to origin\/main/);

  git("checkout", "-qb", "feat");
  writeFileSync(join(repo, "src.js"), "2\n");
  writeFileSync(join(repo, "b.test.js"), "FAIL new\nPASS ok\n");
  git("add", "."); git("commit", "-qm", "feat");
  r = verify();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const txt = readFileSync(`${O}.txt`, "utf8");
  assert.match(txt, /: 4 tests related to 2 changed files\n# base: 1 failing file\(s\) run on origin\/main \w+\n/);
  assert.match(txt, /## New failures \(1\)\nb\.test\.js :: new\n\n## Already failing on origin\/main\na\.test\.js :: old\n$/);
  assert.match(readFileSync(`${O}.done`, "utf8"), /^status=fail new=1 at=/);
  assert.match(readFileSync(`${O}.log`, "utf8"), /ran a\.test\.js,b\.test\.js/);
  assert.match(run("wait", "--timeout", "5", O).stdout, /^\[ORQ AGENT DONE\] verify-api status=fail new=1 .*answer: .*verify-api\.txt/);
  assert.equal(run("lock", "status", "verify", "--json").stdout.trim(), JSON.stringify({ holders: [], waiters: [] }));
  assert.deepEqual(readdirSync(join(ws, ".worktrees")), []); // the base worktree is gone
  assert.ok(existsSync(join(repo, "node_modules", "jest", "bin.js")), "the main clone's node_modules is intact");

  writeFileSync(join(repo, "b.test.js"), "PASS new\n");
  git("commit", "-qam", "fix");
  r = verify();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(readFileSync(`${O}.done`, "utf8"), /^status=ok new=0/);
  assert.match(readFileSync(`${O}.txt`, "utf8"), /## New failures \(0\)\nnone\n\n## Already failing on origin\/main\na\.test\.js :: old/);
  // In the background (plain terminal), as the conductor uses it: returns at once, orq wait reports it by title.
  r = run("verify", "-w", ws, "-r", "api", "-d", repo, "-b", "main", "-o", O);
  assert.match(r.stdout, /^\[orq verify\] X-1 verify api → pid:\d+/, r.stderr);
  const w = run("wait", "--timeout", "60", O);
  assert.equal(w.status, 0, w.stdout);
  assert.match(w.stdout, /^\[ORQ AGENT DONE\] X-1 verify api status=ok new=0 /);

  const base = () => run("baseline", "-x", "-w", ws, "-r", "api", "-b", "main");
  r = base();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = join(ws, ".orquestra", "baseline", "api-main.txt");
  assert.match(readFileSync(out, "utf8"), /^# sha \w+ \d{4}-\d\d-\d\d — tests already failing on origin\/main\na\.test\.js :: old\n$/);
  assert.match(readFileSync(`${out}.done`, "utf8"), /^status=ok sha=\w+ at=/);
  assert.match(base().stdout, /baseline already up to date/);
  assert.deepEqual(readdirSync(join(ws, ".worktrees")), []);
  assert.equal(run("verify", "-w", ws).status, 2);
});

test("setup --install: skills linked into each Claude account, kept when they are the user's; --workspace", () => {
  const { root, env, run } = sandbox(), home = join(root, "home");
  writeFileSync(join(root, "accounts"), `work ${join(root, "claude-work")}\n`);
  (env as Record<string, string>).CLAUDE_ACCOUNTS_FILE = join(root, "accounts");
  mkdirSync(join(home, ".claude", "skills", "orq-status"), { recursive: true }); // a real folder of the user's
  let r = run("setup", "--install");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Environment\n  node +v\d+/);
  assert.match(r.stdout, /git +ok/);
  for (const d of [join(home, ".claude"), join(root, "claude-work")])
    assert.match(readFileSync(join(d, "skills", "issue", "SKILL.md"), "utf8"), /^---\r?\nname: issue/);
  assert.match(r.stdout, /skip .*orq-status/);
  r = run("setup", "--install");
  assert.match(r.stdout, /ok +\S+issue/);
  assert.doesNotMatch(r.stdout, /link /);

  const ws = join(root, "ws");
  mkdirSync(ws);
  assert.equal(run("setup", "--workspace", ws, "--conductor", "codex").status, 0);
  assert.match(readFileSync(join(ws, "AGENTS.md"), "utf8"), /orq:issue begin/);
  assert.match(readFileSync(join(ws, "CLAUDE.md"), "utf8"), new RegExp(`ws ecosystem \\(${ws.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}\\)`));
  writeFileSync(join(ws, "CLAUDE.md"), "mine\n");
  assert.equal(run("setup", "--workspace", ws, "--conductor", "claude").status, 0);
  assert.equal(readFileSync(join(ws, "CLAUDE.md"), "utf8"), "mine\n"); // never overwritten
  assert.ok(existsSync(join(ws, ".claude", "skills", "issue", "SKILL.md")) && existsSync(join(ws, ".orquestra")));
});

test("completion: scripts per shell, each one checked by its own shell when it is installed", () => {
  const { env, run } = sandbox();
  assert.equal(run("completion", "cmd").status, 2);
  const has = (c: string, a: string[]) => spawnSync(c, a, { stdio: "ignore" }).status === 0;
  const sh = (c: string, a: string[], script: string) => spawnSync(c, a, { env: { ...env, ORQ_COMP: script }, encoding: "utf8" });
  const bash = run("completion", "bash").stdout;
  assert.match(bash, /complete -o default -F _orq orq/);
  if (process.platform !== "win32" && has("bash", ["--version"])) {
    const r = sh("bash", ["-c", 'eval "$ORQ_COMP"; COMP_WORDS=(orq la); COMP_CWORD=1; _orq; echo "${COMPREPLY[*]}"; COMP_WORDS=(orq lock ""); COMP_CWORD=2; _orq; echo "${COMPREPLY[*]}"'], bash);
    assert.equal(r.stdout, "lang\nwait release run status\n", r.stderr);
  }
  const zsh = run("completion", "zsh").stdout;
  if (has("zsh", ["--version"])) {
    const r = sh("zsh", ["-f", "-c", 'autoload -U compinit && compinit -u -D && eval "$ORQ_COMP" && (( $+functions[_orq] )) && echo ok'], zsh);
    assert.equal(r.stdout.trim(), "ok", r.stderr);
  }
  const fish = run("completion", "fish").stdout;
  assert.match(fish, /-a lang -d 'language of orq\\'s messages'/);
  if (has("fish", ["--version"])) {
    const r = sh("fish", ["-c", 'echo $ORQ_COMP | source; complete -C "orq la"; complete -C "orq lang to"'], fish);
    assert.match(r.stdout, /^lang\tlanguage of orq's messages\ntoggle\n$/, r.stderr);
  }
  const ps = run("completion", "powershell").stdout;
  assert.equal(run("completion", "pwsh").stdout, ps);
  const pwsh = ["pwsh", "powershell"].find((c) => has(c, ["-NoProfile", "-Command", "exit 0"]));
  if (pwsh) {
    const r = sh(pwsh, ["-NoProfile", "-NonInteractive", "-Command", "Invoke-Expression $env:ORQ_COMP; " +
      "(TabExpansion2 'orq la' 6).CompletionMatches.CompletionText; (TabExpansion2 'orq lock ' 9).CompletionMatches.CompletionText -join ','"], ps);
    assert.equal(r.stdout.trim().split(/\r?\n/).join("|"), "lang|wait,release,run,status", r.stderr);
  }
});

test("keyring: the native module loads on every CI platform; off and missing entries read as nothing", async () => {
  const { backend, readSecret } = await import("./keyring.js");
  const old = process.env.ORQ_KEYRING;
  try {
    process.env.ORQ_KEYRING = "off";
    assert.equal(backend(), "none");
    assert.equal(readSecret("gemini", "antigravity"), undefined);
    delete process.env.ORQ_KEYRING;
    assert.equal(backend(), "native");
    // Only on CI: a lookup (of an entry nobody has) must not throw even without a keyring service (headless Linux).
    if (process.env.CI) assert.equal(readSecret(`orq-test-${process.pid}`, "nobody"), undefined);
  } finally { if (old === undefined) delete process.env.ORQ_KEYRING; else process.env.ORQ_KEYRING = old; }
});
