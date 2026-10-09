[English](../troubleshooting.md) · **Português**

# Problemas conhecidos e soluções

| Sintoma | Causa | Solução |
|---|---|---|
| O prompt chega com pedaços faltando; respostas vazias; "Invalid environment variable name evaluates to an empty string" no log | o `systemd-run` expande `${...}` nos argumentos — template strings de JS e expressões do GitHub Actions no prompt sumiam (o Claude escapava por ler o stdin) | o `herdr-agent` passa `--expand-environment=no` (systemd ≥ 254) |
| Fila de testes travada por uma hora atrás de suítes completas | o baseline era indexado pelo SHA da base: cada merge o invalidava e cada conductor rodava a suíte completa de novo, às vezes duas vezes | o `herdr-verify` confere a base **sob demanda**: só os arquivos de teste que falharam, num `origin/<base>` atualizado; o `herdr-baseline` é só manual |
| Os conductors sempre escolhem o mesmo agente | um LLM lendo regras em prosa favorece a regra mais nova e mais específica | o `orq-pick` decide com dados (entrega, tokens, velocidade, quota, rodízio); a skill proíbe escolher na mão |
| Depois de uma review que falhou, toda review seguinte vai para o mesmo agente | `--exclude-agent` "grudado" na cabeça do conductor | a skill diz que a exclusão vale só para refazer aquela review |
| A review do Antigravity termina sem saída | em modo headless o `agy` nega qualquer comando fora da própria allowlist e uma negação encerra a execução | ele só faz review, com o diff anexado (`-b`) e sem terminal; falha sem veredito → outro reviewer |
| Resposta vazia reportada como `status=ok` | a checagem só via se o arquivo não estava vazio (uma única quebra de linha passava) | resposta só com espaços em branco = `fail` |
| O MCP do Plane falha fora do terminal | chave só no `.bashrc`; um `.mcp.json` de projeto sobrescrevia | `environment.d` + só escopo de usuário |
| `project list` 404 | Plane < 1.4.0 | atualize o Plane |
| PQL retorna tudo/nada | incompatibilidade MCP × Plane CE | não use `pql`; filtre por `state` |
| Commit/PR fora das convenções do repo | o implementador não as leu | o implementador faz o commit e escreve o PR no worktree, citando `commit-conventions` e `pull_request_template.md` pelo caminho |
| O Codex escreve os arquivos mas não faz commit (`index.lock: Read-only file system`) | o Codex trata qualquer `.git` dentro de uma raiz gravável como só leitura, mesmo com `--add-dir` no `.git` | o `herdr-agent` libera o gitdir do worktree, `objects`, `refs` e `logs` como raízes separadas |
| O OpenCode termina mas o processo não sai | processos auxiliares seguram o pipe depois do `step_finish` | o `herdr-agent` nomeia o scope e um watcher o para quando o último evento é `step_finish/stop` e o log fica ocioso por 30 s |
| A review do OpenCode não consegue nem rodar `git diff` | o agente `plan` nega bash, e o headless transforma todo "ask" em negação | reviews só-leitura rodam num worktree descartável com bash liberado e edições negadas, via `OPENCODE_CONFIG_CONTENT` |
| Um agente derruba tudo (ex.: jest com 15 workers ≈ 10 GB) | um limite de workers no prompt não é garantia | cada filho no seu próprio cgroup (`systemd-run --user --scope -p MemoryMax=4G`): se estourar, só ele morre |
| O filho morre no limite de 4 GB durante tsc + jest | a suíte de testes não cabe junto com o agente | os testes saem do filho (`herdr-verify` no conductor, 6 GB, em fila); o filho roda `NODE_OPTIONS=--max-old-space-size=2048 tsc` |
| A máquina trava (I/O alto, OOM) ao criar worktrees | cada worktree instalava ~1 GB de `node_modules` | o worktree **linka** o `node_modules` do repo principal; deps desatualizadas → um install no repo principal |
| Tudo morre de uma vez sob pressão de memória | o `systemd-oomd` mata o pai de todas as sessões | filhos sem MCP, `--maxWorkers=2`, uma suíte por vez; servidor do herdr com `ManagedOOMPreference=avoid` |
| Um processo descontrolado come um núcleo por dias | um filho deixou um processo para trás depois que o worktree foi apagado | o `herdr-board` lista scopes de agentes sem `.run.sh` como "orphan?" e sinaliza agentes rodando há mais de 3 h |
| O conductor diz "rodando" quando o agente já terminou | o `pgrep -f` casa com a própria linha de comando | terminou = `<prefix>.done` existe; nunca `pgrep`/`ps` |
| O reviewer não consegue ler os critérios em `.orquestra/` | o sandbox só enxerga a pasta do `-d` | `herdr-agent -i <file>` anexa o conteúdo ao prompt; `-b <base>` anexa o diff |
| A review do Codex não consegue rodar testes (`EROFS` no cache do jest) | o sandbox só-leitura não consegue escrever nem em `/tmp` | `-a codex -r` roda `workspace-write` num **worktree descartável**, removido no fim |
| Branch desatualizada → rebase doloroso, diff enorme no lockfile, falha "da base" já corrigida | worktree criado antes de um merge na base | o implementador roda `fetch && rebase origin/<base>` antes da resposta final; o conductor confere `merge-base --is-ancestor` antes da review |
| CI vermelho descoberto tarde demais | ninguém olhou os checks | `gh pr checks` depois de cada push (passo 7 da skill) |
| Quota do Codex "no data" | o coletor falha de forma intermitente; o plano Plus não tem janela de 5h | o `agent-quota` lê a sessão mais recente do Codex quando o coletor falha e mostra `5h=-` |
| O Plane some do conductor depois de trocar de conta | `CLAUDE_CONFIG_DIR=X` lê `X/.claude.json`, sem os MCPs do `~/.claude.json` | adicione o MCP também com `CLAUDE_CONFIG_DIR=X claude mcp add-json …` |
| O aviso `[HERDR-AGENT DONE]` não aparece | conductor recém-aberto ou dentro de um diálogo | o `herdr-notify` espera o diálogo e tenta 3×; a notificação do herdr e o `.done` sempre ficam |
| Um script falha "do nada" logo depois de uma edição | o bash lê scripts incrementalmente; editar no lugar muda o que um processo na fila executa | substitua arquivos de forma atômica (escreva ao lado e `mv`); desenvolva num worktree separado |
| O aviso digitado no conductor se mistura com o seu rascunho não enviado | `herdr agent prompt` digita na caixa de entrada | antes de mandar mensagem aos conductors, confira se há rascunho ou pergunta aberta |
| O conductor "pensando" por minutos | espera bloqueante | `Esc`; as instruções proíbem esperas bloqueantes |
