# Changelog

What changed in orq, newest first. Dates are when it landed on `main`. Format inspired by
[Keep a Changelog](https://keepachangelog.com/); versions follow `package.json`.
Português: [CHANGELOG.pt-BR.md](CHANGELOG.pt-BR.md).

## [Unreleased]

## [0.8.0] — 2026-11-10
### Added
- `orq pick` scores (agent, model) pairs: a level in `models.<role>` may list several candidate models (`medium = ["a@medium", "b@medium"]`; a string stays valid). Each pair is scored on its own stats row, with its own exploration and per-model quota check; `--explain` shows one line per pair. Fixed roles take the first model (#103).

### Fixed
- Release check: the last version is the highest `v*` tag, not the nearest one reachable from `dev` (release tags sit on main's merge commits), so the dev → main PR no longer asks for the version already released.

## [0.7.0] — 2026-11-10
### Added
- Docs in sync with 0.7.0 (both READMEs, the `/issue` skill, troubleshooting): `orq pick`'s new filters, conductor session names, orq fetching/committing for agents that can't, `orq <command>` instead of the old `orq-*` names; the Portuguese README's config example caught up. Dependabot PR titles are explicit Conventional Commits.
- Release automation: every push to `dev` opens or updates the `dev → main` PR with the version the commits call for; a `version` check fails a PR into `main` until package.json and both changelogs carry it; merging into `main` tags, publishes to npm and creates the GitHub release. PR titles must be Conventional Commits (see CONTRIBUTING.md).
- Agent capabilities `commit` and `network` (`[agents.<name>]`, default true). For a write run in a git repo, orq does
  what the agent can't: `commit = false` → orq commits the changes after the run (message from a `Commit: ...` line in
  the answer, else the title) and reports it under `## Commit (by orq)`; `network = false` → orq runs `git fetch origin`
  before the run so the agent can rebase locally. The prompt says so, so the agent doesn't try. Built in: antigravity
  `commit = false`, codex `network = false`.
- Agent capability `base_commit` (default: true if the agent takes the prompt, false for a tool that ignores it). A tool that diffs against
  `origin/<base>` itself can't review `-b <round-n.sha>`, so `orq pick review --base <ref>` skips it when the base is a
  commit, and `orq agent -b <commit>` falls back to the branch base (`--base-branch <branch>`, else `origin/HEAD`), warns and
  adds `## Review scope (by orq)` to the answer: the review covers the whole branch, not just the round delta (#76).

### Changed
- **Node 22 or newer is required** (`engines >=22`). Node 20 reached end of life in April 2026. CI tests Node 22, 24
  and 26.

### Fixed
- `orq stats` names every agent and model: from the job's argv, then the pick, then the log (review tools run as plain CLIs no longer show as `?`; a `-m` inside a prompt is no longer read as the model; opencode's screen model comes from its config). Time on a screen run stops at the first turn (`<prefix>.turns`), so a screen left open no longer inflates it; killed runs and older screen runs are left out of the time median (`-`). opencode tokens are counted again on its newer event format (#59).
- `orq pick` skips an agent whose CLI doesn't resolve on PATH (e.g. installed under another Node version), with a reinstall hint, instead of failing after dispatch (#77).
- Several conductors on one workspace get distinct session names, `conductor-<workspace>:<herdr label or ORQ_CONDUCTOR_ID>`, so they can address each other; `orq claim -l` ends each line with that `session=` (#79).
- `orq agent -T` with Codex sometimes never signalled the end of a turn (#62): a `.id` left on the prefix by an earlier
  run (another agent or session) made `--turn codex` drop every real turn as a side thread. A new launch now clears it
  (`-R` writes the resumed session). On herdr, a turn whose hook still doesn't fire (screen seen busy, then idle for
  60 s, `.done` not rewritten) is signalled by the runner as `status=fail reason=no-hook`, with the screen's last lines
  as the answer.
- `policy.max_rounds` counts only review rounds: `orq agent -R --reason verify|unblock` (default `review`) neither
  counts nor is refused; every follow-up goes to `.rounds-<session>.log` and `orq rounds` shows them per reason. The
  round is counted at launch, so a dispatch refused later costs none. `/issue` names verify fixes `verify-fix-<n>.md` (#75).
- A review (`orq agent -r` on a `review*` prefix) that exits 0 without a verdict ("I'll start by exploring the repo...")
  is now `status=fail reason=no-verdict` instead of `ok`. A verdict = a finding with a severity or an explicit approval
  (APPROVED, LGTM, aprovado, no findings...). `policy.review_verdict = false` turns it off. Findings written as bare
  `[blocker] file:line` lines (no list marker) now count, for `orq rounds` too (#78).
- Fix-round reviews converge on large branches: `orq agent -b <commit>` attaches only `<commit>..HEAD` (a review tool
  gets the round's start as `{base}`, not the whole branch again); in `/issue` a finding outside the fix diff never
  opens a round, it goes to a deferred list (security/personal-data leaks stop and ask the user); `orq rounds` warns
  `fresh` when two fix rounds bring new heavy findings — split the issue (#72).

## [0.6.1] — 2026-11-06
### Fixed
- `orq setup --workspace` writes `.orquestra-conductor.md` (and the package ships its template), so `orq conductor`
  starts in a freshly prepared workspace instead of failing with "no .orquestra-conductor.md here" (#63).
- `orq pick` blends each agent's prior with its measured delivery/economy/speed, `(prior·k + observed·n)/(k + n)`
  with k = `min_samples`, instead of a flat prior below `min_samples` runs: an under-sampled agent that costs far more
  no longer wins on economy. The `explore` bonus fades with n and stops after `policy.weights.explore_streak` (2)
  consecutive picks; `--explain` shows `prior→observed` per axis (#54).
- Antigravity quota is tracked per model: `orq quota` lists `antigravity/<model>` lines, an exhausted bucket (no
  `remainingFraction`, only a `resetTime`) reads as 100% used, and `orq pick` checks the model it is about to choose,
  falling back to a lighter configured model of the same agent instead of picking an exhausted one (#60).
- An antigravity run that ends with `RESOURCE_EXHAUSTED` / "quota reached ... Resets in 5h3m" is recorded as an exhausted
  bucket for the model it used (kept until its reset unless the API shows that model with quota left). The run is
  `status=fail` and its `.out.md` says `quota exhausted: <model> until <time>`, so the conductor re-picks (#60).

## [0.6.0] — 2026-11-05
### Added
- `orq conductor [account|-] [model] [-r <session>]` opens the conductor (Claude) in any terminal and OS: finds the workspace
  (`.orquestra-conductor.md` in the folder, else `CONDUCTOR_WS`), maps `sonnet|opus|haiku`, resolves the account from the
  `claude-accounts` file, registers the conductor (inside herdr) and runs `claude` with the instructions (`--append-system-prompt-file`). `herdr-conductor` is now a thin
  wrapper around it (still herdr-only, and renames the pane).

### Changed
- The `/issue` skill and the conductor templates use the `orq <cmd>` names (`orq agent`, `orq verify`, `orq claim`,
  `orq deps`, `orq baseline`, `orq pick`, `orq conductor`) and no longer assume herdr; the completion signal is
  `[HERDR-AGENT DONE]` in herdr and `orq wait` elsewhere. The permission allowlist gains the `orq ...` patterns and keeps
  the `herdr-*` ones for old installs.
- README: daily use is `orq conductor` in any terminal.
- `orq board` folds finished and dead agents older than `ui.board_hide_hours` (default 6) into a count line; `--json`
  keeps all of them. `orq gc` also prunes the stale agent state that no longer shows on the board.
- `orq board` shows an agent with no CPU for `ui.board_idle_min` minutes (default 30) as `idle`.

### Fixed
- Notices no longer go to a closed pane after a handoff: `orq handoff` redirects are followed only to a pane herdr still
  knows; when the target is gone the notice stays on the last live pane and the stale redirect is deleted (herdr
  unreachable: the redirect is followed as before). `orq claim --register` and a new handoff also clear redirects that
  would point away from, or loop back to, a live conductor.
- Finished `-T` agents no longer pile up: with the screen open and no follow-up for `[machine] tui_idle_close_min`
  minutes (default 30, `0` = never) after the turn ended, the agent is stopped, cleaned up and its herdr tab closed. A
  later `orq agent -T -R` reopens the session (`tui_resume`). On herdr, a turn typed straight into the screen counts as
  activity; on tmux only the end of a turn does. Not applied with `close_tab_after = 0`. A `-T` agent killed from outside
  now closes its herdr tab too (a tmux window closes with its runner).
- New `examples/agy-impl.json`: a default implementer allowlist for agy (git, npm, node, ... plus globs such as
  `command(/usr/bin/*)` and `command(*/node_modules/.bin/*)`); point the `write` template at it with `--settings <file>`
  (see `examples/irythill/config.toml`). The denied-commands answer below points to it.
- Antigravity (`agy`) runs where some commands were denied by its allowlist are no longer lost: the answer gets a
  "Denied commands" section (each command and message, plus how to retry or extend `~/.config/orq/agy-impl.json`), and
  a write run whose worktree has changes is `ok` with the diff stat attached (the session id is kept, so `-R` works).
  Without changes (or read only) it stays `fail`, now with the denied list as the answer instead of an empty one.
- A run that ends with rc=128+signal (SIGKILL, memory cap, ...) is `killed`, never `ok`, even with an `ok_exit` list or a
  leftover answer; the `.done` file and the notice to the conductor say `status=killed`.
- The Antigravity `.out.md` of a denied run names the denied command (taken from the last `CommandLine`).
- `orq agent` refuses a prefix that still has a live run (exit 3, nothing started); a dead run's stale results are
  cleared. A `-T -R` follow-up typed into that run's own open screen still works.
- `orq gc` path containment resolves a missing prefix through its real ancestor and works on macOS (`/var` →
  `/private/var`) and Windows, where it ignores case.

## [0.5.0] — 2026-11-04
### Fixed
- Notices to the conductor (verify/agent done, CI red) are now delivered by `orq` itself, detached, and no longer fail
  silently: the old `herdr-notify` depended on `jq`, gave up after 3 tries in a minute and printed its errors to a tab or
  `/dev/null`. Each notice is logged (`<state>/notices.jsonl`; `orq notice` shows it) with every attempt and its outcome,
  retried with backoff (5s, 15s, 45s, 2min, 5min), waits out a dialog and sends to a working conductor (its input queues
  the line).
- `orq agent` without `-a` (or `$AGENT`) now refuses instead of starting Codex: an `orq pick` with no candidate gave an empty
  `$(orq pick ...)`, which started Codex past blocks and quota.
- `orq board` shows each run's own model when a prefix is reused (the state file now records it), and `?` instead of a
  growing duration for a run whose runner is gone.

### Added
- Failures are loud, independent of the conductor reading its pane: a herdr notification with sound, a `✗` title on the
  conductor's pane (display only, clears after 30 min or when acknowledged) and a desktop notification (`notify-send`;
  `[ui] desktop_notify = true|false`, default true, Linux only). Successes stay quiet (plain herdr notification).
- `orq board`: a red line on top lists failures from the last hour whose notice was not delivered, or that the
  conductor has not acted on. Acknowledged = the conductor ran `orq wait` (which printed the result), `orq verify` or
  `orq agent` for that issue after the notice.
- `orq block <name> --quota`: blocks until the quota window resets, read from the collector, instead of a fixed period.
- Watchdog layer 2: `orq rounds <ID> --diagnose` (only on warn/stop) has a cheap, read only agent of another vendor than the
  implementer diagnose why the rounds don't converge, from the metrics, `fix-<n>.md` and the review outputs, and recommend
  continue / split / change-implementer / ask-user. Saved to `.orquestra/<ID>/diagnosis-<rounds>.md`; `orq rounds` shows its
  `RECOMMENDATION` line. New pick role `watchdog` (own pool or `[roles.watchdog]`, else the `opinion` pool, else `review`).
- `orq agent -R -F` past `policy.max_rounds` now refuses (exit 4) without a diagnosis for the current round count that is newer
  than the latest fix/review file. `-F -F` bypasses the check (the user's own call).

## [0.4.0] — 2026-11-04
### Fixed
- `orq rounds` now counts review findings written with a leading bold severity (`**Bloqueante**`, `**Sugestão — `file:7–8`:**`, PT/EN),
  not only `[blocker]` tags, and reads markdown-link paths, en-dash line ranges and per-round `.worktrees/<dir>/` prefixes so
  the same file matches across rounds.
- `orq quota` no longer reports the antigravity login as expired after an hour idle: the access token only lives 1h
  and agy renews it on its next run, so with a refresh token in the keyring the note is "token idle (agy refreshes on
  next run)" and `orq pick` keeps the account. "login expired" stays for a missing refresh token or an API 401.

### Changed
- `install.sh --uninstall` now also runs `systemctl --user disable --now` on the orq timers.
- `orq pick` limits: 95% of the week (`policy.quota_week`) and, on the 5h window, 90/85/80% for simple/medium/heavy
  tasks (`policy.quota_5h`), for every agent. An agent is never picked to review or give an opinion on its own code,
  whenever another declared agent exists for the role. `policy.quota_limit` caps the 5h pick limit and sets the `!` in `orq quota --line`.
  **Migration:** `quota_limit` used to also cap the weekly window; it now only caps 5h, so configs that lowered it to
  keep accounts away from the weekly limit should set `policy.quota_week` explicitly instead.
- `orq quota`'s human reset times ("resets 14:30") moved from right after each window to the end of the line, so
  `<name> 5h=NN% week=NN%` always stays intact and easy to grep.

### Added
- `orq rounds <ID> [-w <workspace>] [--json]`: watchdog metrics per issue with no LLM, from the files in
  `.orquestra/<ID>/` (`fix-<n>.md`, `review-*.out.md`): fix rounds vs `policy.max_rounds`, time total and per round,
  reviewer findings that come back across rounds (same file + word overlap) and an alert level (ok / warn / stop).
  `orq board` shows a marker such as `r2/2 ⚠` next to each conductor's issues.
- Scope guideline in the `/issue` skill and the workspace `CLAUDE.md` template: split big issues into sub-issues or
  sequential batches (one PR each) before dispatching, and stop and split when reviews hit `policy.max_rounds`.
- Pacing in `orq pick`: an account whose usage, at the pace so far in a window (used ÷ elapsed share, needs the reset
  time and 10% of the window elapsed), projects past that window's pick limit at the reset loses `policy.pacing_penalty`
  (default 0.3, 0 = off) of score. Soft: the hard limits are unchanged; fixed roles are not scored.
- `headroom = N` in an `[agents.<name>]` section: children are dropped from that agent's accounts once usage reaches
  the limits minus N points (5h and week), leaving that share for conductors; account choice respects it.
- `orq pick` skips an agent whose quota reading says the login expired, with the fix command as the reason
  (e.g. ``antigravity: login expired: run `agy models` ``); `orq quota` keeps showing it.
- `orq ci [-w <workspace>]... [--json]`: CI/CD signal per claimed issue with a PR — queued, running, passed, failed
  or none, from `gh pr view`'s checks on the branch the issue's worktree carries, collected live (it's the user
  asking right now). Cached in the state dir like quota; `orq board` reads that same cache for a new CI column
  and never blocks on the network. A run turning passed or failed pops a herdr notification, and a failure also
  sends the owning conductor one line (`notify()`, or a stdout line for a non-herdr conductor), once per head
  commit — a later commit that is still red notifies again.
- Quota lines carry each window's reset time (epoch seconds) when the source gives one (Claude, Codex, Antigravity,
  MiniMax, Copilot's monthly reset), as `reset5h=`/`resetweek=` fields that old cached lines (and anything without
  them) still parse fine. `orq quota` shows them as a human time ("resets 14:30", or weekday + time past today).
  `orq pick --explain` and its exit-3 message say when an agent out on quota comes back.
- `orq handoff`: when a conductor's Claude account reaches `conductor.handoff_at` (default 85% of the 5h window, or the weekly limit), opens a new
  herdr space on an account with room, moves its issues and children's notices there and tells the new
  conductor to resume. Targets spread across accounts instead of always filling the lowest-usage one: it counts alive
  conductors per account first and picks the one with the fewest (then the lowest usage), skipping any at
  `conductor.max_per_account` (default 2). A move is skipped when every window over `conductor.handoff_at` (5h and/or
  weekly) resets within `conductor.reset_grace_min` (default 15) minutes, unless the quota reading is unreadable. It saves a
  trimmed recent transcript from the old pane as untrusted context
  for the new conductor; a failed read does not stop the move. It registers idle conductors
  doing PR/merge work. `setup/orq-handoff.timer` runs it every 5 minutes.
- `orq agent -R` enforces `policy.max_rounds`: it counts follow-ups per session (whatever the prefix is called) and
  refuses the next with exit 4; `-F` overrides with the user's OK. `/issue` fixes the `fix-<n>` / `review-<repo>-<n>`
  names and limits visual validation (screenshots) to one cheap attempt.
- `orq claim` records each conductor's name (its herdr workspace label, else `ORQ_CONDUCTOR_ID`), shows it in `-l`,
  and `orq claim --from <name> [-f]` finds (and takes over) a conductor's issues by any part of that name. `/issue`
  uses it when the user names another conductor, and resumes from `.orquestra/<ID>/` instead of starting over.
  `orq claim -l`/`--from` and `orq board` now show the herdr workspace's **current** label while the pane is alive
  (it may have been renamed since the claim), falling back to the name stored at claim time.
- `orq pick review|opinion` exits 2 with a clear message when more than one agent is eligible for the role (declared, not excluded or blocked, with a model for it; before quota checks) and
  neither `--impl-agent` nor `--impl-vendor` is given (`--no-record`/`--explain` do not change this): nothing to
  filter the reviewer down by otherwise.
- `agents.<name>.no_review`: a regex that, when it matches the first line of a review tool's answer (or all of a short one) (e.g. Revtool's "Nada para
  revisar"), ends that `orq agent` run `status=fail` instead of `ok` — "nothing was reviewed" is not a verdict, so
  `orq pick`'s fallback and the conductor treat it as not run.
- `install.sh`: `orq-gc.service`/`orq-handoff.service` now find `node` under mise and nvm. Their `PATH` always
  includes mise's shims directory (stable across versions); when `node` instead resolves to a version-specific
  directory (mise's `activate` PATH, or nvm, which has no static shims dir) the installer writes a drop-in with
  that real directory. A plain, system-package install is untouched either way.

### Fixed
- Multi-account `orq pick`: prefers an account whose pace does not project past the limit before falling back to lowest
  usage (when `policy.pacing_penalty > 0`), and keeps expired accounts with their fix command in the quota rejection note
  when the remaining accounts are over the limit.
- Switching an agent's account no longer shows the old one's quota or block. The "last reading" quota cache is now
  tied to the login (Antigravity), and `orq block` records which login it was made for: when the agent or Claude
  account is logged into another one, the block is dropped on its own (claude, codex, antigravity, copilot, opencode).

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
