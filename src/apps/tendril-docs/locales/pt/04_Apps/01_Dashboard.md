---
title: Painel de Controle
description: "Visão inicial: contagem de planos, gastos e tokens, e atividade
  recente entre projetos."
icon: ChartBar
searchHints:
  - painel de controle
  - estatísticas
  - visão geral
  - gráficos
  - custo
---

# Painel de Controle

O Painel de Controle é a visão geral operacional primária do Tendril, fornecendo visibilidade em tempo real do pipeline de desenvolvimento, gastos com agentes, velocidade de entrega e trabalhos ativos em todos os projetos.

## Cabeçalho e Visão Geral do Pipeline

A parte superior do Painel de Controle exibe a data atual, uma saudação baseada na hora e o **Visualizador de Processos** (`TendrilProcessViewer`):

- **Rascunhos** — Total de planos atualmente no estado `Draft` aguardando refinamento ou execução.
- **Trabalhos em Andamento** — Contagem em tempo real de trabalhos de agentes ativos categorizados pela fase de promptware (**Creating**, **Updating**, **Executing**, **Retrying** e **Creating PR**).
- **Revisão** — Planos com execuções finalizadas aguardando triagem e aprovação do desenvolvedor.
- **Concluídos e Falhos** — Contagem cumulativa de trabalhos finalizados.

Clicar em qualquer estágio no Visualizador de Processos navega diretamente para essa visualização ([Planos](03_Plans.md), [Trabalhos](04_Jobs.md) ou [Revisão](02_Review.md)). A ação **+ New Plan** também pode ser acessada diretamente pelo visualizador.

## Indicadores-Chave de Desempenho (KPIs)

Quatro cartões principais de KPI resumem a velocidade e a eficiência de custos:

| Métrica                 | Significado                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| **Recursos Entregues**  | Número total de planos concluídos e pull requests mesclados entregues em todos os projetos.  |
| **Custo Médio/Recurso** | Gasto médio em dólares necessário para entregar um recurso concluído.                        |
| **Previsão deste Mês**  | Despesa mensal projetada calculada a partir da taxa de consumo dos últimos 30 dias.          |
| **Custo Médio/Plano**   | Custo médio entre todos os planos executados, considerando tokens de entrada, saída e cache. |

### Painéis Laterais de Detalhamento

Clicar em qualquer cartão de KPI abre lateralmente um **Painel de Detalhamento** aprofundado (`BladeContainer`):

- **Detalhamento por Projeto e Agente** — Veja quais projetos ou agentes de codificação são responsáveis pela maior parcela de consumo de tokens e custos.
- **Tabela de Detalhamento do Plano** — Tabela detalhada de auditoria por plano listando o título do plano, duração da execução, contagens de tokens (entrada, saída, leitura de cache, raciocínio) e custo total.
- **Navegação Direta** — Clique em qualquer plano no painel de detalhamento para abrir sua especificação completa.

## Tendência Diária de 28 Dias

O cartão de **Tendência Diária** plota a atividade diária de execução e o gasto de tokens ao longo de uma janela de 28 dias:

- **Gráfico de Barras** — Totais diários de custo e atividade.
- **Média Móvel de 7 Dias** — Curva de média móvel sobreposta ao gráfico para suavizar a variação do dia a dia e destacar a trajetória de entrega.

## Pull Requests

O cartão de **Pull Requests** fornece:

- **Cadência Semanal de PRs** — Gráfico de barras plotando pull requests mesclados ao longo de uma janela contínua de 6 semanas.
- **Mesclagens Recentes** — Lista rápida de pull requests recentemente mesclados do [GitHub](https://github.com) com selos de projetos e links para abri-los em [Pull Requests](06_PullRequests.md).

## Trabalhos Ativos

O cartão de **Trabalhos Ativos** exibe até oito trabalhos de agentes atualmente em execução em tempo real:

- **Status em Tempo Real** — Exibe o selo de status (`Running`, `Pending` ou `Blocked`).
- **Plano Alvo e Promptware** — Identifica o título do plano ou o tipo específico de [Promptware](../02_Concepts/02_Promptwares.md) (`CreatePlan`, `ExecutePlan`, `UpdatePlan`, etc.).
- **Inspeção Direta** — Clicar em qualquer trabalho abre seu terminal de saída em tempo real no aplicativo [Trabalhos](04_Jobs.md).

## Contabilidade de Custos e Tokens

Cada execução de promptware anexa uma linha (append-only) ao arquivo durável `costs.csv` do plano, localizado em `$TENDRIL_HOME/plans/<planId>/costs.csv`.

O Tendril reconcilia esses registros CSV em seu banco de dados [SQLite](https://www.sqlite.org) para calcular custos usando especificações de preços em tempo real do [models.dev](https://models.dev) (por exemplo, tokens de prompt, tokens de conclusão, leituras/gravações de cache de prompt e tokens de raciocínio). Todos os gráficos refletem esses números reconciliados com as cores de projeto configuradas em [Configuração do Projeto](../03_Configuration/02_Projects.md).
