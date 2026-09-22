---
title: Servidor MCP
description: O Tendril inclui um servidor Model Context Protocol (MCP) que expõe
  ferramentas de gerenciamento de planos para agentes de codificação de IA, como
  o Claude Code.
icon: Bot
searchHints:
  - mcp
  - model context protocol
  - claude
  - ferramentas
  - tendril_get_plan
  - tendril_list_plans
  - tendril_start_job
  - tendril_inbox
  - tendril_get_config
---

# Servidor MCP

O Tendril inclui um servidor Model Context Protocol (MCP) que expõe ferramentas de gerenciamento de planos, orquestração de tarefas e descoberta de projetos para agentes de codificação de IA, como o Claude Code.

## Iniciando o Servidor MCP

```bash
tendril mcp
```

Isso inicia o servidor MCP via transporte stdio, adequado para uso na configuração MCP do Claude Code. A entrada e saída padrão são reservadas estritamente para mensagens JSON-RPC; os logs de diagnóstico são direcionados para o stderr.

## Autenticação

Defina a variável de ambiente `TENDRIL_MCP_TOKEN` para exigir autenticação por token para sessões MCP:

- **Variáveis de ambiente**: Clientes que se conectam via stdio podem fornecer o token correspondente por meio de `TENDRIL_MCP_CLIENT_TOKEN` (ou `TENDRIL_MCP_TOKEN`).
- **Metadados da requisição**: Os clientes também podem passar o token por requisição nos parâmetros de `initialize` sob `_meta["io.tendril/token"]`.

Quando `TENDRIL_MCP_TOKEN` não estiver definido ou estiver em branco, a autenticação será desativada e requisições locais serão permitidas.

## Ferramentas Disponíveis

Todas as ferramentas possuem o prefixo `tendril_` e operam diretamente no daemon ou no armazenamento local do Tendril.

### Inspeção e Consulta de Planos

