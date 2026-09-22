---
title: Planos
description: "Planos em Rascunho (ou Bloqueados): molde o trabalho antes da
  execução (PlansApp)."
icon: Feather
searchHints:
  - rascunho
  - plano
  - ideação
  - bloqueado
  - makeplan
---

# Planos

O aplicativo Planos é o espaço de trabalho do Tendril para moldar, refinar e preparar o trabalho de engenharia antes de executar alterações de código. Trabalhar nos planos primeiro garante que os requisitos, a arquitetura e as etapas de verificação estejam claros antes de iniciar as execuções dos agentes.

## Gerenciando Rascunhos

- **Criando Planos** — Pressione `Ctrl+Alt+N` (`Cmd+Option+N` no macOS) ou clique em **+ New Plan** no cabeçalho do shell para abrir a caixa de diálogo de criação.
- **A Fila de Rascunhos** — A barra lateral lista todos os planos no status `Draft` ou `Blocked`. Os planos que estão sendo executados em tarefas de execução são mantidos fora da fila de rascunhos com segurança para evitar edições simultâneas.
- **Distintivos** — Cada rascunho exibe sua tag `#ID`, título, distintivo do projeto e distintivo do nível de complexidade (por exemplo, L1, L2, L3) estilizado com a paleta de níveis configurada no projeto.
- **Plano de Fundo do Processo** — Quando a fila está vazia, o Tendril exibe o plano de fundo interativo do ciclo de vida do processo com navegação para Planos, [Review](02_Review.md) e [Jobs](04_Jobs.md).

## Espaço de Trabalho do Plano (`PlanWorkspace`)

Selecionar um plano abre a interface rica do espaço de trabalho:

### Abas

- **Plan** — Exibe a revisão mais recente da especificação do plano em [Markdown](https://www.markdownguide.org) com listas de verificação de tarefas em tempo real, descrição do problema, abordagem proposta e critérios de verificação.
- **Details** — Metadados do plano, contexto do projeto atribuído (de [Project Setup](../03_Configuration/02_Projects.md)), carimbos de data/hora de criação/atualização e histórico de revisões.
- **Diff View** — Aparece sempre que um plano possui múltiplas revisões (`revisionCount > 1`), fornecendo comparação de diff lado a lado ou unificada entre as revisões.
- **Recommendations** — Lista [Recommendations](07_Recommendations.md) proativas geradas para este plano com controles inline de triagem para Aceitar e Recusar.
- **Git** — Aparece assim que existirem artefatos de execução. Acompanha worktrees ativos do [Git](https://git-scm.com), commits registrados, referências de PR (consulte [Pull Requests](06_PullRequests.md)) e avisa se commits não mesclados estiverem em risco, com um botão para sincronizar worktrees com remotos.

### Painéis e Chat

- **Painel de Verificações** — Acessível a partir do menu suspenso no canto superior direito, este painel exibe os portões de [Verification](../03_Configuration/01_Setup.md#verifications) configurados (`Build`, `Test`, `Lint`, etc.) com seus status de aprovação/falha em tempo real e registros de saída (logs).
- **Chat do Plano** — Painel de chat interativo incorporado (`PlanChatPanel`) para debater ideias, refinar a abordagem ou fazer perguntas ao agente sobre o plano antes de iniciar as alterações de código.

## Ações de Promptware

Consulte [Promptwares](../02_Concepts/02_Promptwares.md) para obter informações contextuais sobre como esses fluxos de trabalho são executados:

| Ação                 | Finalidade                                                                                                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ExecutePlan**      | Bloqueia a revisão mais recente do plano, cria uma ramificação de worktree isolada do [Git](https://git-scm.com) e inicia o [Coding Agent](../06_CodingAgents/_Index.md) para implementar as alterações. |
| **ExpandPlan**       | Solicita a um agente que transforme um resumo breve em um plano estruturado com etapas detalhadas, arquivos de destino e planos de teste.                                                                |
| **SplitPlan**        | Divide um plano grande ou complexo em subplanos menores e focados que podem ser executados de forma independente.                                                                                        |
| **Shelve to Icebox** | Move o plano para o [Icebox](05_Icebox.md) para organizar a fila ativa, preservando todo o contexto.                                                                                                     |
| **Delete Plan**      | Solicita confirmação para remover permanentemente a pasta e os registros do plano.                                                                                                                       |

## Arquivos em Disco e Sincronização em Tempo Real

Cada plano é sustentado por um diretório sob `$TENDRIL_HOME/plans/<planId>/`:

- `plan.yaml` — Metadados do plano em [YAML](https://yaml.org), estado, associação ao projeto e registros de verificação. Consulte [CLI Plan](../09_Advanced/01_CLI/01_Plan.md).
- `revisions/` — Arquivos markdown versionados (`001.md`, `002.md`, etc.) representando cada iteração da especificação.
- `costs.csv` — Livro-razão somente de anexação (append-only) de tokens e custos.

O Tendril usa observadores do sistema de arquivos (filesystem watchers) para detectar edições feitas em editores de texto ou IDEs externos, atualizando a interface instantaneamente sem necessidade de atualização manual.
