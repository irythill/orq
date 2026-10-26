# Changelog

O que mudou no orq, do mais novo para o mais antigo. As datas são de quando entrou na `main`. Formato inspirado no
[Keep a Changelog](https://keepachangelog.com/pt-BR/); as versões seguem o `package.json`.
English: [CHANGELOG.md](CHANGELOG.md).

## [Não lançado]
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
- CI no Linux, macOS e Windows (Node 20 e 24).
- Roadmap v2 em [docs/pt-BR/portability.md](docs/pt-BR/portability.md).

## [0.1.0] — 2026-10-12

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
