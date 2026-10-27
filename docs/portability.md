# Roadmap — a portable, agent-agnostic, modular orq

**Status:** in progress — steps 1 and 2 done (2026-10-10); plan revised 2026-10-26 (agnostic conductor, modular roles,
guided setup). Steps 3 (CI) and 4 (modular roles: `[roles]`, `orq pick`, `orq stats`) done 2026-10-26; AgentDef templates land with `orq agent` (step 8). Step 5 (guided setup: `orq setup`, `suggestRoles`, presets) done the same day; conductor instructions per format land with `orq wait` (step 8). Step 6 (lock & claim: `orq lock`, `orq claim`, `orq deps`) done the same day. Step 7 (ProcessHost: `orq run`, `mem_enforce`, per-agent `mem_max`) done the same day — Windows uses the watchdog for now. Step 8 (`orq agent` on AgentDef and TerminalHost herdr/tmux/plain, `orq wait`) done the same day; the `/issue` playbook runs outside herdr and `orq instructions` writes it per conductor format. Next: step 9 (board).

**Goal:** `npm i -g @irythill/orq` (or an equivalent single install) works on Linux, macOS and Windows (native, not only
WSL), in any shell (bash, zsh, fish, PowerShell, cmd), with **any** agent as conductor and **any** agents as workers and
reviewers — all chosen by the user. herdr is an optional extra, never a requirement.

## 1. Principles
1. **Agent-agnostic.** orq's contract is its command line plus protocol files. Anything that can run a shell command can
   be the conductor: Claude Code, Codex, OpenCode, Copilot, a human.
2. **The user decides.** Every role (conductor, primary worker, workers, reviewer, opinion) is set by the user, fixed or
   `auto` within a list they choose. orq suggests; it never overrides a fixed choice.
3. **Agents are modules.** Adding an agent means writing a definition in the config, not changing code.
4. **Adapt to the environment.** Shell, terminal/multiplexer, OS and keyring are detected; each has a plain fallback.
5. **Everything has a knob.** Memory caps, quota limits, weights — defaults are suggestions, the user adjusts.

## 2. Where orq is tied today

| Piece | Tie | Used by |
|---|---|---|
| Memory cap per agent / test suite | `systemd-run --user --scope -p MemoryMax=` (cgroups v2) | herdr-agent, herdr-verify, herdr-baseline |
| Listing running agents and their memory | `systemctl --user list-units 'herdr-agent-*'`, `MemoryCurrent` | herdr-board |
| Test queue (one suite at a time) | `flock` + waiters from `/proc/locks` | herdr-verify, herdr-baseline, herdr-deps, herdr-claim, herdr-board |
| Process info | `/proc/<pid>/cmdline`, `/proc/meminfo`, `pgrep`, `ps -o` | herdr-board, herdr-agent |
| Detaching background jobs | `setsid` | herdr-agent, herdr-board |
| Always-on server | `herdr.service` (systemd user unit) | install.sh |
| GNU flavours | `stat -c`, `date -d`, `numfmt`, `readlink -f`, `timeout` | many |
| Panes, tabs, **notifying the conductor** | `herdr pane/tab/agent ...`, a line typed into the conductor's pane | herdr-agent, herdr-tab, herdr-notify, herdr-conductor, herdr-board |
| Conductor | always Claude Code; instructions only as `SKILL.md` / `CLAUDE.md` | skills/, templates/, new-conductor.sh |
| Agents | five hard-coded in `herdr-agent` (`case $agent in claude) ...`) | herdr-agent, orq-pick |
| Keyring | `secret-tool` (Linux), `security` (macOS) | quota (Antigravity, Claude) |
| Language | bash 4+ scripts, a few Python ones | setup/ |

## 3. Target architecture

```
 conductor (any agent, or a human)
        │  shell commands + protocol files (.done · .out.md · .log · .id · status=)
        ▼
 ┌──────────────────────────────── orq (one CLI, TypeScript/Node) ────────────────────────────────┐
 │ setup · config · roles · pick · agent · wait · verify · claim · block · quota · stats · board   │
 │                                                                                                 │
 │ AgentDef     ProcessHost      TerminalHost        Notifier         QuotaSource      Lock        │
 └────┬─────────────┬────────────────┬──────────────────┬────────────────┬───────────────┬────────┘
  config-defined  cgroup · Job   auto: herdr · tmux   orq wait (default) claude · codex ·  file lock +
  agents (5 built- Object ·      · zellij · WezTerm   · herdr pane      copilot · agy ·  queue file in
  in, more by user) watchdog     · WT · plain         · Claude bg task  command · none   the state dir
```

