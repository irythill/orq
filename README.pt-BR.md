[English](README.md) · **Português**

<p align="center"><img src="docs/img/orq-logo.svg" alt="orq — um orc de fraque erguendo a batuta de maestro" width="304"></p>

# orq — orquestrando agentes de código com o herdr

Você descreve o trabalho numa issue do Plane. Um **conductor** (Claude, de preferência Opus) lê a issue, escolhe o
agente certo para cada etapa, despacha o **implementador**, os **testes** e uma **review cross-vendor** em abas do
[herdr](https://herdr.dev), e devolve a issue *In Review* com um resumo no Plane. Merge, PR e deploy continuam com você.

O que o orq **não** decide por você: quais agentes você tem, quanto cada um pode gastar e como você gosta de
trabalhar. Tudo isso fica na sua config.

> Nasceu do uso diário numa empresa de saúde: 3–5 issues em paralelo num notebook de 14 GB, usando Claude Code, Codex,
> OpenCode, Antigravity e Copilot. A história, os números e as lições: **[docs/pt-BR/case-study.md](docs/pt-BR/case-study.md)**.
>
> 🚧 = ainda não disponível.

## Como funciona

```
You ── "/issue DEMO-123" ──► conductor (Claude in herdr)
                                │  orq-pick impl ──► which agent/model implements (config + history + quota)
                                ├─► implementer   herdr-agent  own tab · worktree from origin/<base> · memory cap
                                ├─► tests         herdr-verify  only the diff's tests · queue of one suite at a time
                                │  orq-pick review ─► a reviewer from ANOTHER vendor
                                ├─► reviewer      herdr-agent -r  read only · diff + criteria + test results attached
                                └─► Plane         comment, state, labels
                                ◄── "[HERDR-AGENT DONE] ..." in the conductor's pane (the only completion signal)
```

- **Cada etapa numa aba do herdr.** Você acompanha ao vivo e a aba fecha quando termina. Os resultados ficam em
  `.orquestra/<ID>/` (`.out.md`, `.log`, `.done`).
- **Ordem fixa em toda rodada:** implementador ok → testes sem falha nova → review. Um problema bloqueante vira uma
  rodada de correção na própria sessão do implementador (com máximo configurável).
- **Ninguém escolhe agente no feeling.** O `orq-pick` decide com base em dados: o que cada agente entregou no
  histórico, quantos tokens gastou, quanto tempo levou, a quota atual e um rodízio para nenhum agente ficar com todo o
  trabalho.
- **A máquina não cai.** Cada agente roda com seu próprio limite de memória; os testes esperam numa fila.

## Agentes suportados

| Agente | CLI | Papéis possíveis | Observações |
|---|---|---|---|
| Claude Code | `claude` | conductor, implement, review | várias contas (`claude-accounts`); Opus como conductor |
| Codex | `codex` | implement, review | sandbox sem rede: o conductor roda o `git fetch` |
| OpenCode | `opencode` | implement, review | qualquer provider (ex.: MiniMax) |
| Antigravity | `agy` | review | em modo headless nega comandos fora da allowlist: faz a review lendo o diff anexado |
| GitHub Copilot | `copilot` | segunda opinião | cota pequena em alguns planos: uso ocasional |

Você declara só os que tem, e os papéis que cada um pode assumir.

## Instalação

Linux, macOS ou Windows (nativo, não só WSL), em qualquer shell — bash, zsh, fish, PowerShell, cmd.
**Requisitos:** Node 20+ com `npm`, `git`, e pelo menos um agente da tabela acima, logado. Opcional:
[herdr](https://herdr.dev) ou tmux, para cada filho ter sua própria aba ou janela (sem eles, os filhos rodam em
segundo plano e o `orq board` mostra todos).

```bash
npm i -g @irythill/orq
orq setup
```

O `orq setup` mostra o que encontrou (git, terminal, como a memória é limitada, chaveiro, seu shell), liga as skills
do orq em `~/.claude/skills/` e em cada pasta de conta do `claude-accounts` (uma junction no Windows; nunca por cima
de uma pasta sua), pergunta sobre seus agentes e planos, escreve o `~/.config/orq/config.toml`
(`%APPDATA%\orq\config.toml` no Windows) e prepara a pasta que agrupa seus repos para o conductor: `.orquestra/`, o
mapa `CLAUDE.md` e o playbook do `/issue` no formato do conductor. Partes avulsas: `orq setup --install` (sem
perguntas), `orq setup --workspace <pasta> --conductor <agente>`. Dentro do Claude, o **`/orq-setup`** faz o mesmo
como conversa e ainda preenche a tabela de repos. Plane: [docs/pt-BR/plane.md](docs/pt-BR/plane.md).

**Limite de memória:** um scope do systemd no Linux com sessão de usuário; senão, um vigia (macOS, Windows, WSL sem
systemd). **Chaveiro** (cota do Antigravity, cota do Claude no macOS): Secret Service, Keychain ou Credential Manager
pelo `@napi-rs/keyring`; sem o módulo nativo, `secret-tool`/`security`.

### Autocompletar no shell

| Shell | Como ligar |
|---|---|
| bash | `echo 'eval "$(orq completion bash)"' >> ~/.bashrc` |
| zsh | `echo 'eval "$(orq completion zsh)"' >> ~/.zshrc` (depois do `compinit`) |
| fish | `orq completion fish > ~/.config/fish/completions/orq.fish` |
| PowerShell | `Add-Content $PROFILE 'orq completion powershell \| Out-String \| Invoke-Expression'` |
| cmd | sem autocompletar programável |

### Extras do Linux a partir de um clone: `install.sh` (opcional)

Para o herdr como serviço sempre ligado, o plugin dele e os nomes antigos dos scripts (`herdr-*`, `orq-*`,
`agent-quota`):

```bash
# herdr (testado na 0.9.3)
curl -fsSL https://herdr.dev/install.sh -o /tmp/herdr-install.sh && less /tmp/herdr-install.sh && sh /tmp/herdr-install.sh
git clone https://github.com/irythill/orq ~/Code/orq && cd ~/Code/orq
./install.sh            # links em ~/.local/bin, serviço do herdr, skills do Claude
```

Precisa de `git`, `jq`, Node 20+ com `npm`, `python3` (3.11+ para config em TOML; mais antigo → config em JSON ou
`pip install --user tomli`) e `systemd` de usuário (WSL2: Ubuntu 22.04+ com systemd habilitado). O `install.sh`
confere os requisitos (tabela do que foi encontrado e do que falta), compila o CLI `orq` (`src/` → `dist/`) e depois
cria **symlinks** (nunca copia) dos scripts em `~/.local/bin`, do `setup/herdr.service` em `~/.config/systemd/user/`
(e habilita o serviço), e de cada skill em `~/.claude/skills/` e em cada pasta de conta listada em
`~/.config/claude-accounts`. É idempotente: rode de novo depois de um `git pull` ou de uma conta nova. Nunca
sobrescreve um arquivo de verdade (avisa e pula) e nunca escreve a sua config.

| Flag | O que faz |
|---|---|
| `--dry-run` | mostra o que faria, sem mudar nada |
| `--uninstall` | remove só os links que ele cria, e só os que apontam para este repo (config e histórico ficam) |

## Configuração

Duas camadas, para separar **o seu jeito de trabalhar** do **projeto do time**:

| Arquivo | De quem | O que guarda |
|---|---|---|
| `~/.config/orq/config.toml` | seu, fica na sua máquina | agentes, contas, modelos por papel e nível, pesos do pick, limites de memória |
| `<workspace>/.orq/workspace.toml` 🚧 | do time, versionado | Plane (projetos, padrão de issue), repos, branch base, verificação, testes, dependências |

O mais específico ganha, chave por chave. JSON também funciona (`config.json`). Para ver o resultado mesclado:
`orq-config` (tudo), `orq-config get policy.weights`, `orq-config files`.

### Exemplo: config pessoal
Exemplo completo e comentado: [`examples/irythill/config.toml`](examples/irythill/config.toml). O essencial:

```toml
[agents.codex]
vendor = "openai"
roles  = ["impl", "fix", "review"]
quota  = ["codex"]                       # name in agent-quota's output
[agents.codex.models.impl]
simple = "gpt-6-sol@low"                 # model@effort
heavy  = "gpt-6.1-sol@medium"

[agents.opencode]
vendor = "minimax"
roles  = ["review"]                      # here it only reviews; for someone else it may implement
[agents.opencode.models.review]
default = "minimax/MiniMax-M3"

[policy]
quota_limit = 90                         # ≥ 90% used → agent out
[policy.weights]
quality  = 0.40                          # did it deliver? (impl: approved on the first review)
tokens   = 0.45                          # did it spend little?
speed    = 0.15
rotation = 0.20                          # penalty for having been picked recently
```

### Como o `orq-pick` escolhe
1. **Filtros:** só agentes com aquele papel, abaixo do limite de quota, não bloqueados (`orq-block`) e, para reviews,
   de um vendor diferente do implementador. Com várias contas, pega a menos usada.
2. **Pontuação:** `quality × delivery + tokens × economy + speed × quickness − rotation × recent picks`. Os números vêm
   do histórico (`orq-stats`); um agente com poucas execuções usa o `prior` da config e ganha um bônus de exploração.
3. **Agentes com `reserve = true`** (ex.: Claude, que divide quota com o conductor) só entram quando nada mais serve.

```bash
orq-pick review --impl-agent codex --explain     # every candidate's score and who was left out, and why
orq-stats --days 30                              # scoreboard: delivery, approval, time and tokens per agent and model
orq-block antigravity --days 3                   # out of the picks (e.g. weekly quota gone, no collector for it)
```

### Idioma e tema
O orq fala inglês e português: mensagens da CLI, `herdr-board`, avisos e `install.sh`. Ele segue `[ui] lang` na sua
config (`"auto"` = idioma do sistema, `"en"`, `"pt"`) ou a variável de ambiente `ORQ_LANG`. Para trocar a qualquer
momento:
- `orq-lang pt` / `orq-lang en` / `orq-lang toggle` (`orq-lang` sozinho mostra o atual);
- a tecla `l` dentro do `orq board`;
- uma tecla no herdr: o `install.sh` liga o plugin `orq` do herdr; associe a ação `orq.lang-toggle` (trecho pronto em
  `herdr-plugin/herdr-plugin.toml`) — por exemplo, `prefix+shift+l` — e a `orq.board` para abrir o painel por cima.

O `orq board` tem visual próprio, inspirado no portfólio [SYNTH.DECK](https://github.com/irythill/synth-deck-portfolio):
`[ui] theme = "gunmetal"` (padrão, grafite escuro), `"chrome"` (prata claro), `"lcd"` (verde fósforo) ou `"terminal"`
(as cores do seu terminal). A tecla `t` dentro do painel alterna entre eles (`ORQ_THEME` tem prioridade).

O que já está rodando continua no idioma em que começou. Os conductors sempre falam com você no seu idioma.

## Uso diário

```bash
herdr                                    # abre a janela (o servidor roda como serviço)
cd ~/Code/<workspace> && herdr-conductor # dentro de um pane do herdr: abre o conductor (conta e modelo opcionais)
```
No conductor: **`/issue DEMO-123`**. Ele responde numa linha e segue sozinho a cada `[HERDR-AGENT DONE]`. Você só volta
quando ele pede uma decisão ou avisa que terminou.

Para ver tudo de uma vez, deixe o **`orq board`** aberto numa aba ou janela (qualquer terminal, qualquer SO; o
`herdr-board` o chama): fila de testes, agentes rodando (modelo, memória contra o limite, última ação), conductors e
suas issues, memória, quota, bloqueios e o placar de 7 dias. `--once` imprime uma vez, `--json` para scripts. Com
`ui.toast.delivery = "system"` na config do herdr, cada etapa concluída também gera uma notificação nativa do sistema.

Várias issues ao mesmo tempo: um conductor por issue (de preferência em contas diferentes). O `herdr-claim` impede que
dois conductors peguem a mesma issue. Detalhes, atalhos e cenários: [docs/pt-BR/herdr.md](docs/pt-BR/herdr.md).

## Skills

| Skill | Para quê | Status |
|---|---|---|
| `/issue <ID>` | Fluxo completo: issue → implementação → testes → review → Plane | pronta |
| `/orq-setup` | Setup guiado: agentes, contas, repos, verificação | pronta |
| `/review <PR or branch>` | Review cruzada de algo pronto (ex.: PR de um colega), sem implementação | 🚧 |
| `/investigate <question>` | Um agente só-leitura investiga um bug ou trecho de código e reporta | 🚧 |
| `/orq-status` | Resumo no chat: fila, agentes rodando, placar e quota | pronta |

## Comandos

| Comando | O que faz |
|---|---|
| `orq agent -a <agent> ...` (`herdr-agent`) | Roda um agente com limite de memória numa aba do herdr, numa janela do tmux ou em segundo plano; `-r` só leitura, `-R <id>` continua a sessão, `-i` anexa um arquivo, `-b <base>` anexa o diff, `-T` a tela do próprio agente (só herdr) |
| `orq instructions claude\|agents` | Escreve o playbook do `/issue` como `SKILL.md` (Claude Code) ou dentro do `AGENTS.md` (Codex, OpenCode…) |
| `orq wait <prefixo>...` | Bloqueia até esses agentes terminarem; imprime `status=` e o arquivo da resposta (qualquer conductor, qualquer terminal) |
| `orq verify ...` (`herdr-verify`) | Testes relacionados ao diff, em fila e com limite de memória; falhas que também falham na base contam como pré-existentes |
| `orq board` (`herdr-board`) | Painel ao vivo: fila, agentes, conductors, cota, bloqueios, placar |
| `herdr-conductor` | Abre o conductor no pane atual |
| `herdr-claim` | Dono de cada issue entre os conductors |
| `herdr-deps` | Liga as dependências do worktree às do repo principal (sem reinstalar) |
| `orq baseline ...` (`herdr-baseline`) | Snapshot manual dos testes que falham na base (fora do fluxo) |
| `orq setup` | Primeira configuração e instalação: ambiente, skills do Claude, config, workspace do conductor |
| `orq completion bash\|zsh\|fish\|powershell` | Imprime o script de autocompletar do shell (veja Instalação) |
| `orq <config\|set\|lang\|block\|quota>` | O CLI multiplataforma (TypeScript); os nomes `orq-*` e `agent-quota` abaixo chamam ele |
| `agent-quota` | Quota atual de cada agente e conta; se a leitura falha, vale a última boa até a janela resetar |
| `orq-config` · `orq-pick` · `orq-stats` · `orq-block` | Configuração, escolha de agente, placar, bloqueios manuais |
| `orq-lang` | Mostra ou troca o idioma das mensagens do orq (en/pt) |
| `orq-set <seção> <chave> <valor>` | Grava um valor na sua config do orq (ex.: `orq-set ui theme lcd`) |

## Mais

- [docs/pt-BR/case-study.md](docs/pt-BR/case-study.md) — como isso surgiu, com números reais
- [docs/pt-BR/plane.md](docs/pt-BR/plane.md) — Plane self-hosted via MCP
- [docs/pt-BR/claude-accounts.md](docs/pt-BR/claude-accounts.md) — várias contas do Claude
- [docs/pt-BR/herdr.md](docs/pt-BR/herdr.md) — herdr no dia a dia, atalhos, várias issues ao mesmo tempo
- [docs/pt-BR/troubleshooting.md](docs/pt-BR/troubleshooting.md) — problemas conhecidos e soluções
- [docs/pt-BR/omarchy.md](docs/pt-BR/omarchy.md) — extras para quem usa Omarchy
- [docs/pt-BR/portability.md](docs/pt-BR/portability.md) — o roadmap: Linux, macOS e Windows nativo, qualquer agente como conductor, papéis definidos pelo usuário, setup guiado
- [CHANGELOG.pt-BR.md](CHANGELOG.pt-BR.md) — o que mudou, versão a versão
- `examples/` — configurações reais para copiar

## Licença

[MIT](LICENSE)
