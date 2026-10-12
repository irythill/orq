# Plano de portabilidade — orq no Linux, macOS e Windows

**Status:** em andamento — passos 1 e 2 feitos (10/10/2026).

**Objetivo:** `npm i -g @irythill/orq` (ou uma instalação única equivalente) funciona no Linux, macOS e Windows (nativo, não
só WSL), em qualquer shell: bash, zsh, fish, PowerShell, cmd. herdr/tmux continuam sendo a **melhor** experiência,
não um requisito.

## 1. Onde o orq está preso ao Linux hoje

| Peça | Mecanismo só de Linux | Usado por |
|---|---|---|
| Teto de memória por agente / suíte de testes | `systemd-run --user --scope -p MemoryMax=` (cgroups v2) | herdr-agent, herdr-verify, herdr-baseline |
| Listar agentes rodando e a memória deles | `systemctl --user list-units 'herdr-agent-*'`, `MemoryCurrent` | herdr-board |
| Fila de testes (uma suíte por vez) | `flock` + leitura de quem espera em `/proc/locks` | herdr-verify, herdr-baseline, herdr-deps, herdr-claim, herdr-board |
| Informação de processos | `/proc/<pid>/cmdline`, `/proc/meminfo`, `pgrep`, `ps -o` | herdr-board, herdr-agent |
| Cota | Coletores do Omarchy (`/usr/share/omarchy/bin/omarchy-agent-usage-*`) | agent-quota |
| Soltar processos em segundo plano | `setsid` | herdr-agent, herdr-board |
| Servidor sempre de pé | `herdr.service` (unidade de usuário do systemd) | install.sh |
| Variantes GNU | `stat -c`, `date -d`, `numfmt`, `readlink -f`, `timeout` | vários |
| Painéis, abas, avisar o conductor | `herdr pane/tab/agent ...` | herdr-agent, herdr-tab, herdr-notify, herdr-conductor, herdr-board |
| A própria linguagem | scripts em bash 4+ | 15 scripts (em Python: orq-config, orq-block, orq-pick, orq-stats, orq_i18n.py) |

Os 4 scripts em Python (orq-config, orq-block, orq-pick, orq-stats) já são quase portáveis.

## 2. Arquitetura alvo

```
                 ┌──────────────────────── orq (um CLI só, TypeScript/Node) ────────────────────────┐
 conductor  ───► │ config · pick · block · stats · claim · quota · agent · verify · board · status  │
 (Claude Code)   │                                                                                   │
                 │  ProcessHost        TerminalHost             QuotaSource            Lock          │
                 └──────┬─────────────────┬───────────────────────┬──────────────────────┬──────────┘
                        │                 │                       │                      │
          teto de memória /       herdr (tmux) ★ melhor      claude · codex ·      arquivo de trava no
          listar / matar, por SO  plain (logs + painel)      copilot · comando ·   diretório de estado
                                  (depois: Orca, WezTerm…)   none                  do orq
```

Quatro interfaces pequenas isolam tudo o que depende do sistema. O resto do orq (escolha de agente, prompts,
fluxo de review, placar, i18n) é lógica pura e roda igual em qualquer lugar.

### ProcessHost — rodar um agente com teto de memória
| SO | Como o teto é aplicado |
|---|---|
| Linux com systemd | `systemd-run --user --scope` (como hoje: o kernel mata só aquele agente) |
| Windows | Job Object com limite de memória (mesma garantia do cgroup) |
| macOS / Linux sem systemd | **vigia**: o orq mede a memória da árvore de processos a cada poucos segundos e mata acima do teto |

Memória e lista de processos em todo SO por uma biblioteca multiplataforma (ex.: `pidusage` / `systeminformation`),
no lugar de `/proc` e `systemctl`. Os agentes rodando passam a ser registrados pelo próprio orq (um arquivo de
estado por execução: pid, prefixo, início), não por nomes de unidade do systemd.

### TerminalHost — onde a saída do agente aparece
Os filhos já rodam **sem tela** (`claude -p`, `codex exec`, `copilot -p`…), então o multiplexador de terminal só
serve para *assistir* e para *avisar o conductor*.
- **herdr** (tmux) — recomendado: uma aba por filho, saída ao vivo, a linha `[HERDR-AGENT DONE]` digitada no painel
  do conductor, modo tela (`-T`).
- **plain** — funciona em qualquer shell: a saída vai para `<prefixo>.log`; `orq board` mostra tudo num terminal só;
  o conductor sabe que um filho terminou com `orq wait <prefixo>` (espera o `.done`) em vez de um aviso digitado.
  Os arquivos de protocolo (`.done`, `status=`, o relatório do verify) continuam iguais.
- Depois, se valer a pena: Orca, WezTerm, abas do Windows Terminal — cada um é só mais um TerminalHost.