### AgentDef — agents as modules
Each agent is a definition: how to run it headless, resume a session, run read-only, find the session id and read
its quota. The five current agents ship as built-in definitions the user may override; new ones need no code.

```toml
[agents.my-agent]
vendor   = "acme"
run      = "acme exec --model {model} --prompt-file {prompt}"
resume   = "acme exec --resume {session} --prompt-file {prompt}"
readonly = "--sandbox read-only"
session  = { from_log = "session id: (\\S+)" }
quota    = { command = "acme-usage" }        # prints "<name> 5h=NN% week=NN%"
```

### Roles — set by the user
Roles: `conductor`, `primary` (main worker), `workers`, `reviewer`, `opinion`. Each is **fixed** (`agent = ...`) or
**auto** (`pick = "auto"` within `pool`). A fixed agent that is out of quota or blocked is never swapped silently: orq
goes to the role's `fallback` list, if any, or stops and tells the user.

```toml
[roles.conductor]
agent = "claude"
[roles.primary]
agent    = "codex"
fallback = ["claude"]
[roles.workers]
pick = "auto"
pool = ["claude", "opencode"]
[roles.reviewer]
pick = "auto"
pool = ["antigravity", "opencode", "claude"]
rule = "other-vendor"          # other-vendor | any
[roles.opinion]
agent = "copilot"
```

The current `agents.<name>.roles = [...]` format keeps working: it is read as `auto` roles with every agent that lists
the role in its pool.

### Notifier — telling the conductor a child finished
Children already run headless, so the only thing that tied orq to herdr was the notice typed into the conductor's pane.
- **`orq wait <prefix>`** (default, any conductor): blocks until `.done`, prints the summary. `orq status --json` for
  conductors that prefer polling.
- **herdr**: the `[ORQ AGENT DONE]` line in the conductor's pane, as today.
- **Claude Code**: run `orq wait` as a background task, which wakes the conductor when it exits.

### Conductor instructions — one source, several formats
One generic instruction text (the `/issue` flow, protocol, rules). `orq setup` writes it in the chosen conductor's
format: `SKILL.md` + `CLAUDE.md` (Claude Code), `AGENTS.md` (Codex, OpenCode), Copilot's instructions file.

