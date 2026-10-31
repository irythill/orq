[English](../case-study.md) · **Português**

# Estudo de caso: um dev, cinco agentes de código, um PC de 14 GB

*Por [irythill](https://github.com/irythill). Números do próprio histórico `.orquestra/` do autor (setembro–outubro de
2026); empresa, repositórios e issues anonimizados.*

## Contexto

Uma empresa de saúde, um time pequeno e um ecossistema de **7 repositórios**: uma API em NestJS, um painel admin, um
site público de cadastro, peças de mobile e de CI/infraestrutura. O trabalho é acompanhado num **Plane self-hosted**. O
autor paga assinaturas mensais de **Claude Code, Codex, OpenCode (MiniMax), Antigravity e GitHub Copilot**, e queria
trabalhar em **3–5 issues ao mesmo tempo** num **PC Linux de 14 GB** — sem ficar de babá de cada agente e sem
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

## Resultados (últimos 30 dias, out. de 2026, 644 execuções de agente)

Medianas por execução. "Tokens novos" exclui leituras de cache — é o que de fato pesa na quota de uma assinatura.

| Papel | Agente / modelo | Execuções | Entregou | Aprovado na primeira review | Minutos | Tokens novos |
|---|---|---|---|---|---|---|
| implement | Codex gpt-6-sol | 23 | 96% | **83%** | **1.9** | **37k** |
| implement | Codex gpt-6.1-sol | 27 | 100% | 70% | 3.6 | 61k |
| implement | Claude Sonnet | 20 | 90% | 53% | 4 | 59k |
| implement | Codex gpt-6-luna | 11 | 100% | 50% | 1.6 | 68k |
| implement | OpenCode MiniMax | 1 | 100% | 0% | 1.0 | 313k |
| fix | Codex gpt-6-luna | 95 | 99% | — | 0.9 | 138k |
| fix | Claude Sonnet | 72 | 94% | — | 3 | 58k |
| fix | Claude modelo padrão | 5 | 40% | — | 2 | 26k |
| review | Claude Sonnet | 98 | 98% | — | 1.6 | 49k |
| review | OpenCode MiniMax | 73 | 89% | — | 3 | 67k |
| review | Codex gpt-6-luna | 35 | 100% | — | 0.5 | 38k |
| review | Codex gpt-6-sol | 25 | 100% | — | 0.5 | 30k |
| review | Antigravity gemini-3.8-flash-high | 10 | 50% | — | 5.8 | 178k |

O que os números disseram:
- **Codex com gpt-6-sol continua o burro de carga** para implementar: a melhor aprovação na primeira review (83%) com
  o menor custo em tokens entre os concorrentes reais.
- **O Claude Sonnet agora carrega tanto fix (72 execuções) quanto review (98 execuções)** — o maior consumidor da
  própria quota entre todos os papéis.
- **O modelo padrão do Claude é um risco em trabalho de fix**: só 40% saiu limpo — mas em apenas 5 execuções, amostra
  pequena demais para concluir muita coisa.
- **O gemini-3.8-flash-high do Antigravity reprovou em metade das reviews** (50%, 10 execuções), com o maior custo em
  tokens (178k) e tempo (5.8 min) entre os reviewers — o mais caro e o menos confiável. O modelo Flash já foi removido
  da config desde então.
- **A única tentativa de implementação do OpenCode MiniMax continuou reprovando** (0% aprovado, 313k tokens); ficou
  só com review.
- Cada rodada de correção evitada economiza um ciclo inteiro de implementação → testes → review. Esse é o verdadeiro
  fator de custo, mais do que o preço por token.

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

**8. A janela de tempo de uma assinatura também acaba no meio do trabalho.** A janela de 5 horas de uma conta esvaziou
enquanto um conductor ainda orquestrava. Solução: handoff automático de conductor para outra conta; o primeiro handoff
real moveu dois conductors sem perder estado.

**9. Os limites de escolha precisam variar por janela e por tarefa, não ser um número só.** O `orq-pick` agora limita
o gasto a 95% do orçamento semanal, e a 90/85/80% da janela de 5 horas dependendo do peso da tarefa — tarefas mais
pesadas ganham um teto mais apertado, porque uma tarefa pesada precisa de mais margem para terminar.

**10. Saber quando a quota reseta importa tanto quanto medi-la.** Saber o horário do reset deixa um conductor escolher
entre esperar a janela ou trocar de agente, e deixa o handoff pular uma troca quando o reset está a minutos de
acontecer. Separadamente, um sinal de CI por issue deixa um conductor distinguir "ainda rodando" de "realmente falhou"
sem adivinhar pela quota.

**11. Um fix pode ser um bug em si.** Um agente "corrigiu" um achado de baixa severidade apagando a funcionalidade a
que ele pertencia; outro adicionou uma checagem de prontidão que teria travado todo handoff real. Nenhum dos dois foi
pego pelo pipeline — só por um humano ou conductor lendo o diff real do fix. Lição: um resultado de fix verde não é a
mesma coisa que um resultado bom; alguém precisa ler.

**12. "Nada para revisar" passou como review limpa.** Um reviewer que não retornou achados ficava idêntico a um
reviewer que rodou e não achou nada. O orq não tem gate para isso; nessa sessão, a checagem foi feita na mão no
script. É uma regra a seguir, não algo que o orq garanta.

**13. Um loop de fix pode sair do escopo mais rápido do que bater no limite de rodadas.** Um loop que devia fechar
um fix local virou uma discussão mais ampla que o fix nunca deveria resolver. Limites de rodada existem para parar
loops descontrolados, mas não pegaram esse caso — reconferir se o escopo ainda é o original importa mais do que
contar rodadas.

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
