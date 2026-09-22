---
title: Recomendações
description: Acompanhamentos sugeridos (refatorações, higiene, testes) inferidos
  dos seus repositórios — sem a necessidade de tickets manuais.
icon: Lightbulb
searchHints:
  - recomendações
  - sugestões
  - automático
---

# Recomendações

O aplicativo Recomendações é a central de triagem do Tendril para melhorias na base de código sugeridas por IA, adições de cobertura de testes, limpezas arquiteturais e itens de débito técnico descobertos durante a execução de planos.

## Origem e Elegibilidade

À medida que os [Coding Agents](../06_CodingAgents/_Index.md) analisam, executam e verificam planos, eles apontam melhorias relacionadas (por exemplo, casos de borda não testados, dependências obsoletas, oportunidades de refatoração ou gargalos de desempenho).

Para manter as recomendações acionáveis e evitar trabalho prematuro:

- Apenas recomendações originadas de planos **Concluídos** aparecem no aplicativo Recomendações (consulte [Plan Lifecycle](../02_Concepts/03_Lifecycle.md)).
- Recomendações originadas de planos com falha ou em execução permanecem vinculadas ao seu plano de origem até que esse plano seja bem-sucedido.

## A Fila de Recomendações

A barra lateral apresenta todas as recomendações pendentes:

- **Tag do Plano de Origem** — Exibe o número do plano de origem (por exemplo, `#14`).
- **Título** — Descrição concisa da melhoria sugerida.
- **Badge do Projeto** — Identifica qual repositório de projeto a recomendação tem como alvo (configurado em [Project Setup](../03_Configuration/02_Projects.md)).
- **Badge de Impacto** — Avaliação de urgência e valor codificada por cores:
  - `High` (verde) — Correções críticas, refatorações significativas ou lacunas essenciais de testes.
  - `Medium` (âmbar) — Limpezas, melhorias de manutenibilidade ou aprimoramentos não bloqueantes.
  - `Low` (neutro) — Ajustes menores ou melhorias cosméticas.

## Visualização Detalhada e Ações de Triagem

Selecionar uma recomendação exibe sua justificativa técnica completa, avaliação de impacto e um link para abrir o **Plano de Origem** inicial em [Plans](03_Plans.md).

Os desenvolvedores podem realizar a triagem das recomendações usando quatro ações principais:

| Ação                    | Controle                  | Efeito                                                                                                                                                                                                                                               |
| ----------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Accept**              | Botão CircleCheck         | Marca a recomendação como `Accepted` e inicia imediatamente um [Job](04_Jobs.md) de segundo plano `CreatePlan` (consulte [Promptwares](../02_Concepts/02_Promptwares.md)) para estruturar um novo rascunho de implementação em [Plans](03_Plans.md). |
| **Accept with Notes**   | Botão Check               | Abre o `RecommendationNoteDialog`, permitindo que o desenvolvedor adicione restrições ou requisitos específicos. O agente recebe tanto a recomendação original quanto as notas do operador.                                                          |
| **Decline**             | Botão X                   | Marca a recomendação como `Declined` com notas de recusa opcionais, removendo-a da fila de pendências.                                                                                                                                               |
| **Create GitHub Issue** | Botão com ícone do GitHub | Abre o `CreateIssueDialog` para registrar a recomendação diretamente como uma issue do [GitHub](https://github.com) via [GitHub CLI](https://cli.github.com) (`gh`) no repositório do projeto. Mantém a recomendação como `Pending`.                 |

Assim que uma ação é concluída, o Tendril avança automaticamente para a próxima recomendação na fila, permitindo uma revisão rápida das melhorias propostas.
