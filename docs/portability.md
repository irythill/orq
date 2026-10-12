# Portability plan — orq on Linux, macOS and Windows

**Status:** in progress — steps 1 and 2 done (2026-10-10).

**Goal:** `npm i -g @irythill/orq` (or an equivalent single install) works on Linux, macOS and Windows (native, not only WSL),
in any shell: bash, zsh, fish, PowerShell, cmd. herdr/tmux stay the **best** experience, not a requirement.

## 1. Where orq is tied to Linux today

| Piece | Linux-only mechanism | Used by |
|---|---|---|
| Memory cap per agent / test suite | `systemd-run --user --scope -p MemoryMax=` (cgroups v2) | herdr-agent, herdr-verify, herdr-baseline |
| Listing running agents and their memory | `systemctl --user list-units 'herdr-agent-*'`, `MemoryCurrent` | herdr-board |
| Test queue (one suite at a time) | `flock` + reading waiters from `/proc/locks` | herdr-verify, herdr-baseline, herdr-deps, herdr-claim, herdr-board |
| Process info | `/proc/<pid>/cmdline`, `/proc/meminfo`, `pgrep`, `ps -o` | herdr-board, herdr-agent |
| Quota | Omarchy collectors (`/usr/share/omarchy/bin/omarchy-agent-usage-*`) | agent-quota |
| Detaching background jobs | `setsid` | herdr-agent, herdr-board |
| Always-on server | `herdr.service` (systemd user unit) | install.sh |
| GNU flavours | `stat -c`, `date -d`, `numfmt`, `readlink -f`, `timeout` | many |
| Panes, tabs, notifying the conductor | `herdr pane/tab/agent ...` | herdr-agent, herdr-tab, herdr-notify, herdr-conductor, herdr-board |
| Language itself | bash 4+ scripts | 15 scripts (Python: orq-config, orq-block, orq-pick, orq-stats, orq_i18n.py) |

The 4 Python scripts (orq-config, orq-block, orq-pick, orq-stats) are already almost portable.

## 2. Target architecture

```
                 ┌───────────────────────── orq (one CLI, TypeScript/Node) ─────────────────────────┐
 conductor  ───► │ config · pick · block · stats · claim · quota · agent · verify · board · status  │
 (Claude Code)   │                                                                                   │
                 │  ProcessHost        TerminalHost             QuotaSource            Lock          │
                 └──────┬─────────────────┬───────────────────────┬──────────────────────┬──────────┘
                        │                 │                       │                      │
          memory cap / list /     herdr (tmux) ★ best        claude · codex ·      file lock in the
          kill, per OS            plain (logs + board)       copilot · custom      orq state dir
                                  (later: Orca, WezTerm…)    command · none
```

Four small interfaces isolate everything OS-specific. The rest of orq (picking, prompts, review flow, stats,
i18n) is plain logic and runs the same everywhere.

### ProcessHost — run an agent with a memory cap
| OS | How the cap is enforced |
|---|---|
| Linux with systemd | `systemd-run --user --scope` (as today: the kernel kills only that agent) |
| Windows | Job Object with a memory limit (same guarantee as the cgroup) |
| macOS / Linux without systemd | **watchdog**: orq samples the process tree's memory every few seconds and kills it above the cap |

Memory and process listing everywhere through a cross-platform library (e.g. `pidusage` / `systeminformation`),
replacing `/proc` and `systemctl`. Running agents are tracked by orq itself (a state file per run: pid, prefix,
start time), not by systemd unit names.

### TerminalHost — where the agent's output is visible
Children already run **headless** (`claude -p`, `codex exec`, `copilot -p`…), so a terminal multiplexer is only
for *watching* and for *notifying the conductor*.
- **herdr** (tmux) — recommended: a tab per child, live output, the `[HERDR-AGENT DONE]` line typed into the
  conductor's pane, screen mode (`-T`).
- **plain** — works in any shell: output goes to `<prefix>.log`; `orq board` shows everything in one terminal;
  the conductor learns that a child finished with `orq wait <prefix>` (blocks until `.done`) instead of a typed
  notice. Protocol files (`.done`, `status=`, the verify report) stay the same.
- Later, if useful: Orca, WezTerm, Windows Terminal tabs — each is just another TerminalHost.

