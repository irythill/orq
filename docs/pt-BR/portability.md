# Roadmap — um orq portátil, agnóstico de agente e modular

**Status:** em andamento — passos 1 e 2 prontos (2026-10-10); plano revisado em 2026-10-26 (conductor agnóstico,
papéis modulares, setup guiado). Passos 3 (CI) e 4 (papéis modulares: `[roles]`, `orq pick`, `orq stats`) prontos em 2026-10-26; os templates de AgentDef chegam com o `orq agent` (passo 8). Passo 5 (setup guiado: `orq setup`, `suggestRoles`, presets) pronto no mesmo dia; as instruções do conductor por formato chegam com o `orq wait` (passo 8). Passo 6 (lock e claim: `orq lock`, `orq claim`, `orq deps`) pronto no mesmo dia. Passo 7 (ProcessHost: `orq run`, `mem_enforce`, `mem_max` por agente) pronto no mesmo dia — o Windows usa o vigia por enquanto. Passo 8 (`orq agent` sobre AgentDef e TerminalHost herdr/tmux/plain, `orq wait`) pronto no mesmo dia; o playbook do `/issue` roda fora do herdr e o `orq instructions` o escreve no formato de cada conductor. Passo 9 (`orq board` a partir do estado do próprio orq: agentes, fila, claims, cota, bloqueios, placar; o `herdr-board` o chama) pronto em 2026-10-27; o `-T` (a TUI do próprio agente) continua no `herdr-agent-tui`, adiado. Passo 10, primeira parte: `orq verify` e `orq baseline` (os ports que o passo 7 ainda devia; o `herdr-verify` e o `herdr-baseline` chamam eles) prontos em 2026-10-27, então o fluxo do `/issue` roda inteiro fora do herdr. O resto do passo 10 (chaveiro pelo `@napi-rs/keyring` com um CLI de reserva; o pacote `@irythill/orq` publicável; o `orq setup` fazendo a instalação — skills, workspace do conductor; `orq completion`; `install.sh` e `herdr.service` como extras opcionais do Linux) pronto no mesmo dia. Primeira publicação no npm, `@irythill/orq@0.1.0`, em 2026-10-28. O `-T` passou para o `orq agent` em 2026-10-28 (herdr ou tmux, qualquer agente com template `tui`). Ainda adiados: os extras do board que só existem no herdr.

**Objetivo:** `npm i -g @irythill/orq` (ou uma instalação única equivalente) funciona no Linux, macOS e Windows (nativo,
não só WSL), em qualquer shell (bash, zsh, fish, PowerShell, cmd), com **qualquer** agente como conductor e **quaisquer**
agentes como workers e reviewers — tudo escolhido pelo usuário. O herdr é um extra opcional, nunca um requisito.

## 1. Princípios
1. **Agnóstico de agente.** O contrato do orq é a linha de comando mais os arquivos de protocolo. Qualquer coisa que
   rode um comando no shell pode ser o conductor: Claude Code, Codex, OpenCode, Copilot, uma pessoa.
2. **O usuário decide.** Todo papel (conductor, worker principal, workers, reviewer, opinion) é definido pelo usuário,
   fixo ou `auto` dentro de uma lista escolhida por ele. O orq sugere; nunca passa por cima de uma escolha fixa.
3. **Agentes são módulos.** Adicionar um agente é escrever uma definição no config, não mudar código.
4. **Adaptar ao ambiente.** Shell, terminal/multiplexador, SO e keyring são detectados; cada um tem um fallback simples.
5. **Tudo é ajustável.** Limites de memória, de quota, pesos — os padrões são sugestões, o usuário ajusta.

## 2. Onde o orq está preso hoje

