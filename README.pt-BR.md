[English](README.md) · **Português**

<p align="center"><img src="docs/img/orq-logo.svg" alt="orq — um orc de fraque erguendo a batuta de maestro" width="304"></p>

# orq — orquestrando agentes de código

Você descreve o trabalho numa issue do Plane. Um **conductor** (qualquer agente que execute comandos) lê a issue, escolhe o
agente certo para cada etapa, despacha o **implementador**, os **testes** e uma **review cross-vendor** (cada um
em sua própria aba ou janela no [herdr](https://herdr.dev) ou no tmux, ou em segundo plano), e devolve a issue
*In Review* com um resumo no Plane. Merge, PR e deploy continuam com você.

O que o orq **não** decide por você: quais agentes você tem, quanto cada um pode gastar e como você gosta de
trabalhar. Tudo isso fica na sua config.

> Nasceu do uso diário numa empresa de saúde: 3–5 issues em paralelo num PC de 14 GB, usando Claude Code, Codex,
> OpenCode, Antigravity e Copilot. A história, os números e as lições: **[docs/pt-BR/case-study.md](docs/pt-BR/case-study.md)**.
>
> 🚧 = ainda não disponível.

## Como funciona

```
You ── "/issue DEMO-123" ──► conductor (any agent CLI, in any terminal)
                                │  orq pick impl ──► which agent/model implements (config + history + quota)
                                ├─► implementer   orq agent  own tab/window or background · worktree from origin/<base> · memory cap
                                ├─► tests         orq verify  only the diff's tests · queue of one suite at a time
                                │  orq pick review ─► a reviewer from ANOTHER vendor
                                ├─► reviewer      orq agent -r  read only · diff + criteria + test results attached
                                └─► Plane         comment, state, labels
                                ◄── "[HERDR-AGENT DONE] ..." typed into the conductor's herdr pane, or `orq wait` printing "[ORQ AGENT DONE] ..."
```

- **Cada etapa na sua própria aba ou janela.** No herdr ou no tmux você acompanha ao vivo e a aba fecha quando
  termina; sem eles a etapa roda em segundo plano (o `orq board` mostra). Os resultados ficam em
  `.orquestra/<ID>/` (`.out.md`, `.log`, `.done`).
- **Ordem fixa em toda rodada:** implementador ok → testes sem falha nova → review. Só um `[blocker]` com
  `arquivo:linha` e uma falha concreta vira rodada de correção; o resto vai para o comentário no Plane (com máximo
  configurável).
- **As rodadas convergem.** O fix continua a sessão do implementador no mesmo modelo (`orq pick fix --same`, esforço
  um nível acima), corrige só os blockers listados, com um teste para cada, e o review seguinte, do mesmo reviewer,
  confere esses blockers e o diff do próprio fix em vez de recomeçar. O implementador termina com uma seção
  `## Decisions`, para que uma escolha proposital não volte como blocker.
- **Ninguém escolhe agente no feeling.** O `orq-pick` decide com base em dados: o que cada agente entregou no
  histórico, quantos tokens gastou, quanto tempo levou, a quota atual e um rodízio para nenhum agente ficar com todo o
  trabalho.
- **A máquina não cai.** Cada agente roda com seu próprio limite de memória; os testes esperam numa fila.

## Agentes suportados

| Agente | CLI | Papéis possíveis | Observações |
|---|---|---|---|
| Claude Code | `claude` | conductor, implement, review | várias contas (`claude-accounts`); Claude como conductor |
| Codex | `codex` | conductor, implement, review | sandbox sem rede: o orq roda o `git fetch` antes de uma execução de escrita (`network = false`); cota lida dos arquivos de sessão (inclusive a janela de 30 dias do plano free) |
| OpenCode | `opencode` | conductor, implement, review | qualquer provider (ex.: MiniMax); na MiniMax, cota pela API do Token Plan com a sua chave |
| Antigravity | `agy` | review (implement com allowlist) | em modo headless nega comandos fora da allowlist: faz a review lendo o diff anexado; não consegue commitar, então o orq commita as execuções de escrita dele (`commit = false`) |
| GitHub Copilot | `copilot` | segunda opinião | cota pequena em alguns planos: uso ocasional |

Você declara só os que tem, e os papéis que cada um pode assumir.

## Instalação

Linux, macOS ou Windows (nativo, não só WSL), em qualquer shell — bash, zsh, fish, PowerShell, cmd.
**Requisitos:** Node 22+ com `npm`, `git`, e pelo menos um agente da tabela acima, logado. Opcional:
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
mapa `ORQ.md` e o playbook do `/issue` no formato do conductor. Partes avulsas: `orq setup --install` (sem
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

Precisa de `git`, `jq`, Node 22+ com `npm`, `python3` (3.11+ para config em TOML; mais antigo → config em JSON ou
`pip install --user tomli`) e `systemd` de usuário (WSL2: Ubuntu 22.04+ com systemd habilitado). O `install.sh`
confere os requisitos (tabela do que foi encontrado e do que falta), compila o CLI `orq` (`src/` → `dist/`) e depois
cria **symlinks** (nunca copia) dos scripts em `~/.local/bin`, do `setup/herdr.service` em `~/.config/systemd/user/`
(e habilita o serviço), e de cada skill em `~/.claude/skills/` e em cada pasta de conta listada em
`~/.config/claude-accounts`. É idempotente: rode de novo depois de um `git pull` ou de uma conta nova. Nunca
sobrescreve um arquivo de verdade (avisa e pula) e nunca escreve a sua config.

| Flag | O que faz |
|---|---|
| `--dry-run` | mostra o que faria, sem mudar nada |
| `--uninstall` | remove só os links que ele cria, e só os que apontam para este repo, e desativa os timers de usuário do orq no systemd (`systemctl --user disable --now`); config e histórico ficam |

## Configuração

Duas camadas, para separar **o seu jeito de trabalhar** do **projeto do time**:

| Arquivo | De quem | O que guarda |
|---|---|---|
| `~/.config/orq/config.toml` | seu, fica na sua máquina | agentes, contas, modelos por papel e nível, pesos do pick, limites de memória |
| `<workspace>/.orq/workspace.toml` | do time, versionado | Plane (projetos, padrão de issue), repos, branch base, verificação, testes, dependências |

O mais específico ganha, chave por chave. JSON também funciona (`config.json`). Para ver o resultado mesclado:
`orq config` (tudo), `orq config get policy.weights`, `orq config files`.

### Exemplo: config pessoal
Exemplo completo e comentado: [`examples/irythill/config.toml`](examples/irythill/config.toml). O essencial:

```toml
[agents.codex]
vendor = "openai"
roles  = ["impl", "fix", "review"]
quota  = ["codex"]                       # name in agent-quota's output
[agents.codex.models.impl]
simple = "gpt-6-sol@low"                 # model@effort, per issue level
medium = ["gpt-6-sol@medium", "gpt-6-luna@medium"]  # several: each (agent, model) pair is scored on its own history
heavy  = "gpt-6.1-sol@high"
[agents.codex.models.review]
simple  = "gpt-6-sol@low"                # reviews scale with the issue too
default = "gpt-6-sol@medium"
heavy   = "gpt-6-sol@high"

[agents.opencode]
vendor = "minimax"
roles  = ["review"]                      # here it only reviews; for someone else it may implement
[agents.opencode.models.review]
default = "minimax/MiniMax-M3"

[agents.revtool]                          # a review tool, not a chat: no prompt, no session
vendor  = "minimax"                      # the vendor of the model it runs, for the cross-vendor rule
roles   = ["review"]
run     = "revtool --markdown -b {base}"  # {base} = orq agent -b; it reads the diff itself
write   = false
ok_exit = [0, 1]                         # exit 1 = findings, still a verdict
no_review = "Nothing to review"          # matched on the answer's first line (or a short answer): not a verdict, status=fail
# commit = false                         # can't git commit: orq commits a write run's changes
# network = false                        # no network: orq fetches origin before a write run
# base_commit = false                    # can't review `-b <sha>` (default for a tool): pick skips it on a round delta, agent falls back to the branch base
# filter = "jq -r '...'"                 # optional: its output → [blocker]/[suggestion] lines

[conductor]
handoff_at = 85                          # % da janela → o orq handoff move o conductor para outra conta
max_per_account = 2                      # conta que já tem esse tanto de conductors nunca é alvo do handoff
reset_grace_min = 15                     # toda janela acima do gatilho renova dentro desses minutos → pula a mudança

[git]
issue_pattern = "(?<![a-z0-9])(?<issue>[a-z][a-z0-9]*-\\d+)(?![a-z0-9])"   # Nome de branch/worktree → ID da issue, para `orq gc` e `orq ci` — padrão mostrado; regex, grupo nomeado `issue` (senão o grupo 1)

[policy]
quota_week = 95                          # ≥ 95% of the week → agent out
quota_5h = { simple = 90, medium = 85, heavy = 80 }  # same for the 5h window, by task level
pacing_penalty = 0.3                     # score penalty when usage at the current pace would pass the pick limit (5h by level, week: quota_week) by the reset (0 = off)
# [conductor] headroom = 25             # pontos reservados para o conductor ativo: filhos param em limite − 25
[policy.weights]
quality  = 0.40                          # did it deliver? (impl: approved on the first review)
tokens   = 0.45                          # did it spend little?
speed    = 0.15
rotation = 0.20                          # penalty for having been picked recently
```

### Como o `orq pick` escolhe
1. **Filtros:** só agentes com aquele papel cuja CLI está no PATH, abaixo do limite de quota, não bloqueados
   (`orq block`) e, para reviews, de um vendor diferente do implementador (e, para o delta de uma rodada, capazes de
   revisar um commit: `base_commit`). Com várias contas, prefere uma cujo ritmo fique dentro do limite e, como
   desempate, a menos usada.
2. **Pontuação:** `quality × delivery + tokens × economy + speed × quickness − rotation × recent picks`. Os números vêm
   do histórico (`orq stats`); um agente com poucas execuções usa o `prior` da config e ganha um bônus de exploração.
3. **Agentes reservados** (`reserve = true`, ou o conductor ativo por padrão) recebem uma penalidade na pontuação para preservar cota para a orquestração.

```bash
orq pick review --impl-agent codex --explain     # every candidate's score and who was left out, and why
orq stats --days 30                              # scoreboard per agent and model: delivery, approval, time (to the first turn), tokens
orq block antigravity --days 3                   # out of the picks (e.g. weekly quota gone, no collector for it)
orq pick fix --same .orquestra/<ID>/impl-<repo>.pick   # a fix round: the implementer's agent/model/account, effort +1
```

### Idioma e tema
O orq fala inglês e português: mensagens da CLI, `orq board`, avisos e `install.sh`. Ele segue `[ui] lang` na sua
config (`"auto"` = idioma do sistema, `"en"`, `"pt"`) ou a variável de ambiente `ORQ_LANG`. Para trocar a qualquer
momento:
- `orq lang pt` / `orq lang en` / `orq lang toggle` (`orq lang` sozinho mostra o atual);
- a tecla `l` dentro do `orq board`;
- no herdr, uma tecla para isso: veja [Com o herdr](#com-o-herdr).

O `orq board` tem visual próprio, inspirado no portfólio [SYNTH.DECK](https://github.com/irythill/synth-deck-portfolio):
`[ui] theme = "gunmetal"` (padrão, grafite escuro), `"chrome"` (prata claro), `"lcd"` (verde fósforo) ou `"terminal"`
(as cores do seu terminal). A tecla `t` dentro do painel alterna entre eles (`ORQ_THEME` tem prioridade).

O que já está rodando continua no idioma em que começou. Os conductors sempre falam com você no seu idioma.

## Uso diário

Abra o conductor em qualquer terminal, na pasta do seu workspace (a que o `orq setup` preparou):
```bash
cd ~/Code/<workspace> && orq conductor [agente] [conta|-] [modelo]   # qualquer terminal: carrega as instruções do conductor, o ORQ.md do workspace e a skill /issue
```
Escolha o conductor com `orq setup --workspace <pasta> --conductor codex` e rode `orq conductor` nessa pasta.
`orq conductor codex - <modelo>` troca o agente só nessa sessão; `-r <id>` a retoma. Claude Code também é um
conductor testado; a sintaxe antiga `orq conductor <conta Claude> <modelo>` continua funcionando. Se uma conta e um
agente têm o mesmo nome, use `--agent <nome>` para selecionar o agente explicitamente. O wrapper `herdr-conductor` continua abrindo Claude.

`ORQ.md` guarda o mapa do workspace. O setup preserva um `CLAUDE.md` existente e copia seu conteúdo para `ORQ.md`
na migração; se ele não existe, cria um `CLAUDE.md` apontando para o mapa. `AGENTS.md` aponta para o mapa e contém o
playbook gerado, preservando o texto fora do bloco gerado. Depois da migração, edite `ORQ.md`. Sem comandos em segundo
plano, o conductor usa `orq wait` em primeiro plano. `orq handoff` continua transferindo apenas contas Claude.

Os padrões ficam em `[roles.conductor]` (`agent`, `account`, `model`). Os templates interativos são separados dos
templates dos filhos, mantendo MCPs e os pedidos normais de permissão. Sobrescreva um agente embutido ou adicione outra CLI:

```toml
[agents.codex.conductor]
run = "codex [-m {model}] -C {dir} {prompt_text}"
resume = "codex resume {session} [-m {model}] -C {dir} {prompt_text}"
models = { fast = "id-do-seu-modelo" }
accounts = { work = { CODEX_HOME = "/caminho/codex-work" } }

[conductor]
headroom = 25 # pontos percentuais reservados para o agente que estiver conduzindo
```

Os templates aceitam `{dir}`, `{instructions}` (caminho do arquivo), `{prompt_text}` (prompt para ler as instruções),
`{model}`, `{account}`, `{session}` e `{name}`. Contas e `env` são mapas de variáveis de ambiente. O conductor exporta
`ORQ_CONDUCTOR_AGENT`, então o `orq pick` aplica a penalidade de reserva e `[conductor].headroom` ao agente em uso,
inclusive após uma troca só nessa sessão. Valores explícitos de `agents.<nome>.reserve` e `headroom` têm precedência.

Com vários conductors, dê a cada um um nome fixo (`export ORQ_CONDUCTOR_ID=<nome>`; no herdr, vale o label do
workspace) para o `orq claim` distingui-los: a sessão do Claude se chama `conductor-<workspace>:<nome>`, e o
`orq claim -l` termina cada linha com esse `session=`, para os conductors conseguirem se falar.
Variantes:
- **herdr:** rode `herdr` (o servidor roda como serviço) e, num pane, o mesmo `orq conductor` (o `herdr-conductor` continua funcionando).
- **tmux:** rode `orq conductor` num pane; os filhos abrem como janelas do tmux.
- **Nenhum dos dois:** os filhos rodam em segundo plano e o conductor espera com `orq wait`.

No conductor: **`/issue DEMO-123`**. Ele responde numa linha e segue sozinho a cada sinal de conclusão
(`[HERDR-AGENT DONE]` num pane do herdr; fora dele, a linha `[ORQ AGENT DONE]` impressa pelo `orq wait`). Você só volta
quando ele pede uma decisão ou avisa que terminou.

Para ver tudo de uma vez, deixe o **`orq board`** aberto numa aba ou janela (qualquer terminal, qualquer SO; o
`herdr-board` o chama): fila de testes, agentes rodando (modelo, memória contra o limite, última ação), conductors e
suas issues, memória, quota, CI/CD de cada issue reivindicada, bloqueios e o placar de 7 dias. `--once` imprime uma
vez, `--json` para scripts.
Uma falha (testes vermelhos, agente `status=fail`, CI vermelho) também é **barulhenta**: além da linha digitada no pane
do conductor (entregue pelo orq com novas tentativas e log, `orq notice`), você recebe um título `✗` no pane do
conductor (herdr) e, no Linux, uma notificação de desktop (`[ui] desktop_notify = false` desliga essa; precisa do
`notify-send`). Sucessos ficam quietos. A linha vermelha no topo do board lista as falhas da última hora cujo aviso não
foi entregue ou que o conductor ainda não tratou (some quando ele roda `orq wait`, `orq verify` ou `orq agent` para a
issue).
O `orq quota --line` imprime a cota numa linha para qualquer barra de status. O `orq ci` mostra os checks do PR de cada
issue reivindicada (na fila, rodando, passou, falhou ou nenhum, lido via `gh` na hora — é uma consulta que o usuário
pediu agora, então, diferente da coluna de CI do board, não lê só o cache); uma falha também avisa o conductor dono num
aviso só por commit. Depois dos merges, o `orq gc` lista e remove as worktrees de issues que ficaram para trás.

Várias issues ao mesmo tempo: um conductor por issue (de preferência em contas diferentes). O `orq claim`
(`herdr-claim`) impede que dois conductors peguem a mesma issue.

## Com o herdr

O herdr é opcional, mas é com ele que o orq fica mais redondo: filhos em abas próprias, avisos digitados no pane do
conductor e alguns extras:
- `orq conductor` (ou `herdr-conductor`) num pane do herdr também dá o nome "conductor" ao pane.
- `ui.toast.delivery = "system"` na config do herdr faz cada etapa concluída gerar uma notificação nativa do sistema;
  falhas também geram uma notificação do herdr com som, e um CI que fica verde ou vermelho também gera uma.
- O `orq quota --line` cabe na barra de abas do herdr (uma entrada `command` no `tab_bar_right`,
  [docs/pt-BR/herdr.md](docs/pt-BR/herdr.md#cota-na-barra-de-abas)).
- Uma tecla para o idioma: o `install.sh` liga o plugin `orq` do herdr; associe a ação `orq.lang-toggle` (trecho pronto
  em `herdr-plugin/herdr-plugin.toml`) — por exemplo, `prefix+shift+l` — e a `orq.board` para abrir o painel por cima.

Dia a dia, atalhos e várias issues ao mesmo tempo: [docs/pt-BR/herdr.md](docs/pt-BR/herdr.md).

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
| `orq agent -a <agent> ...` (`herdr-agent`) | Roda um agente com limite de memória numa aba do herdr, numa janela do tmux ou em segundo plano; `-r` só leitura, `-R <id>` continua a sessão, `-i` anexa um arquivo, `-b <base>` anexa o diff, `-T` a tela do próprio agente (herdr ou tmux; `-R` com ela aberta digita o follow-up nela; a tela que terminou fecha após `[machine] tui_idle_close_min` minutos sem follow-up, padrão 30, `0` = nunca) |
| `orq instructions claude\|agents` | Escreve o playbook do `/issue` como `SKILL.md` (Claude Code) ou dentro do `AGENTS.md` (Codex, OpenCode…) |
| `orq notice [--list] [-n N]` | O log de entrega dos avisos aos conductors: cada tentativa, nova tentativa e falha (`<state>/notices.jsonl`) |
| `orq wait <prefixo>...` | Bloqueia até esses agentes terminarem; imprime `status=` e o arquivo da resposta (qualquer conductor, qualquer terminal) |
| `orq verify ...` (`herdr-verify`) | Testes relacionados ao diff, em fila e com limite de memória; falhas que também falham na base contam como pré-existentes |
| `orq board` (`herdr-board`) | Painel ao vivo: fila, agentes, conductors, cota, bloqueios, placar |
| `orq conductor [agente] [conta|-] [modelo] [-r <id>]` (`herdr-conductor`) | Abre o conductor configurado no terminal atual com as instruções, conta e modelo; `-r` retoma uma sessão |
| `orq claim` (`herdr-claim`) | Dono de cada issue entre os conductors |
| `orq deps` (`herdr-deps`) | Liga as dependências do worktree às do repo principal (sem reinstalar) |
| `orq baseline ...` (`herdr-baseline`) | Snapshot manual dos testes que falham na base (fora do fluxo) |
| `orq gc [-w <workspace>] [--yes] [--days N] [--json]` | Lista worktrees de issues que podem ser removidas (PR mergeado, ou conteúdo já na base, inclusive squash merge); `--yes` as remove. Nunca mexe em trabalho não commitado, commit fora do remote, claim ativo ou agente rodando. `orq-gc.timer` diário opcional |
| `orq ci [-w <workspace>] [--json]` | Status de CI/CD de cada issue reivindicada com PR: na fila, rodando, passou, falhou ou nenhum, coletado na hora via `gh` (o cache que ele preenche é o que a coluna de CI do `orq board` lê, sem nunca travar na rede). Quando vira verde ou vermelho sai uma notificação do herdr, e uma falha também avisa o conductor dono |
| `orq rounds <ID> [-w <workspace>] [--json] [--diagnose]` | Watchdog: `--diagnose` (só warn/stop) pede a um agente barato, somente leitura e de outro fornecedor (papel de pick `watchdog`, cai para `opinion`, depois `review`) o diagnóstico de por que as rodadas não convergem → `.orquestra/<ID>/diagnosis-<n>.md`, consultivo; `orq agent -R -F` além de `max_rounds` exige (`-F -F` ignora). Sem ele, sem LLM: rodadas de fix vs `policy.max_rounds`, tempo por rodada, achados do revisor repetidos entre rodadas, alerta ok / warn / stop. O board marca cada issue (`r2/2 ⚠`) |
| `orq quota --line` | Uma linha de cota para barra de status (`work 64 · home 94! · codex 81`), do cache do board, nunca da rede |
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
- [CONTRIBUTING.md](CONTRIBUTING.md) — branches, títulos de PR, como sai uma versão (em inglês)
- `examples/` — configurações reais para copiar

## Licença

[MIT](LICENSE)
