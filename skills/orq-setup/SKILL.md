---
name: orq-setup
description: Guided first-time setup of orq for a new developer — detects and smoke-tests the installed agent CLIs, asks which agents take which roles, models, Claude accounts and pick weights, writes ~/.config/orq/config.toml, then prepares a conductor workspace (new-conductor.sh + workspace CLAUDE.md) and checks Plane. Use when the user says "/orq-setup", "set up orq", "configure orq" or just ran install.sh.
---

# /orq-setup — configure orq for this developer

You are setting up orq for someone who just ran `install.sh`. Be brief, one step at a time. Talk to the user in the
user's language. **Ask before writing or running anything that costs tokens or changes files**; show what you will
write first. Never handle API keys or tokens yourself: tell the user where to put them.
`$ORQ` = the orq repo (resolve it from `readlink -f "$(command -v orq-config)"`, two levels up).

## 0. Preflight
- `command -v orq-config orq-pick herdr-agent herdr` — missing orq scripts → tell the user to run `$ORQ/install.sh`
  and stop. Missing `herdr` → point to the README Install section.
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

## 2. Agents, roles and models
For each working agent, ask (AskUserQuestion where the options are known):
- **Roles:** `impl` (implements), `fix` (fix rounds, usually same as impl), `review`, `opinion` (rare second opinion).
  Remind them: reviews must come from a **vendor different** from the implementer's, so at least two vendors with
  `review` or `impl` make the flow work. Claude is also the conductor: suggest `reserve = true` for it.
- **Vendor:** defaults — claude `anthropic`, codex `openai`, opencode = the provider they use (e.g. `minimax`),
  antigravity `google`, copilot `github`.
- **Models per role and level** (`simple | medium | heavy | default`, value `"model[@effort]"`). Offer the values in
  `$ORQ/examples/irythill/config.toml` as defaults, saying clearly **they are one person's choices**, not
  recommendations; the user may have other models or plans. Ask the CLI for its model list when unsure.
- **quota names:** what `agent-quota` prints for that agent (run it and show the names).

## 3. Claude accounts
- `claude-accounts` lists them. None and the user has more than one account → offer to create
  `~/.config/claude-accounts` (lines `<name> <CLAUDE_CONFIG_DIR>`, e.g. `work ~/.claude`, `personal ~/.claude-personal`)
  and explain the alias + one-time login from `$ORQ/docs/claude-accounts.md`. One account → skip; `quota = ["<name>"]`
  only if listed there.
- Re-run `$ORQ/install.sh` afterwards so the skills are linked into each account's folder too.

## 4. Policy
Explain simply, then suggest the example's values and ask if they want to change any:
- `quota_limit` (90): an agent at or above this % of its 5h/weekly quota is left out.
- weights — `quality` (did it deliver?), `tokens` (spent little?), `speed` (finished fast?), `rotation` (penalty for
  being picked recently, spreads the work). Several issues in parallel → favor `tokens`; few, important issues →
  favor `quality`.
- `max_rounds` (2) review rounds before handing back; `machine.agent_mem_max` (4G) — suggest less on <16 GB RAM.
- **Language** of orq's messages (board, notices, CLI): `[ui] lang = "auto" | "en" | "pt"` (auto = system locale).
  Suggest the language the user is talking to you in. Mention they can switch any time with `orq-lang toggle`, the
  `l` key in `herdr-board`, or a herdr key bound to the `orq.lang-toggle` action (see the comments in
  `herdr-plugin/herdr-plugin.toml`).

## 5. Write and validate
- Show the full TOML (same layout and comments as the example, only the agents they enabled). After the OK:
  `mkdir -p ~/.config/orq`; existing file → `cp ~/.config/orq/config.toml ~/.config/orq/config.toml.bak-$(date +%Y%m%d%H%M%S)`;
  then write it. Python < 3.11 without `tomli` → write `config.json` instead.
- Validate: `orq-config files` and `orq-config` (exit 2 = error: fix and retry).
- Show the picks: `orq-pick impl --level medium --explain --no-record` and
  `orq-pick review --impl-agent <their main implementer> --explain --no-record`. Exit 3 = no candidate: explain why
  (roles, vendor, quota) and adjust.

## 6. Workspace
- Ask for the folder that groups their repos (e.g. `~/Code/acme-platform`) and a short name. After the OK:
  `$ORQ/setup/new-conductor.sh <name> <folder>`. It never overwrites a filled `CLAUDE.md`.
- Fill the repo table in `<folder>/CLAUDE.md` by inspecting each git repo inside it:
  - base branch: `git -C <repo> symbolic-ref --short refs/remotes/origin/HEAD` (strip `origin/`); ask if the team
    branches from another one (e.g. `dev`).
  - group: the suggestion `new-conductor.sh` printed.
  - stack and verification: `package.json` scripts (lint, typecheck, test) with the package manager from the lockfile;
    otherwise `Makefile`, `pyproject.toml`, `Cargo.toml`, `go.mod`… Leave `—` when nothing fits.
  Show the filled table and write it only after the OK. Plane projects and the issue standard: ask, or leave the
  placeholders and say so.

## 7. Plane
- Point to `$ORQ/docs/plane.md`. Check `claude mcp list` (and `CLAUDE_CONFIG_DIR=<dir> claude mcp list` for every
  account that will run a conductor) for a `plane` server.
- Missing → tell the user to follow docs/plane.md; the API key goes in **their** MCP config, typed by them, never in
  this chat or in a repo.

## 8. Wrap up
Short checklist: agents tested and enabled (roles), accounts, config path (+ backup), workspace and repos filled,
Plane ok/pending, anything skipped. Then how to start:
```bash
herdr                                     # the window (server runs as a service)
cd <folder> && herdr-conductor            # inside a herdr pane
```
and in the conductor: `/issue DEMO-123`.