### Shell and TerminalHost — adapt to where the user is
- **Shell**: orq is a Node binary, so it runs the same in every shell (npm creates the right shim per OS). Per shell:
  completions (`orq completion bash|zsh|fish|pwsh`), quoting in the generated instructions, and the shell that runs
  test suites in `orq verify` (configurable; default pwsh on Windows, the user's `$SHELL` elsewhere).
- **Terminal**: `terminal = "auto"` detects the multiplexer from the environment (`HERDR_PANE_ID`, `TMUX`, `ZELLIJ`,
  `WEZTERM_PANE`, `WT_SESSION`, `KITTY_WINDOW_ID`) and opens one tab/pane per child where supported; otherwise `plain`
  (output in `<prefix>.log`, everything visible in `orq board`). First: herdr, tmux, plain. Others are small adapters.

### ProcessHost — memory cap, set by the user

```toml
[machine]
agent_mem_max = "4G"       # default for every agent; "off" disables
test_mem_max  = "6G"
mem_enforce   = "auto"     # auto | kernel | watchdog | off
[agents.codex]
mem_max = "6G"             # per-agent override
```

| OS | `auto` enforces with |
|---|---|
| Linux with systemd | `systemd-run --user --scope` (the kernel kills only that agent) |
| Windows | **watchdog** for now; a Job Object (kernel-enforced) needs a native addon — later, if the watchdog proves too coarse |
| macOS / Linux without systemd | **watchdog**: samples the process tree every few seconds, kills it above the cap |

Running agents are tracked by orq itself (a state file per run: pid, prefix, start, cap), not by systemd unit names.
`orq setup` suggests a cap from total RAM and the number of parallel tasks.

### QuotaSource and keyring
Built-in sources: `claude`, `codex`, `antigravity`, `copilot`, `command`, `false`, `none` (done in step 2). Credentials
in the OS keyring are read through `@napi-rs/keyring` (Secret Service, macOS Keychain, Windows Credential Manager),
replacing `secret-tool` and `security`. No keyring (headless server) → credential file, or `?` as today. orq never
refreshes an agent's login.

### Lock — test queue
A lock file in orq's state directory plus a queue file recording who waits, so `orq board` no longer needs `/proc/locks`.

### Paths
Resolved in `src/paths.ts`. Linux/macOS keep `~/.config/orq` and `~/.local/state/orq` (or `XDG_*`); Windows uses
`%APPDATA%\orq` and `%LOCALAPPDATA%\orq\state`.

## 4. Guided setup — `orq setup`

The roles we tuned by hand (case study) became rules. Instead of asking a newcomer "should this agent do impl or
review?", setup asks what they can answer and applies the rules. The rules live in code (`suggestRoles(agents,
answers)`, tested), not in a skill's text, so they work with any conductor; `/orq-setup` just runs `orq setup` and
explains.

**1. Detect and smoke-test** the installed agent CLIs (opt-in, each test costs a few tokens).

**2. Ask what the user knows:**
- per agent: plan — free · small subscription (Pro, Copilot Pro) · large subscription (Max, high tiers) · pay-as-you-go;
  and which they trust most to write code;
- where they will talk to orq (the conductor);
- how many tasks they usually run in parallel (1–2 → favor quality; 3+ → favor tokens);
- how much RAM agents may use (suggestion from total RAM).

**3. Apply the rules:**

| Situation | Suggestion |
|---|---|
| Shares quota with the conductor | `reserve` (only when the others don't fit) |
| Small plan or monthly allowance | `opinion` only (heavy tasks, or impl and review disagree) |
| Pay-as-you-go | `reviewer` pool (few tokens), not `primary` by default |
| No free shell in headless mode (e.g. agy) | `reviewer` only, diff attached |
| Largest plan apart from the conductor's | `primary` |
| Vendor different from `primary` | `reviewer` (cross review) |

**4. Adapt to what the user has:**

| User has | orq sets up |
|---|---|
| 1 agent | It does everything; review runs in a fresh session with another model or effort. Notice: cross-vendor review catches more — consider a second agent. |
| 2+ accounts/agents of one vendor | Separate accounts for conductor and workers; review with another model; `other-vendor` off, with a notice. |
| 2 vendors | One is `primary`, the other `reviewer`; they swap when quota runs out. |
| 3+ vendors | `auto` roles with pools and rotation (like `examples/irythill/config.toml`). |

**5. Show the proposal with reasons**, e.g. "Codex as primary (largest free plan); Antigravity and OpenCode review
(other vendor); Copilot only for second opinions (small monthly allowance). Change anything?" What the user fixes
becomes `agent = ...`; the rest stays `auto`.

**Presets** for those who skip the questions: `economy`, `quality`, `single-agent`.

**6. Learn from use.** Setup values are only the `prior`s. `orq stats` already measures delivery, tokens and time per
agent; after N runs `orq status` suggests changes ("OpenCode spent 10x the tokens implementing — keep it for review
only?"). The user accepts or not; nothing changes by itself.

The maintainer's config stays an **example**, labelled as one person's choices.

## 5. Language: TypeScript on Node
Bash is the problem (no bash on native Windows; GNU vs BSD tools on macOS). TypeScript: the maintainer's main language;
`npm i -g` works the same on the three OSes; single binary possible later (`bun build --compile` / Node SEA). The
remaining bash/Python scripts keep working until ported; old names stay as thin wrappers.

## 6. Steps (each ships on its own; Linux keeps working the whole time)
1. ✅ **Skeleton:** `orq` CLI in TypeScript, i18n; `orq config`, `orq set`, `orq lang`, `orq block`.
2. ✅ **Quota:** `orq quota` with QuotaSources and `[quota]`. Removes the Omarchy dependency.
3. ✅ **CI on Linux, macOS and Windows** for everything already in TS. Portability is proven from here on, not at the end.
4. ✅ **Modular roles and agents:** `[roles]` and AgentDef in the config (old format still read); port `orq-pick` with
   fixed/auto/fallback; `orq-stats` port.
5. ✅ **Guided setup:** `orq setup` with `suggestRoles`, presets, conductor instructions per format; `/orq-setup` calls it.
6. ✅ **Lock & claim:** portable lock + queue file; port `herdr-claim`, `herdr-deps`.
7. ✅ **ProcessHost:** watchdog first (all OSes), then systemd and Job Object; `mem_enforce` and per-agent caps; port
   `herdr-verify`, `herdr-baseline`.
8. ✅ **`orq agent` + `orq wait`:** port `herdr-agent` on AgentDef, Notifier and TerminalHost (herdr, tmux, plain); the
   `/issue` instructions use `orq wait` outside herdr.
9. **Board:** `orq board` from orq's own state, no `/proc` or systemd.
10. **Keyring and install:** `@napi-rs/keyring`; `npm i -g @irythill/orq` + `orq setup` on all OSes; `install.sh` and
    `herdr.service` become optional Linux extras; shell completions.

## 7. Open questions
- herdr on macOS: tmux exists there, so herdr may work as is — to verify.
- Package name: `orq` is taken on npm → `@irythill/orq` (the command is still `orq`).
- How far the learning in §4.6 goes: suggestions only (current plan), or an opt-in "auto-tune".
