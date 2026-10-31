---
name: issue
description: Runs a Plane issue end to end by orchestrating coding agents in herdr or any terminal (herdr-agent / orq agent + orq wait) — implementer and cross-vendor reviewer picked by orq pick, tests by herdr-verify / orq verify, comment and status in Plane. Use when the user says "/issue <ID>", "take issue X", "run ABC-123", or asks to check/create issues in the conductor's ecosystem.
---

# /issue <ID> — conductor playbook (herdr or any terminal)

You are the **orchestrator**: you plan, dispatch, follow up and report. **Do not implement anything yourself** (it
burns the conductor's model). Talk to the user in the user's language.

**Ecosystem configuration:** the **workspace** `CLAUDE.md` (the folder named in your conductor instructions) defines
the repositories and their groups (= herdr workspace, `-g`), **each repo's base branch**, verification commands,
Plane projects (identifier → project_id), default assignee, labels/modules and MCP limitations. Read it before you
start. Below, `$WS` = workspace.
**Inside herdr** (`HERDR_ENV=1`): children open in herdr tabs and their notices reach your pane — the flow below.
**Outside herdr** (any terminal, tmux, any OS): the same flow with these swaps —
- `herdr-agent ...` → `orq agent ...` (same flags; it is the same program). Children run in tmux windows inside tmux,
  else in the background (their screen goes to a log; the answer is still `<prefix>.out.md`). `-T` needs tmux.
- `herdr-claim` → `orq claim` (set `ORQ_CONDUCTOR_ID` to a fixed name per conductor), `herdr-deps` → `orq deps`.
- **Completion signal:** no line arrives in your pane. After dispatching, run `orq wait <prefix>` **as a background
  task** (Claude Code: Bash with `run_in_background`); its exit wakes you and its output is the line
  `[ORQ AGENT DONE] <title> status=ok|fail ... answer: <file>` — treat it exactly like `[HERDR-AGENT DONE]`. Several
  children in parallel: `orq wait --any <prefix1> <prefix2>` (one wake-up per finish; wait again for the rest).
  No background tasks in your harness → run `orq wait` in the foreground; that is the one allowed blocking wait.
- `herdr-verify` → `orq verify`, `herdr-baseline` → `orq baseline` (same flags). They run in a tmux window or in
  the background like children, and you wait for them the same way: `orq wait $O/verify-<repo>`.
- Peeking at a child: `<prefix>.log` (not `herdr pane read`).
Issue artifacts (prompts, notes) live in `$WS/.orquestra/<ID>/`.

## 1. Read the issue
- **First, claim it:** `herdr-claim -w $WS <ID>`. Exit 1 = another conductor owns it: **stop** and tell the user
  (don't read it, don't dispatch anything). Taking it over (e.g. switching accounts) only with the user's OK:
  `herdr-claim -w $WS -f <ID>`. Several conductors may share a workspace; `herdr-claim -w $WS -l` lists who has what,
  with each conductor's name (its herdr workspace label, e.g. "emp: orq-cms-dsgn"; outside herdr, `ORQ_CONDUCTOR_ID`).
- **The user names another conductor** ("take over orq-cms-dsgn's work"): never guess a pane id. Run
  `orq claim -w $WS --from "<what they said>"` (any part of the name works). It lists that conductor's issues; exit 3 =
  the name matches more than one conductor (show the list, ask which); exit 1 = none. With the user's OK,
  `orq claim -w $WS --from "<name>" -f` takes them all. **Resuming** an issue someone else started: don't start over.
  Read `$O/` first — `impl-<repo>.md`/`.out.md` (prompt, answer, `## Decisions`), `.pick` files, the last
  `fix-<n>.md` and `review-<repo>.out.md`, `verify-<repo>.txt` — and the Plane comments, then go on from the step the
  files show (a `.pane`/`.id` without `.done` = a child still running: `orq wait` for it instead of dispatching again).
- `mcp__plane__workitem` `retrieve_by_identifier` with `workitem_identifier: "<ID>"`; then `workitem_comment list`.
- Extract: goal, **acceptance criteria**, affected repos, links. No acceptance criteria → write a short proposal and
  **ask the user** before dispatching.
- Issue missing assignee, priority, labels or module → **fill them in** following the workspace `CLAUDE.md` "Issue
  standard". The same standard applies to any new issue you create.
- Move it to **In Progress** (`workitem update` with the state_id from `state list`).

## 2. Classify
One task per repo. Level:
- **simple** — CRUD, UI/text tweak, localized bug, 1–3 files.
- **medium** — business rule, API↔front integration, several files.
- **heavy** — architecture, data migration, hard/concurrency bug, security.

## 3. Pick agent and model: always `orq pick`, never by hand
`orq pick` decides agent, model, effort and account (user config + delivery and token history + current quota +
rotation). **Do not choose by preference, by a rule you read elsewhere, or by what worked last time**: run it before
EVERY dispatch (implementation, review, second opinion) and use its output verbatim.
```bash
orq pick impl --level simple|medium|heavy                          # → e.g. -a codex -m gpt-6-sol -e low
orq pick review --level <level> --impl-agent <agent that implemented>   # → another vendor, e.g. -a opencode -m ...
orq pick opinion --impl-agent <agent that implemented>             # second opinion (e.g. Copilot), see step 5
```
More than one agent declared for `review`/`opinion` and neither `--impl-agent` nor `--impl-vendor` given → exit 2:
always pass one of them (`--no-record`/`--explain` do not change this).
The output goes straight into `herdr-agent` (`herdr-agent $(orq pick ...) -g ... -t ... -d ... -o ... -- prompt.md`).
- Exit 3 = no candidate (quota exhausted, no agent with that role): **stop and ask the user**.
- Implementer failed review twice (step 6) → pick again without it: `orq pick impl --level <level> --exclude-agent <agent>`.
- `--exclude-agent` never "sticks": every `orq pick` call decides again, with only that dispatch's exclusions.
- The conductor's own model (e.g. Opus) as implementer: only with the user's OK, never through `orq pick`.
- Want to understand a choice? `orq pick ... --explain --no-record` (score of each candidate; not counted in rotation).

**Every child runs through `herdr-agent`** (agent from `orq pick`): headless (`claude -p` / `codex exec` /
`opencode run` / `agy -p` / `copilot -p`) in a herdr tab (workspace = group `-g`, tab = title) with live output.
When it finishes it writes `<prefix>.done` and sends ONE line `[HERDR-AGENT DONE] <title> status=ok|fail ...` to your
pane; no MCP, and a **4 GB memory cap per agent** (own cgroup: if it blows up, only it dies). NEVER `herdr agent start`
for children (no memory cap, no answer file). **Screen mode (`-T`, or `HERDR_AGENT_TUI=1`; herdr or tmux):** the tab
shows the agent's own TUI instead of the log; same cap, same files, same signal (end-of-turn hook). The screen stays
open after the turn (it holds memory until the tab closes); `-R` with the tab open types the follow-up into it. Use it
when the user wants to watch. The repo must already be trusted in Codex/Claude (otherwise the TUI stops at the "trust this
folder?" dialog — tell the user, don't approve it for them).

## 4. Dispatch the implementer
Write the prompt to `$WS/.orquestra/<ID>/impl-<repo>.md` (short: goal, acceptance criteria, likely files, the repo's
verification commands, "base: origin/<BASE>; don't rebase/merge other branches; local commits, no push; commit
messages following <path of the repo's commit conventions, see step 7>").
Always include:
- **Repo checklist:** copy the repo's "Checklist" column from the workspace `CLAUDE.md`.
- **Decisions:** "end your final answer with a `## Decisions` section, at most 10 lines: what you chose and what you
  ruled out, trade-offs, and what you left out on purpose and why". The reviewer reads it (step 5), so a deliberate
  choice doesn't come back as a blocker.
- **No tests in the child** (memory rule): "don't run jest/vitest; I run the related tests afterwards".
- **Fresh branch:** "before your final answer: `git fetch origin <BASE> && git rebase origin/<BASE>`; on conflict stop
  and report; after the rebase repeat lint/tsc". Codex has no network: for it, you fetch and check in step 5.

**Base = the repo's base branch from the workspace `CLAUDE.md`, always from the updated remote (`origin/<BASE>`).**
Worktree with `git worktree add` (not `herdr worktree create`: that opens a separate herdr workspace per worktree, and
children are grouped by the repo's `-g`).
```bash
R=$WS/<repo>; BASE=<repo base>; B=<prefix>plane-<lowercase-id>; WT=$WS/.worktrees/<repo>-plane-<lowercase-id>
O=$WS/.orquestra/<ID>
git -C $R fetch origin $BASE
git -C $R worktree add -b $B $WT origin/$BASE         # already exists? reuse $WT, don't recreate it
git -C $WT log -1 --format='%h %s'                    # check HEAD == origin/$BASE before launching
```
**Dependencies — NEVER install inside the worktree** (each `node_modules` is ~1 GB and tens of thousands of files;
on a modest disk that saturates I/O and memory and freezes the machine). The worktree uses a **link** to the main
repo's `node_modules`:
```bash
herdr-deps -r $R -b $BASE -w $WT     # link; stale deps → fast-forward + ONE install in $R (per-repo lock across conductors)
```
Exit 3 = stale deps and `$R` dirty or not on `$BASE` → **ask the user**. If another conductor is installing in the
same repo, the command waits its turn (never install by hand).
In the child's prompt: "node_modules is shared (link): don't run install/add; if you need a new dependency, stop and
tell me".
**Dispatch** (no MCP; memory cap; writes in automatic mode — that is why implementation only happens in a worktree):
```bash
orq pick impl --level <level> > $O/impl-<repo>.pick    # the fix rounds reuse it (step 6)
herdr-agent $(cat $O/impl-<repo>.pick) -g <group> -t "<ID> impl <repo>" -d $WT -o $O/impl-<repo> -- $O/impl-<repo>.md
```
- The Claude account (`-c`) already comes from `orq pick` (the least used one under the limit).
- Full final answer in `$O/impl-<repo>.out.md`; log in `.log`; the agent's session id in `.id`.
- Codex's sandbox has no network: `git fetch` is yours, beforehand (above). Push/PR: yours (step 7).
- `herdr-agent` returns immediately (no need to background it); the child's pane is in `<prefix>.pane`
  (`herdr pane read $(cat <prefix>.pane) --source recent` to peek).
- **No baseline in the issue flow:** don't run `herdr-baseline` before dispatching (the base moves with every merge and
  the full suite blocks every conductor's test queue). `herdr-verify` checks the base on demand (step 4b).
- **Children start WITHOUT MCP** (Plane is yours; each MCP costs ~150–200 MB per session and `systemd-oomd` kills the
  whole herdr server when memory runs out) — `herdr-agent` takes care of it.
- Every child prompt ends with: "Don't try to talk to the conductor or use herdr; finish with your complete final
  answer (that is what I read)."
- **Verification in the child: lint and tsc only, one command at a time** (the cap is 4 GB per agent and jest/vitest
  blow it; tests are yours, step 4b): use the Verification column of the workspace `CLAUDE.md` and put in the prompt
  "verify sequentially, never in parallel or watch mode: (1) lint only the changed files (`git diff --name-only
  origin/<BASE>...HEAD`); (2) `NODE_OPTIONS=--max-old-space-size=2048 tsc --noEmit` for the project. Don't run tests".
  Full suite only in CI (or a manual `herdr-baseline` if the user asks).
- An issue that changes an API contract: **API first**; consumers afterwards, with the new contract in the prompt.
- **Never block waiting** (`herdr agent wait`, `pane wait-output`, `sleep`, `timeout`): completion arrives as a
  `[HERDR-AGENT DONE]` line in your pane. Dispatch, report in one line and end your turn. "Done yet?" = `<prefix>.done`
  exists (never `pgrep`).
- Investigation only (no code): "READ ONLY" prompt, in the repo itself, no worktree. `herdr-agent -r` (Claude:
  `--permission-mode plan`; the others: throwaway worktree, no editing).

## 4b. Tests (yours, not the child's)
Child with `status=ok` → run the tests related to the diff, in their own tab, one at a time on the machine (queue):
`herdr-verify -w $WS -r <repo> -d $WT -b <BASE> -o $O/verify-<repo> -g <group>` → `$O/verify-<repo>.txt` with
**new failures** and pre-existing ones: if any test fails, it runs the same test files on an updated
`origin/<BASE>` (whatever fails there is pre-existing). You get `[HERDR-AGENT DONE] verify ... new=N`.
`new>0` → fix round with the list (step 6), no review. `new=0` → review.
**Pre-existing failures get fixed too.** Any failure — tests listed as "already failing on origin/<BASE>", or a CI job
(lint, biome, typecheck, shard, regression) failing on the PR or on the base — goes into a fix round on the issue's
branch (separate `fix:`/`test:` commit naming the issue). Never close, move to In Review or call a PR done while
something is red, new or old, and never widen a baseline or allowlist to silence it. Only if the fix is large or
outside the issue's domain: ask the user first (then it ships as its own PR, not as a note).
**Mandatory order every round (impl and each fix): child `ok` → verify → review.** Never dispatch the review (or an
"early" fix) while this round's verify is pending, even if it is queued behind another verify: wait for
`[HERDR-AGENT DONE] ... verify ...` and end your turn until then.

## 5. Cross review (always another vendor)
```bash
orq pick review --level <level> --impl-agent <who implemented> > $O/review-<repo>.pick   # round 2+ reuses it
herdr-agent $(cat $O/review-<repo>.pick) -b $BASE \
  -g <group> -t "<ID> review <repo>" -d $WT -o $O/review-<repo> -r -i $O/impl-<repo>.md -i $O/impl-<repo>.out.md \
  -i $O/verify-<repo>.txt \
  -- $O/review-<repo>.md
```
`-b $BASE` attaches the diff (`origin/$BASE...HEAD`): always use it. The review prompt works for any reviewer and says
"the diff is attached; for context, open files with your file-reading tool; don't run lint, tsc or tests (the results
are in the attached verify)". If the reviewer ends with `status=fail` and no verdict (empty answer, or a
`jetski: ... permission` line), that is not a rejection: run `orq pick review ... --exclude-agent <it>` and redo it.
`--exclude-agent` applies **only to redoing that review** (save the new pick to `review-<repo>.pick`); the next
round reuses whoever gave the verdict. An agent that failed twice in a row with no verdict →
`orq block <agent> --days 1` and tell the user.
**Review tools** (an agent whose `run` has no `{prompt}`/`{prompt_text}`/stdin, e.g. a CodeRabbit-like CLI with
`ok_exit`/`filter` in the config): same command; it ignores the prompt and the attachments and reviews the branch
against `{base}` itself. Read its answer like any other: `status=ok` with `rc≠0` is a verdict with findings, not a
failure. Its high-severity items are the blockers, still under the step 6 rule (`file:line` + concrete failure).
If the tool's answer says nothing was reviewed (e.g. Corvus's "Nada para revisar"), `agents.<name>.no_review` (a
regex) makes `orq agent` end that run `status=fail`: `orq pick`'s fallback and the conductor treat it as not run,
same as an empty answer.
**Second opinion** (`orq pick opinion`, read only, same attachments): only on **heavy** issues or when reviewer and
implementer disagree about a blocker. It never becomes a round by itself: you weigh both answers and decide.
**Before dispatching:** `git -C $R fetch origin $BASE; git -C $WT merge-base --is-ancestor origin/$BASE HEAD` — if it
fails, don't review yet: send a fix "rebase on origin/<BASE> and repeat the checks".
Always **in the same worktree `$WT`**, with the prompt in `$WS/.orquestra/<ID>/review-<repo>.md` = acceptance
criteria + "review only the attached diff; answer APPROVED or a numbered list of problems, each tagged `[blocker]` or
`[suggestion]`. A blocker has `file:line` and a concrete failure (input or state → wrong result, crash, data loss,
security hole, broken acceptance criterion); style, naming, refactors and 'could be cleaner' are suggestions".
The implementer's answer (`impl-<repo>.out.md`) is attached for its `## Decisions` section only: the diff is the source
of truth. The prompt says "a choice listed under Decisions is not a blocker unless it breaks an acceptance criterion or
is wrong; then say why".
Fixed review checklist, besides the criteria: (a) identifiers/keys consistent across the touched modules (same concept
= same field); (b) dependency downgrade, override or pin → check the CVE/advisory behind the current version; (c) the
repo checklist.

## 6. Loop
**Only `[blocker]` items open a round.** An item tagged blocker without `file:line` and a concrete failure, or that
only restates a `## Decisions` choice, counts as a suggestion; when you downgrade one, say why in the Plane comment.
No blockers left → APPROVED, even with suggestions.
Blocking problems → write the list (blockers only) to `$O/fix-<n>.md` (always this name; reviews `$O/review-<repo>-<n>`, never `fix<n>-<repo>` or other variants — a later conductor counts rounds by these files) and continue the implementer's session (any agent):
`herdr-agent $(orq pick fix --same $O/impl-<repo>.pick) -g <group> -t "<ID> fix<n> <repo>" -d $WT -o $O/impl-<repo> -R $(cat $O/impl-<repo>.id) -- $O/fix-<n>.md`.
A fix is a continuation: same agent, model, account and session, effort one level up (`--same` reads the implementer's
pick; never a new `orq pick`, never `-a` alone — without `-m` the session resumes on the CLI's default model, which
loses the prompt cache and hands the work to a weaker model). `fix-<n>.md` = the numbered blockers + these rules: "fix only
these items, with the smallest diff that does it; don't refactor, rename or reformat code that isn't in the list; for
each blocker add or adjust a test that fails without the fix, when the code is testable (say so when it isn't); if an
item is wrong or conflicts with a criterion, don't fix it: say why"; and it ends with "update the `## Decisions`
section of your final answer for the whole branch". **Before dispatching the fix:** `git -C $WT rev-parse HEAD > $O/round-<n>.sha`.
Then a new `herdr-verify` (4b) and the **round review** (step 5 with these changes):
- Same reviewer as the round before: `$(cat $O/review-<repo>.pick)`. Only if it is over quota, blocked or fails with
  no verdict → a new `orq pick review` (saved to the same file).
- Extra attachments: `git -C $WT diff $(cat $O/round-<n>.sha)..HEAD > $O/fix-<n>.diff` → `-i $O/fix-<n>.md -i $O/fix-<n>.diff`
  (the full `-b $BASE` diff stays, as context).
- The prompt asks a closed question: "for each item in fix-<n>.md: RESOLVED or NOT RESOLVED (why); then the fix diff:
  any regression it introduced, as `[blocker]`/`[suggestion]`. Outside the fix diff, report only a blocker you missed
  before that would break production, and say why it wasn't in the first review". Anything else is a suggestion. A review tool can't answer that: it reviews the whole
branch again, so you do the matching — a finding is a blocker this round only if it is inside `fix-<n>.diff` or is a
NOT RESOLVED item of `fix-<n>.md`; one you already decided on (fixed, rejected or downgraded) stays decided. **Maximum: `orq config get policy.max_rounds` rounds** — `orq agent -R` refuses the next one (exit 4) and counts per session, so a renamed prefix doesn't reset it; on exit 4 stop and tell the user, `-F` only with their OK; over it → `orq pick impl
--exclude-agent <it> > $O/impl-<repo>.pick` only with the user's OK, or stop and report. Non-blocking suggestions go into the comment; they
don't become a round.

## Screenshots / visual validation
Only when the issue asks for it. **One** attempt (a job with `--effort low`, a short prompt that says which screens and
where to save the images), at most ~6 images, and read them only as files you need to judge — never re-read the same
image. If it fails, tell the user instead of dispatching a second `shots` job. Playwright runs inside that child's
worktree, never as an MCP in the conductor (images in the conductor's context are re-billed every turn).

## 7. Close
**Commit/PR conventions belong to the repo, not to you.** The **implementer, in the worktree** (where the repo's
rules live) commits and writes the PR. Find and cite in the prompt, by path, whatever the repo has:
`.claude/skills/commit-conventions/SKILL.md` or `.agents/skills/commit-conventions/SKILL.md`,
`.github/pull_request_template.md`, `commitlint.config.*`. None of those → plain Conventional Commits.
- Commits: from step 4 on, the prompt says "follow <commit conventions path>". If the review flags a deviation, ask the
  implementer for `git commit --amend`/`rebase -i` before the PR.
- PR (**only when the user asks**): you, in `$WT`: `git -C $WT push -u origin <branch>` and `gh pr create` with a body
  built **from the repo's `.github/pull_request_template.md`** (every section; `<ID>` where the template asks for the
  issue) and the answer in `$O/impl-<repo>.out.md`. Check the opened PR against the template.
- Plane comment (`workitem_comment create`): summary, repo(s), branch, agents and models used (`orq pick` output),
  review result, checks that ran.
- **Review bots on the PR** (a GitHub App reviewer): one more input, not a new review cycle. Only a finding with
  high severity, `file:line` and a concrete failure, not already decided in the rounds, goes into a fix round (it
  counts towards `policy.max_rounds`); the rest goes into the Plane comment or a follow-up issue. Don't re-request the
  bot's review to "get it clean".
- **CI after every push:** `gh pr checks <n>` (no `--watch`; if pending, end your turn and check on the next notice).
  Red → `gh run view <id> --log-failed | tail -40`: error from the diff → fix round; error already on the base → create
  a Plane issue (workspace standard) and tell the user. "Ready to merge" only with green checks or an explained failure
  + issue.
- Move it to **In Review** (finished child tabs close by themselves; close any leftover with
  `herdr tab list | jq -r '.result.tabs[]|select(.label|startswith("<ID> "))|.tab_id' | xargs -rn1 herdr tab close`)
  and **release the issue**: `herdr-claim -w $WS -r <ID>`. The worktree stays until the merge.
- **After the merge** (when the user confirms): run `orq gc -w $WS` and show the list. If this issue's worktree is
  listed as removable, run `orq gc -w $WS --yes`; anything else → ask the user.
- **Never** push, PR, merge or deploy unless the user asks. Report to the user in 3–5 lines.

## Saving tokens
Short prompts (never paste the whole `CLAUDE.md` — the agent reads the repo's own). Reviews judge only the diff, but the prompt must say the reviewer **may open files for context** (cat, rg, git
show — read only): Codex read "review only the diff" as "use only the attached diff" and returned an empty review. Don't re-read
the whole issue at every step. Respect the MCP limitations listed in the workspace `CLAUDE.md`.
