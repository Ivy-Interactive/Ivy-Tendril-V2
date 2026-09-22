---
title: Tarefas
description: "Execuções de promptware ativas e anteriores: status, custo,
  duração e saída em tempo real."
icon: Activity
searchHints:
  - tarefas
  - em execução
  - execução
  - agentes
  - status
---

# Tarefas

O aplicativo de Tarefas (Jobs) é o monitor de execução em tempo real e log de auditoria histórica do Tendril. Cada invocação de [Promptware](../02_Concepts/02_Promptwares.md) (`CreatePlan`, `ExecutePlan`, `UpdatePlan`, `CreatePr`, `SplitPlan`, etc.) roda como uma tarefa assíncrona rastreada aqui.

## Visão Geral e Progresso de Status

No topo da visualização de Tarefas, uma **Barra de Progresso Empilhada** (`StackedProgress`) exibe a distribuição em tempo real dos estados das tarefas:

- **Running** (azul) — Processos de agentes em execução ativa.
- **Completed** (verde) — Execuções concluídas com sucesso.
- **Failed** (vermelho) — Execuções encerradas com erros ou falhas de verificação.
- **Blocked** (âmbar) — Tarefas aguardando dependências, limites de simultaneidade ou confirmação do operador.
- **Pending** (opaco) — Tarefas enfileiradas aguardando slots de agentes disponíveis.

Controles de execução em lote no cabeçalho permitem aos operadores executar **Stop All Queued** ou **Stop All** nas tarefas quando necessário, ou limpar linhas históricas em lote pelo menu suspenso **Clear** (`Clear Completed`, `Clear Failed` ou `Clear All`).

## A Tabela de Tarefas

A tabela utiliza rolagem infinita com ordenação e filtragem no servidor, avaliadas pelo daemon:

| Coluna      | Descrição                                                 | Interação                                                                                        |
| ----------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Id**      | Identificador numérico da tarefa (ex.: `00042`).          | Clique no cabeçalho para ordenar por mais recente/mais antiga.                                   |
| **Plan Id** | Identificador do plano de destino.                        | Clique para navegar diretamente para o plano em [Plans](03_Plans.md).                            |
| **Status**  | Badge de status atual da tarefa.                          | Codificado por cores conforme o estado.                                                          |
| **Type**    | Identificador de promptware (ex.: `ExecutePlan`).         | Ordenável por promptware.                                                                        |
| **Project** | Badge do projeto.                                         | Estilizado com a cor do projeto definida em [Project Setup](../03_Configuration/02_Projects.md). |
| **Output**  | Estado de execução do agente (`running`, `done`, `idle`). | **Clique para abrir o Painel de Saída ao Vivo** (`JobSessionView`) com streaming do terminal.    |
| **Tokens**  | Contagem total de consumo de tokens.                      | **Clique para abrir o Painel de Custos e Tokens** (`JobCostSheet`).                              |
| **Cost**    | Custo de execução calculado em USD.                       | **Clique para abrir o Painel de Custos e Tokens**.                                               |
| **Timer**   | Cronômetro em tempo real ou duração gravada.              | Exibe a duração em tempo real.                                                                   |
| **Date**    | Carimbo de data/hora de quando a tarefa foi iniciada.     | Ordenação cronológica.                                                                           |

## Painéis e Slide-Overs

Clicar nas células ou nas ações da linha abre painéis laterais focados diretamente sobre a tabela, sem perder a sua posição:

### Painel de Saída ao Vivo (`JobSessionView`)

Clicar na célula de **Output** abre o visualizador de streaming em tempo real do agente. Você vê a saída de terminal `stdout`/`stderr` em tempo real do agente (logs de compilação, saída de testes, invocações de ferramentas e raciocínio do agente), e não apenas um indicador de carregamento genérico.

### Painel de Custos e Tokens (`JobCostSheet`)

Clicar na célula **Tokens** ou **Cost** exibe um detalhamento contábil completo:

- **Input Tokens** — Tokens de prompt e contexto enviados ao modelo.
- **Output Tokens** — Tokens gerados pelo modelo.
- **Cache Read Tokens** — Tokens servidos a partir do cache de prompt (economizando custo e latência).
- **Cache Write Tokens** — Tokens gravados no cache de prompt do provedor.
- **Reasoning Tokens** — Tokens gastos em modelos de raciocínio interno (ex.: OpenAI o1/o3 ou pensamento estendido da Anthropic).
- **Cost Calculation** — Custo monetário reconciliado com as especificações de preço do [models.dev](https://models.dev).

### Painel de Prompt Completo

Clicar no texto do **Prompt** abre o prompt completo e sem truncamento enviado ao agente, com destaque de sintaxe integral.

## Menu de Ações da Linha

Cada linha de tarefa fornece um menu de ações (`...`):

| Ação            | Disponibilidade     | Efeito                                                                                                                                                                           |
| --------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stop**        | Tarefas ativas      | Interrompe o processo do agente em execução imediatamente. A worktree do [Git](https://git-scm.com) é preservada para que você possa retomar ou inspecionar o progresso parcial. |
| **Force Start** | Tarefas bloqueadas  | Ignora limites de simultaneidade ou bloqueios de dependência para iniciar a tarefa imediatamente.                                                                                |
| **Debug**       | Todas as tarefas    | Abre o **Painel de Depuração da Tarefa** (`JobDebugSheet`), fornecendo acesso por abas ao Job Log, Job Prompt, Raw Output Log e Eventwire Log, com botões "Open in Editor".      |
| **Delete**      | Concluídas / Falhas | Exclui permanentemente o registro da tarefa do histórico após confirmação.                                                                                                       |
