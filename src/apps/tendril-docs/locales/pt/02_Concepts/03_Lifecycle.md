---
title: Ciclo de Vida e Jobs
description: Um job é uma execução de um promptware. Isto é o que acontece
  enquanto ele é executado — status, saída, verificações e custo.
icon: RefreshCw
searchHints:
  - job
  - ciclo de vida
  - status
  - verificação
  - worktree
  - simultaneidade
  - custo
  - tokens
  - fila
  - parar tudo
---

# Ciclo de Vida e Jobs

Toda vez que o Tendril faz algo em seu nome, ele cria um **job**: uma execução de um único
[agente de fluxo de trabalho (promptware)](02_Promptwares.md) contra um [plano](01_Plans.md). Os jobs são como um plano
avança em seu ciclo de vida, e são o que você observa em tempo real no aplicativo para desktop e na CLI.

## Status dos jobs

| Status        | Significado                                                                |
| ------------- | -------------------------------------------------------------------------- |
| **Pending**   | Criado, ainda não admitido na fila.                                        |
| **Queued**    | Aguardando um slot de simultaneidade disponível.                           |
| **Running**   | O processo do agente de codificação está em execução ativa.                |
| **Completed** | Concluído com sucesso e passou por todos os gates obrigatórios.            |
| **Failed**    | O agente encontrou um erro ou as verificações obrigatórias falharam.       |
| **Timeout**   | Excedeu o limite de tempo de execução configurado e foi finalizado.        |
| **Stopped**   | Interrompido por ação do usuário.                                          |
| **Blocked**   | Não pode prosseguir — aguardando um job dependente, credencial ou decisão. |

## O loop de execução

1. **Fila** — o job é criado e enfileirado atrás das tarefas em execução no momento.
2. **Preparação** — para promptwares que modificam código ([ExecutePlan](02_Promptwares.md),
   [RetryPlan](02_Promptwares.md)), o Tendril provisiona uma
   [Git worktree](https://git-scm.com/docs/git-worktree) isolada por repositório sob a pasta
   `Worktrees/{repo-name}/` do plano. A execução nunca toca ou bloqueia o seu checkout de trabalho principal.
3. **Implementação** — o agente de fluxo de trabalho avança pelas fases do plano, realizando commits incrementais.
4. **Verificação** — cada gate de verificação configurado é executado na worktree e registra seu resultado.
5. **Relatório** — logs de saída, custos de tokens e o estado atualizado do plano são salvos no disco e reportados para o
   daemon.

Parar um job retorna o plano ao estado em que se encontrava antes do início do job, preservando o
estado da worktree para que você possa inspecionar o progresso parcial. Consulte [Planos](01_Plans.md) para a tabela de estados completa.

## Verificações

Uma verificação é um gate de qualidade automatizado registrado em `plan.yaml`. Cada checagem produz um resultado —
`Pass`, `Fail` ou `Skipped` — juntamente com um relatório detalhado na pasta `Verification/` do plano.
Quais checagens são executadas depende de quais arquivos o plano modifica:

| Verificação     | Checagens                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------ |
| **NpmBuild**    | O workspace pnpm / npm compila sem erros.                                                  |
| **NpmLint**     | Linting e formatação passam nos pacotes TypeScript / JavaScript.                           |
| **NpmTest**     | Suítes de testes automatizados passam (Vitest, Jest, etc.).                                |
| **RustBuild**   | Pacotes Cargo compilam sem erros de compilador.                                            |
| **RustClippy**  | Linter Clippy não reporta warnings ou erros.                                               |
| **RustFormat**  | `cargo fmt --check` reporta formatação consistente.                                        |
| **RustTest**    | Suítes de testes unitários e de integração em Rust passam.                                 |
| **Screenshots** | Evidências visuais foram capturadas para modificações de UI.                               |
| **CheckResult** | Confirmação de ponta a ponta do próprio agente de que os critérios do plano são atendidos. |

Uma verificação que não se aplica a um plano é marcada como `Skipped` em vez de ser omitida silenciosamente,
garantindo uma trilha de auditoria explícita. Um plano atinge **Review** apenas quando suas verificações obrigatórias passam.
Se uma verificação falhar, o plano entra em **Failed**, e o
[RetryPlan](02_Promptwares.md) pode fazer uma nova passagem com a saída exata do erro
e o diff atual como contexto.

> [!TIP]
> Quando uma verificação falhar, inspecione o relatório em `Verification/` e teste o comando diretamente na
> worktree do plano. A checagem geralmente está correta e a worktree pode estar apenas sem uma dependência
> ou artefato de compilação — consulte [Integrando uma Base de Código](../01_GettingStarted/03_Onboarding.md).

## Simultaneidade e worktrees

Múltiplos jobs podem ser executados simultaneamente, governados por `maxConcurrentJobs` em
[~/.tendril/config.yaml](../03_Configuration/01_Setup.md) (padrão `20`):

```yaml
maxConcurrentJobs: 4
```

Como cada plano em execução opera dentro de [git worktrees](https://git-scm.com/docs/git-worktree) dedicadas,
jobs paralelos no mesmo repositório não colidem. No entanto, execuções paralelas compartilham sua CPU, memória e
limites de taxa de API dos agentes de codificação, portanto, ajuste `maxConcurrentJobs` de acordo com sua estação de trabalho.

## Rastreamento de custos

Cada execução registra os tokens gastos e os custos estimados em dólares. O log de auditoria durável é o
`costs.csv` do plano, anexado com uma linha por execução:

```csv
Promptware,Tokens,Cost,Model,CostSource,Agent
ExecutePlan,148213,1.9042,claude-opus-5,api,claude
```

Quando um agente roda em uma assinatura sem medição (ou modelo local como o Apple Foundation Models), o
campo `Cost` permanece vazio em vez de registrar zero, preservando as métricas de tokens sem inventar
valores em dólares.

## Gerenciando e inspecionando jobs

O aplicativo desktop exibe o status dos jobs em tempo real e o streaming da saída do terminal através do
stream WebSocket do daemon. A CLI oferece total paridade:

```bash
# List all active and recent jobs
tendril job list

# Filter jobs by status
tendril job list --status Running
tendril job list --status Failed

# Inspect dispatch queue order and available slots
tendril job queue

# Promote a queued or blocked job to run immediately
tendril job force-start <job-id>

# Cancel a running job
tendril job cancel <job-id> -m "Stopping for review"

# Halt every running, queued, and blocked job
tendril job stop-all

# Clean up completed or failed jobs from the database
tendril job clear --completed
tendril job clear --failed
```

Logs completos e transcrições de cada execução são permanentemente armazenados em disco em
`$TENDRIL_HOME/Jobs/{jobId}-{planId}-{promptware}/`, incluindo o prompt de sistema original, rastreamentos de
execução de ferramentas e transcrições do agente.

## Próximos passos

- [Planos](01_Plans.md) — os estados entre os quais os jobs movimentam um plano.
- [Promptwares](02_Promptwares.md) — o que realmente é executado dentro de um job.
- [Solução de Problemas](../01_GettingStarted/06_Troubleshooting.md) — diagnosticando jobs travados ou com falha.
