**English** · [Português](README.pt-BR.md)

<p align="center"><img src="docs/img/orq-logo.svg" alt="orq — an orc in a tailcoat raising a conductor's baton" width="304"></p>

# orq — orchestrating coding agents with herdr

You describe the work in a Plane issue. A **conductor** (Claude, ideally Opus) reads it, picks the right agent for
each step, dispatches the **implementer**, the **tests** and a **cross-vendor review** in [herdr](https://herdr.dev)
tabs, and hands the issue back *In Review* with a summary in Plane. Merge, PR and deploy stay with you.

What orq does **not** decide for you: which agents you have, how much each may spend and how you like to work. All of
that lives in your config.

> Born from daily use at a health-tech company: 3–5 issues in parallel on a 14 GB PC, across Claude Code, Codex,
> OpenCode, Antigravity and Copilot. The story, numbers and lessons: **[docs/case-study.md](docs/case-study.md)**.
>
> 🚧 = not available yet.

## How it works

```
You ── "/issue DEMO-123" ──► conductor (Claude in herdr)
                                │  orq-pick impl ──► which agent/model implements (config + history + quota)
                                ├─► implementer   herdr-agent  own tab · worktree from origin/<base> · memory cap
                                ├─► tests         herdr-verify  only the diff's tests · queue of one suite at a time
                                │  orq-pick review ─► a reviewer from ANOTHER vendor
                                ├─► reviewer      herdr-agent -r  read only · diff + criteria + test results attached
                                └─► Plane         comment, state, labels
                                ◄── "[HERDR-AGENT DONE] ..." in the conductor's pane (the only completion signal)
```

- **Every step in a herdr tab.** You watch it live and the tab closes when it's done. Results stay in
  `.orquestra/<ID>/` (`.out.md`, `.log`, `.done`).
- **Fixed order every round:** implementer ok → tests with no new failure → review. Only a `[blocker]` with
  `file:line` and a concrete failure becomes a fix round; the rest goes into the Plane comment (configurable maximum).
- **Fix rounds converge.** A fix continues the implementer's session on the same model (`orq pick fix --same`, effort
  one level up), fixes only the listed blockers with a test each, and the next review, by the same reviewer, checks
  those blockers and the fix's own diff instead of starting over. The implementer ends with a `## Decisions` section, so
  a deliberate choice doesn't come back as a blocker.
- **Nobody picks an agent by gut feeling.** `orq-pick` decides from data: what each agent delivered in the history,
  how many tokens it spent, how long it took, the current quota, and a rotation so no agent gets all the work.
- **The machine stays up.** Each agent runs under its own memory cap; tests wait in a queue.

## Supported agents

