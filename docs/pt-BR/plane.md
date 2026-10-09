[English](../plane.md) · **Português**

# Plane MCP (self-hosted)
Um Plane self-hosted não é acessível pelo `mcp.plane.so` → use **stdio**, com versão fixada.

**Chave num lugar só** (terminal, apps desktop e o servidor do herdr):
```bash
mkdir -p ~/.config/environment.d
cp templates/plane.conf.example ~/.config/environment.d/plane.conf   # put your key, slug and URL in it
chmod 600 ~/.config/environment.d/plane.conf
echo 'set -a; [ -f ~/.config/environment.d/plane.conf ] && . ~/.config/environment.d/plane.conf; set +a' >> ~/.bashrc
```
Faça logout e login de novo (ou `systemctl --user import-environment PLANE_API_KEY PLANE_WORKSPACE_SLUG PLANE_BASE_URL`).

**Clientes** (só a chave vem do ambiente; use seu próprio slug/URL):
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
`~/.config/opencode/opencode.json` (dentro de `"mcp"`):
```json
"plane": { "type": "local", "command": ["uvx", "plane-mcp-server@0.3.3", "stdio"],
  "environment": { "PLANE_API_KEY": "{env:PLANE_API_KEY}", "PLANE_WORKSPACE_SLUG": "your-slug",
                   "PLANE_BASE_URL": "https://plane.example.com" }, "enabled": true }
```
**Não** declare `plane` em arquivos `.mcp.json` de projeto (eles sobrescrevem o de usuário e sobem sem a chave fora do
bash). Confira com `claude mcp list`, `codex mcp list`, `opencode mcp list`. Os filhos sobem **sem** MCP (só o
conductor usa o Plane).

Compatibilidade: o MCP 0.3.3 precisa de **Plane ≥ 1.4.0** para `project list` (`/projects-lite/`). Mesmo na 1.4.2,
`workitem count` retorna 404 e **`pql` retorna resultados errados** → liste sem `pql` e filtre por `state`.
Atualizando um Plane self-hosted: `pg_dump` antes, suba o `APP_RELEASE`, faça redeploy (o `plane-migrator` migra).
