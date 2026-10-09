**English** · [Português](README.pt-BR.md)

# orq — orchestrating coding agents with herdr

You describe the work in a Plane issue. A **conductor** (Claude, ideally Opus) reads it, picks the right agent for
each step, dispatches the **implementer**, the **tests** and a **cross-vendor review** in [herdr](https://herdr.dev)
tabs, and hands the issue back *In Review* with a summary in Plane. Merge, PR and deploy stay with you.

What orq does **not** decide for you: which agents you have, how much each may spend and how you like to work. All of
that lives in your config.

> Born from daily use at a health-tech company: 3–5 issues in parallel on a 14 GB laptop, across Claude Code, Codex,
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
- **Fixed order every round:** implementer ok → tests with no new failure → review. A blocking problem becomes a fix
  round in the implementer's own session (configurable maximum).
- **Nobody picks an agent by gut feeling.** `orq-pick` decides from data: what each agent delivered in the history,
  how many tokens it spent, how long it took, the current quota, and a rotation so no agent gets all the work.
- **The machine stays up.** Each agent runs under its own memory cap; tests wait in a queue.

## Supported agents

| Agent | CLI | Possible roles | Notes |
|---|---|---|---|
| Claude Code | `claude` | conductor, implement, review | several accounts (`claude-accounts`); Opus as conductor |
| Codex | `codex` | implement, review | sandbox without network: the conductor runs `git fetch` |
| OpenCode | `opencode` | implement, review | any provider (e.g. MiniMax) |
| Antigravity | `agy` | review | headless denies commands outside its allowlist: it reviews by reading the attached diff |
| GitHub Copilot | `copilot` | second opinion | small allowances on some plans: occasional use |

You declare only the ones you have, and the roles each may take.

## Install

Linux or **Windows with WSL2** (Ubuntu 22.04+ with systemd enabled). macOS: no per-agent memory cap.

**Requirements:** `git`, `jq`, `python3` (3.11+ for TOML config; older → JSON config or `pip install --user tomli`),
user `systemd`, Node if your repos are JS/TS, and at least one agent from the table above, logged in.

```bash
# 1. herdr (tested on 0.9.3)
curl -fsSL https://herdr.dev/install.sh -o /tmp/herdr-install.sh && less /tmp/herdr-install.sh && sh /tmp/herdr-install.sh

# 2. orq
git clone https://github.com/irythill/orq ~/Code/orq && cd ~/Code/orq
./install.sh            # links in ~/.local/bin, herdr service, skills for Claude
```

`install.sh` checks the requirements (table of what's found and missing), then **symlinks** (never copies) the
scripts into `~/.local/bin`, `setup/herdr.service` into `~/.config/systemd/user/` (and enables it), and every skill
into `~/.claude/skills/` plus each account folder listed in `~/.config/claude-accounts`. Idempotent: re-run it after
a `git pull` or a new account. It never overwrites a real file (warns and skips) and never writes your config.

| Flag | What it does |
|---|---|
| `--dry-run` | print what it would do, change nothing |
| `--uninstall` | remove only the links it creates, and only those pointing into this repo (config and history stay) |

Then, inside Claude: **`/orq-setup`** — it detects the installed agents, tests each one headless, asks about roles,
models, accounts, repos, base branches and verification commands, writes `~/.config/orq/config.toml` and fills the
workspace `CLAUDE.md`. Plane:
[docs/plane.md](docs/plane.md).

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
simple = "gpt-6-sol@low"                 # model@effort
heavy  = "gpt-6.1-sol@medium"

[agents.opencode]
vendor = "minimax"
roles  = ["review"]                      # here it only reviews; for someone else it may implement
[agents.opencode.models.review]
default = "minimax/MiniMax-M3"

[policy]
quota_limit = 90                         # ≥ 90% used → agent out
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
```

### Language and theme
orq speaks English and Portuguese: CLI messages, `herdr-board`, notices and `install.sh`. It follows
`[ui] lang` in your config (`"auto"` = system locale, `"en"`, `"pt"`), or the `ORQ_LANG` environment variable.
Switch it any time:
- `orq-lang pt` / `orq-lang en` / `orq-lang toggle` (`orq-lang` alone shows the current one);
- `l` inside `herdr-board`;
- a herdr key: `install.sh` links the `orq` herdr plugin; bind its `orq.lang-toggle` action (snippet in
  `herdr-plugin/herdr-plugin.toml`) — e.g. `prefix+shift+l` — and `orq.board` to open the board as an overlay.

`herdr-board` has its own look, from the [SYNTH.DECK](https://github.com/irythill/synth-deck-portfolio)
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

To see everything at once, keep **`herdr-board`** open in a tab: test queue, running agents (model, memory, last
action), conductors and what each is waiting for, memory and quota. `f` jumps to the pane of any line. With
`ui.toast.delivery = "system"` in herdr's config, each finished step also pops up a native OS notification.

Several issues at once: one conductor per issue (ideally on different accounts). `herdr-claim` keeps two conductors
off the same issue. Details, shortcuts and scenarios: [docs/herdr.md](docs/herdr.md).

## Skills

| Skill | What for | Status |
|---|---|---|
| `/issue <ID>` | Full flow: issue → implementation → tests → review → Plane | ready |
| `/orq-setup` | Guided setup: agents, accounts, repos, verification | ready |
| `/review <PR or branch>` | Cross review of something finished (e.g. a teammate's PR), no implementation | 🚧 |
| `/investigate <question>` | A read-only agent investigates a bug or piece of code and reports | 🚧 |
| `/orq-status` | Summary in chat: queue, running agents, scoreboard and quota | 🚧 |

## Commands

| Command | What it does |
|---|---|
| `herdr-agent -a <agent> ...` | Runs an agent in a tab with a memory cap; `-r` read only, `-R <id>` continue the session, `-i` attach a file, `-b <base>` attach the diff, `-T` the agent's own screen |
| `herdr-verify` | Tests related to the diff; failures that also fail on the base count as pre-existing |
| `herdr-board` | Live board |
| `herdr-conductor` | Opens the conductor in the current pane |
| `herdr-claim` | Owner of each issue among conductors |
| `herdr-deps` | Links the worktree's dependencies to the main repo's (no reinstall) |
| `herdr-baseline` | Manual snapshot of the tests failing on the base (outside the flow) |
| `agent-quota` | Current quota of each agent and account |
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
- `examples/` — real configurations to copy

## License

[MIT](LICENSE)