| Peça | Amarra | Usado por |
|---|---|---|
| Limite de memória por agente / suíte de testes | `systemd-run --user --scope -p MemoryMax=` (cgroups v2) | herdr-agent, herdr-verify, herdr-baseline |
| Listar agentes rodando e sua memória | `systemctl --user list-units 'herdr-agent-*'`, `MemoryCurrent` | herdr-board |
| Fila de testes (uma suíte por vez) | `flock` + quem espera via `/proc/locks` | herdr-verify, herdr-baseline, herdr-deps, herdr-claim, herdr-board |
| Info de processos | `/proc/<pid>/cmdline`, `/proc/meminfo`, `pgrep`, `ps -o` | herdr-board, herdr-agent |
| Rodar em segundo plano | `setsid` | herdr-agent, herdr-board |
| Servidor sempre ligado | `herdr.service` (unit de usuário do systemd) | install.sh |
| Variantes GNU | `stat -c`, `date -d`, `numfmt`, `readlink -f`, `timeout` | vários |
| Painéis, abas, **avisar o conductor** | `herdr pane/tab/agent ...`, uma linha digitada no painel do conductor | herdr-agent, herdr-tab, herdr-notify, herdr-conductor, herdr-board |
| Conductor | sempre Claude Code; instruções só como `SKILL.md` / `CLAUDE.md` | skills/, templates/, new-conductor.sh |
| Agentes | cinco fixos no `herdr-agent` (`case $agent in claude) ...`) | herdr-agent, orq-pick |
| Keyring | `secret-tool` (Linux), `security` (macOS) | quota (Antigravity, Claude) |
| Linguagem | scripts bash 4+, alguns em Python | setup/ |

## 3. Arquitetura alvo

```
 conductor (qualquer agente, ou uma pessoa)
        │  comandos no shell + arquivos de protocolo (.done · .out.md · .log · .id · status=)
        ▼
 ┌──────────────────────────────── orq (uma CLI, TypeScript/Node) ────────────────────────────────┐
 │ setup · config · roles · pick · agent · wait · verify · claim · block · quota · stats · board   │
 │                                                                                                 │
 │ AgentDef     ProcessHost      TerminalHost        Notifier         QuotaSource      Lock        │
 └────┬─────────────┬────────────────┬──────────────────┬────────────────┬───────────────┬────────┘
  agentes no      cgroup · Job   auto: herdr · tmux   orq wait (padrão)  claude · codex ·  arquivo de lock
  config (5 que   Object ·       · zellij · WezTerm   · painel herdr     copilot · agy ·   + fila no
  vêm prontos)    vigia          · WT · plain         · tarefa bg Claude command · none    diretório de estado
```

### AgentDef — agentes como módulos
Cada agente é uma definição: como rodar headless, retomar uma sessão, rodar só leitura, achar o id da sessão e ler a
quota. Os cinco agentes atuais vêm como definições prontas que o usuário pode sobrescrever; novos não exigem código.

```toml
[agents.meu-agente]
vendor   = "acme"
run      = "acme exec --model {model} --prompt-file {prompt}"
resume   = "acme exec --resume {session} --prompt-file {prompt}"
readonly = "--sandbox read-only"
session  = { from_log = "session id: (\\S+)" }
quota    = { command = "acme-usage" }        # imprime "<nome> 5h=NN% week=NN%"
```

### Papéis — definidos pelo usuário
Papéis: `conductor`, `primary` (worker principal), `workers`, `reviewer`, `opinion`. Cada um é **fixo**
(`agent = ...`) ou **auto** (`pick = "auto"` dentro de `pool`). Um agente fixo sem quota ou bloqueado nunca é trocado
em silêncio: o orq vai para a lista `fallback` do papel, se houver, ou para e avisa.

```toml
[roles.conductor]
agent = "claude"
[roles.primary]
agent    = "codex"
fallback = ["claude"]
[roles.workers]
pick = "auto"
pool = ["claude", "opencode"]
[roles.reviewer]
pick = "auto"
pool = ["antigravity", "opencode", "claude"]
rule = "other-vendor"          # other-vendor | any
[roles.opinion]
agent = "copilot"
```

O formato atual `agents.<nome>.roles = [...]` continua funcionando: é lido como papéis `auto`, com todo agente que
lista o papel no pool.

### Notifier — avisar o conductor que um filho terminou
Os filhos já rodam headless; a única coisa que prendia o orq ao herdr era o aviso digitado no painel do conductor.
- **`orq wait <prefix>`** (padrão, qualquer conductor): bloqueia até o `.done` e imprime o resumo. `orq status --json`
  para conductors que preferem consultar.
- **herdr**: a linha `[ORQ AGENT DONE]` no painel do conductor, como hoje.
- **Claude Code**: rodar `orq wait` como tarefa em segundo plano, que acorda o conductor quando termina.

### Instruções do conductor — uma fonte, vários formatos
Um texto genérico de instruções (o fluxo do `/issue`, protocolo, regras). O `orq setup` escreve no formato do conductor
escolhido: `SKILL.md` + `CLAUDE.md` (Claude Code), `AGENTS.md` (Codex, OpenCode), o arquivo de instruções do Copilot.

