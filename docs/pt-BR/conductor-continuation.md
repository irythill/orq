[English](../conductor-continuation.md) · **Português**

# Continuação do conductor

Depois de despachar um filho, o conductor precisa saber quando ele termina. Conseguir iniciar um processo em background
não basta: a conversa só continua sozinha se o harness abrir um novo turno quando esse processo acaba. O orq escolhe a
estratégia de espera pelas capacidades do harness do conductor, nunca pelo nome do agente ou pelo terminal.

| Estratégia | Quando | Pode encerrar o turno? |
| --- | --- | --- |
| background task | `background` e `resume_on_completion` (embutido: Claude Code) | Sim, depois de rodar `orq wait --any` como tarefa em background |
| foreground loop | `foreground_wait` (padrão para todos os outros harnesses) | Não: `orq wait --any --timeout <s>` em loop até o trabalho acabar |
| manual | nenhuma das anteriores | Só avisando o usuário que não vai continuar e como retomá-lo |

No herdr a linha de conclusão é digitada no painel do conductor, o que funciona como despertar em qualquer estratégia.

Regras do foreground loop: exit 124 = nada terminou ainda (status de uma linha, esperar de novo, nunca despachar o mesmo
filho de novo); exit 0/1 é uma linha de conclusão para agir. Se a ferramenta de shell devolver o id de uma sessão em
execução em vez do exit code (o Codex faz isso em comandos longos), continue consultando essa mesma sessão em vez de
abrir outro `orq wait`. O loop em foreground não revive uma conversa cujo turno já terminou.

Veja o que vale com `orq instructions strategy [--conductor <agente>] [--json]`. Sobrescreva os valores embutidos por
agente, só com capacidades verificadas naquele harness:

```toml
[agents.codex.conductor.capabilities]
background = true            # inicia processos destacados...
resume_on_completion = false # ...mas não é acordado quando terminam → foreground loop
foreground_wait = true
foreground_timeout = 240     # chamada de ferramenta em foreground mais longa, em segundos
```

Depois de mudar capacidades ou atualizar o orq, regere as instruções com
`orq setup --workspace <pasta> --conductor <agente>`.
