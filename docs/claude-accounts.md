# Several Claude accounts
One `CLAUDE_CONFIG_DIR` folder per account, listed in `~/.config/claude-accounts`:
```
work ~/.claude
personal ~/.claude-personal
```
A new account = one more line + an alias in `~/.bashrc` (`alias claude-x='CLAUDE_CONFIG_DIR="$HOME/.claude-x" claude'`)
+ logging in once with `claude-x`. Check with `claude-accounts` and `agent-quota`. In `~/.config/orq/config.toml`, list
the names under `[agents.claude] quota = [...]`: `orq-pick` then hands children the least used account.

**`CLAUDE_CONFIG_DIR` gotcha:** with `CLAUDE_CONFIG_DIR=X`, Claude reads **`X/.claude.json`** (MCPs, projects,
account data). Plain `claude` reads **`~/.claude.json`**. So `CLAUDE_CONFIG_DIR=~/.claude` is **not** the same
`claude` as your terminal's: an MCP added with `claude mcp add -s user` in the terminal doesn't show up there. Add it to
every account that will run a conductor:
```bash
CLAUDE_CONFIG_DIR=~/.claude-x claude mcp add-json -s user plane '<json>'
CLAUDE_CONFIG_DIR=~/.claude-x claude mcp list
```