### Shell e TerminalHost — adaptar ao ambiente do usuário
- **Shell**: o orq é um binário Node, então roda igual em todo shell (o npm cria o atalho certo por SO). Por shell:
  autocompletar (`orq completion bash|zsh|fish|pwsh`), aspas nas instruções geradas e o shell que roda as suítes no
  `orq verify` (configurável; padrão pwsh no Windows, o `$SHELL` do usuário nos outros).
- **Terminal**: `terminal = "auto"` detecta o multiplexador pelo ambiente (`HERDR_PANE_ID`, `TMUX`, `ZELLIJ`,
  `WEZTERM_PANE`, `WT_SESSION`, `KITTY_WINDOW_ID`) e abre uma aba/painel por filho onde houver suporte; senão `plain`
  (saída em `<prefix>.log`, tudo visível no `orq board`). Primeiro: herdr, tmux, plain. Os outros são adaptadores pequenos.

### ProcessHost — limite de memória, definido pelo usuário

```toml
[machine]
agent_mem_max = "4G"       # padrão para todo agente; "off" desliga
test_mem_max  = "6G"
mem_enforce   = "auto"     # auto | kernel | watchdog | off
[agents.codex]
mem_max = "6G"             # sobrescreve só para este agente
```

| SO | `auto` impõe com |
|---|---|
| Linux com systemd | `systemd-run --user --scope` (o kernel mata só aquele agente) |
| Windows | **vigia** por enquanto; um Job Object (imposto pelo kernel) exige um addon nativo — depois, se o vigia se mostrar grosseiro |
| macOS / Linux sem systemd | **vigia**: mede a árvore de processos a cada poucos segundos e mata acima do limite |

Os agentes em execução são rastreados pelo próprio orq (um arquivo de estado por execução: pid, prefix, início,
limite), não por nomes de unit do systemd. O `orq setup` sugere um limite a partir da RAM total e das tarefas em paralelo.

### QuotaSource e keyring
Fontes prontas: `claude`, `codex`, `antigravity`, `copilot`, `command`, `false`, `none` (feito no passo 2). Credenciais no
keyring do SO são lidas com `@napi-rs/keyring` (Secret Service, Keychain do macOS, Credential Manager do Windows),
substituindo `secret-tool` e `security`. Sem keyring (servidor sem interface) → arquivo de credenciais, ou `?` como hoje.
O orq nunca renova o login de um agente.

### Lock — fila de testes
Um arquivo de lock no diretório de estado do orq mais um arquivo de fila com quem espera, para o `orq board` não
depender mais de `/proc/locks`.

### Caminhos
Resolvidos em `src/paths.ts`. Linux/macOS mantêm `~/.config/orq` e `~/.local/state/orq` (ou `XDG_*`); Windows usa
`%APPDATA%\orq` e `%LOCALAPPDATA%\orq\state`.

## 4. Setup guiado — `orq setup`

Os papéis que ajustamos à mão (estudo de caso) viraram regras. Em vez de perguntar a quem está chegando "este agente
implementa ou revisa?", o setup pergunta o que a pessoa sabe responder e aplica as regras. As regras ficam em código
(`suggestRoles(agents, answers)`, com testes), não no texto de uma skill, então funcionam com qualquer conductor; o
`/orq-setup` só roda `orq setup` e explica.

**1. Detectar e testar** as CLIs de agentes instaladas (opcional, cada teste gasta alguns tokens).

**2. Perguntar o que o usuário sabe:**
- por agente: plano — gratuito · assinatura pequena (Pro, Copilot Pro) · assinatura grande (Max, planos altos) ·
  pague-por-uso; e em qual confia mais para escrever código;
- onde vai conversar com o orq (o conductor);
- quantas tarefas costuma rodar em paralelo (1–2 → prioriza qualidade; 3+ → prioriza tokens);
- quanta RAM os agentes podem usar (sugestão a partir da RAM total).

**3. Aplicar as regras:**

| Situação | Sugestão |
|---|---|
| Divide quota com o conductor | `reserve` (só quando os outros não cabem) |
| Plano pequeno ou franquia mensal | só `opinion` (tarefas pesadas, ou impl e review discordam) |
| Pague-por-uso | pool de `reviewer` (poucos tokens), não `primary` por padrão |
| Sem shell livre no modo headless (ex.: agy) | só `reviewer`, com o diff anexado |
| Maior plano fora o do conductor | `primary` |
| Fornecedor diferente do `primary` | `reviewer` (revisão cruzada) |