### QuotaSource — where quota numbers come from
Configurable per user (see §3). Built-in sources:
- `claude` — the account's usage from Anthropic's OAuth usage endpoint, with the login Claude Code already has
  (`<account dir>/.credentials.json`, or the macOS Keychain). One line per account in `claude-accounts`. The token
  is never refreshed by orq: expired → `?` + "open claude once".
- `codex` — the `rate_limits` Codex writes to its session files (already the fallback today).
- `antigravity` — per-model quota from Cloud Code (`fetchAvailableModels`), with the login agy keeps in the system
  keyring (Linux: Secret Service through `secret-tool`; macOS/Windows: to do). Worst model per window; never refreshes
  agy's login: expired → last reading + "run `agy models`".
- `copilot` — premium requests used this month (`gh api /copilot_internal/user`, needs `gh auth login`); a monthly
  allowance, so it fills the week slot and the 5h slot is `-`.
- `command` — any command that prints `<name> 5h=NN% week=NN%` (covers Omarchy collectors, or anything custom).
- `false` — left out of the list.
- `none` — no data; the agent is never skipped for quota, use `orq block` when it runs out (MiniMax
  pay-as-you-go today).

### Lock — test queue
A lock file in orq's state directory (`proper-lockfile`-style, works on all three OSes) plus a queue file that
records who is waiting, so `orq board` no longer needs `/proc/locks`.

### Paths
Resolved in one place (`src/paths.ts`). Linux and macOS keep `~/.config/orq` and `~/.local/state/orq` (or the
`XDG_*` variables), so existing installs keep working; Windows uses `%APPDATA%\orq` and `%LOCALAPPDATA%\orq\state`.

## 3. New user configuration

```toml
[machine]
agent_mem_max = "4G"       # already exists — now enforced on every OS (see ProcessHost)
test_mem_max  = "6G"       # already exists
test_slots    = 1          # already exists
terminal      = "auto"     # NEW: auto | herdr | plain   (auto = herdr if installed, else plain)

[quota]                    # NEW: which agents orq reads quota from, and how
claude      = "builtin"
codex       = "builtin"
copilot     = "builtin"
antigravity = "builtin"
opencode    = "none"
# any agent: { command = "my-collector" }   → prints "<name> 5h=NN% week=NN%"
# false = leave it out. Omarchy's collector, if you prefer it for Codex:
# codex = { command = "/usr/share/omarchy/bin/omarchy-agent-usage-codex --limits-only --force | ..." }
```

`/orq-setup` asks these questions (it already asks about agents and roles).

## 4. Language: TypeScript on Node

Why not keep bash: it is the problem (no bash on Windows outside WSL/Git Bash; GNU vs BSD tools on macOS).
Why TypeScript over Python: the maintainer's main language; `npm i -g` works the same on the three OSes;
single binary possible later (`bun build --compile` / Node SEA); mature libraries for every interface above.
Python stays acceptable during the migration — the four Python scripts keep working until they are ported.

## 5. Migration order (each step ships on its own; Linux keeps working the whole time)

1. ✅ **Skeleton:** `orq` CLI in TypeScript with subcommands and i18n (`m(en, pt)`), installed by `install.sh`
   next to the current scripts. Port the simple, already-portable ones: `orq config`, `orq set`, `orq lang`,
   `orq block`. Old names stay as thin wrappers (`orq-config` → `orq config`) so nothing breaks.
2. ✅ **Quota:** `orq quota` with QuotaSources and the `[quota]` config. Removes the Omarchy dependency.
3. **Pick & stats:** port `orq-pick` and `orq-stats` (logic only).
4. **Lock & claim:** portable lock + queue file; port `herdr-claim`, `herdr-deps`.
5. **ProcessHost:** cgroup / Job Object / watchdog; port `herdr-verify`, `herdr-baseline`.
6. **TerminalHost + agent:** port `herdr-agent` (the biggest: 264 lines) with `herdr` and `plain` hosts;
   `orq wait`; update the `/issue` skill to use `orq wait` when not in herdr.
7. **Board:** `orq board` reading orq's own state instead of `/proc` and systemd.
8. **Installer:** `npm i -g @irythill/orq` + `orq setup` on all OSes; `install.sh` becomes Linux convenience only.
   CI runs the test suite on Linux, macOS and Windows.

## 6. Open questions
- herdr on macOS: tmux exists there, so herdr may work as is — to verify.
- Package name: `orq` is taken on npm → `@irythill/orq` (the command is still `orq`).
