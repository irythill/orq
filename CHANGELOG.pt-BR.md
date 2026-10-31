# Changelog

O que mudou no orq, do mais novo para o mais antigo. As datas são de quando entrou na `main`. Formato inspirado no
[Keep a Changelog](https://keepachangelog.com/pt-BR/); as versões seguem o `package.json`.
English: [CHANGELOG.md](CHANGELOG.md).

## [Não lançado]
### Alterado
- Limites do `orq pick`: 95% da semana (`policy.quota_week`) e, na janela de 5h, 90/85/80% para tarefas
  simple/medium/heavy (`policy.quota_5h`), em todos os agentes. Um agente nunca revisa nem opina sobre o próprio código,
  sempre que houver outro agente declarado para o papel. `policy.quota_limit` limita a cota de 5h do pick e define o `!` do `orq quota --line`.
  **Migração:** `quota_limit` também limitava a janela semanal antes; agora só limita a de 5h, então configs que o
  baixaram para manter as contas longe do limite semanal devem definir `policy.quota_week` explicitamente.
- Os horários de renovação do `orq quota` ("renova 14:30") saíram de logo depois de cada janela e foram para o fim da
  linha, assim `<nome> 5h=NN% week=NN%` continua intacto e fácil de grepar.

### Adicionado
- `orq ci [-w <workspace>]... [--json]`: sinal de CI/CD por issue reivindicada com PR — na fila, rodando, passou,
  falhou ou nenhum, a partir dos checks que o `gh pr view` lê na branch que o worktree da issue carrega, coletado
  na hora (é o usuário pedindo agora). Em cache no diretório de estado como a cota; o `orq board` lê esse mesmo
  cache numa coluna de CI nova e nunca trava na rede. Quando um deles vira passou ou falhou sai uma notificação do
  herdr, e uma falha também manda uma linha pro conductor dono (`notify()`, ou uma linha no stdout para um
  conductor que não é herdr), uma vez por commit — um commit seguinte que continua vermelho avisa de novo.
- As linhas de cota trazem o horário de renovação de cada janela (epoch em segundos) quando a fonte fornece um
  (Claude, Codex, Antigravity, MiniMax, a renovação mensal do Copilot), nos campos `reset5h=`/`resetweek=`; linhas
  antigas em cache (e qualquer coisa sem eles) continuam lendo normalmente. O `orq quota` mostra isso como horário
  humano ("renova 14:30", ou dia da semana + horário quando não é hoje). O `orq pick --explain` e sua mensagem de
  exit 3 dizem quando um agente sem cota volta.
- `orq handoff`: quando a conta Claude de um conductor chega a `conductor.handoff_at` (padrão 85% na janela de 5h, ou
  o limite semanal), abre um space novo no herdr numa conta com folga, move as issues e os avisos dos filhos para lá
  e manda o novo conductor retomar. Os alvos se espalham entre as contas em vez de sempre preencher a de menor uso:
  conta os conductors vivos por conta primeiro e escolhe a com menos deles (depois o menor uso), pulando qualquer
  conta em `conductor.max_per_account` (padrão 2). Uma mudança é pulada quando toda janela acima de `conductor.handoff_at`
  (5h e/ou semanal) renova dentro de `conductor.reset_grace_min` (padrão 15) minutos, a menos que a leitura de cota esteja ilegível.
  Salva um trecho recente do pane antigo como contexto não confiável
  para o novo conductor; uma falha de leitura não interrompe a transferência. Registra
  conductors sem issue que estejam trabalhando em PR/merge. `setup/orq-handoff.timer` roda a cada 5 minutos.
- `orq agent -R` aplica `policy.max_rounds`: conta os follow-ups por sessão (qualquer que seja o nome do prefixo) e
  recusa o próximo com exit 4; `-F` libera com o OK do usuário. O `/issue` fixa os nomes `fix-<n>` / `review-<repo>-<n>`
  e limita a validação visual (screenshots) a uma tentativa barata.
- O `orq claim` grava o nome de cada conductor (o label do workspace no herdr, senão `ORQ_CONDUCTOR_ID`), mostra no
  `-l`, e `orq claim --from <nome> [-f]` encontra (e assume) as issues de um conductor por qualquer parte desse nome. O
  `/issue` usa isso quando o usuário cita outro conductor e retoma a partir de `.orquestra/<ID>/` em vez de recomeçar.

### Corrigido
- Trocar a conta de um agente não mostra mais a cota ou o bloqueio da antiga. O cache de "última leitura" da cota
  passou a ser ligado ao login (Antigravity), e o `orq block` grava para qual login foi feito: quando o agente ou a
  conta do Claude entra em outra, o bloqueio some sozinho (claude, codex, antigravity, copilot, opencode).

## [0.3.0] — 2026-10-29
### Adicionado
- `orq agent -T` (e `herdr-agent -T`): a tela do próprio agente em TypeScript, numa aba do herdr **ou numa janela do
  tmux** (antes era o bash `herdr-agent-tui`, só herdr). Claude, Codex e OpenCode; qualquer agente via `tui` /
  `tui_resume` / `turn_hook` em `[agents.<nome>]`. Cada fim de turno roda `orq agent --turn`, que escreve
  `.out.md`/`.id`/`.done` e avisa; o `orq wait` funciona como nas execuções headless. O `-R` digita o follow-up na tela
  aberta (colagem entre colchetes no tmux, então prompts de várias linhas chegam inteiros) ou, com ela fechada, reabre
  a sessão. `machine.tui = true` ou `HERDR_AGENT_TUI=1` tornam o modo tela o padrão onde ele pode rodar.
### Corrigido
- OpenCode 2.x: os servidores MCP não eram desligados nos filhos (a v2 descarta sem avisar uma entrada de MCP sem
  `type` e `command`); o plugin de fim de turno usa a API de plugins da v2.
- Uma tela fechada antes do fim do primeiro turno escreve `status=fail`, então o `orq wait` não espera para sempre;
  fechar a aba ou o servidor do tmux limpa o worktree descartável da revisão.
### Removido
- `setup/herdr-agent-tui` (o -T em bash); um link `~/.local/bin/herdr-agent-tui` velho de uma instalação anterior pode
  ser apagado.

## [0.2.0] — 2026-10-29
### Adicionado
- `orq quota --line`: uma linha para barra de status (`work 64 · home 93! · codex 81`), a janela mais apertada de cada
  fonte, `!` no limite do pick, `⊘` bloqueado. Lê o cache do board e nunca espera a rede, então uma entrada `command` do
  `tab_bar_right` do herdr pode chamá-lo a cada minuto (docs/pt-BR/herdr.md).
- Cota do OpenCode na MiniMax: janelas de 5h e semanal do Token Plan via `/v1/token_plan/remains`, com
  `$MINIMAX_API_KEY` ou a chave que o OpenCode guarda no `auth.json` (`$MINIMAX_API_HOST` para outra região). O
  `opencode` agora é `"builtin"` por padrão; sem chave da MiniMax ele mostra `-`, como antes.
- `orq gc`: lista as worktrees de issues que podem ser removidas (PR mergeado com o HEAD local, ou conteúdo já na
  base, o que pega também squash merge) e as remove com `--yes`. Nunca mexe em worktree com mudança não commitada,
  commit fora do remote, claim ativo ou agente rodando. O `/issue` usa no pós-merge no lugar do `git cherry`; o
  `install.sh` instala um `orq-gc.timer` diário opcional (não ativado).
- `/issue`: o prompt de fix pede o menor diff, nada fora dos blockers listados e um teste por blocker que falhe sem o
  fix; item que o implementador considera errado é respondido, não "corrigido".
- `/issue`: da rodada 2 em diante, o review confere os blockers anteriores e o diff do próprio fix (`round-<n>.sha`..HEAD),
  com o mesmo reviewer da rodada anterior; achado novo fora desse diff só como blocker justificado.
- `/issue`: os itens do review vêm marcados `[blocker]` ou `[suggestion]`; só um blocker com `arquivo:linha` e uma
  falha concreta abre rodada de fix, e o resto vai para o comentário no Plane.
- `/issue`: o implementador termina com uma seção `## Decisions` (escolhas, trade-offs, o que ficou de fora de
  propósito) e o reviewer a recebe; escolha documentada não vira blocker, a menos que quebre um critério ou esteja errada.
### Corrigido
- Cota do Codex no plano free: a única janela é de 30 dias, que o coletor ignorava (mostrava `-`, e o `orq pick`
  tratava um Codex com 80 % usado como ilimitado). A janela mais longa acima de 6 h agora ocupa o lugar da semana, com
  uma nota quando não é semanal.
- **As rodadas de fix mantinham a sessão do implementador, mas não o modelo.** O `/issue` retomava com
  `-a <agente> -R <sessão>` sem `-m`, e o Codex caía no modelo padrão da CLI (num workspace, 88 de 136 fixes rodaram
  num modelo diferente do da implementação, com a maior mediana de tokens novos: o cache de prompt é por modelo). Novo
  `orq pick fix --same <arquivo do pick do impl>` repete agente, modelo e conta do implementador com o esforço um nível
  acima (no máximo high); o `/issue` salva o pick do implementador em `impl-<repo>.pick` e o usa em todo fix.

## [0.1.0] — 2026-10-28 — primeiro release no npm
### Adicionado
- O orc maestro: arte ASCII com a versão e quem faz qual papel, mostrada por `orq`, `orq --version` e `orq setup`
  só num terminal de verdade (nunca quando a saída vai para outro programa); cores 24-bit ou básicas, respeita
  `NO_COLOR`. Logo em pixel-art em `docs/img/orq-logo.svg`, no topo dos READMEs.
- `[roles]` no config: `conductor`, `primary`, `workers`, `reviewer`, `opinion`, cada um **fixo** (`agent`, depois
  `fallback` em ordem, nunca trocado por um agente fora da lista) ou **auto** (`pool`, com a pontuação de antes); `rule`
  por papel. Sem `[roles]`, `agents.<nome>.roles` continua funcionando. `vendor` é opcional para os agentes embutidos.
- `orq pick` (novo papel `worker`) e `orq stats` em TypeScript; `orq-pick` e `orq-stats` agora chamam eles.
- `orq setup`: primeira configuração guiada em qualquer terminal — detecta as CLIs de agentes, pergunta plano,
  confiança, conductor, tarefas em paralelo e RAM, e sugere papéis, pesos e limites de memória com o motivo de cada um
  (`--answers` para conductors, `--preset economy|quality|single-agent`). O `/orq-setup` usa ele. Agentes sem `models`
  usam o modelo padrão da CLI.
- `orq lock`: a fila de testes sem `flock` nem `/proc/locks` — uma fila FIFO de arquivos no diretório de estado, com
  `test_slots` vagas; a entrada de um processo morto é limpa sozinha. `herdr-verify`, `herdr-baseline` e o board usam ela.
- `orq claim` (era `herdr-claim`): funciona fora do herdr também — o id do conductor é `HERDR_PANE_ID`,
  `ORQ_CONDUCTOR_ID` ou `<usuário>@<host>`; fora do herdr um dono conta como vivo por `ORQ_CLAIM_TTL_H` horas (24).
- `orq deps` (era `herdr-deps`): mesmo fluxo; no Windows o `node_modules` é ligado com junction (sem admin).
- `orq run`: roda um comando com limite de memória em qualquer SO — escopo do systemd onde houver, senão um vigia que
  mede a árvore de processos a cada segundo e a encerra acima do limite (saída 137). `machine.mem_enforce = auto |
  kernel | watchdog | off`, `agents.<nome>.mem_max` por agente, `"off"` desliga. `herdr-verify` e `herdr-baseline` usam ele.
- `orq agent` (era `herdr-agent`, que agora chama ele): roda um agente filho sem tela, com limite de memória, e escreve
  os mesmos arquivos (`.out.md`, `.log`, `.id`, `.pane`, `.done`). A saída vai para uma aba do herdr dentro do herdr,
  uma janela do tmux dentro do tmux, senão um processo em segundo plano (log no diretório de estado) — escolha com
  `machine.terminal` / `ORQ_TERMINAL`. O `-T` (a tela do próprio agente) continua no script bash, `herdr-agent-tui`,
  só no herdr.
- AgentDef: como cada agente roda é um conjunto de templates de comando em `[agents.<nome>]` (`run`, `resume`,
  `readonly`, `write`, `stdin`, `format`, `session`, `answer`, `env`); os cinco agentes vêm com padrões embutidos iguais
  ao `herdr-agent`, e qualquer outra CLI pode ser usada declarando `run` no config.
- `orq wait <prefixo>...`: bloqueia até os filhos terminarem e imprime uma linha `[ORQ AGENT DONE] <título> status=...`
  por filho (saída 0 tudo ok, 1 alguma falha, 124 tempo esgotado; `--any`, `--timeout`, `--answer`). Para conductors
  fora do herdr; dentro do herdr a linha `[HERDR-AGENT DONE]` continua chegando no pane do conductor.
- `/issue` fora do herdr: o playbook explica como rodar o fluxo em qualquer terminal — `orq agent`, `orq claim`,
  `orq deps`, e `orq wait` como tarefa em segundo plano para o sinal de término.
- `orq instructions claude|agents`: escreve o playbook do `/issue` no formato do conductor — `SKILL.md` para o Claude
  Code, um bloco marcado no `AGENTS.md` para Codex, OpenCode e outros (o resto do arquivo é mantido).
- `orq board` (o `herdr-board` agora o chama): o painel ao vivo a partir dos arquivos de estado do próprio orq —
  agentes rodando (`<state>/agents/*.json`, memória da árvore de processos contra o limite), a fila de testes
  (`orq lock`), conductors e as issues que reivindicaram, cota (em cache, coletada em segundo plano a cada 5 min),
  bloqueios ativos e o placar de 7 dias. Sem `/proc`, systemd nem jq: Linux, macOS e Windows, qualquer terminal.
  `--once`, `--json`, `--interval`; teclas `q` `r` `l` `t`; texto puro quando a saída vai para outro programa ou com
  `NO_COLOR`. Não portado: `f` (pular para um painel) e o estado ao vivo do herdr de cada painel de conductor.
- `orq verify` e `orq baseline` (eram o `herdr-verify` e o `herdr-baseline`, que agora chamam eles): os testes
  relacionados a um diff, com as falhas que também falham em `origin/<base>` contadas como pré-existentes, e o snapshot
  da base. Mesmas flags, arquivos de saída e códigos de saída; mesma fila "verify" (`orq lock`) e limite de memória de
  testes (`orq run`). Abrem numa aba do herdr, numa janela do tmux ou em segundo plano como o `orq agent`, `-x` roda em
  primeiro plano, e o `orq wait <prefixo>` espera por eles. O bin do próprio runner roda com o node quando existe (sem
  shell do `npx` no Windows); jest e vitest.
- **Instalação em qualquer SO:** `npm i -g @irythill/orq` + `orq setup`, sem clone. O `orq setup` agora mostra o que
  encontrou (git, terminal, limite de memória, chaveiro, a linha de autocompletar do shell), liga as skills em cada
  conta do Claude (uma junction no Windows, uma cópia se os links falharem; nunca por cima de uma pasta do usuário) e
  prepara o workspace do conductor (`.orquestra/`, o mapa `CLAUDE.md`, o playbook do `/issue` no formato dele).
  `--install` e `--workspace <pasta> [--conductor <agente>]` fazem essas partes sem perguntas. O pacote leva as
  skills e o template do workspace.
- `orq completion bash|zsh|fish|powershell`: imprime o script de autocompletar daquele shell (subcomandos e as
  palavras fixas de cada um; arquivos no resto).
- CI no Linux, macOS e Windows (Node 20 e 24).
- Roadmap v2 em [docs/pt-BR/portability.md](docs/pt-BR/portability.md).

### Alterado
- O chaveiro é lido pelo `@napi-rs/keyring` (Secret Service, Keychain, Credential Manager) em vez do `secret-tool` e
  do `security`; eles continuam de reserva quando o módulo nativo não carrega. `ORQ_KEYRING = native | cli | off`.
  A cota do Antigravity agora funciona no macOS e no Windows também.
- `install.sh` e `setup/herdr.service` são extras opcionais do Linux para um clone (serviço e plugin do herdr, os
  nomes antigos dos scripts); nada depende deles.
- As skills chamam `orq pick`, `orq config`, `orq block`, `orq stats`, `orq quota`, `orq lang` (presentes em toda
  instalação) em vez dos wrappers `orq-*` / `agent-quota`; o `/orq-setup` parte do `npm i -g` e do `orq setup`.

### Corrigido
- Um pid 0 (um arquivo `.pid` vazio, um campo faltando) não conta mais como processo vivo: `process.kill(0, 0)` mira o
  grupo de processos e sempre dá certo.
- `orq run` com o limite do systemd passa `--expand-environment=no` (systemd ≥ 254), como o `herdr-agent` fazia, para
  `${...}` nos argumentos sobreviver.

## 2026-10-12 — o CLI orq em TypeScript (só no git, antes do pacote npm)

### Adicionado
- **CLI `orq` em TypeScript** (Node 20+): `orq config`, `orq set`, `orq lang`, `orq block` e `orq quota`. Os nomes
  antigos (`orq-config`, `orq-set`, `orq-lang`, `orq-block`, `agent-quota`) continuam funcionando e chamam ele.
  Primeiro passo do [plano de portabilidade](docs/pt-BR/portability.md) (Linux, macOS, Windows nativo).
- **Fontes de quota na config** (`[quota]`): `"builtin"` (Claude pelo endpoint de uso do OAuth, Codex pela última
  sessão), `"none"`, `false` ou `{ command = "..." }`. Copilot listado, sem coletor.
- Skill **`/orq-status`**: resumo só-leitura no chat — fila de testes, agentes rodando, conductors, quota, bloqueios
  e placar.
- **`herdr-conductor -r <id>`** retoma uma conversa (ex.: depois de um reboot) com a mesma conta e as mesmas
  instruções.
- O `install.sh` compila o CLI (`dist.new` trocado com `mv`, então scripts rodando nunca veem um `dist/` pela metade)
  e exige Node 20+ e npm.
- `.gitattributes` mantém fim de linha LF nos scripts em qualquer SO.

### Alterado
- Painel: a quota mostra uma coluna por conta com as duas janelas (5h e, embaixo, a semana); agentes sem coletor
  numa linha só.
- `orq quota`: Antigravity tem coletor embutido (cota por modelo do Cloud Code, login lido do chaveiro do sistema no
  Linux), ligado por padrão.
- `orq quota`: Copilot tem coletor embutido (requisições premium usadas no mês, via `gh api`), ligado por padrão.

### Corrigido
- `orq quota`: quando o endpoint de uso falha ou responde HTTP 429, vale a última leitura boa, janela por janela, até
  aquela janela resetar — uma conta esgotada não vira mais `?` nem é escolhida.
- `install.sh`: a checagem da versão do Node falhava no Node 26 (booleano passado ao `process.exit`).

## 2026-10-09 — primeira versão pública

- Temas do painel: SYNTH.DECK (gunmetal padrão, chrome, lcd, terminal); `orq-set` grava um valor da config.
- orq bilíngue (inglês/português): `ui.lang`, `orq-lang`, tecla `l` no painel, docs em pt-BR.
- `install.sh` (checagem de requisitos, symlinks, serviço do herdr, skills, plugin do herdr) e a skill `/orq-setup`.
- Inglês em tudo, exemplos genéricos e o estudo de caso; licença MIT.

## Antes do repo público (30/09 → 09/10/2026)

Resumo do histórico privado, condensado no primeiro commit público:

- **A orquestração saiu do Agent Deck para o herdr** (06/10): `herdr-agent`, `herdr-verify`, `herdr-board`,
  `herdr-claim`, `herdr-deps`, `herdr-notify`, `herdr-tab`; vários conductors no mesmo workspace.
- **Agentes:** Claude headless com limite de memória por agente, Codex como implementador padrão, OpenCode como
  terceiro fornecedor, Antigravity como revisor alternativo (em sandbox), Copilot para segunda opinião.
- **Escolha:** `orq-config` (TOML/JSON em camadas), `orq-pick` (por entrega, tokens, rapidez, quota e rodízio),
  `orq-stats` (placar), `orq-block` (tira um agente/conta da escolha até uma data), quota por conta do Claude.
- **Testes:** sinal único de conclusão, fila com uma suíte por vez, verificação só do que mudou, falhas que também
  falham na base contam como pré-existentes.
