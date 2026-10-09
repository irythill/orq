[English](../claude-accounts.md) · **Português**

# Várias contas do Claude
Uma pasta `CLAUDE_CONFIG_DIR` por conta, listadas em `~/.config/claude-accounts`:
```
work ~/.claude
personal ~/.claude-personal
```
Conta nova = mais uma linha + um alias no `~/.bashrc` (`alias claude-x='CLAUDE_CONFIG_DIR="$HOME/.claude-x" claude'`)
+ fazer login uma vez com `claude-x`. Confira com `claude-accounts` e `agent-quota`. No `~/.config/orq/config.toml`,
liste os nomes em `[agents.claude] quota = [...]`: aí o `orq-pick` entrega aos filhos a conta menos usada.

**Pegadinha do `CLAUDE_CONFIG_DIR`:** com `CLAUDE_CONFIG_DIR=X`, o Claude lê **`X/.claude.json`** (MCPs, projetos,
dados da conta). O `claude` puro lê **`~/.claude.json`**. Então `CLAUDE_CONFIG_DIR=~/.claude` **não** é o mesmo
`claude` do seu terminal: um MCP adicionado com `claude mcp add -s user` no terminal não aparece lá. Adicione em toda
conta que vai rodar um conductor:
```bash
CLAUDE_CONFIG_DIR=~/.claude-x claude mcp add-json -s user plane '<json>'
CLAUDE_CONFIG_DIR=~/.claude-x claude mcp list
```
