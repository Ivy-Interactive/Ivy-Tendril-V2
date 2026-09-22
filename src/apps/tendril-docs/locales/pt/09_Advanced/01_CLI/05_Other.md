---
title: Outros Comandos
description: Execução de promptware, orquestração de tarefas em segundo plano,
  sessões de chat, registro de serviços em segundo plano e utilitários.
icon: Wrench
searchHints:
  - promptware
  - memória
  - ferramenta
  - tarefa
  - chat
  - serviço
  - inicialização automática
  - launchd
  - systemd
  - status
  - modelos
  - hash de senha
  - gerar certificados
  - instruções do agente
---

# Outros Comandos

Referência para execução de promptware, rastreamento de tarefas em segundo plano, sessões interativas de chat, gerenciamento de serviços em segundo plano do SO e comandos utilitários da CLI do Tendril.

## promptware

O Tendril usa [promptwares](../../02_Concepts/02_Promptwares.md) para estruturar os fluxos de trabalho de execução de agentes. Para obter detalhes sobre o contexto, consulte o [Conceito de Promptwares](../../02_Concepts/02_Promptwares.md).

#### promptware run

```terminal
>tendril promptware run <name> [args...] [options]
```

Executa um promptware diretamente na máquina host, ignorando a fila de tarefas do servidor.

| Option                 | Effect                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `--profile <profile>`  | Sobrescrever o perfil de raciocínio do agente (`deep`, `balanced`, `quick`)               |
| `--working-dir <path>` | Diretório de trabalho para o processo de execução do agente                               |
| `--value <key=value>`  | Valores adicionais de cabeçalho de firmware (repetível)                                   |
| `--plan <id>`          | ID do plano de destino ou caminho da pasta                                                |
| `--agent <provider>`   | Sobrescrever provedor de agente (`claude`, `antigravity`, `codex`, `copilot`, `opencode`) |
| `--dry-run`            | Imprimir o firmware compilado para stdout e sair sem iniciar um agente                    |

#### Memória e Ferramentas

```terminal
>tendril promptware list-memory <name>
>tendril promptware read-memory <name> [files...]
>tendril promptware write-memory <name> <filename> [--file <path>] [--stdin]
>tendril promptware delete-memory <name> <filename>
>tendril promptware write-tool <name> <tool_name> [--file <path>] [--stdin]
```

Os agentes usam esses comandos para persistir padrões aprendidos no diretório `Memory/` de um promptware e criar ferramentas personalizadas em `Tools/`.

#### Implantação e Camadas

```terminal
>tendril promptware deploy
>tendril promptware layers [name]
```

- **deploy** — compila e instala promptwares padrão em `<TendrilHome>/Promptwares/`.
- **layers** — inspeciona qual camada (padrão fornecido ou sobreposição de equipe) forneceu cada arquivo de promptware.

## job

Gerencie tarefas assíncronas de agentes em segundo plano. As tarefas são executadas por meio da fila do daemon e relatam o status em tempo real. Para inspeção visual na interface, consulte o [App Tarefas](../../04_Apps/04_Jobs.md).

#### job list

```terminal
>tendril job list
>tendril job list --status Running
>tendril job list --limit 50
>tendril job list --json
```

Lista as tarefas recentes em segundo plano do servidor daemon do Tendril.

| Option              | Effect                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `--status <status>` | Filtrar por status (`Pending`, `Queued`, `Running`, `Completed`, `Failed`, `Timeout`, `Stopped`, `Blocked`) |
| `--limit <n>`       | Número máximo de resultados (padrão: 20)                                                                    |
| `--json`            | Exibir tarefas como JSON estruturado                                                                        |

#### job start

```terminal
>tendril job start <job-type> [plan-id] [options]
```

Inicia uma tarefa assíncrona em segundo plano no daemon em execução do Tendril. Tipos de tarefa suportados: `CreatePlan`, `ExecutePlan`, `RetryPlan`, `UpdatePlan`, `ExpandPlan`, `SplitPlan`, `CreatePr`, `CreateIssue`, `SetupProject`, `AddProject`, `SyncRepo`.

| Option                    | Effect                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `--priority <number>`     | Classificação de prioridade para despacho na fila (maior executa primeiro)                  |
| `--chat-session <id>`     | Associar tarefa a uma sessão de chat (o padrão é `$TENDRIL_CHAT_SESSION_ID`)                |
| `--wait-for <job-id>`     | ID da tarefa que deve ser concluída antes que esta tarefa possa ser enfileirada (repetível) |
| `--idempotency-key <key>` | Token de idempotência: novos envios retornam a tarefa existente em vez de criar outra       |
| `--force`                 | Reenviar mesmo se um trabalho idêntico já estiver em andamento                              |
| `--description <text>`    | Descrição da tarefa (usado com `CreatePlan`)                                                |
| `--project <name>`        | Projeto de destino (usado com `CreatePlan`)                                                 |
| `--note <text>`           | Nota de execução (usado com `ExecutePlan`)                                                  |
| `--instructions <text>`   | Prompt de refinamento (usado com `UpdatePlan`)                                              |
| `--change-request <text>` | Feedback do revisor (usado com `RetryPlan`)                                                 |
| `--repo <name>`           | Repositório (usado com `CreateIssue`)                                                       |
| `--assignee <user>`       | Nome de usuário do responsável no GitHub (usado com `CreateIssue` / `CreatePr`)             |
| `--reviewer <user>`       | Nome de usuário do revisor no GitHub (usado com `CreatePr`, repetível)                      |
| `--draft`                 | Criar como um PR em rascunho (usado com `CreatePr`)                                         |

