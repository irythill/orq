# Known problems and fixes

| Symptom | Cause | Fix |
|---|---|---|
| Prompt arrives with pieces missing; empty answers; "Invalid environment variable name evaluates to an empty string" in the log | `systemd-run` expands `${...}` in its arguments — JS template strings and GitHub Actions expressions in the prompt vanished (Claude escaped it by reading stdin) | `herdr-agent` passes `--expand-environment=no` (systemd ≥ 254) |
| Test queue stuck for an hour behind full test suites | the baseline was keyed to the base SHA: every merge invalidated it and each conductor re-ran the full suite, sometimes twice | `herdr-verify` checks the base **on demand**: only the failing test files, on a fresh `origin/<base>`; `herdr-baseline` is manual only |
| Conductors always pick the same agent | an LLM reading prose rules favors the newest, most specific rule | `orq-pick` decides from data (delivery, tokens, speed, quota, rotation); the skill forbids choosing by hand |
| After one failed review, every later review goes to the same agent | `--exclude-agent` "stuck" in the conductor's head | the skill says the exclusion is for redoing that one review only |
| Antigravity review ends with no output | in headless mode `agy` denies any command outside its own allowlist and one denial ends the run | it only reviews, with the diff attached (`-b`) and no terminal; failure without a verdict → another reviewer |
| Empty answer reported as `status=ok` | the check only looked for a non-empty file (a single newline passed) | whitespace-only answer = `fail` |
| Plane MCP fails outside the terminal | key only in `.bashrc`; a project `.mcp.json` overrode it | `environment.d` + user scope only |
| `project list` 404 | Plane < 1.4.0 | upgrade Plane |
| PQL returns everything/nothing | MCP × Plane CE incompatibility | don't use `pql`; filter by `state` |
| Commit/PR not following the repo's conventions | the implementer didn't read them | the implementer commits and writes the PR in the worktree, citing `commit-conventions` and `pull_request_template.md` by path |
| Codex writes the files but doesn't commit (`index.lock: Read-only file system`) | Codex treats any `.git` inside a writable root as read only, even with `--add-dir` on `.git` | `herdr-agent` grants the worktree's gitdir, `objects`, `refs` and `logs` as separate roots |
| OpenCode finishes but the process doesn't exit | helper processes hold the pipe after `step_finish` | `herdr-agent` names the scope and a watcher stops it when the last event is `step_finish/stop` and the log is idle for 30 s |
| OpenCode review can't even run `git diff` | the `plan` agent denies bash, and headless turns every "ask" into a denial | read-only reviews run on a throwaway worktree with bash allowed and edits denied, via `OPENCODE_CONFIG_CONTENT` |
| One agent takes everything down (e.g. jest with 15 workers ≈ 10 GB) | a worker limit in the prompt is no guarantee | each child in its own cgroup (`systemd-run --user --scope -p MemoryMax=4G`): if it blows up, only it dies |
| Child dies at its 4 GB cap during tsc + jest | the test suite doesn't fit next to the agent | tests leave the child (`herdr-verify` in the conductor, 6 GB, queued); child runs `NODE_OPTIONS=--max-old-space-size=2048 tsc` |
| Machine freezes (high I/O, OOM) when creating worktrees | each worktree installed ~1 GB of `node_modules` | the worktree **links** to the main repo's `node_modules`; stale deps → one install in the main repo |
| Everything dies at once under memory pressure | `systemd-oomd` kills the parent of all sessions | children without MCP, `--maxWorkers=2`, one suite at a time; herdr server with `ManagedOOMPreference=avoid` |
| A runaway process eats a core for days | a child left a process behind after its worktree was deleted | `herdr-board` lists agent scopes without a `.run.sh` as "orphan?" and flags agents running for over 3 h |
| Conductor says "running" when the agent already finished | `pgrep -f` matches its own command line | finished = `<prefix>.done` exists; never `pgrep`/`ps` |
| Reviewer can't read the criteria in `.orquestra/` | sandbox only sees the `-d` folder | `herdr-agent -i <file>` appends the content to the prompt; `-b <base>` appends the diff |
| Codex review can't run tests (`EROFS` on jest's cache) | the read-only sandbox can't even write to `/tmp` | `-a codex -r` runs `workspace-write` on a **throwaway worktree**, removed at the end |
| Stale branch → rebase pain, huge lockfile diff, "base" failure already fixed | worktree cut before a merge on the base | implementer runs `fetch && rebase origin/<base>` before its final answer; conductor checks `merge-base --is-ancestor` before reviewing |
| Red CI discovered too late | nobody looked at the checks | `gh pr checks` after every push (skill step 7) |
| Codex quota "no data" | the collector fails intermittently; the Plus plan has no 5h window | `agent-quota` reads the latest Codex session when the collector fails and shows `5h=-` |
| Plane disappears from the conductor after switching accounts | `CLAUDE_CONFIG_DIR=X` reads `X/.claude.json`, without the MCPs in `~/.claude.json` | add the MCP with `CLAUDE_CONFIG_DIR=X claude mcp add-json …` too |
| `[HERDR-AGENT DONE]` notice doesn't show up | conductor just opened or inside a dialog | `herdr-notify` waits for the dialog and retries 3×; the herdr notification and `.done` always remain |
| A script fails "out of nowhere" right after an edit | bash reads scripts incrementally; editing in place changes what a queued process executes | replace files atomically (write next to it and `mv`); develop in a separate worktree |
| Notice typed into the conductor merges with your unsent draft | `herdr agent prompt` types into the input box | before messaging conductors, check for a draft or an open question |
| Conductor "thinking" for minutes | blocking wait | `Esc`; the instructions forbid blocking waits |
