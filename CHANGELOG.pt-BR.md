# Changelog

O que mudou no orq, do mais novo para o mais antigo. As datas são de quando entrou na `main`. Formato inspirado no
[Keep a Changelog](https://keepachangelog.com/pt-BR/); as versões seguem o `package.json`.
English: [CHANGELOG.md](CHANGELOG.md).

## [Unreleased]
### Adicionado
- Capacidades `commit` e `network` por agente (`[agents.<nome>]`, padrão true). Numa execução de escrita num repo git,
  o orq faz o que o agente não consegue: `commit = false` → o orq commita as mudanças depois (mensagem de uma linha
  `Commit: ...` na resposta, senão o título) e mostra em `## Commit (by orq)`; `network = false` → o orq roda
  `git fetch origin` antes, para o agente fazer o rebase localmente. O prompt avisa, para o agente não tentar.
  Embutidos: antigravity `commit = false`, codex `network = false`.
- Capacidade `base_commit` por agente (padrão true; false para ferramenta que ignora o prompt). Uma ferramenta que faz o
  diff contra `origin/<base>` sozinha não revisa `-b <round-n.sha>`: o `orq pick review --base <ref>` a descarta quando a
  base é um commit, e o `orq agent -b <commit>` volta para a base da branch (`--base-branch <branch>`, senão `origin/HEAD`),
  avisa e acrescenta `## Review scope (by orq)` à resposta: a revisão cobre a branch inteira, não só o delta da rodada (#76).

### Alterado
- **Agora é preciso Node 22 ou mais novo** (`engines >=22`). O Node 20 chegou ao fim de vida em abril de 2026. O CI
  testa Node 22, 24 e 26.

### Corrigido
- `orq agent -T` com Codex às vezes nunca sinalizava o fim do turno (#62): um `.id` deixado no prefixo por uma execução
  anterior (outro agente ou sessão) fazia o `--turn codex` descartar todo turno real como thread paralela. Um novo
  lançamento agora o apaga (`-R` grava a sessão retomada). No herdr, um turno cujo hook ainda não dispara (tela vista
  ocupada, depois ociosa por 60 s, `.done` não reescrito) é sinalizado pelo runner como `status=fail reason=no-hook`,
  com as últimas linhas da tela como resposta.
- `policy.max_rounds` conta só rodadas de revisão: `orq agent -R --reason verify|unblock` (padrão `review`) não conta
  nem é recusado; todo follow-up vai para `.rounds-<sessão>.log` e o `orq rounds` mostra por motivo. A rodada é contada
  no launch, então um dispatch recusado depois não gasta rodada. O `/issue` nomeia correções de verify como
  `verify-fix-<n>.md` (#75).
- Uma revisão (`orq agent -r` com prefixo `review*`) que sai com 0 sem veredito ("I'll start by exploring the repo...")
  agora é `status=fail reason=no-verdict`, não `ok`. Veredito = um achado com severidade ou uma aprovação explícita
  (APPROVED, LGTM, aprovado, sem achados...). `policy.review_verdict = false` desliga. Achados escritos como linhas
  `[blocker] arquivo:linha` sem marcador de lista agora contam, também no `orq rounds` (#78).
- As revisões das rodadas de correção convergem em branches grandes: `orq agent -b <commit>` anexa só `<commit>..HEAD`
  (uma ferramenta de revisão recebe o início da rodada como `{base}`, não a branch inteira de novo); no `/issue` um achado
  fora do diff da correção nunca abre rodada, vai para uma lista de adiados (vazamento de segurança/dado pessoal para e
  pergunta ao usuário); o `orq rounds` avisa `fresh` quando duas rodadas trazem achados graves novos — divida a issue (#72).

## [0.6.1] — 2026-11-06
### Corrigido
- `orq setup --workspace` grava o `.orquestra-conductor.md` (e o pacote leva o template dele), então o `orq conductor`
  abre num workspace recém-preparado em vez de falhar com "no .orquestra-conductor.md here" (#63).
- `orq pick` mistura o prior de cada agente com a entrega/economia/rapidez medidas, `(prior·k + medido·n)/(k + n)`
  com k = `min_samples`, em vez de um prior fixo abaixo de `min_samples` execuções: um agente com poucos dados e custo
  muito maior não ganha mais em economia. O bônus `explore` diminui com n e para depois de
  `policy.weights.explore_streak` (2) escolhas seguidas; `--explain` mostra `prior→medido` por eixo (#54).

## [0.6.0] — 2026-11-05
### Adicionado
- `orq conductor [conta|-] [modelo] [-r <sessão>]` abre o conductor (Claude) em qualquer terminal e SO: acha o workspace
  (`.orquestra-conductor.md` na pasta, senão `CONDUCTOR_WS`), mapeia `sonnet|opus|haiku`, resolve a conta pelo arquivo
  `claude-accounts`, registra o conductor (dentro do herdr) e roda o `claude` com as instruções (`--append-system-prompt-file`). O `herdr-conductor` virou um wrapper fino
  dele (continua só para herdr, e renomeia o pane).

### Alterado
- A skill `/issue` e os templates do conductor usam os nomes `orq <cmd>` (`orq agent`, `orq verify`, `orq claim`,
  `orq deps`, `orq baseline`, `orq pick`, `orq conductor`) e não assumem mais o herdr; o sinal de término é
  `[HERDR-AGENT DONE]` no herdr e `orq wait` fora dele. A allowlist de permissões ganha os padrões `orq ...` e mantém os
  `herdr-*` para instalações antigas.
- README: o uso diário é `orq conductor` em qualquer terminal.
- O `orq board` dobra agentes terminados e mortos com mais de `ui.board_hide_hours` (padrão 6) numa linha de contagem; o
  `--json` mantém todos. O `orq gc` também apaga o estado velho de agentes que já não aparece no board.
- O `orq board` mostra como `idle` o agente sem CPU por `ui.board_idle_min` minutos (padrão 30).

### Corrigido
- Os avisos não vão mais para um pane fechado depois de um handoff: os redirecionamentos do `orq handoff` só são seguidos
  até um pane que o herdr ainda conhece; se o destino sumiu, o aviso fica no último pane vivo e o redirecionamento velho é
  apagado (herdr inacessível: segue o redirecionamento como antes). `orq claim --register` e um novo handoff também
  limpam redirecionamentos que sairiam de um conductor vivo ou voltariam a ele.
- Agentes `-T` que terminaram não se acumulam mais: com a tela aberta e sem follow-up por `[machine] tui_idle_close_min`
  minutos (padrão 30, `0` = nunca) depois do fim do turno, o agente é encerrado, limpo e a aba do herdr é fechada. Um
  `orq agent -T -R` depois reabre a sessão (`tui_resume`). No herdr, um turno digitado direto na tela conta como
  atividade; no tmux só o fim do turno conta. Não vale com `close_tab_after = 0`. Um agente `-T` morto de fora agora fecha
  a aba do herdr também (a janela do tmux fecha com o runner).
- Novo `examples/agy-impl.json`: allowlist padrão de implementador para o agy (git, npm, node, ... mais globs como
  `command(/usr/bin/*)` e `command(*/node_modules/.bin/*)`); aponte o template `write` para ele com `--settings <arquivo>`
  (veja `examples/irythill/config.toml`). A resposta de comandos negados, abaixo, aponta para ele.
- Execuções do Antigravity (`agy`) em que alguns comandos foram negados pela allowlist não se perdem mais: a resposta
  ganha uma seção "Denied commands" (cada comando e mensagem, e como tentar de novo ou ampliar
  `~/.config/orq/agy-impl.json`), e uma execução de escrita com mudanças no worktree fica `ok` com o diff stat anexado
  (o id da sessão é mantido, então `-R` funciona). Sem mudanças (ou só leitura) continua `fail`, agora com a lista de
  negados como resposta em vez de vazia.
- Uma execução que termina com rc=128+sinal (SIGKILL, limite de memória, ...) é `killed`, nunca `ok`, mesmo com lista
  `ok_exit` ou uma resposta antiga; o `.done` e o aviso ao conductor dizem `status=killed`.
- O `.out.md` do Antigravity numa execução negada nomeia o comando negado (o último `CommandLine`).
- O `orq agent` recusa um prefixo que ainda tem execução viva (saída 3, nada é iniciado); resultados velhos de uma
  execução morta são limpos. Um follow-up `-T -R` digitado na tela aberta da própria execução continua funcionando.
- A contenção de caminhos do `orq gc` resolve um prefixo ausente pelo ancestral real e funciona no macOS (`/var` →
  `/private/var`) e no Windows, onde ignora maiúsculas.

## [0.5.0] — 2026-11-04
### Corrigido
- Os avisos ao conductor (verify/agente terminou, CI vermelho) agora são entregues pelo próprio `orq`, destacados, e não
  falham mais em silêncio: o antigo `herdr-notify` dependia do `jq`, desistia após 3 tentativas em um minuto e imprimia os
  erros numa aba ou em `/dev/null`. Cada aviso fica registrado (`<state>/notices.jsonl`; `orq notice` mostra) com cada
  tentativa e o resultado, com novas tentativas e espera crescente (5s, 15s, 45s, 2min, 5min), espera um diálogo passar e
  envia a um conductor ocupado (a entrada dele enfileira a linha).
- `orq agent` sem `-a` (ou `$AGENT`) agora recusa em vez de iniciar o Codex: um `orq pick` sem candidato deixava
  `$(orq pick ...)` vazio, o que iniciava o Codex passando por cima de bloqueios e cota.
- `orq board` mostra o modelo de cada execução quando um prefixo é reutilizado (o arquivo de estado agora o registra), e `?`
  em vez de uma duração crescente para execução cujo runner sumiu.

### Adicionado
- Falhas são barulhentas, sem depender do conductor ler o pane: notificação do herdr com som, título `✗` no pane do
  conductor (só visual, some em 30 min ou quando reconhecido) e notificação de desktop (`notify-send`;
  `[ui] desktop_notify = true|false`, padrão true, só Linux). Sucessos ficam quietos (notificação simples do herdr).
- `orq board`: uma linha vermelha no topo lista falhas da última hora cujo aviso não foi entregue ou que o conductor
  ainda não tratou. Reconhecido = o conductor rodou `orq wait` (que imprimiu o resultado), `orq verify` ou `orq agent`
  para aquela issue depois do aviso.
- `orq block <nome> --quota`: bloqueia até a janela de cota renovar, lida do coletor, em vez de um prazo fixo.
- Watchdog camada 2: `orq rounds <ID> --diagnose` (só em warn/stop) pede a um agente barato, somente leitura e de outro
  fornecedor que o implementador, um diagnóstico de por que as rodadas não convergem, a partir das métricas, dos `fix-<n>.md`
  e das saídas das revisões, recomendando continue / split / change-implementer / ask-user. Gravado em
  `.orquestra/<ID>/diagnosis-<rodadas>.md`; o `orq rounds` mostra a linha `RECOMMENDATION`. Novo papel de pick `watchdog`
  (pool próprio ou `[roles.watchdog]`, senão o pool de `opinion`, senão o de `review`).
- `orq agent -R -F` além de `policy.max_rounds` agora recusa (saída 4) sem um diagnóstico para o número atual de rodadas, mais
  novo que o último arquivo de fix/revisão. `-F -F` ignora a checagem (decisão do próprio usuário).

## [0.4.0] — 2026-11-04
### Corrigido
- O `orq rounds` agora conta achados de review escritos com severidade em negrito no início (`**Bloqueante**`, `**Sugestão — `arquivo:7–8`:**`, PT/EN),
  e não só tags `[blocker]`, e lê caminhos em links markdown, faixas de linha com travessão e o prefixo `.worktrees/<dir>/`
  de cada rodada, para o mesmo arquivo casar entre rodadas.
- O `orq quota` não diz mais que o login do antigravity expirou após uma hora parado: o access token dura 1h e o agy
  o renova só quando roda, então com refresh token no chaveiro a nota é "token ocioso (o agy renova no próximo uso)"
  e o `orq pick` mantém a conta. "login expirado" fica para refresh token ausente ou 401 da API.

### Alterado
- `install.sh --uninstall` agora também executa `systemctl --user disable --now` nos timers do orq.
- Limites do `orq pick`: 95% da semana (`policy.quota_week`) e, na janela de 5h, 90/85/80% para tarefas
  simple/medium/heavy (`policy.quota_5h`), em todos os agentes. Um agente nunca revisa nem opina sobre o próprio código,
  sempre que houver outro agente declarado para o papel. `policy.quota_limit` limita a cota de 5h do pick e define o `!` do `orq quota --line`.
  **Migração:** `quota_limit` também limitava a janela semanal antes; agora só limita a de 5h, então configs que o
  baixaram para manter as contas longe do limite semanal devem definir `policy.quota_week` explicitamente.
- Os horários de renovação do `orq quota` ("renova 14:30") saíram de logo depois de cada janela e foram para o fim da
  linha, assim `<nome> 5h=NN% week=NN%` continua intacto e fácil de grepar.

### Adicionado
- `orq rounds <ID> [-w <workspace>] [--json]`: métricas de watchdog por issue, sem LLM, a partir dos arquivos em
  `.orquestra/<ID>/` (`fix-<n>.md`, `review-*.out.md`): rodadas de fix vs `policy.max_rounds`, tempo total e por
  rodada, achados do revisor que voltam entre rodadas (mesmo arquivo + sobreposição de palavras) e um nível de alerta
  (ok / warn / stop). O `orq board` mostra um marcador como `r2/2 ⚠` ao lado das issues de cada conductor.
- Diretriz de escopo na skill `/issue` e no template do `CLAUDE.md` do workspace: dividir issues grandes em sub-issues ou
  lotes sequenciais (um PR cada) antes de despachar, e parar e dividir quando as revisões chegarem a `policy.max_rounds`.
- Ritmo no `orq pick`: conta cujo uso, no ritmo até agora numa janela (usado ÷ fração decorrida; precisa do horário de
  renovação e de 10% da janela decorrida), projeta passar do limite de pick daquela janela na renovação perde
  `policy.pacing_penalty` (padrão 0.3, 0 = desligado) de score. Suave: os limites duros não mudam; papéis fixos não pontuam.
- `headroom = N` numa seção `[agents.<nome>]`: filhos saem das contas do agente quando o uso chega aos limites menos N
  pontos (5h e semana), deixando essa fatia para os conductors; a escolha da conta respeita isso.
- `orq pick` pula o agente cuja leitura de cota diz login expirado, com o comando de correção como motivo
  (ex.: ``antigravity: login expirado: rode `agy models` ``); o `orq quota` continua mostrando.
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
  O `orq claim -l`/`--from` e o `orq board` agora mostram o label **atual** do workspace no herdr enquanto o pane
  está vivo (ele pode ter sido renomeado depois do claim), caindo para o nome salvo na hora do claim.
- O `orq pick review|opinion` sai com exit 2 e uma mensagem clara quando mais de um agente está elegível para o
  papel (declarado, não excluído nem bloqueado, com modelo para ele; antes da checagem de quota) e nem `--impl-agent` nem `--impl-vendor` foram passados (`--no-record`/`--explain` não mudam isso): não há
  como filtrar o revisor sem essa informação.
- `agents.<nome>.no_review`: uma regex que, ao bater com a resposta de uma ferramenta de revisão (ex.: "Nada para
  revisar" do Revtool), faz aquela execução do `orq agent` terminar `status=fail` em vez de `ok` — "nada foi
  revisado" não é um veredito, então o fallback do `orq pick` e o conductor tratam como se não tivesse rodado.
- `install.sh`: `orq-gc.service`/`orq-handoff.service` agora encontram o `node` do mise e do nvm. O `PATH` das
  units já inclui o diretório de shims do mise (estável entre versões); quando o `node` resolve para um diretório
  específico de versão (o PATH do `mise activate`, ou o nvm, que não tem um diretório de shims fixo) o instalador
  escreve um drop-in com esse diretório real. Uma instalação simples, por pacote do sistema, não é afetada em
  nenhum dos dois casos.

### Corrigido
- `orq pick` com várias contas: prefere uma conta cujo ritmo não projete estouro do limite antes de desempatar pelo
  menor uso (quando `policy.pacing_penalty > 0`), e mantém as contas com login expirado e seu comando de correção na
  nota de recusa de cota quando as demais passam do limite.
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