| Agent | CLI | Possible roles | Notes |
|---|---|---|---|
| Claude Code | `claude` | conductor, implement, review | several accounts (`claude-accounts`); Opus as conductor |
| Codex | `codex` | implement, review | sandbox without network: the conductor runs `git fetch`; quota from its session files (the free plan's 30-day window included) |
| OpenCode | `opencode` | implement, review | any provider (e.g. MiniMax); on MiniMax, quota from the Token Plan API with your key |
| Antigravity | `agy` | review | headless denies commands outside its allowlist: it reviews by reading the attached diff |
| GitHub Copilot | `copilot` | second opinion | small allowances on some plans: occasional use |

You declare only the ones you have, and the roles each may take.

## Install

Linux, macOS or Windows (native, not only WSL), in any shell — bash, zsh, fish, PowerShell, cmd.
**Requirements:** Node 20+ with `npm`, `git`, and at least one agent from the table above, logged in. Optional:
[herdr](https://herdr.dev) or tmux, so each child gets its own tab or window (otherwise children run in the
background and `orq board` shows them).

```bash
npm i -g @irythill/orq
orq setup
```

`orq setup` shows what it found (git, terminal, how memory is capped, keyring, your shell), links orq's skills into
`~/.claude/skills/` and each account folder in `claude-accounts` (a junction on Windows; never over a folder of
yours), asks about your agents and plans, writes `~/.config/orq/config.toml` (`%APPDATA%\orq\config.toml` on Windows)
and prepares the folder that groups your repos for the conductor: `.orquestra/`, the map `CLAUDE.md` and the
`/issue` playbook in the conductor's format. Pieces on their own: `orq setup --install` (no questions),
`orq setup --workspace <folder> --conductor <agent>`. Inside Claude, **`/orq-setup`** does the same as a
conversation and also fills in the repo table. Plane: [docs/plane.md](docs/plane.md).

**Memory cap:** a systemd scope on Linux with a user session, else a watchdog (macOS, Windows, WSL without systemd).
**Keyring** (Antigravity quota, Claude quota on macOS): Secret Service, Keychain or Credential Manager through
`@napi-rs/keyring`; without the native module, `secret-tool`/`security`.

### Shell completion

| Shell | Turn it on |
|---|---|
| bash | `echo 'eval "$(orq completion bash)"' >> ~/.bashrc` |
| zsh | `echo 'eval "$(orq completion zsh)"' >> ~/.zshrc` (after `compinit`) |
| fish | `orq completion fish > ~/.config/fish/completions/orq.fish` |
| PowerShell | `Add-Content $PROFILE 'orq completion powershell \| Out-String \| Invoke-Expression'` |
| cmd | no programmable completion |

### Linux extras from a clone: `install.sh` (optional)

For herdr as an always-on service, its plugin and the old script names (`herdr-*`, `orq-*`, `agent-quota`):

```bash
# herdr (tested on 0.9.3)
curl -fsSL https://herdr.dev/install.sh -o /tmp/herdr-install.sh && less /tmp/herdr-install.sh && sh /tmp/herdr-install.sh
git clone https://github.com/irythill/orq ~/Code/orq && cd ~/Code/orq
./install.sh            # links in ~/.local/bin, herdr service, skills for Claude
```

Needs `git`, `jq`, Node 20+ with `npm`, `python3` (3.11+ for TOML config; older → JSON config or
`pip install --user tomli`) and user `systemd` (WSL2: Ubuntu 22.04+ with systemd enabled). `install.sh` checks the
requirements (table of what's found and missing), builds the `orq` CLI (`src/` → `dist/`), then **symlinks** (never
copies) the scripts into `~/.local/bin`, `setup/herdr.service` into `~/.config/systemd/user/` (and enables it), and
every skill into `~/.claude/skills/` plus each account folder listed in `~/.config/claude-accounts`. Idempotent:
re-run it after a `git pull` or a new account. It never overwrites a real file (warns and skips) and never writes
your config.

| Flag | What it does |
|---|---|
| `--dry-run` | print what it would do, change nothing |
| `--uninstall` | remove only the links it creates, and only those pointing into this repo (config and history stay) |

## Configuration

Two layers, to keep **your way of working** apart from **the team's project**:

| File | Whose | What it holds |
|---|---|---|
| `~/.config/orq/config.toml` | yours, stays on your machine | agents, accounts, models per role and level, pick weights, memory limits |
| `<workspace>/.orq/workspace.toml` 🚧 | the team's, versioned | Plane (projects, issue standard), repos, base branch, verification, tests, dependencies |

The more specific one wins, key by key. JSON works too (`config.json`). To see the merged result: `orq-config`
(everything), `orq-config get policy.weights`, `orq-config files`.

### Example: personal config
Complete, commented example: [`examples/irythill/config.toml`](examples/irythill/config.toml). The essentials:

```toml
[agents.codex]
vendor = "openai"
roles  = ["impl", "fix", "review"]
quota  = ["codex"]                       # name in agent-quota's output
[agents.codex.models.impl]
simple = "gpt-6-sol@low"                 # model@effort, per issue level
medium = "gpt-6-sol@medium"
heavy  = "gpt-6.1-sol@high"
[agents.codex.models.review]
simple  = "gpt-6-sol@low"                # reviews scale with the issue too
default = "gpt-6-sol@medium"
heavy   = "gpt-6-sol@high"

[agents.opencode]
vendor = "minimax"
roles  = ["review"]                      # here it only reviews; for someone else it may implement
[agents.opencode.models.review]
default = "minimax/MiniMax-M3"

[agents.corvus]                          # a review tool, not a chat: no prompt, no session
vendor  = "minimax"                      # the vendor of the model it runs, for the cross-vendor rule
roles   = ["review"]
run     = "corvus --markdown -b {base}"  # {base} = orq agent -b; it reads the diff itself
write   = false
ok_exit = [0, 1]                         # exit 1 = findings, still a verdict
# filter = "jq -r '...'"                 # optional: its output → [blocker]/[suggestion] lines

[conductor]
handoff_at = 85                          # % of the window → orq handoff moves the conductor to another account
max_per_account = 2                      # an account already holding this many conductors is never a handoff target

[policy]
quota_week = 95                          # ≥ 95% of the week → agent out
quota_5h = { simple = 90, medium = 85, heavy = 80 }  # same for the 5h window, by task level
[policy.weights]
quality  = 0.40                          # did it deliver? (impl: approved on the first review)
tokens   = 0.45                          # did it spend little?
speed    = 0.15
rotation = 0.20                          # penalty for having been picked recently
```

### How `orq-pick` chooses
1. **Filters:** only agents with that role, under the quota limit, not blocked (`orq-block`) and, for reviews, from a
   vendor other than the implementer's. With several accounts, it takes the least used one.
2. **Scores:** `quality × delivery + tokens × economy + speed × quickness − rotation × recent picks`. The numbers come
   from the history (`orq-stats`); an agent with few runs uses the config's `prior` and gets an exploration bonus.
3. **`reserve = true` agents** (e.g. Claude, which shares quota with the conductor) only come in when nothing else fits.

```bash
orq-pick review --impl-agent codex --explain     # every candidate's score and who was left out, and why
orq-stats --days 30                              # scoreboard: delivery, approval, time and tokens per agent and model
orq-block antigravity --days 3                   # out of the picks (e.g. weekly quota gone, no collector for it)
orq pick fix --same .orquestra/<ID>/impl-<repo>.pick   # a fix round: the implementer's agent/model/account, effort +1
```

### Language and theme
orq speaks English and Portuguese: CLI messages, `herdr-board`, notices and `install.sh`. It follows
`[ui] lang` in your config (`"auto"` = system locale, `"en"`, `"pt"`), or the `ORQ_LANG` environment variable.
Switch it any time:
- `orq-lang pt` / `orq-lang en` / `orq-lang toggle` (`orq-lang` alone shows the current one);
- `l` inside `orq board`;
- a herdr key: `install.sh` links the `orq` herdr plugin; bind its `orq.lang-toggle` action (snippet in
  `herdr-plugin/herdr-plugin.toml`) — e.g. `prefix+shift+l` — and `orq.board` to open the board as an overlay.

`orq board` has its own look, from the [SYNTH.DECK](https://github.com/irythill/synth-deck-portfolio)
portfolio: `[ui] theme = "gunmetal"` (default, dark graphite), `"chrome"` (light silver), `"lcd"` (phosphor green) or
`"terminal"` (your terminal's colors). `t` inside the board cycles through them (`ORQ_THEME` overrides).

Whatever is already running keeps its language. Conductors always talk to you in your own language. Docs:
[Português](README.pt-BR.md).

## Daily use

```bash
herdr                                    # opens the window (the server runs as a service)
cd ~/Code/<workspace> && herdr-conductor # inside a herdr pane: opens the conductor (account and model optional)
```
In the conductor: **`/issue DEMO-123`**. It answers in one line and moves on by itself at every `[HERDR-AGENT DONE]`.
You only come back when it asks for a decision or says it's done.

To see everything at once, keep **`orq board`** open in a tab or window (any terminal, any OS; `herdr-board` calls it):
test queue, running agents (model, memory against the cap, last action), conductors and their issues, memory, quota,
blocks and the 7-day scoreboard. `--once` prints it once, `--json` for scripts. With
`ui.toast.delivery = "system"` in herdr's config, each finished step also pops up a native OS notification.
For quota without opening the board, `orq quota --line` fits herdr's tab bar (a `tab_bar_right` command entry,
[docs/herdr.md](docs/herdr.md#quota-in-the-tab-bar)). After merges, `orq gc` lists and removes the issue worktrees
left behind.

Several issues at once: one conductor per issue (ideally on different accounts). `herdr-claim` keeps two conductors
off the same issue. Details, shortcuts and scenarios: [docs/herdr.md](docs/herdr.md).

## Skills

| Skill | What for | Status |
|---|---|---|
| `/issue <ID>` | Full flow: issue → implementation → tests → review → Plane | ready |
| `/orq-setup` | Guided setup: agents, accounts, repos, verification | ready |
| `/review <PR or branch>` | Cross review of something finished (e.g. a teammate's PR), no implementation | 🚧 |
| `/investigate <question>` | A read-only agent investigates a bug or piece of code and reports | 🚧 |
| `/orq-status` | Summary in chat: queue, running agents, scoreboard and quota | ready |

## Commands

| Command | What it does |
|---|---|
| `orq agent -a <agent> ...` (`herdr-agent`) | Runs an agent with a memory cap in a herdr tab, a tmux window or the background; `-r` read only, `-R <id>` continue the session, `-i` attach a file, `-b <base>` attach the diff, `-T` the agent's own screen (herdr or tmux; `-R` with it open types the follow-up into it) |
| `orq instructions claude\|agents` | Writes the `/issue` playbook as `SKILL.md` (Claude Code) or into `AGENTS.md` (Codex, OpenCode…) |
| `orq wait <prefix>...` | Blocks until those agents finish; prints `status=` and the answer file (any conductor, any terminal) |
| `orq verify ...` (`herdr-verify`) | Tests related to the diff, queued and memory-capped; failures that also fail on the base count as pre-existing |
| `orq board` (`herdr-board`) | Live board: queue, agents, conductors, quota, blocks, scoreboard |
| `herdr-conductor` | Opens the conductor in the current pane |
| `herdr-claim` | Owner of each issue among conductors |
| `herdr-deps` | Links the worktree's dependencies to the main repo's (no reinstall) |
| `orq baseline ...` (`herdr-baseline`) | Manual snapshot of the tests failing on the base (outside the flow) |
| `orq gc [-w <workspace>] [--yes] [--days N] [--json]` | Lists issue worktrees that are safe to remove (PR merged, or content already in the base, squash merges included); `--yes` removes them. Never touches uncommitted work, unpushed commits, a live claim or a running agent. Optional daily `orq-gc.timer` |
| `orq quota --line` | One line of quota for a status bar (`work 64 · home 94! · codex 81`), from the board's cache, never the network |
| `orq setup` | First configuration and install: environment, skills for Claude, config, conductor workspace |
| `orq completion bash\|zsh\|fish\|powershell` | Prints the shell completion script (see Install) |
| `orq <config\|set\|lang\|block\|quota>` | The cross-platform CLI (TypeScript); the `orq-*` and `agent-quota` names below call it |
| `agent-quota` | Current quota of each agent and account; on a failed reading, the last good one until its window resets |
| `orq-config` · `orq-pick` · `orq-stats` · `orq-block` | Configuration, agent pick, scoreboard, manual blocks |
| `orq-lang` | Shows or switches the language of orq's messages (en/pt) |
| `orq-set <section> <key> <value>` | Writes one value into your orq config (e.g. `orq-set ui theme lcd`) |

## More

- [docs/case-study.md](docs/case-study.md) — how this came to be, with real numbers
- [docs/plane.md](docs/plane.md) — self-hosted Plane through MCP
- [docs/claude-accounts.md](docs/claude-accounts.md) — several Claude accounts
- [docs/herdr.md](docs/herdr.md) — herdr day to day, shortcuts, several issues at once
- [docs/troubleshooting.md](docs/troubleshooting.md) — known problems and fixes
- [docs/omarchy.md](docs/omarchy.md) — extras for Omarchy users
- [docs/portability.md](docs/portability.md) — the roadmap: Linux, macOS and native Windows, any agent as conductor, user-defined roles, guided setup
- [CHANGELOG.md](CHANGELOG.md) — what changed, release by release
- `examples/` — real configurations to copy

## License

[MIT](LICENSE)
