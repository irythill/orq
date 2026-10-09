[English](../omarchy.md) · **Português**

# Extras para Omarchy (opcional)

## Cores do herdr acompanhando o tema
```bash
cp omarchy/herdr.toml.tpl ~/.config/omarchy/themed/herdr.toml.tpl
omarchy hook install theme-set omarchy/herdr-theme-set.sh
omarchy theme set "$(omarchy theme current)"     # generate the colors now
```
O hook reescreve o bloco `# >>> omarchy theme` no fim do `~/.config/herdr/config.toml` a cada troca de tema e recarrega
o servidor. Não declare outro `[theme.custom]` nesse arquivo (TOML duplicado).

## Quota sempre visível na barra
O Omarchy vem com o widget `omarchy.agents` (Claude + Codex). Para mostrar as porcentagens sem precisar clicar:
```bash
omarchy plugin clone omarchy.agents
cd ~/.config/omarchy/plugins/$USER.agents && patch -p1 < <repo>/omarchy/agents-bar-summary.patch
omarchy restart shell
```
Opcional, no `~/.config/omarchy/shell.json`, no item do widget: `"refreshIntervalSec": 300`.
