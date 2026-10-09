**English** · [Português](pt-BR/herdr.md)

# Using herdr day to day

**Concepts (3 levels, outside in):**
- **Space** (= herdr workspace): one row in the sidebar. One per conductor (`acme-1`, `acme-2`…) and one per repo
  group (`api`, `web`…), the latter created automatically by `herdr-agent` when the group's first child starts.
- **Tab** inside a space: every child gets one, titled `<ID> impl <repo>`, `<ID> review <repo>`… Finished child tabs
  close by themselves (`HERDR_CLOSE_DELAY`, 20 s; `HERDR_KEEP_TAB=1` keeps them).
- **Pane** inside a tab: the terminal. The conductor is a Claude in a pane.

The herdr **server** always runs (the `herdr` service); opening and closing the window stops nothing. `herdr` opens the
window, `prefix d` closes it (the prefix in the sample config: `Ctrl+Space`).

**1. Starting the day (one conductor)**
```bash
herdr                                        # opens the window (the server is already running)
```
Inside herdr:
1. Create the conductor's space: `prefix Shift+C`, then `prefix Shift+R` and name it (e.g. `acme-1`).
2. In its pane: `agent-quota` to see which account has room, then
   `cd ~/Code/acme-platform && herdr-conductor work opus` (account and model).
3. The first time on an account, Claude asks whether you trust the folder → *Yes*.
4. Send `/issue DEMO-123`. The conductor claims the issue, creates the worktree, dispatches the child and stops (one
   line of answer).
5. Follow along: the child shows up in the group's space (e.g. `api`) — `Alt+↓` to it, `Alt+←/→` between tabs, `Alt+↑`
   back. Don't type in child tabs (headless, output only). When a child finishes, `[HERDR-AGENT DONE] …` reaches the
   conductor and it carries on by itself (verify → review → Plane comment). Or keep `herdr-board` open in a tab.

**2. Several issues at once (same workspace)**
1. Create another space (`prefix Shift+C`, name `acme-2`) and open another conductor there, preferably on **another
   account**: `cd ~/Code/acme-platform && herdr-conductor personal opus`.
2. Send a different issue to each (`/issue DEMO-123` in one, `/issue DEMO-130` in the other).
3. Prefer issues in **different modules/repos**: the test queue and the dependency lock prevent clashes, but two issues
   touching the same files produce conflicting PRs. Dependent issues (API → front) stay in the same conductor, in order.
4. Sent it to the wrong conductor? It refuses by itself: `herdr-claim` records each issue's owner
   (`herdr-claim -w ~/Code/acme-platform -l` lists who has what).
5. Machine limits: on 14 GB, 3–5 parallel tasks work with the default caps (4 GB per agent, one test suite at a time).
   Everyone's tests share one queue.

**3. An account ran out in the middle of an issue**
1. New space, `herdr-conductor <another-account> opus`.
2. Send: "take over issue DEMO-123 (`herdr-claim -f`), state in `.orquestra/DEMO-123/`".
3. Close the old conductor's space (`prefix Shift+K`). A Claude child only resumes (`-R`) on the same account; on
   another, dispatch a new one.

**Shortcuts** (`prefix ?` shows them all):
| Action | Key |
|---|---|
| Leave without stopping anything / come back | `prefix d` / `herdr` |
| New space · rename · close | `prefix Shift+C` · `prefix Shift+R` · `prefix Shift+K` |
| Previous/next space · list · search | `Alt+↑/↓` · `prefix w` · `prefix g` |
| Previous/next tab · tab N · close tab | `Alt+←/→` · `Alt+1..9` · `prefix k` |
| Neighbor pane · zoom · scroll/copy | `Ctrl+Alt+arrows` · `prefix z` · `prefix [` |

**Conductor etiquette (it re-reads the whole conversation on every message and notice):**
- **Dispatch only:** `/issue X`, "open the PR", "status?", "you can close it". Architecture/infrastructure discussions
  belong in a regular Claude session; the decision goes into the Plane issue and only then `/issue`.
- **Silence = running.** To check by hand: `.orquestra/<ID>/<prefix>.done` exists → finished (answer in `.out.md`);
  peek: `herdr pane read $(cat .orquestra/<ID>/<prefix>.pane) --source recent`.
- **One batch per session:** after a set of related issues → `/clear` (state lives in Plane and `.orquestra/`).

## Native pop-up when something finishes
herdr sends notices to the OS notification service (Linux: the desktop's; Windows: toast; macOS: Notification Center)
when `~/.config/herdr/config.toml` has:
```toml
[ui.toast]
delivery = "system"     # off | herdr (inside herdr) | terminal | system
```
Then: `herdr server reload-config`. orq notices (`herdr-notify`) show up as "✓ <ID> <step> <repo>" or "✗ ..." with the
answer file in the body. On WSL the pop-up depends on herdr reaching Windows; if nothing shows, use
`delivery = "herdr"` (notice inside the herdr window).
