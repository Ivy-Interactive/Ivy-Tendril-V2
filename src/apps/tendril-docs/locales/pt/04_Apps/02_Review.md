---
title: Revisão
description: "Fila de trabalho concluído: Planos em Revisão ou Falhos. Nada é
  mesclado sem você."
icon: ThumbsUp
searchHints:
  - revisão
  - aprovar
  - rejeitar
  - diff
  - verificar
---

# Revisão

O aplicativo Revisão é a porta de controle de qualidade do Tendril. Quando um agente conclui a execução de um plano via `ExecutePlan` (consulte [Promptwares](../02_Concepts/02_Promptwares.md)), o worktree isolado do [Git](https://git-scm.com) é preservado e apresentado aqui para inspeção, verificação e triagem pelo desenvolvedor. Nada é mesclado ou enviado para a sua branch padrão sem a aprovação explícita do operador.

## A Fila de Revisão

A barra lateral lista todos os planos que requerem a atenção do desenvolvedor (planos com status `Review` ou `Failed`):

- **Badges** — Cada linha exibe o `#ID` do plano, a badge do projeto e o status de [Verificação](../03_Configuration/01_Setup.md#verifications):
  - `Verified` (verde) — Todos os critérios de verificação obrigatórios foram aprovados.
  - `Unverified` (aviso) — Um ou mais critérios de verificação falharam, ou os critérios ainda não foram executados.
  - Indicador de estado (por exemplo, `Failed`) para identificar facilmente execuções que precisam de solução de problemas.
- **Atalhos de Teclado** — Use `ArrowLeft` e `ArrowRight` para navegar rapidamente pelos planos na fila de revisão.

## Espaço de Trabalho de Revisão

O espaço de trabalho principal apresenta a implementação do plano e ferramentas de inspeção:

- **Visão Geral do Plano & Comentários** — Leia a especificação do plano e deixe comentários em linha (`DraftComment`) para fornecer feedback específico linha por linha.
- **Barra de Ações de Revisão** — Ações de revisão configuradas no projeto (definidas em `reviewActions` em [Configuração do Projeto](../03_Configuration/02_Projects.md)) são renderizadas como botões de um clique na barra de ferramentas (por exemplo, `Run E2E`, `Smoke Test`).
- **Abrir Especificação Completa & Diff** — Acessível a partir do menu do espaço de trabalho, abre a página completa de detalhes do plano em [Planos](03_Plans.md) para inspecionar diffs de múltiplas revisões, alcançabilidade de commits do git worktree e artefatos gerados.
- **Chat do Plano Integrado** — Use o `PlanChatPanel` integrado para fazer perguntas ao agente, inspecionar a lógica de execução ou esclarecer detalhes da implementação antes de aprovar.

## Ações de Triagem

| Ação                        | Controle                           | Efeito                                                                                                                                                                                                   |
| --------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Criar Pull Request**      | CTA Principal                      | Cria um pull request no [GitHub](https://github.com) através da [GitHub CLI](https://cli.github.com) (`gh`), vincula-o ao plano em [Pull Requests](06_PullRequests.md) e marca o plano como `Completed`. |
| **Enviar para PR**          | CTA Principal (se o PR já existir) | Envia novos commits do worktree para a branch de um pull request existente.                                                                                                                              |
| **Solicitar Alterações**    | Botão de ícone (com badge)         | Abre o `SuggestChangesDialog` para enviar rascunhos de comentários e feedback, iniciando um [Job](04_Jobs.md) `UpdatePlan` no worktree existente.                                                        |
| **Aceitar Entrega Parcial** | Botão secundário                   | Abre o `PartialDeliveryDialog` para aceitar partes funcionais de um entregável enquanto mantém os itens restantes em preparação.                                                                         |
| **Redefinir para Rascunho** | Menu de opções                     | Abre o `ResetToDraftDialog` para mover o plano de volta para `Draft` em [Planos](03_Plans.md) para redefinição de escopo.                                                                                |
| **Excluir Plano**           | Menu de opções (destrutivo)        | Abre o `DeletePlanDialog` para excluir permanentemente o plano e descartar seu worktree isolado.                                                                                                         |
