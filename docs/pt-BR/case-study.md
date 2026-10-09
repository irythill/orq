[English](../case-study.md) · **Português**

# Estudo de caso: um dev, cinco agentes de código, um notebook de 14 GB

*Por [irythill](https://github.com/irythill). Números do próprio histórico `.orquestra/` do autor (setembro–outubro de
2026); empresa, repositórios e issues anonimizados.*

## Contexto

Uma empresa de saúde, um time pequeno e um ecossistema de **7 repositórios**: uma API em NestJS, um painel admin, um
site público de cadastro, peças de mobile e de CI/infraestrutura. O trabalho é acompanhado num **Plane self-hosted**. O
autor paga assinaturas mensais de **Claude Code, Codex, OpenCode (MiniMax), Antigravity e GitHub Copilot**, e queria
trabalhar em **3–5 issues ao mesmo tempo** num **notebook Linux de 14 GB** — sem ficar de babá de cada agente e sem
queimar a quota mais cara em trabalho de rotina.

A ideia desde o início: o modelo caro (Claude Opus) só **orquestra** — lê a issue, planeja, despacha, pesa os
resultados — enquanto agentes mais baratos implementam e fazem review.

## Linha do tempo

| Quando | O quê |
|---|---|
| fim de set | Testou vários orquestradores (Orca, Emdash, claude-squad, bb, agent-orchestrator, Orchestry); ficou com Agent Deck + tmux |
| 30 set | Primeira versão do playbook `/issue`: conductor + filhos headless + review cross-vendor |
| 5–6 out | Migrou para o [herdr](https://herdr.dev): uma aba por filho, sinal de conclusão digitado no pane do conductor |
| 6–8 out | Limite de memória por agente, fila de testes, comparação com a base sob demanda, painel ao vivo, vários conductors por workspace |
| 9 out | Escolha de agente baseada em dados (`orq-pick`), inglês e lançamento público |

## Resultados (60 dias, 71 issues, 284 execuções de agente)

Medianas por execução. "Tokens novos" exclui leituras de cache — é o que de fato pesa na quota de uma assinatura.

| Papel | Agente / modelo | Execuções | Entregou | Aprovado na primeira review | Minutos | Tokens novos |
|---|---|---|---|---|---|---|
| implement | Codex gpt-6-sol | 14 | 93% | **78%** | **1.5** | **33k** |
| implement | Codex gpt-6.1-sol | 28 | 100% | 71% | 3.5 | 57k |
| implement | Claude Sonnet | 4 | 100% | 2 de 2 | 4.6 | 55k |
| implement | OpenCode MiniMax | 1 | 100% | 0 de 1 | 1.0 | 313k |
| review | Codex gpt-6-sol | 9 | 100% | — | 0.6 | 26k |
| review | OpenCode MiniMax | 8 | 88% | — | 1.8 | 35k |
| review | Claude Sonnet | 69 | 97% | — | 1.8 | 49k |

O que os números disseram:
- **Codex com gpt-6-sol é o burro de carga.** A melhor aprovação na primeira review com cerca de metade dos tokens do
  modelo maior; o maior fica para issues pesadas.
- **O Claude Sonnet estava fazendo review de quase tudo** (69 reviews) — na mesma quota de que os conductors Opus
  precisam. Tirar as reviews dele foi a maior economia disponível.
- **OpenCode com MiniMax faz review bem e barato**, mas a única tentativa de implementação dele reprovou na review e
  gastou ~10× os tokens. Então, neste setup, ele só faz review. (Com o modelo padrão do provider, as reviews custam 3×
  mais.)
- Cada rodada de correção evitada economiza um ciclo inteiro de implementação → testes → review (60k–200k tokens). Esse
  é o verdadeiro fator de custo, mais do que o preço por token.

## O que quebrou, e o que aprendemos

**1. O primeiro gargalo foi a máquina, não os modelos.** Um único `jest` com 15 workers ocupava ~10 GB, e o
`systemd-oomd` matava o servidor de terminal inteiro com todos os agentes dentro. Soluções: cada agente no seu próprio
cgroup (`systemd-run --scope -p MemoryMax=4G`, para que só o culpado morra), agentes nunca rodam a suíte de testes (o
conductor roda os testes relacionados numa fila, uma suíte por vez, 6 GB), worktrees linkam o `node_modules` em vez de
instalar ~1 GB cada, e os filhos sobem sem servidores MCP (~150–200 MB cada).

**2. Um "baseline" de testes falhando virou engarrafamento.** Para separar falhas novas das antigas, toda issue era
comparada com as falhas da suíte completa na branch base. Com vários conductors fazendo merge o dia todo, a base mudava
a cada ~40 minutos, cada conductor rodava a suíte completa de novo, às vezes duas vezes, e execuções rápidas de teste
esperavam atrás delas por uma hora. Solução: comparar **sob demanda** — só quando um teste falha, rodar *esses mesmos
arquivos de teste* numa branch base atualizada. Segundos em vez de uma suíte completa, e nunca desatualizado.

**3. LLMs seguem a regra mais nova, não a melhor.** Quando o playbook dizia "use o Antigravity para poupar a quota do
Claude", os conductors passaram a mandar *toda* review para o Antigravity. Regras em prosa para escolher agentes não
se sustentam. Solução: `orq-pick`, um script simples que pontua os candidatos a partir do histórico (entrega, tokens,
velocidade), filtra por quota e papel, e faz rodízio. A skill agora proíbe escolher na mão. Reproduzindo as últimas 19
issues, o Claude teria feito 3 reviews em vez de 10.

**4. Um único bug silencioso pode se passar por três problemas de agente.** OpenCode, Antigravity e Codex
"ocasionalmente" devolviam respostas vazias em alguns diffs. A causa não era nenhum deles: o `systemd-run` (usado para
o limite de memória) **expande `${...}` nos argumentos**, então template strings de JavaScript e expressões do GitHub
Actions sumiam do prompt. O Claude só escapava porque lê o prompt pelo stdin. Uma flag (`--expand-environment=no`)
resolveu todos — depois de um diagnóstico errado ter culpado um dos agentes primeiro. Lição: quando várias ferramentas
falham do mesmo jeito, olhe para o que elas têm em comum.

**5. Agentes headless e sistemas de permissão não combinam.** O Antigravity nega, em modo headless, qualquer comando de
shell fora da allowlist — e uma única negação encerra a execução sem resposta. O agente "plan" (só leitura) do OpenCode
não consegue nem rodar `git diff`. Soluções: os reviewers recebem o diff anexado e leem arquivos com as próprias
ferramentas de arquivo; reviews só-leitura rodam num worktree descartável, onde o agente pode rodar comandos mas não
consegue mexer na branch real.

**6. Uma falha sem veredito não é uma reprovação.** No começo, uma review vazia contava como "aprovada" (uma única
quebra de linha passava na checagem), e depois um reviewer que falhou era excluído pelo resto da issue em vez de só
naquela nova tentativa. As duas coisas agora são regras explícitas.

**7. Editar um script em execução é uma armadilha.** O bash lê o script enquanto executa; editá-lo no lugar enquanto
processos na fila estão bloqueados dentro dele faz com que retomem num offset deslocado. Aconteceu duas vezes. Agora as
mudanças são desenvolvidas num worktree separado e entram substituindo os arquivos inteiros.

## Como é o dia agora

Abrir o herdr, abrir um conductor por issue (`herdr-conductor`), mandar `/issue <ID>` e deixar o `herdr-board` numa
aba. Cada etapa concluída gera uma notificação nativa. O conductor só volta para decisões: um critério de aceite
ambíguo, uma terceira rodada de correção, um PR para abrir. Toda escolha de agente é visível (`orq-pick --explain`) e
todo resultado é medido (`orq-stats`), então a configuração melhora com dados, e não com impressões.

## Próximos passos

- **Lições** por repo: quando acontece uma rodada de correção, um modelo barato extrai o que deu errado numa lista curta,
  aprovada por um humano, que o próximo implementador naquele repo lê — medido pela aprovação na primeira review antes
  e depois.
- Um `/orq-setup` guiado, um `install.sh` e config de workspace compartilhada pelo time (`.orq/workspace.toml`).
