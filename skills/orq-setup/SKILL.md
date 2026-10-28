---
name: orq-setup
description: Guided first-time setup of orq for a new developer — detects and smoke-tests the installed agent CLIs, asks which agents take which roles, models, Claude accounts and pick weights, writes ~/.config/orq/config.toml, then prepares a conductor workspace (orq setup --workspace + workspace CLAUDE.md) and checks Plane. Use when the user says "/orq-setup", "set up orq", "configure orq" or just installed orq (npm i -g @irythill/orq, or install.sh).
---

# /orq-setup — configure orq for this developer

You are setting up orq for someone who just installed it (`npm i -g @irythill/orq`, or `install.sh` from a clone).
Be brief, one step at a time. Talk to the user in the user's language. **Ask before writing or running anything that
costs tokens or changes files**; show what you will write first. Never handle API keys or tokens yourself: tell the
user where to put them.
`$ORQ` = docs and examples: a clone of the repo if there is one, else https://github.com/irythill/orq (`docs/`,
`examples/`; the npm package ships only the CLI, the skills and the workspace template).

## 0. Preflight
- `command -v orq` missing → tell the user to run `npm i -g @irythill/orq` and stop.
- `orq setup --install`: shows what orq found (git, terminal host, memory cap, keyring, shell completion) and links
  the skills for Claude Code. `git` missing → stop: it is required. herdr is optional (tabs per child; on Linux,
  `$ORQ/install.sh` adds it as a service): without it children run in tmux windows or in the background.
- Existing `~/.config/orq/config.toml` (or `config.json`)? Show it in short and ask: start over, or adjust it.

## 1. Detect and smoke-test the agents
- `command -v claude codex opencode agy copilot` → list what's installed (`agy` = Antigravity).
- Offer one headless smoke test per agent found. Say that **each costs a few tokens** and needs the CLI logged in; run
  only the ones the user approves (AskUserQuestion, multiSelect), one at a time, with a timeout:
  ```bash
  timeout 120 claude -p "reply ok"
  timeout 120 codex exec --skip-git-repo-check "reply ok"
  timeout 120 opencode run "reply ok"
  timeout 120 agy -p "reply ok"
  timeout 120 copilot -p "reply ok" -s
  ```
- Report a table: agent · installed · test ok/failed/skipped. Failed → likely not logged in: tell the user the login
  command (`claude`, `codex login`, `opencode auth login`, `agy`, `copilot` then `/login`) and offer to retest. Only
  agents that passed (or that the user insists on) go into the config.

## 2. Agents and roles — `orq setup` suggests, the user decides
Don't ask "which roles should this agent take?": newcomers can't answer that. Ask what they know (AskUserQuestion)
and let `orq setup` apply the rules (src/suggest.ts):
- per working agent: **plan** — `free` · `small` (Pro, Copilot Pro, monthly allowance) · `large` (Max, high tiers) ·
  `payg` (API, MiniMax); its **vendor** only for agents orq doesn't know (opencode: the provider, e.g. `minimax`);
- which one they **trust most** to write code (optional);
- where they will **talk to orq** (the conductor): an agent name, or `other`;
- how many tasks they usually run **in parallel**; how much **RAM** agents may use (suggest total RAM).
Then write the answers to a temp file and show the proposal:
```bash
orq setup --answers /tmp/orq-answers.json      # {"agents":{"codex":{"plan":"large","trust":true},...},"conductor":"claude","parallel":3,"ramGB":16}
```
Explain each `# Why:` line in plain words and ask what to change. Whatever they fix becomes `[roles.<role>] agent = ...`;
the rest stays `auto`. Presets for those who want no questions: `--preset economy | quality | single-agent`.
**Models** (`models.<role>.<level> = "model[@effort]"`): optional — without them each CLI uses its default model.
Offer `$ORQ/examples/irythill/config.toml` as an example, saying clearly **it is one person's choices**.
**quota names:** what `orq quota` prints for that agent.

## 3. Claude accounts
- `claude-accounts` lists them. None and the user has more than one account → offer to create
  `~/.config/claude-accounts` (lines `<name> <CLAUDE_CONFIG_DIR>`, e.g. `work ~/.claude`, `personal ~/.claude-personal`)
  and explain the alias + one-time login from `$ORQ/docs/claude-accounts.md`. One account → skip; `quota = ["<name>"]`
  only if listed there.
