---
title: Icebox
description: Planos de baixa prioridade ou "para depois" no estado Icebox para
  manter os Rascunhos focados.
icon: Snowflake
searchHints:
  - icebox
  - congelamento
  - backlog
---

# Icebox

O Icebox é o backlog e espaço de espera dedicado do Tendril para planos de engenharia futuros, adiados ou de baixa prioridade. Congelar planos mantém a fila de rascunhos de [Planos](03_Plans.md) ativa e focada nas prioridades do sprint atual, sem perder pesquisas, discussões ou especificações já elaboradas (consulte [Ciclo de Vida do Plano](../02_Concepts/03_Lifecycle.md)).

## Congelando Planos

Um plano pode ser congelado a qualquer momento enquanto estiver no estado `Draft` ou `Blocked`:

- No aplicativo de [Planos](03_Plans.md), selecione **Shelve to Icebox** no menu de ações.
- O Tendril atualiza o status do plano para `Icebox`.
- O diretório do plano em `$TENDRIL_HOME/plans/<planId>/`, suas revisões versionadas e os registros de custo permanecem totalmente preservados no disco (consulte [Gerenciamento de Planos via CLI](../09_Advanced/01_CLI/01_Plan.md)).

## Navegação e Filtragem

O aplicativo Icebox oferece busca e filtragem direcionadas em todo o seu backlog:

- **Barra de Pesquisa** — Filtre planos por palavras-chave do título ou pelo `#ID` numérico do plano.
- **Filtro de Projeto** — Restrinja os planos congelados a um projeto específico configurado em [Configuração do Projeto](../03_Configuration/02_Projects.md).
- **Filtro de Nível** — Filtre planos por nível de complexidade (ex.: L1, L2, L3 configurados em [Instalação e Configurações](../03_Configuration/01_Setup.md#in-app-settings)).

## Cartões de Plano e Ações

Cada plano congelado é exibido em um cartão que mostra sua tag `#ID`, título, distintivo do projeto, distintivo do nível de complexidade e indicadores de verificação:

| Ação                  | Controle                   | Efeito                                                                                                                                                                                                                                            |
| --------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inspecionar Plano** | Clicar no Título do Cartão | Abre o espaço de trabalho do plano em [Planos](03_Plans.md) para revisar a especificação completa, metadados ou revisões anteriores.                                                                                                              |
| **Descongelar**       | Botão com ícone de chama   | Faz a transição do plano de `Icebox` de volta para `Draft` de forma otimista. O plano sai do Icebox imediatamente e retorna para a fila ativa de [Planos](03_Plans.md), pronto para execução via [ExecutePlan](../02_Concepts/02_Promptwares.md). |
| **Excluir**           | Botão com ícone de lixeira | Abre `DeletePlanDialog` para remover permanentemente a pasta do plano, revisões e registros do banco de dados.                                                                                                                                    |