**4. Adaptar ao que o usuário tem:**

| O usuário tem | O orq monta |
|---|---|
| 1 agente | Ele faz tudo; a revisão roda numa sessão nova, com outro modelo ou esforço. Aviso: revisão entre fornecedores pega mais erros — considere um segundo agente. |
| 2+ contas/agentes do mesmo fornecedor | Contas separadas para conductor e workers; revisão com outro modelo; `other-vendor` desligado, com aviso. |
| 2 fornecedores | Um é `primary`, o outro `reviewer`; trocam quando a quota acaba. |
| 3+ fornecedores | Papéis `auto` com pools e rodízio (como `examples/irythill/config.toml`). |

**5. Mostrar a proposta com os motivos**, ex.: "Codex como primary (maior plano livre); Antigravity e OpenCode revisam
(outro fornecedor); Copilot só para segunda opinião (franquia mensal pequena). Quer mudar algo?" O que o usuário fixar
vira `agent = ...`; o resto fica `auto`.

**Presets** para quem pula as perguntas: `economy`, `quality`, `single-agent`.

**6. Aprender com o uso.** Os valores do setup são só os `prior`s. O `orq stats` já mede entrega, tokens e tempo por
agente; depois de N execuções o `orq status` sugere mudanças ("o OpenCode gastou 10x mais tokens implementando —
deixar só para revisão?"). O usuário aceita ou não; nada muda sozinho.

O config do mantenedor continua sendo **exemplo**, marcado como escolhas de uma pessoa.

## 5. Linguagem: TypeScript em Node
O problema é o bash (não existe no Windows nativo; ferramentas GNU vs BSD no macOS). TypeScript: a linguagem principal
do mantenedor; `npm i -g` funciona igual nos três SOs; binário único possível depois (`bun build --compile` / Node SEA).
Os scripts bash/Python restantes seguem funcionando até serem portados; os nomes antigos viram atalhos finos.

## 6. Passos (cada um é entregue sozinho; o Linux segue funcionando o tempo todo)
1. ✅ **Esqueleto:** CLI `orq` em TypeScript, i18n; `orq config`, `orq set`, `orq lang`, `orq block`.
2. ✅ **Quota:** `orq quota` com QuotaSources e `[quota]`. Remove a dependência do Omarchy.
3. ✅ **CI no Linux, macOS e Windows** para tudo que já está em TS. A portabilidade é provada daqui em diante, não no fim.
4. ✅ **Papéis e agentes modulares:** `[roles]` e AgentDef no config (formato antigo ainda lido); port do `orq-pick` com
   fixo/auto/fallback; port do `orq-stats`.
5. ✅ **Setup guiado:** `orq setup` com `suggestRoles`, presets, instruções do conductor por formato; o `/orq-setup` chama ele.
6. ✅ **Lock e claim:** lock portátil + arquivo de fila; port do `herdr-claim` e `herdr-deps`.
7. ✅ **ProcessHost:** vigia primeiro (todos os SOs), depois systemd e Job Object; `mem_enforce` e limite por agente; port
   do `herdr-verify` e `herdr-baseline` (chegou com o passo 10: `orq verify`, `orq baseline`).
8. ✅ **`orq agent` + `orq wait`:** port do `herdr-agent` sobre AgentDef, Notifier e TerminalHost (herdr, tmux, plain); as
   instruções do `/issue` usam `orq wait` fora do herdr.
9. ✅ **Board:** `orq board` a partir do estado do próprio orq, sem `/proc` nem systemd.
10. ✅ **Keyring e instalação:** `@napi-rs/keyring`; `npm i -g @irythill/orq` + `orq setup` em todos os SOs; `install.sh` e
    `herdr.service` viram extras opcionais do Linux; autocompletar por shell.

## 7. Perguntas em aberto
- herdr no macOS: o tmux existe lá, então o herdr pode funcionar como está — a verificar.
- Nome do pacote: `orq` está ocupado no npm → `@irythill/orq` (o comando continua `orq`).
- Até onde vai o aprendizado do §4.6: só sugestões (plano atual), ou um "auto-ajuste" opcional.