- Re-run `orq setup --install` afterwards so the skills are linked into each account's folder too.

## 4. Policy
Explain simply, then suggest the example's values and ask if they want to change any:
- `quota_limit` (90): an agent at or above this % of its 5h/weekly quota is left out.
- weights — already suggested by `orq setup` from the parallel tasks: `quality` (did it deliver?), `tokens` (spent
  little?), `speed` (finished fast?), `rotation` (penalty for being picked recently, spreads the work).
- `max_rounds` (2) review rounds before handing back; `machine.agent_mem_max` / `test_mem_max` come from `orq setup`
  (RAM and parallel tasks) — the user may change them.
- **Language** of orq's messages (board, notices, CLI): `[ui] lang = "auto" | "en" | "pt"` (auto = system locale).
  Suggest the language the user is talking to you in. Mention they can switch any time with `orq lang toggle`, the
  `l` key in `orq board`, or a herdr key bound to the `orq.lang-toggle` action (see the comments in
  `herdr-plugin/herdr-plugin.toml`).
- **Board theme**: `[ui] theme = "gunmetal"` (default, dark) | `"chrome"` (light) | `"lcd"` (green) | `"terminal"`.
  Light terminal → suggest `chrome`; they can cycle with `t` inside `orq board`.

## 5. Write and validate
- Show the full TOML (the proposal plus the changes they asked for). After the OK: `orq setup --answers <file> --write`
  (backs up an existing config as `config.toml.bak-<timestamp>`), then apply their edits with `orq set` or by editing
  the file.
- Validate: `orq config files` and `orq config` (exit 2 = error: fix and retry).
- Show the picks: `orq pick impl --level medium --explain --no-record` and
  `orq pick review --impl-agent <their main implementer> --explain --no-record`. Exit 3 = no candidate: explain why
  (roles, vendor, quota) and adjust.

## 6. Workspace
- Ask for the folder that groups their repos (e.g. `~/Code/acme-platform`). After the OK:
  `orq setup --workspace <folder> --conductor <the conductor agent>` — `.orquestra/`, `.worktrees/`, the map
  `<folder>/CLAUDE.md` from the template (never overwrites one) and the `/issue` playbook in the conductor's format
  (`.claude/skills/issue/SKILL.md` for Claude Code, `AGENTS.md` for the others). Conductor in herdr (clone only):
  `$ORQ/setup/new-conductor.sh <name> <folder>` also writes its instructions and permissions.
- Fill the repo table in `<folder>/CLAUDE.md` by inspecting each git repo inside it:
  - base branch: `git -C <repo> symbolic-ref --short refs/remotes/origin/HEAD` (strip `origin/`); ask if the team
    branches from another one (e.g. `dev`).
  - group: the repo folder name in lower case (the herdr workspace or tmux group for its children).
  - stack and verification: `package.json` scripts (lint, typecheck, test) with the package manager from the lockfile;
    otherwise `Makefile`, `pyproject.toml`, `Cargo.toml`, `go.mod`… Leave `—` when nothing fits.
  Show the filled table and write it only after the OK. Plane projects and the issue standard: ask, or leave the
  placeholders and say so.

## 7. Plane
- Point to `$ORQ/docs/plane.md` (on GitHub without a clone). Check `claude mcp list` (and `CLAUDE_CONFIG_DIR=<dir> claude mcp list` for every
  account that will run a conductor) for a `plane` server.
- Missing → tell the user to follow docs/plane.md; the API key goes in **their** MCP config, typed by them, never in
  this chat or in a repo.

## 8. Wrap up
Short checklist: agents tested and enabled (roles), accounts, config path (+ backup), workspace and repos filled,
Plane ok/pending, anything skipped. Then how to start:
```bash
cd <folder> && claude                     # any terminal (or codex, opencode… reading AGENTS.md)
cd <folder> && herdr-conductor            # or inside a herdr pane (clone + install.sh)
```
and in the conductor: `/issue DEMO-123`. `orq board` in another tab shows everything; shell completion:
`orq completion bash|zsh|fish|powershell` (the line to add is in `orq setup --install`).
