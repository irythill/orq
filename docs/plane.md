**English** · [Português](pt-BR/plane.md)

# Plane MCP (self-hosted)
A self-hosted Plane isn't reachable through `mcp.plane.so` → use **stdio**, with a pinned version.

**Key in a single place** (terminal, desktop apps and the herdr server):
```bash
mkdir -p ~/.config/environment.d
cp templates/plane.conf.example ~/.config/environment.d/plane.conf   # put your key, slug and URL in it
chmod 600 ~/.config/environment.d/plane.conf
echo 'set -a; [ -f ~/.config/environment.d/plane.conf ] && . ~/.config/environment.d/plane.conf; set +a' >> ~/.bashrc
```
Log out and back in (or `systemctl --user import-environment PLANE_API_KEY PLANE_WORKSPACE_SLUG PLANE_BASE_URL`).

**Clients** (only the key comes from the environment; use your own slug/URL):
```bash
claude mcp add -s user plane -e PLANE_WORKSPACE_SLUG=your-slug -e PLANE_BASE_URL=https://plane.example.com \
  -- uvx plane-mcp-server@0.3.3 stdio
```
`~/.codex/config.toml`:
```toml
[mcp_servers.plane]
command = "uvx"
args = ["plane-mcp-server@0.3.3", "stdio"]
env_vars = ["PLANE_API_KEY"]
env = { PLANE_WORKSPACE_SLUG = "your-slug", PLANE_BASE_URL = "https://plane.example.com" }
```
`~/.config/opencode/opencode.json` (under `"mcp"`):
```json
"plane": { "type": "local", "command": ["uvx", "plane-mcp-server@0.3.3", "stdio"],
  "environment": { "PLANE_API_KEY": "{env:PLANE_API_KEY}", "PLANE_WORKSPACE_SLUG": "your-slug",
                   "PLANE_BASE_URL": "https://plane.example.com" }, "enabled": true }
```
**Don't** declare `plane` in project `.mcp.json` files (they override the user-level one and start without the key
outside bash). Check with `claude mcp list`, `codex mcp list`, `opencode mcp list`. Children start **without** MCP
(only the conductor uses Plane).

Compatibility: MCP 0.3.3 needs **Plane ≥ 1.4.0** for `project list` (`/projects-lite/`). Even on 1.4.2,
`workitem count` returns 404 and **`pql` returns wrong results** → list without `pql` and filter by `state`.
Upgrading a self-hosted Plane: `pg_dump` first, bump `APP_RELEASE`, redeploy (the `plane-migrator` migrates).
