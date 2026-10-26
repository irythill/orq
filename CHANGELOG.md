# Changelog

What changed in orq, newest first. Dates are when it landed on `main`. Format inspired by
[Keep a Changelog](https://keepachangelog.com/); versions follow `package.json`.
Português: [CHANGELOG.pt-BR.md](CHANGELOG.pt-BR.md).

## [Unreleased]
### Added
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
- CI on Linux, macOS and Windows (Node 20 and 24).
- Roadmap v2 in [docs/portability.md](docs/portability.md).

## [0.1.0] — 2026-10-12

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
