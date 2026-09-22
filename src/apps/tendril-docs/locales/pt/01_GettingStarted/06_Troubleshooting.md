---
title: Solução de Problemas
description: Sintomas comuns e como corrigi-los. Se ainda estiver com problemas,
  execute `tendril doctor` e entre em contato no Discord.
icon: Wrench
searchHints:
  - solução de problemas
  - erro
  - problema
  - sintoma
  - depuração
  - diagnosticar
  - worktree obsoleta
  - banco de dados
  - doctor
  - db
---

# Solução de Problemas

Diagnostique e resolva problemas comuns de configuração, agentes, planos e banco de dados.

## Instalação e ambiente

| Sintoma                                     | Correção                                                                                                                                                                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TENDRIL_HOME` não encontrado               | Defina a variável de ambiente e reinicie seu terminal, ou escreva o caminho em `~/.tendril_location`. Sem nenhum dos dois, o Tendril usa por padrão `~/.tendril`.                                                                      |
| `config.yaml` não encontrado                | O arquivo deve existir em `$TENDRIL_HOME/config.yaml` e ter exatamente esse nome — não `tendril-config.yaml`. O comando `tendril doctor` informa o caminho esperado.                                                                   |
| `gh` não autenticado                        | Execute a autenticação da [GitHub CLI](https://cli.github.com/): `gh auth login`, depois `gh auth status` para confirmar.                                                                                                              |
| `git` não encontrado                        | Instale o [Git](https://git-scm.com/) e verifique se ele está no seu `PATH`.                                                                                                                                                           |
| `tendril` não reconhecido após a compilação | `cargo build --release` deixa o binário em `target/release/tendril`. Adicione esse caminho ao `PATH` ou execute `cargo install --path src/crates/tendril-cli`.                                                                         |
| O aplicativo inicia, mas nada carrega       | O aplicativo desktop supervisiona o daemon `tendril run`; se os binários sidecar estiverem ausentes de um build empacotado, não haverá daemon para comunicação. Veja [Instalação](02_Installation.md) para as etapas de empacotamento. |

## Planos

| Sintoma                                                 | Correção                                                                                                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plano travado em `Draft`                                | Verifique se um repositório está vinculado com `tendril plan get <id>` e certifique-se de que a definição do projeto existe em `config.yaml`.                                         |
| A pasta do plano parece incompleta ou falha ao carregar | Execute `tendril plan validate <id>` para inspecionar problemas — `plan.yaml` inválido, `Revisions/` ausente, título vazio ou versões de esquema incompatíveis.                       |
| Plano em um esquema desatualizado                       | Execute `tendril plan doctor --fix` para migrar pastas de planos para o esquema atual. Para remover estruturas vazias e órfãs de planos, execute `tendril plan doctor --prune-husks`. |
| Plano não tem repositórios configurados                 | Execute `tendril plan add-repo <id> <path>`.                                                                                                                                          |
| Worktree obsoleta após uma execução com falha           | Execute `tendril plan cleanup <id>` para remover worktrees de planos concluídos. Para planos não terminais, passe `--force`: `tendril plan cleanup <id> --force`.                     |

## Execução e agentes

| Sintoma                                  | Correção                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agente não acessível                     | Verifique `codingAgent` em `config.yaml` e execute a CLI do agente diretamente em um shell limpo. O Tendril o executa como um processo filho; se `claude`, `codex`, `copilot`, `gemini`, `opencode`, `antigravity` ou `cursor` não puderem rodar sem supervisão, as tarefas em segundo plano irão travar. Para `apple`, verifique `fm available` e garanta que `fm serve` esteja ativo. |
| A execução falha imediatamente           | Leia o log da tarefa em `$TENDRIL_HOME/Jobs/{jobId}-{planId}-{promptware}/`. Causas comuns incluem contexto de repositório ausente ou concessões de ferramentas ausentes em [Promptwares](../02_Concepts/02_Promptwares.md).                                                                                                                                                            |
| As verificações continuam falhando       | Execute o comando de verificação manualmente dentro da worktree isolada do plano (`$TENDRIL_HOME/Plans/{id}-{name}/Worktrees/{repo}`). O comando geralmente está correto e a worktree precisa apenas de uma etapa de configuração — veja [Integrando uma Base de Código](03_Onboarding.md).                                                                                             |
| A tarefa nunca inicia                    | Execute `tendril job queue` para inspecionar a ordem de envio e os limites de simultaneidade (`maxConcurrentJobs` em `config.yaml`). Promova uma tarefa na fila ou bloqueada com `tendril job force-start <id>`, ou interrompa tarefas travadas com `tendril job stop-all`. Veja [Ciclo de Vida e Tarefas](../02_Concepts/03_Lifecycle.md).                                             |
| A entrada por voz diz estar indisponível | No macOS, conceda permissões de microfone em Ajustes do Sistema → Privacidade e Segurança → Microfone, e reinicie o aplicativo desktop.                                                                                                                                                                                                                                                 |

## Banco de dados

O Tendril gerencia seu banco de dados [SQLite](https://www.sqlite.org) em `$TENDRIL_HOME/tendril.db`. Embora as migrações
sejam executadas automaticamente na inicialização do daemon, o Tendril disponibiliza comandos dedicados de banco de dados:

```bash
# Check current database schema version
tendril db version

# Apply any pending migrations
tendril db migrate

# Verify database integrity
tendril db integrity

# Reclaim unused disk space
tendril db vacuum

# Reset database (prompted confirmation)
tendril db reset
```

| Sintoma                                    | Correção                                                                                                                                                                                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Em dúvida se o banco de dados está íntegro | Execute `tendril doctor` (verifica a conectividade) ou `tendril db integrity` para checar a consistência interna do SQLite.                                                                                                                         |
| Banco de dados bloqueado                   | Outro processo possui um bloqueio exclusivo. Apenas um daemon deve rodar por vez; feche o aplicativo desktop antes de executar `tendril run` ou `tendril serve` manualmente.                                                                        |
| Banco de dados corrompido                  | Pare o aplicativo e o daemon, depois execute `tendril db reset` (ou exclua `$TENDRIL_HOME/tendril.db` junto com os arquivos `-wal` e `-shm`). Os arquivos markdown dos planos no disco em `$TENDRIL_HOME/Plans/` permanecem completamente intactos. |

> [!TIP]
> Ao solicitar assistência no [Discord](https://discord.gg/FHgxkDga3y) ou GitHub, anexe os logs de diagnóstico
> completos usando `tendril report-bug <plan-id>` — veja [Obtendo Ajuda](05_GettingHelp.md).