### QuotaSource — de onde vêm os números de cota
Configurável por usuário (ver §3). Fontes embutidas:
- `claude` — o uso da conta pelo endpoint de uso OAuth da Anthropic, com o login que o Claude Code já tem
  (`<pasta da conta>/.credentials.json`, ou o Keychain no macOS). Uma linha por conta do `claude-accounts`. O orq
  nunca renova o token: expirado → `?` + "abra o claude uma vez".
- `codex` — os `rate_limits` que o Codex grava nos arquivos de sessão (já é o plano B hoje).
- `antigravity` — cota por modelo do Cloud Code (`fetchAvailableModels`), com o login que o agy guarda no chaveiro
  do sistema (Linux: Secret Service via `secret-tool`; macOS/Windows: a fazer). Pior modelo por janela; nunca renova
  o login do agy: expirado → última leitura + "rode `agy models`".
- `copilot` — requisições premium usadas no mês (`gh api /copilot_internal/user`, precisa de `gh auth login`); é uma
  franquia mensal, então ocupa o lugar da semana e o 5h fica `-`.
- `command` — qualquer comando que imprima `<nome> 5h=NN% week=NN%` (cobre os coletores do Omarchy ou algo próprio).
- `false` — fica fora da lista.
- `none` — sem dados; o agente nunca é pulado por cota, use `orq block` quando acabar (MiniMax pago
  por uso hoje).

### Lock — fila de testes
Um arquivo de trava no diretório de estado do orq (no estilo `proper-lockfile`, funciona nos três SOs) mais um
arquivo de fila que registra quem espera, para o `orq board` não precisar mais de `/proc/locks`.

### Caminhos
Resolvidos num lugar só (`src/paths.ts`). Linux e macOS mantêm `~/.config/orq` e `~/.local/state/orq` (ou as
variáveis `XDG_*`), então instalações existentes continuam funcionando; o Windows usa `%APPDATA%\orq` e
`%LOCALAPPDATA%\orq\state`.

## 3. Nova configuração do usuário

```toml
[machine]
agent_mem_max = "4G"       # já existe — agora aplicado em todo SO (ver ProcessHost)
test_mem_max  = "6G"       # já existe
test_slots    = 1          # já existe
terminal      = "auto"     # NOVO: auto | herdr | plain   (auto = herdr se instalado, senão plain)

[quota]                    # NOVO: de quais agentes o orq lê a cota, e como
claude      = "builtin"
codex       = "builtin"
copilot     = "builtin"
antigravity = "builtin"
opencode    = "none"
# qualquer agente: { command = "meu-coletor" }   → imprime "<nome> 5h=NN% week=NN%"
# false = deixa de fora. O coletor do Omarchy, se preferir ele para o Codex:
# codex = { command = "/usr/share/omarchy/bin/omarchy-agent-usage-codex --limits-only --force | ..." }
```

O `/orq-setup` faz essas perguntas (ele já pergunta sobre agentes e papéis).

## 4. Linguagem: TypeScript no Node

Por que não manter bash: ele é o problema (não há bash no Windows fora do WSL/Git Bash; ferramentas GNU vs BSD no
macOS). Por que TypeScript em vez de Python: é a linguagem principal de quem mantém; `npm i -g` funciona igual
nos três SOs; dá para virar binário único depois (`bun build --compile` / Node SEA); há bibliotecas maduras para
cada interface acima. Python continua aceitável durante a migração — os quatro scripts em Python seguem
funcionando até serem portados.

## 5. Ordem da migração (cada passo sai sozinho; o Linux continua funcionando o tempo todo)

1. ✅ **Esqueleto:** CLI `orq` em TypeScript com subcomandos e i18n (`m(en, pt)`), instalado pelo `install.sh` ao lado
   dos scripts atuais. Portar os simples, já portáveis: `orq config`, `orq set`, `orq lang`, `orq block`. Os nomes
   antigos ficam como atalhos finos (`orq-config` → `orq config`) para nada quebrar.
2. ✅ **Cota:** `orq quota` com QuotaSources e a config `[quota]`. Remove a dependência do Omarchy.
3. **Pick e stats:** portar `orq-pick` e `orq-stats` (só lógica).
4. **Lock e claim:** trava portável + arquivo de fila; portar `herdr-claim`, `herdr-deps`.
5. **ProcessHost:** cgroup / Job Object / vigia; portar `herdr-verify`, `herdr-baseline`.
6. **TerminalHost + agent:** portar `herdr-agent` (o maior: 264 linhas) com os hosts `herdr` e `plain`;
   `orq wait`; atualizar a skill `/issue` para usar `orq wait` fora do herdr.
7. **Painel:** `orq board` lendo o estado do próprio orq em vez de `/proc` e systemd.
8. **Instalador:** `npm i -g @irythill/orq` + `orq setup` em todos os SOs; o `install.sh` vira só uma conveniência no Linux.
   O CI roda os testes no Linux, macOS e Windows.

## 6. Perguntas em aberto
- herdr no macOS: o tmux existe lá, então o herdr pode funcionar como está — verificar.
- Nome do pacote: `orq` já está ocupado no npm → `@irythill/orq` (o comando continua `orq`).
