# Changelog

O que mudou no orq, do mais novo para o mais antigo. As datas são de quando entrou na `main`. Formato inspirado no
[Keep a Changelog](https://keepachangelog.com/pt-BR/); as versões seguem o `package.json`.
English: [CHANGELOG.md](CHANGELOG.md).

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
