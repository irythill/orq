**English** · [Português](pt-BR/case-study.md)

# Case study: one developer, five coding agents, a 14 GB PC

*By [irythill](https://github.com/irythill). Numbers from the author's own `.orquestra/` history (September–October
2026); company, repositories and issues anonymized.*

## Context

A health-tech company, a small team, and an ecosystem of **7 repositories**: a NestJS API, an admin panel, a public
sign-up website, mobile and CI/infrastructure pieces. Work is tracked in a **self-hosted Plane**. The author pays for
monthly subscriptions to **Claude Code, Codex, OpenCode (MiniMax), Antigravity and GitHub Copilot**, and wanted to
work on **3–5 issues at the same time** on a **14 GB Linux PC** — without babysitting each agent and without
burning the most expensive quota on routine work.

The idea from the start: the expensive model (Claude Opus) only **orchestrates** — reads the issue, plans, dispatches,
weighs results — while cheaper agents implement and review.

## Timeline

| When | What |
|---|---|
| late Sep | Tried several orchestrators (Orca, Emdash, claude-squad, bb, agent-orchestrator, Orchestry); settled on Agent Deck + tmux |
| Sep 30 | First version of the `/issue` playbook: conductor + headless children + cross-vendor review |
| Oct 5–6 | Moved to [herdr](https://herdr.dev): one tab per child, completion signal typed into the conductor's pane |
| Oct 6–8 | Memory caps per agent, test queue, on-demand base comparison, live board, several conductors per workspace |
| Oct 9 | Data-driven agent choice (`orq-pick`), English and public release |

## Results (last 30 days, Oct 2026, 644 agent runs)

Medians per run. "New tokens" excludes cache reads — what actually weighs on a subscription's quota.

| Role | Agent / model | Runs | Delivered | Approved on first review | Minutes | New tokens |
|---|---|---|---|---|---|---|
| implement | Codex gpt-6-sol | 23 | 96% | **83%** | **1.9** | **37k** |
| implement | Codex gpt-6.1-sol | 27 | 100% | 70% | 3.6 | 61k |
| implement | Claude Sonnet | 20 | 90% | 53% | 4 | 59k |
| implement | Codex gpt-6-luna | 11 | 100% | 50% | 1.6 | 68k |
| implement | OpenCode MiniMax | 1 | 100% | 0% | 1.0 | 313k |
| fix | Codex gpt-6-luna | 95 | 99% | — | 0.9 | 138k |
| fix | Claude Sonnet | 72 | 94% | — | 3 | 58k |
| fix | Claude default model | 5 | 40% | — | 2 | 26k |
| review | Claude Sonnet | 98 | 98% | — | 1.6 | 49k |
| review | OpenCode MiniMax | 73 | 89% | — | 3 | 67k |
| review | Codex gpt-6-luna | 35 | 100% | — | 0.5 | 38k |
| review | Codex gpt-6-sol | 25 | 100% | — | 0.5 | 30k |
| review | Antigravity gemini-3.8-flash-high | 10 | 50% | — | 5.8 | 178k |

What the numbers said:
- **Codex with gpt-6-sol is still the workhorse** for implementing: best first-review approval (83%) at the lowest
  token cost of any real contender.
- **Claude Sonnet now carries both fix (72 runs) and review (98 runs)** — the single heaviest user of its own quota
  across roles.
- **Claude's default model is a liability on fix work**: only 40% landed clean — but on 5 runs, too small a sample to
  conclude much.
- **Antigravity's gemini-3.8-flash-high failed half its reviews** (50%, 10 runs) while costing the most tokens
  (178k) and the most time (5.8 min) of any reviewer — costliest and least reliable. The Flash model has since been
  dropped from the config.
- **OpenCode MiniMax's one implementation attempt still failed** (0% approved, 313k tokens); kept to reviewing only.
- Every fix round avoided saves a whole implement → test → review cycle. That is the real cost driver, more than
  the price per token.

## What broke, and what we learned

**1. The machine, not the models, was the first bottleneck.** A single `jest` with 15 workers took ~10 GB, and
`systemd-oomd` killed the whole terminal server with every agent in it. Fixes: each agent in its own cgroup
(`systemd-run --scope -p MemoryMax=4G`, so only the offender dies), agents never run the test suite (the conductor runs
the related tests in a queue, one suite at a time, 6 GB), worktrees link `node_modules` instead of installing ~1 GB
each, and children start without MCP servers (~150–200 MB each).

**2. A "baseline" of failing tests turned into a traffic jam.** To tell new failures from old ones, every issue
compared against the full suite's failures on the base branch. With several conductors merging all day, the base moved
every ~40 minutes, every conductor re-ran the full suite, sometimes twice, and quick test runs waited behind them for
an hour. Fix: compare **on demand** — only when a test fails, run *those same test files* on a fresh base branch.
Seconds instead of a full suite, and never stale.

**3. LLMs follow the newest rule, not the best one.** When the playbook said "use Antigravity to spare Claude's
quota", the conductors started sending *every* review to Antigravity. Prose rules for choosing agents don't hold up.
Fix: `orq-pick`, a plain script that scores candidates from the history (delivery, tokens, speed), filters by quota and
role, and rotates. The skill now forbids choosing by hand. Replaying the last 19 issues, Claude would have reviewed 3
instead of 10.

**4. One silent bug can masquerade as three agent problems.** OpenCode, Antigravity and Codex all "occasionally"
returned empty answers on some diffs. The cause was none of them: `systemd-run` (used for the memory cap) **expands
`${...}` in its arguments**, so JavaScript template strings and GitHub Actions expressions vanished from the prompt.
Claude was immune only because it reads the prompt from stdin. One flag (`--expand-environment=no`) fixed all of them —
after a wrong diagnosis blamed one of the agents first. Lesson: when several tools fail the same way, look at what
they share.

**5. Headless agents and permission systems don't mix.** Antigravity denies, in headless mode, any shell command not
in its allowlist — and a single denial ends the run with no answer. OpenCode's read-only "plan" agent can't even run
`git diff`. Fixes: reviewers get the diff attached and read files with their file tools; read-only reviews run on a
throwaway worktree where the agent may run commands but can't touch the real branch.

**6. A failure without a verdict is not a rejection.** Early on, an empty review counted as "approved" (a single
newline passed the check), and later a failed reviewer was excluded for the rest of the issue instead of just for that
retry. Both are now explicit rules.

**7. Editing a running script is a trap.** Bash reads scripts as it executes them; editing one in place while queued
processes are blocked inside it makes them resume at a shifted offset. It happened twice. Now changes are developed in
a separate worktree and land by replacing files whole.

**8. A subscription's time window runs out mid-work too.** An account's 5-hour window emptied while a conductor was
still orchestrating. Fix: automatic conductor handoff to another account; the first real handoff moved two conductors
without losing state.

**9. Pick limits need to vary by window and task, not be one number.** `orq-pick` now caps spend at 95% of the weekly
budget, and at 90/85/80% of the 5-hour window depending on the task's weight — heavier tasks get a tighter ceiling,
because a heavy task needs more room left to finish.

**10. Knowing when quota resets matters as much as tracking it.** Reset times let a conductor choose between waiting
out a window and switching agents, and let handoff skip a move when a reset is minutes away. Separately, a CI signal
per issue lets a conductor tell "still running" from "actually failed" without guessing from quota alone.

**11. A fix can be a bug of its own.** One agent "fixed" a low-severity finding by deleting the feature it was
attached to; another added a readiness check that would have hung every real handoff. Neither was caught by the
pipeline — only by a human or conductor reading the fix's actual diff. Lesson: a green fix result is not the same as
a good one; something has to read it.

**12. "Nothing to review" passed as a clean review.** A reviewer that returned no findings looked identical to a
reviewer that ran and found nothing. orq has no gate for this; in that session, the check was done by hand in the
script. It's a rule to follow, not something orq enforces.

**13. A fix loop can wander out of scope faster than it hits its round limit.** One loop meant to land a local fix
grew into a broader discussion the fix was never meant to settle. Round limits exist to stop runaway loops, but they
didn't catch this — re-checking whether the scope is still the original one matters more than counting rounds.

## What the day looks like now

Open herdr, open one conductor per issue (`herdr-conductor`), send `/issue <ID>`, and keep `herdr-board` in a tab. Each
finished step pops up a native notification. The conductor comes back only for decisions: an ambiguous acceptance
criterion, a third fix round, a PR to open. Every choice of agent is visible (`orq-pick --explain`) and every outcome is
measured (`orq-stats`), so the configuration improves from data instead of impressions.

## Next

- Per-repo **lessons**: when a fix round happens, a cheap model extracts what went wrong into a short, human-approved
  list that the next implementer in that repo reads — measured by first-review approval before and after.
- A guided `/orq-setup`, an `install.sh`, and team-shared workspace config (`.orq/workspace.toml`).
