# Changelog

What changed in orq, newest first. Dates are when it landed on `main`. Format inspired by
[Keep a Changelog](https://keepachangelog.com/); versions follow `package.json`.
Português: [CHANGELOG.pt-BR.md](CHANGELOG.pt-BR.md).

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
