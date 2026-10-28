---
name: orq-status
description: Read-only summary of the orq orchestration in chat — test queue, running agents, conductors and their issues, quota per agent/account, active blocks and the recent scoreboard (orq stats). Use when the user says "/orq-status", "how's the queue", "what's running", "how much quota is left" or asks for an orq status report.
---

# /orq-status — orchestration status in chat

**Read only.** Collect, summarize, stop. Do not dispatch, kill, unblock, or claim anything: if something looks
wrong, point it out and suggest the command, but let the user decide. Talk to the user in the user's language.

## 1. Collect (one Bash call, all in parallel is fine)
```bash
orq board --once 2>&1                                                            # queue, agents, conductors, quota
orq block -l                                                                     # agents/accounts out of orq pick
orq stats --days ${DAYS:-7}                                                      # scoreboard (default: last 7 days)
```
- `orq board --once` (plain text when piped; `--json` for exact fields) already gathers the test queue (TRANSPORT), running agents (TRACKS), conductors with their
  claimed issues (MASTER) and quota (MIXER). Its quota comes from a cache refreshed in the background: if MIXER says
  "collecting..." (or the cache is old and the user asked about quota), run `orq quota` directly instead.
- The user passed a number (`/orq-status 30`)? Use it as `--days`. `-w <workspace>` → pass it to `orq stats -w` and
  as `-w <workspace>` to the board.
- A command missing or failing (e.g. herdr not running): say so in one line and summarize what the others returned.
  `orq quota` exiting 1 is a known quirk (last agent not requested), not a failure — use its output.

## 2. Summarize (short, scannable)
Sections in this order; skip a section that is empty, saying so in one line ("queue empty", "no agents running"):
1. **Test queue** — what is running (issue, repo, for how long) and how many are waiting.
2. **Agents** — one line each: issue, label, agent·model, elapsed, memory. Flag ⚠ for >3 h running, memory near
   the cap, or orphans (no `.run.sh`).
3. **Conductors** — issue(s) and state; call out any **asking for approval** (the user must act there).
4. **Quota** — per account/agent, the higher of 5h/week. Flag ≥70 % and ≥90 %; `?` = no data (log in again).
   Add active blocks from `orq block -l` with their end date.
5. **Scoreboard** — per agent: runs, first-pass approval, median duration, new tokens. Two or three lines, not the
   whole table, unless the user asks.

End with **at most two** suggested next actions, only when something needs attention (e.g. "Antigravity block
ends 16/10: `orq block -r antigravity` when quota is back"; "conductor X is waiting for your approval").
