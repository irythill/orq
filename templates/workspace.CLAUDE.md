# CLAUDE.md — {{NAME}} ecosystem ({{WORKSPACE}})

This folder groups the ecosystem's repositories. Each repo has its own `CLAUDE.md`/`AGENTS.md` with commands and
rules — read the repo's own before touching it. This file only holds the map and the orchestration settings.

## Orchestration (read by the `/issue` skill)
- **Workspace:** `{{WORKSPACE}}`
- **Conductor (herdr):** opened with `herdr-conductor [account] [model]` in a herdr pane, in this folder
  (instructions in `.orquestra-conductor.md`); the **Group** in the table below is the herdr workspace (`-g`).
  Tests from the Verification column (jest/vitest) **don't run in the child**: the conductor runs `herdr-verify`
  (one at a time on the machine); the child does lint + `tsc` (`NODE_OPTIONS=--max-old-space-size=2048`).
- **Agents:** chosen by `orq-pick` from each developer's `~/.config/orq/config.toml` — nothing about models here.

## Repositories

| Folder | What it is | Stack / PM | Group | Base | Verification | Checklist |
|---|---|---|---|---|---|---|
| `{{repo}}` | {{description}} | {{stack}} | `{{group}}` | `dev` | `{{lint}}`, `{{typecheck}}`, `{{test}}` | {{what every implementer must remember in this repo, or —}} |

## How they connect
- {{who consumes whom; what changes first when a contract changes}}

## Branches
- Work starts from an **updated `origin/<Base>`** (Base column) and comes back through a PR to the same base.
- **Branch prefix:** `{{prefix, e.g. your-user/ — or empty}}` → one branch per issue `<prefix>plane-<lowercase-id>`.
  Worktrees in `{{WORKSPACE}}/.worktrees/<repo>-plane-<id>`.
- Commit/PR conventions live **in each repo** (`.claude|.agents/skills/commit-conventions`,
  `.github/pull_request_template.md`, `commitlint`) — don't copy them here; the `/issue` skill tells the implementer
  to follow them.
- **Never** merge, push to the base/`main` or deploy unless the user asks.

## Plane ({{PLANE_URL}}, workspace `{{SLUG}}`)
| Project | Identifier | project_id | Repos |
|---|---|---|---|
| {{name}} | `{{ID}}` | `{{uuid}}` | {{repos}} |

States: Backlog → Todo → In Progress → **In Review** → Done.

### Issue standard (when creating or triaging)
- **State**: `Todo` if ready, `Backlog` if still an idea.
- **Assignee**: `{{user}}` → `{{user_id}}`.
- **Created by**: automatic (owner of the MCP token).
- **Priority**: `urgent` / `high` / `medium` (default) / `low`.
- **Labels**: {{convention — e.g. 1 type + at least 1 area}}.
- **Module**: pick an existing, active one; none fits → propose one to the user before creating it.
- **Parent/relation** to the originating issue, when there is one.

### MCP limitations
- {{e.g. don't use `pql`; `workitem count` returns 404}}
