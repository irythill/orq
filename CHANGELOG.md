# Changelog

What changed in orq, newest first. Dates are when it landed on `main`. Format inspired by
[Keep a Changelog](https://keepachangelog.com/); versions follow `package.json`.
Português: [CHANGELOG.pt-BR.md](CHANGELOG.pt-BR.md).

## [Unreleased]
### Added
- `orq agent -R` enforces `policy.max_rounds`: it counts follow-ups per session (whatever the prefix is called) and
  refuses the next with exit 4; `-F` overrides with the user's OK. `/issue` fixes the `fix-<n>` / `review-<repo>-<n>`
  names and limits visual validation (screenshots) to one cheap attempt.
- `orq claim` records each conductor's name (its herdr workspace label, else `ORQ_CONDUCTOR_ID`), shows it in `-l`,
  and `orq claim --from <name> [-f]` finds (and takes over) a conductor's issues by any part of that name. `/issue`
  uses it when the user names another conductor, and resumes from `.orquestra/<ID>/` instead of starting over.

## [0.3.0] — 2026-10-29
### Added
- `orq agent -T` (and `herdr-agent -T`): the agent's own screen in TypeScript, in a herdr tab **or a tmux window**
  (it used to be the bash `herdr-agent-tui`, herdr only). Claude, Codex and OpenCode; any agent via `tui` /
  `tui_resume` / `turn_hook` in `[agents.<name>]`. Every end of turn runs `orq agent --turn`, which writes
  `.out.md`/`.id`/`.done` and notifies; `orq wait` works as with headless runs. `-R` types the follow-up into the open
  screen (a bracketed paste in tmux, so multi-line prompts arrive whole) or, once it is closed, reopens the session.
  `machine.tui = true` or `HERDR_AGENT_TUI=1` make it the default where it can run.
### Fixed
- OpenCode 2.x: MCP servers were not turned off in child runs (v2 silently drops an MCP entry without `type` and
  `command`); the end-of-turn plugin uses the v2 plugin API.
- A screen closed before its first turn ends writes `status=fail`, so `orq wait` no longer waits forever; closing the
  tab or the tmux server cleans up the throwaway review worktree.
### Removed
- `setup/herdr-agent-tui` (the bash -T); a stale `~/.local/bin/herdr-agent-tui` link from an earlier install can go.

## [0.2.0] — 2026-10-29
### Added
- `orq quota --line`: one line for a status bar (`work 64 · home 93! · codex 81`), the tighter window per source,
  `!` at the pick limit, `⊘` blocked. It reads the board's cache and never waits for the network, so a herdr
  `tab_bar_right` command entry can call it every minute (docs/herdr.md).
- Quota for OpenCode on MiniMax: the Token Plan's 5h and weekly windows from `/v1/token_plan/remains`, with
  `$MINIMAX_API_KEY` or the key OpenCode keeps in its `auth.json` (`$MINIMAX_API_HOST` for another region). `opencode`
  is now `"builtin"` by default; without a MiniMax key it reads `-` as before.
- `orq gc`: lists the issue worktrees that are safe to remove (PR merged with the local head, or content already in
  the base, which also catches squash merges) and removes them with `--yes`. Never touches a worktree with uncommitted
  changes, unpushed commits, a live claim or a running child. `/issue` uses it after the merge instead of `git cherry`;
  `install.sh` installs an optional daily `orq-gc.timer` (not enabled).
- `/issue`: the fix prompt asks for the smallest diff, nothing outside the listed blockers, and a test per blocker that
  fails without the fix; an item the implementer thinks is wrong is answered, not "fixed".
- `/issue`: from round 2 on, the review checks the previous blockers and the fix's own diff (`round-<n>.sha`..HEAD),
  with the same reviewer as the round before; new findings outside that diff only as a justified blocker.
- `/issue`: review items are tagged `[blocker]` or `[suggestion]`; only a blocker with `file:line` and a concrete
  failure opens a fix round, and the rest goes into the Plane comment.
- `/issue`: the implementer ends with a `## Decisions` section (choices, trade-offs, what was left out on purpose) and
  the reviewer gets it; a documented choice is not a blocker unless it breaks a criterion or is wrong.
### Fixed
- Codex quota on the free plan: its only window is 30 days, which the collector ignored (it showed `-`, so
  `orq pick` treated an 80 %-used Codex as unlimited). The longest window over 6 h now fills the week slot, with a note
  when it isn't a week.
- **Fix rounds kept the implementer's session but not its model.** `/issue` resumed with `-a <agent> -R <session>`
  and no `-m`, so Codex fell back to its CLI default (in one workspace, 88 of 136 fixes ran on a different model than
  the implementation, with the highest new-token median: the prompt cache is per model). New
  `orq pick fix --same <impl pick file>` repeats the implementer's agent, model and account with the effort one level up
  (capped at high); `/issue` saves the implementer's pick to `impl-<repo>.pick` and uses it on every fix.

## [0.1.0] — 2026-10-28 — first npm release
### Added
- The orc conductor: ASCII art with the version and who plays which role, shown by `orq`, `orq --version` and
  `orq setup` in a real terminal only (never when the output is piped); 24-bit or basic colors, `NO_COLOR` respected.
  Pixel-art logo in `docs/img/orq-logo.svg`, on top of the READMEs.
- `[roles]` in the config: `conductor`, `primary`, `workers`, `reviewer`, `opinion`, each **fixed** (`agent`, then
  `fallback` in order, never swapped for an agent outside the list) or **auto** (`pool`, scored as before); `rule`
  per role. Without `[roles]`, `agents.<name>.roles` keeps working. `vendor` is optional for the built-in agents.
- `orq pick` (new role `worker`) and `orq stats` in TypeScript; `orq-pick` and `orq-stats` now call them.
- `orq setup`: guided first configuration in any terminal — detects agent CLIs, asks plan, trust, conductor, parallel
  tasks and RAM, and suggests roles, weights and memory caps with the reason for each (`--answers` for conductors,
  `--preset economy|quality|single-agent`). `/orq-setup` uses it. Agents without `models` use the CLI's default.
- `orq lock`: the test queue without `flock` or `/proc/locks` — a FIFO of plain files in the state dir, `test_slots`
  slots, a dead process's entry is swept by itself. `herdr-verify`, `herdr-baseline` and the board use it.
- `orq claim` (was `herdr-claim`): works outside herdr too — the conductor id is `HERDR_PANE_ID`, `ORQ_CONDUCTOR_ID`
  or `<user>@<host>`; outside herdr an owner counts as alive for `ORQ_CLAIM_TTL_H` hours (24).
- `orq deps` (was `herdr-deps`): same flow; on Windows `node_modules` is linked with a junction (no admin rights).
- `orq run`: runs a command under a memory cap on any OS — a systemd scope where available, else a watchdog that
  samples the process tree every second and kills it above the cap (exit 137). `machine.mem_enforce = auto | kernel |
  watchdog | off`, `agents.<name>.mem_max` per agent, `"off"` disables. `herdr-verify` and `herdr-baseline` use it.
- `orq agent` (was `herdr-agent`, which now calls it): runs a child agent headless under its memory cap and writes the
  same files (`.out.md`, `.log`, `.id`, `.pane`, `.done`). Its output goes to a herdr tab inside herdr, a tmux window
  inside tmux, else a background process (log under the state dir) — `machine.terminal` / `ORQ_TERMINAL` choose.
  `-T` (the agent's own screen) is still the bash script, `herdr-agent-tui`, herdr only.
- AgentDef: how each agent runs is a set of command templates in `[agents.<name>]` (`run`, `resume`, `readonly`,
  `write`, `stdin`, `format`, `session`, `answer`, `env`); the five agents ship as built-in defaults matching
  `herdr-agent`, and any other CLI is usable by declaring `run` in the config.
- `orq wait <prefix>...`: blocks until children finish and prints one `[ORQ AGENT DONE] <title> status=...` line each
  (exit 0 all ok, 1 a failure, 124 timeout; `--any`, `--timeout`, `--answer`). For conductors outside herdr; inside
  herdr the `[HERDR-AGENT DONE]` line still arrives in the conductor's pane.
- `/issue` outside herdr: the playbook says how to run the flow in any terminal — `orq agent`, `orq claim`,
  `orq deps`, and `orq wait` as a background task as the completion signal.
- `orq instructions claude|agents`: writes the `/issue` playbook in the conductor's format — `SKILL.md` for Claude
  Code, a marked block in `AGENTS.md` for Codex, OpenCode and others (the rest of the file is kept).
- `orq board` (`herdr-board` now calls it): the live board from orq's own state files — running agents
  (`<state>/agents/*.json`, memory of the process tree against the cap), the test queue (`orq lock`), conductors and
  their claimed issues, quota (cached, collected in the background every 5 min), active blocks and the 7-day
  scoreboard. No `/proc`, systemd or jq: Linux, macOS and Windows, any terminal. `--once`, `--json`, `--interval`;
  keys `q` `r` `l` `t`; plain text when piped or with `NO_COLOR`. Not ported: `f` (jump to a pane) and the live
  herdr state of each conductor pane.
- `orq verify` and `orq baseline` (were `herdr-verify` and `herdr-baseline`, which now call them): the tests related
  to a diff, with failures that also fail on `origin/<base>` counted as pre-existing, and the base snapshot. Same flags,
  output files and exit codes; same "verify" queue (`orq lock`) and test memory cap (`orq run`). They open in a herdr
  tab, a tmux window or the background like `orq agent`, `-x` runs in the foreground, and `orq wait <prefix>` waits
  for them. The runner's own bin runs with node when present (no `npx` shell on Windows); jest and vitest.
- **Install on any OS:** `npm i -g @irythill/orq` + `orq setup`, no clone. `orq setup` now shows what it found (git,
  terminal host, memory cap, keyring, the shell's completion line), links the skills into each Claude account (a
  junction on Windows, a copy if links fail; never over a folder of the user's) and prepares the conductor's
  workspace (`.orquestra/`, the `CLAUDE.md` map, the `/issue` playbook in its format). `--install` and
  `--workspace <dir> [--conductor <agent>]` do those parts with no questions. The package ships the skills and the
  workspace template.
- `orq completion bash|zsh|fish|powershell`: prints the completion script for that shell (subcommands and their
  fixed words; files otherwise).
- CI on Linux, macOS and Windows (Node 20 and 24).
- Roadmap v2 in [docs/portability.md](docs/portability.md).

### Changed
- Keyring reads go through `@napi-rs/keyring` (Secret Service, Keychain, Credential Manager) instead of `secret-tool`
  and `security`; those remain the fallback when the native module can't load. `ORQ_KEYRING = native | cli | off`.
  The Antigravity quota now works on macOS and Windows too.
- `install.sh` and `setup/herdr.service` are optional Linux extras for a clone (herdr service and plugin, the old
  script names); nothing requires them.
- The skills call `orq pick`, `orq config`, `orq block`, `orq stats`, `orq quota`, `orq lang` (present in every
  install) instead of the `orq-*` / `agent-quota` wrappers; `/orq-setup` starts from `npm i -g` and `orq setup`.

### Fixed
- A pid of 0 (an empty `.pid` file, a missing field) no longer counts as a live process: `process.kill(0, 0)` targets
  the process group and always succeeds.
- `orq run` with the systemd cap passes `--expand-environment=no` (systemd ≥ 254), like `herdr-agent` did, so `${...}`
  in arguments survives.

## 2026-10-12 — the orq CLI in TypeScript (git only, before the npm package)

### Added
- **`orq` CLI in TypeScript** (Node 20+): `orq config`, `orq set`, `orq lang`, `orq block` and `orq quota`. The old
  names (`orq-config`, `orq-set`, `orq-lang`, `orq-block`, `agent-quota`) keep working and call it. First step of the
  [portability plan](docs/portability.md) (Linux, macOS, native Windows).
- **Quota sources in config** (`[quota]`): `"builtin"` (Claude via the OAuth usage endpoint, Codex from its latest
  session), `"none"`, `false` or `{ command = "..." }`. Copilot listed with no collector.
- **`/orq-status`** skill: read-only summary in chat — test queue, running agents, conductors, quota, blocks and the
  scoreboard.
- **`herdr-conductor -r <id>`** resumes a conversation (e.g. after a reboot) with the same account and instructions.
- `install.sh` builds the CLI (`dist.new` swapped in with `mv`, so running scripts never see a half-built `dist/`) and
  requires Node 20+ and npm.
- `.gitattributes` keeps LF line endings for scripts on every OS.

### Changed
- Board: quota shows one column per account with both windows (5h, then week below it); agents with no collector
  on one line.
- `orq quota`: Antigravity has a builtin collector (per-model quota from Cloud Code, login read from the system
  keyring on Linux), on by default.
- `orq quota`: Copilot has a builtin collector (premium requests used this month, via `gh api`), on by default.

### Fixed
- `orq quota`: when the usage endpoint fails or answers HTTP 429, the last good reading is used, window by window,
  until that window resets — an exhausted account no longer turns into `?` and gets picked.
- `install.sh`: Node version check failed on Node 26 (boolean passed to `process.exit`).

## 2026-10-09 — first public release

- herdr themes for the board: SYNTH.DECK (gunmetal default, chrome, lcd, terminal); `orq-set` writes one config value.
- Bilingual orq (English/Portuguese): `ui.lang`, `orq-lang`, `l` on the board, pt-BR docs.
- `install.sh` (requirements check, symlinks, herdr service, skills, herdr plugin) and the `/orq-setup` skill.
- English everywhere, generic examples and the case study; MIT license.

## Before the public repo (2026-09-30 → 2026-10-09)

Summary of the private history, squashed into the first public commit:

- **Orchestration moved from Agent Deck to herdr** (2026-10-06): `herdr-agent`, `herdr-verify`, `herdr-board`,
  `herdr-claim`, `herdr-deps`, `herdr-notify`, `herdr-tab`; several conductors on the same workspace.
- **Agents:** Claude headless with a memory cap per agent, Codex as default implementer, OpenCode as third vendor,
  Antigravity as alternative reviewer (sandboxed), Copilot for second opinions.
- **Picking:** `orq-config` (layered TOML/JSON), `orq-pick` (by delivery, tokens, speed, quota and rotation),
  `orq-stats` (scoreboard), `orq-block` (take an agent/account out until a date), quota per Claude account.
- **Tests:** single completion signal, test queue with one suite at a time, verification of only what changed,
  failures that also fail on the base count as pre-existing.