| Ferramenta                       | Parâmetros                                                           | Descrição                                                                                                                                                                                                                           |
| -------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tendril_get_plan`               | `plan_id` (obrigatório), `field` (opcional)                          | Obtém os metadados de um plano e a revisão mais recente. Quando `field` é especificado, retorna apenas esse campo (ex.: `title`, `state`, `project`, `level`, `repos`, `commits`, `prs`, `verifications`, `dependsOn`, `revision`). |
| `tendril_list_plans`             | `state` (opcional), `project` (opcional), `search`, `since`, `limit` | Lista planos que correspondem aos filtros. `since` aceita um timestamp RFC 3339; `search` filtra por título ou ID.                                                                                                                  |
| `tendril_get_revision`           | `plan_id` (obrigatório), `number` (opcional)                         | Obtém o texto em markdown de uma revisão de plano (a mais recente por padrão ou um número de revisão específico).                                                                                                                   |
| `tendril_plan_validate`          | `plan_id` (obrigatório)                                              | Verifica a integridade do plano e relata quaisquer problemas estruturais ou de esquema.                                                                                                                                             |
| `tendril_plan_verification_list` | `plan_id` (obrigatório)                                              | Lista todas as verificações e seus status atuais (`Pending`, `Pass`, `Fail`, `Skipped`) para um plano.                                                                                                                              |
| `tendril_plan_rec_list`          | `plan_id` (obrigatório), `state` (opcional)                          | Lista recomendações para um plano. Status de filtro: `Pending`, `Accepted`, `AcceptedWithNotes`, `Declined`.                                                                                                                        |

### Criação e Modificação de Planos

| Ferramenta                         | Parâmetros                                                                                                                    | Descrição                                                                                                                                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tendril_plan_create`              | `title` (obrigatório), `project` (obrigatório), `level`, `initial_prompt`, `source_url`, `execution_profile`, `priority`, ... | Cria um novo plano. As etapas de verificação são geradas automaticamente a partir da configuração do projeto.                                                                                                      |
| `tendril_plan_write_revision`      | `plan_id` (obrigatório), `content` (obrigatório), `reason` (opcional)                                                         | Grava uma nova revisão numerada em markdown. Os blocos de perguntas são validados em relação ao esquema.                                                                                                           |
| `tendril_plan_set`                 | `plan_id` (obrigatório), `field` (obrigatório), `value` (obrigatório)                                                         | Atualiza um campo escalar (`state`, `title`, `level`, `project`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`). Mudanças de estado aplicam as etapas de verificação antes de permitir `Completed`. |
| `tendril_plan_set_verification`    | `plan_id` (obrigatório), `name` (obrigatório), `status` (obrigatório)                                                         | Define o status da etapa de verificação (`Pending`, `Pass`, `Fail`, `Skipped`).                                                                                                                                    |
| `tendril_plan_verification_remove` | `plan_id` (obrigatório), `name` (obrigatório)                                                                                 | Remove uma etapa de verificação de um plano.                                                                                                                                                                       |
| `tendril_plan_add_repo`            | `plan_id` (obrigatório), `path` (obrigatório)                                                                                 | Associa o caminho de um repositório a um plano.                                                                                                                                                                    |
| `tendril_plan_remove_repo`         | `plan_id` (obrigatório), `path` (obrigatório)                                                                                 | Desassocia o caminho de um repositório de um plano.                                                                                                                                                                |
| `tendril_plan_add_pr`              | `plan_id` (obrigatório), `url` (obrigatório)                                                                                  | Registra a URL de um pull request em um plano.                                                                                                                                                                     |
| `tendril_plan_add_commit`          | `plan_id` (obrigatório), `sha` (obrigatório)                                                                                  | Registra o SHA de um commit em um plano.                                                                                                                                                                           |
| `tendril_plan_add_depends_on`      | `plan_id` (obrigatório), `folder` (obrigatório)                                                                               | Adiciona uma dependência de plano bloqueante. O plano dependente não será executado até que o alvo atinja `Completed` e seus PRs sejam mesclados.                                                                  |
| `tendril_plan_remove_depends_on`   | `plan_id` (obrigatório), `folder` (obrigatório)                                                                               | Remove uma dependência de plano bloqueante.                                                                                                                                                                        |
| `tendril_plan_add_related_plan`    | `plan_id` (obrigatório), `folder` (obrigatório)                                                                               | Vincula um plano relacionado para referência contextual.                                                                                                                                                           |
| `tendril_plan_remove_related_plan` | `plan_id` (obrigatório), `folder` (obrigatório)                                                                               | Remove o vínculo com um plano relacionado.                                                                                                                                                                         |

### Recomendações

| Ferramenta                 | Parâmetros                                                                                       | Descrição                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `tendril_plan_rec_add`     | `plan_id` (obrigatório), `title` (obrigatório), `description` (obrigatório), `impact` (opcional) | Adiciona uma nova recomendação com nível de impacto (`Small`, `Medium`, `High`). |
| `tendril_plan_rec_accept`  | `plan_id` (obrigatório), `title` (obrigatório)                                                   | Aceita uma recomendação.                                                         |
| `tendril_plan_rec_decline` | `plan_id` (obrigatório), `title` (obrigatório), `reason` (opcional)                              | Recusa uma recomendação com uma justificativa opcional.                          |
| `tendril_plan_rec_remove`  | `plan_id` (obrigatório), `title` (obrigatório)                                                   | Remove uma recomendação do plano.                                                |

### Tarefas e Inbox

| Ferramenta            | Parâmetros                                                                             | Descrição                                                                                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tendril_inbox`       | `description` (obrigatório), `project` (opcional), `source_path` (opcional)            | Envia uma nova descrição de tarefa para a inbox do Tendril, iniciando automaticamente um job `CreatePlan`.                                                                                                         |
| `tendril_start_job`   | `job_type` (obrigatório), `plan_id`, `description`, `project`, `note`, `priority`, ... | Inicia uma tarefa em segundo plano no daemon em execução (`CreatePlan`, `ExecutePlan`, `RetryPlan`, `UpdatePlan`, `ExpandPlan`, `SplitPlan`, `CreatePr`, `CreateIssue`, `SetupProject`, `SyncRepo`, `AddProject`). |
| `tendril_list_jobs`   | `status` (opcional), `limit` (opcional)                                                | Lista tarefas recentes em segundo plano do daemon.                                                                                                                                                                 |
| `tendril_get_job`     | `job_id` (obrigatório)                                                                 | Recupera status, tempo de execução, contagem de tokens e detalhes de custo para uma tarefa específica.                                                                                                             |
| `tendril_cancel_job`  | `job_id` (obrigatório), `message` (opcional)                                           | Cancela uma tarefa em execução em segundo plano.                                                                                                                                                                   |
| `tendril_job_add_log` | `job_id` (obrigatório), `action` (obrigatório), `summary` (opcional)                   | Anexa uma entrada de log narrativa a `<TendrilHome>/Jobs/`. Funciona offline mesmo se o daemon estiver parado.                                                                                                     |

### Configuração e Descoberta

| Ferramenta                   | Parâmetros        | Descrição                                                                                                                       |
| ---------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `tendril_get_config`         | `key` (opcional)  | Lê valores públicos de configuração (ex.: `codingAgent`, `jobTimeout`, `planTemplate`). Credenciais confidenciais são omitidas. |
| `tendril_list_projects`      | —                 | Lista todos os projetos configurados com seus caminhos de repositório, verificações e configurações.                            |
| `tendril_list_verifications` | `name` (opcional) | Lista definições globais de verificação ou inspeciona uma pelo nome.                                                            |

> [!NOTE]
> A configuração é somente leitura via MCP: modificar configurações em todo o sistema como `planFolder` ou `codingAgent` requer o uso da CLI (`tendril config set`) ou da interface do Tendril.

## Configuração do Claude Code

Adicione o servidor MCP do Tendril às configurações do seu Claude Code (`~/.claude/settings.json` ou no nível do projeto em `.claude/settings.json`):

```json
{
  "mcpServers": {
    "tendril": {
      "command": "tendril",
      "args": ["mcp"]
    }
  }
}
```

Com autenticação por token habilitada:

```json
{
  "mcpServers": {
    "tendril": {
      "command": "tendril",
      "args": ["mcp"],
      "env": {
        "TENDRIL_MCP_CLIENT_TOKEN": "your-secret-token"
      }
    }
  }
}
```
