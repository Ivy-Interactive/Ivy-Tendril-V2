---
title: Pull Requests
description: Acompanhe e abra PRs do GitHub a partir do Tendril após o Review
  aprovar o CreatePr.
icon: GitPullRequest
searchHints:
  - pull requests
  - pr
  - mesclar
  - github
---

# Pull Requests

O aplicativo Pull Requests oferece rastreamento entre projetos para todos os pull requests do [GitHub](https://github.com) criados a partir de planos aprovados do Tendril. Ele disponibiliza um painel centralizado para monitorar quais PRs estão abertos, mesclados ou fechados, junto com o consumo de tokens e o custo associado a cada entrega.

## Ciclo de Vida e Fluxo de Trabalho do PR

1. **Aprovação** — Assim que um plano conclui a execução e é aprovado no [Review](02_Review.md), clicar em **Create Pull Request** executa o promptware `CreatePr` (consulte [Promptwares](../02_Concepts/02_Promptwares.md)).
2. **Criação** — O Tendril usa a [GitHub CLI](https://cli.github.com) (`gh`) para enviar a branch isolada do worktree do [Git](https://git-scm.com) e abrir um pull request no [GitHub](https://github.com) com um resumo gerado por IA (consulte [Integração com o GitHub](../07_Integrations/01_Github.md)).
3. **Rastreamento** — O pull request é vinculado ao plano e rastreado nesta visualização até ser mesclado ou fechado.

## A Tabela de Pull Requests

A tabela lista todos os pull requests registrados em seus projetos:

| Coluna         | Descrição                                                  | Interação                                                                                                     |
| -------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Plan**       | `#ID` e título do plano.                                   | Clique para abrir um painel lateral de pré-visualização exibindo a especificação completa do plano.           |
| **Project**    | Badge do projeto.                                          | Exibe a cor do projeto definida em [Configuração de Projetos](../03_Configuration/02_Projects.md).            |
| **Status**     | Badge de status (`Open`, `Merged`, `Closed` ou `Unknown`). | A dica de contexto (tooltip) ao passar o mouse exibe o registro de data/hora da última verificação no GitHub. |
| **PR**         | Número do pull request no GitHub (ex.: `#84`).             | Clique para abrir o pull request no [GitHub](https://github.com) no seu navegador padrão.                     |
| **Tokens**     | Tokens cumulativos consumidos pelo plano.                  | Contagem compacta de tokens (ex.: `450K`, `1.2M`).                                                            |
| **Cost**       | Custo total em USD para todas as tarefas deste plano.      | Gasto formatado em moeda.                                                                                     |
| **Repository** | Repositório de destino no GitHub (`owner/repo`).           | Caminho completo do repositório de destino.                                                                   |
| **Branch**     | Nome da branch Git.                                        | Branch de origem no repositório.                                                                              |

## Filtragem e Sincronização

- **Filtros de Status** — Use o seletor de badges de status acima da tabela para filtrar por `Open`, `Merged`, `Closed` ou `Unknown`.
- **Busca** — Filtre linhas em tempo real por ID do plano, título, nome do projeto, repositório ou nome da branch.
- **Ressincronizar com o GitHub** — Clique no botão **Resync** para executar uma etapa de sincronização (`gh pr list`) nos repositórios configurados. O Tendril reporta quaisquer repositórios inacessíveis, não autenticados ou com limite de taxa excedido.

> [!NOTE]
> Pull requests mesclados são terminais e não são verificados novamente durante as etapas de sincronização periódica.

## Ações de Linha

Cada linha de pull request oferece quatro ações rápidas:

- **View Plan** — Navega para o espaço de trabalho com os detalhes do plano no aplicativo [Plans](03_Plans.md).
- **Follow Up** — Abre a caixa de diálogo Novo Plano pré-preenchida com as referências de repositório, projeto e branch para que você possa estruturar facilmente tarefas de acompanhamento, correções de bugs ou refinamentos em [Plans](03_Plans.md).
- **Open PR** — Abre o pull request no [GitHub](https://github.com) no seu navegador web.
- **Resync** — Atualiza o status a partir do GitHub para aquele repositório específico.
