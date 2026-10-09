**English** · [Português](pt-BR/omarchy.md)

# Omarchy extras (optional)

## herdr colors following the theme
```bash
cp omarchy/herdr.toml.tpl ~/.config/omarchy/themed/herdr.toml.tpl
omarchy hook install theme-set omarchy/herdr-theme-set.sh
omarchy theme set "$(omarchy theme current)"     # generate the colors now
```
The hook rewrites the `# >>> omarchy theme` block at the end of `~/.config/herdr/config.toml` on every theme change and
reloads the server. Don't declare another `[theme.custom]` in that file (duplicate TOML).

## Quota always visible in the bar
Omarchy ships the `omarchy.agents` widget (Claude + Codex). To show the percentages without clicking:
```bash
omarchy plugin clone omarchy.agents
cd ~/.config/omarchy/plugins/$USER.agents && patch -p1 < <repo>/omarchy/agents-bar-summary.patch
omarchy restart shell
```
Optional, in `~/.config/omarchy/shell.json`, on the widget item: `"refreshIntervalSec": 300`.