```terminal
>tendril job start ExecutePlan 00042
>tendril job start RetryPlan 00042 --change-request "Fix failing unit tests"
>tendril job start CreatePlan --description "Add dark mode toggle" --project MyProject
```

#### job status e fail

```terminal
>tendril job status <job-id> --message <text> [--plan-id <id>] [--plan-title <title>]
>tendril job fail <job-id> --message <text>
```

Relata telemetria de progresso ou falha da tarefa diretamente ao daemon. Usado internamente por scripts de promptware durante a execução.

#### job cancel e delete

```terminal
>tendril job cancel <job-id> [--message <reason>]
>tendril job delete <job-id>
```

- **cancel** — sinaliza para uma tarefa em execução ser abortada.
- **delete** — remove o registro de uma tarefa do banco de dados (os arquivos de log no disco são preservados).

#### job add-log

```terminal
>tendril job add-log <job-id> <action> [--summary <text>]
```

Anexa uma entrada de narrativa `## Agent Log` diretamente no arquivo de log da tarefa em `<TendrilHome>/Jobs/`. Opera diretamente no sistema de arquivos e não requer que o daemon do servidor esteja acessível.

#### Fila e Manutenção

```terminal
>tendril job queue [--json]
>tendril job force-start <job-id>
>tendril job stop-all
>tendril job clear [--completed] [--failed] [--all] [-y/--yes]
>tendril job maintenance
```

- **queue** — imprime as tarefas pendentes na ordem de despacho
- **force-start** — ignora as restrições de simultaneidade e dependência para despachar uma tarefa imediatamente
- **stop-all** — cancela todas as tarefas ativas e enfileiradas
- **clear** — exclui em lote tarefas concluídas ou com falha
- **maintenance** — executa uma etapa de limpeza e reconciliação de tarefas imediatamente

## chat

Conduza sessões interativas de codificação com agentes a partir do seu terminal:

```terminal
>tendril chat list [--json]
>tendril chat get <session-id> [--json]
>tendril chat create [--agent <agent>] [--model <model>] [--title <title>] [--effort <level>] [--plan <folder>] [--json]
>tendril chat send <session-id> "<message>" [--agent <agent>] [--model <model>] [--effort <effort>]
>tendril chat delete <session-id>
```

`tendril chat send` conecta-se ao daemon, despacha a rodada do prompt e transmite em tempo real respostas de tokens e eventos de chamada de ferramenta diretamente para stdout.

## service

Gerencie o serviço de inicialização automática do daemon em segundo plano do Tendril em várias plataformas:

- **macOS** — registra um agente do [launchd](https://en.wikipedia.org/wiki/Launchd) em `~/Library/LaunchAgents/io.tendril.daemon.plist`
- **Linux** — registra uma unidade de serviço de usuário do [systemd](https://systemd.io)
- **Windows** — registra uma tarefa agendada no [Agendador de Tarefas](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-start-page)

```terminal
>tendril service install [--no-start] [--force]
>tendril service status [--json]
>tendril service uninstall [--purge-binaries] [--force]
```

- **install** — registra o executável em execução como o serviço em segundo plano. Use `--no-start` para registrar para o próximo login sem iniciar imediatamente.
- **status** — relata se o serviço está registrado, carregado e atendendo (incluindo URL e PID).
- **uninstall** — desregistra a configuração de inicialização automática. Use `--purge-binaries` para remover sidecars instalados em `<home>/bin`.

## Utilitários

#### models

```terminal
>tendril models
>tendril models --refresh
```

Lista modelos de LLM suportados, afiliações de provedores, limites de janela de contexto e preços em tempo real. Use `--refresh` para buscar tarifas atualizadas do registro de modelos.

#### generate-certs

```terminal
>tendril generate-certs <output-directory>
```

Gera um par PEM autoassinado `localhost.crt` e `localhost.key` para fornecer HTTPS com `tendril serve --tls-cert <path> --tls-key <path>`.

#### hash-password

```terminal
>tendril hash-password <password> [secret]
```

Gera o hash de uma senha com [Argon2](https://en.wikipedia.org/wiki/Argon2) para uso na seção `auth:` do arquivo `config.yaml`. Imprime a string de hash codificada e o segredo pepper.

#### project-analyzer

```terminal
>tendril project-analyzer <folder-path>
```

Inspeciona um diretório e imprime uma análise resumida da stack em YAML identificando runtimes de linguagem, gerenciadores de pacotes e frameworks de teste.

#### agent-instructions

```terminal
>tendril agent-instructions
```

Compila e imprime o template completo de prompt do sistema do agente com caminhos de instalação substituídos, formatado para ser redirecionado para o prompt de um agente autônomo.

#### wireframe

```terminal
>tendril wireframe setup [path] [--tailwind superset|jit] [--force] [--quiet]
>tendril wireframe serve [path] [--port <port>] [--host <host>] [--no-open]
>tendril wireframe screenshot [path] [--out <path>] [--width <w>] [--height <h>]
>tendril wireframe agent-readme [path]
```

Gera estrutura inicial (scaffold), serve, visualiza com hot reload e captura telas de wireframes em React projetados durante a criação de planos.
