[English](../herdr.md) · **Português**

# Usando o herdr no dia a dia

**Conceitos (3 níveis, de fora para dentro):**
- **Space** (= workspace do herdr): uma linha na barra lateral. Um por conductor (`acme-1`, `acme-2`…) e um por grupo
  de repos (`api`, `web`…), este último criado automaticamente pelo `herdr-agent` quando o primeiro filho do grupo
  começa.
- **Aba** dentro de um space: cada filho ganha uma, com título `<ID> impl <repo>`, `<ID> review <repo>`… As abas de
  filhos que terminaram fecham sozinhas (`HERDR_CLOSE_DELAY`, 20 s; `HERDR_KEEP_TAB=1` mantém abertas).
- **Pane** dentro de uma aba: o terminal. O conductor é um Claude num pane.

O **servidor** do herdr está sempre rodando (o serviço `herdr`); abrir e fechar a janela não para nada. `herdr` abre a
janela, `prefix d` fecha (o prefix na config de exemplo: `Ctrl+Space`).

**1. Começando o dia (um conductor)**
```bash
herdr                                        # opens the window (the server is already running)
```
Dentro do herdr:
1. Crie o space do conductor: `prefix Shift+C`, depois `prefix Shift+R` e dê um nome (ex.: `acme-1`).
2. No pane dele: `agent-quota` para ver qual conta tem folga, depois
   `cd ~/Code/acme-platform && herdr-conductor work opus` (conta e modelo).
3. Na primeira vez numa conta, o Claude pergunta se você confia na pasta → *Yes*.
4. Mande `/issue DEMO-123`. O conductor reivindica a issue, cria o worktree, despacha o filho e para (uma linha de
   resposta).
5. Acompanhe: o filho aparece no space do grupo (ex.: `api`) — `Alt+↓` até ele, `Alt+←/→` entre abas, `Alt+↑` para
   voltar. Não digite nas abas dos filhos (headless, só saída). Quando um filho termina, `[HERDR-AGENT DONE] …` chega
   ao conductor e ele segue sozinho (verify → review → comentário no Plane). Ou deixe o `herdr-board` aberto numa aba.

**2. Várias issues ao mesmo tempo (mesmo workspace)**
1. Crie outro space (`prefix Shift+C`, nome `acme-2`) e abra outro conductor ali, de preferência em **outra conta**:
   `cd ~/Code/acme-platform && herdr-conductor personal opus`.
2. Mande uma issue diferente para cada um (`/issue DEMO-123` num, `/issue DEMO-130` no outro).
3. Prefira issues em **módulos/repos diferentes**: a fila de testes e o lock de dependências evitam conflitos, mas duas
   issues mexendo nos mesmos arquivos geram PRs conflitantes. Issues dependentes (API → front) ficam no mesmo
   conductor, em ordem.
4. Mandou para o conductor errado? Ele recusa sozinho: o `herdr-claim` registra o dono de cada issue
   (`herdr-claim -w ~/Code/acme-platform -l` lista quem está com o quê).
5. Limites da máquina: com 14 GB, 3–5 tarefas em paralelo funcionam com os limites padrão (4 GB por agente, uma suíte
   de testes por vez). Os testes de todo mundo dividem uma fila só.

**3. Uma conta acabou no meio de uma issue**
1. Space novo, `herdr-conductor <another-account> opus`.
2. Mande: "assuma a issue DEMO-123 (`herdr-claim -f`), estado em `.orquestra/DEMO-123/`".
3. Feche o space do conductor antigo (`prefix Shift+K`). Um filho Claude só retoma (`-R`) na mesma conta; em outra,
   despache um novo.

**Atalhos** (`prefix ?` mostra todos):
| Ação | Tecla |
|---|---|
| Sair sem parar nada / voltar | `prefix d` / `herdr` |
| Novo space · renomear · fechar | `prefix Shift+C` · `prefix Shift+R` · `prefix Shift+K` |
| Space anterior/próximo · lista · busca | `Alt+↑/↓` · `prefix w` · `prefix g` |
| Aba anterior/próxima · aba N · fechar aba | `Alt+←/→` · `Alt+1..9` · `prefix k` |
| Pane vizinho · zoom · rolar/copiar | `Ctrl+Alt+arrows` · `prefix z` · `prefix [` |

**Etiqueta com o conductor (ele relê a conversa inteira a cada mensagem e aviso):**
- **Só despacho:** `/issue X`, "abre o PR", "status?", "pode fechar". Discussões de arquitetura/infraestrutura ficam
  numa sessão normal do Claude; a decisão vai para a issue no Plane e só então `/issue`.
- **Silêncio = rodando.** Para conferir na mão: `.orquestra/<ID>/<prefix>.done` existe → terminou (resposta em
  `.out.md`); espiar: `herdr pane read $(cat .orquestra/<ID>/<prefix>.pane) --source recent`.
- **Um lote por sessão:** depois de um conjunto de issues relacionadas → `/clear` (o estado fica no Plane e em
  `.orquestra/`).

## Pop-up nativo quando algo termina
O herdr manda avisos para o serviço de notificações do sistema (Linux: o do desktop; Windows: toast; macOS: Central de
Notificações) quando o `~/.config/herdr/config.toml` tem:
```toml
[ui.toast]
delivery = "system"     # off | herdr (inside herdr) | terminal | system
```
Depois: `herdr server reload-config`. Os avisos do orq (`herdr-notify`) aparecem como "✓ <ID> <step> <repo>" ou
"✗ ..." com o arquivo de resposta no corpo. No WSL, o pop-up depende de o herdr conseguir chegar ao Windows; se nada
aparecer, use `delivery = "herdr"` (aviso dentro da janela do herdr).
