---
title: API REST
description: O Tendril expõe uma API HTTP e WebSocket para gerenciamento
  programático de planos e tarefas no URL do seu servidor Tendril (porta padrão
  5010).
icon: Server
searchHints:
  - api
  - rest
  - http
  - endpoint
  - planos
  - tarefas
  - caixa de entrada
  - autenticação
  - bearer
  - X-Api-Key
  - websocket
  - eventos
---

# API REST

O Tendril expõe uma API REST HTTP e uma interface WebSocket para gerenciamento programático de planos e tarefas. Por padrão, o servidor da API escuta em `http://127.0.0.1:5010` (ou `http://localhost:5010`). O suporte a HTTPS é ativado quando `tendril serve` é iniciado com `--tls-cert` e `--tls-key`.

## Autenticação

O Tendril protege os endpoints da API usando credenciais bearer, chaves de API opcionais ou autenticação básica por senha:

### Segredo Bearer do Daemon

Quando o daemon inicia, ele gera um segredo bearer de 32 bytes criptograficamente seguro e o grava em `<home>/.master`. As rotas protegidas da API exigem este segredo no cabeçalho `Authorization` ou `X-Api-Key`:

```bash
# Using Authorization header
curl -H "Authorization: Bearer <secret>" http://127.0.0.1:5010/api/plans

# Using X-Api-Key header
curl -H "X-Api-Key: <secret>" http://127.0.0.1:5010/api/plans
```

Para conexões WebSocket em `/api/ws`, passe o segredo na query string:

```text
ws://127.0.0.1:5010/api/ws?token=<secret>
```

### Chave de API Configurada

Quando `api.apiKey` está configurado no `config.yaml`, as requisições também devem atender ao requisito de chave de API enviando `X-Api-Key: <configured-key>`:

```yaml
# config.yaml
api:
  apiKey: "your-secret-key"
```

```bash
curl -H "Authorization: Bearer <daemon-secret>" \
     -H "X-Api-Key: your-secret-key" \
     http://127.0.0.1:5010/api/plans
```

### Autenticação por Senha

Quando `auth:` está configurado no `config.yaml`, os clientes podem se autenticar com `Authorization: Basic <base64(user:password)>` ou obtendo um token de sessão JWT assinado a partir de `POST /api/auth/login`. Os tokens de sessão são válidos por 15 minutos e aceitos via `Authorization: Bearer <session-token>`.

### Endpoints Não Autenticados

Os seguintes endpoints de verificação não exigem autenticação:

- `GET /api/health` — verificação de integridade principal retornando PID, versão, versão da API e lista de recursos
- `GET /api/jobs/health` — alias para a verificação de integridade
- `GET /api/ping` — verificação de prontidão ping/pong retornando `{"ping": "pong"}`
- `POST /api/auth/login` — endpoint de autenticação por senha

## Planos

### Listar Planos

```http
GET /api/plans?state=Draft&project=MyProject&limit=50
```

| Parameter | Type   | Description                                                                                                                                 |
| --------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`  | string | Filtrar por estado do plano (`Draft`, `Creating`, `Updating`, `Executing`, `Completed`, `Failed`, `Review`, `Skipped`, `Icebox`, `Blocked`) |
| `state`   | string | Alias para `status`                                                                                                                         |
| `project` | string | Filtrar por nome do projeto                                                                                                                 |
| `level`   | string | Filtrar por nível (ex.: `Feature`, `Bug`)                                                                                                   |
| `q`       | string | Filtro de busca textual no título e conteúdo do plano                                                                                       |
| `limit`   | int    | Máximo de resultados (ilimitado por padrão)                                                                                                 |

### Criar Plano

```http
POST /api/plans
Content-Type: application/json

{
  "title": "Fix login validation bug",
  "project": "MyProject",
  "level": "Bug",
  "initialPrompt": "Fix the issue where empty passwords crash the auth handler",
  "priority": 10
}
```

### Obter Plano

```http
GET /api/plans/{planId}
GET /api/plans/{planId}?field=state
```

Retorna o registro completo do plano ou a string de um único campo quando `?field=` for especificado. Campos suportados: `id`, `title`, `state`, `project`, `level`, `created`, `updated`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`, `partialDelivery`, `repos`, `prs`, `commits`, `verifications`, `dependsOn`, `relatedPlans`, `recommendations`.

### Atualizar Campo

```http
PUT /api/plans/{planId}
Content-Type: application/json

{
  "field": "state",
  "value": "Executing"
}
```

Campos suportados: `state`, `title`, `level`, `project`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`.

Definir `state` como `Completed` retorna `400` enquanto qualquer uma das verificações do plano estiver no estado `Fail`. Adicione `"allowFailedVerifications": true` para registrar mesmo assim; o plano é então sinalizado com `partialDelivery: true`.

### Excluir Plano

```http
DELETE /api/plans/{planId}
```

### Repositórios

```http
POST /api/plans/{planId}/repos
DELETE /api/plans/{planId}/repos
Content-Type: application/json

{
  "repoPath": "/path/to/repo"
}
```

### Pull Requests e Commits

```http
POST /api/plans/{planId}/prs
Content-Type: application/json

{
  "prUrl": "https://github.com/org/repo/pull/42"
}
```

```http
POST /api/plans/{planId}/commits
Content-Type: application/json

{
  "sha": "abc1234def5678"
}
```

### Dependências e Planos Relacionados

```http
POST /api/plans/{planId}/depends-on
DELETE /api/plans/{planId}/depends-on
Content-Type: application/json

{
  "dependsOn": "00041-setup-database"
}
```

```http
POST /api/plans/{planId}/related-plans
DELETE /api/plans/{planId}/related-plans
Content-Type: application/json

{
  "relatedPlan": "00039-refactor-auth"
}
```

### Verificações do Plano

```http
GET /api/plans/{planId}/verifications
POST /api/plans/{planId}/verifications
Content-Type: application/json

{
  "name": "CargoTest",
  "status": "Pending"
}
```

```http
PUT /api/plans/{planId}/verifications/{name}
Content-Type: application/json

{
  "status": "Pass"
}
```

```http
DELETE /api/plans/{planId}/verifications/{name}
```

Status válidos de verificação: `Pending`, `Pass`, `Fail`, `Skipped`.

### Revisões e Validação

```http
GET /api/plans/{planId}/revisions
POST /api/plans/{planId}/revisions
PUT /api/plans/{planId}/revisions/latest
POST /api/plans/{planId}/validate
```

## Recomendações

### Listar Recomendações

```http
GET /api/plans/{planId}/recommendations
GET /api/plans/{planId}/recommendations?state=Pending
GET /api/recommendations
```

Estados de filtro: `Pending`, `Accepted`, `AcceptedWithNotes`, `Declined`. `GET /api/recommendations` realiza consultas em todos os planos.

### Adicionar Recomendação

```http
POST /api/plans/{planId}/recommendations
Content-Type: application/json

{
  "title": "Add integration test",
  "description": "Coverage is missing for the password reset route",
  "impact": "Medium"
}
```

Níveis de impacto: `Small`, `Medium`, `High`.

### Aceitar / Recusar Recomendação

```http
PUT /api/plans/{planId}/recommendations/{title}/accept
Content-Type: application/json

{
  "notes": "Covered via end-to-end suite"
}
```

```http
PUT /api/plans/{planId}/recommendations/{title}/decline
Content-Type: application/json

{
  "reason": "Scope intentionally deferred to next milestone"
}
```

### Excluir Recomendação

```http
DELETE /api/plans/{planId}/recommendations/{title}
```

## Caixa de Entrada

### Enviar Tarefa de Plano

```http
POST /api/inbox
Content-Type: application/json

{
  "description": "Fix login validation bug",
  "project": "MyProject",
  "sourcePath": "/path/to/source",
  "force": false
}
```

Inicia uma tarefa em segundo plano `CreatePlan` e retorna:

```json
{
  "jobId": "00143",
  "status": "Started",
  "message": "Plan creation job started successfully"
}
```

### Propostas e Varreduras

```http
POST /api/inbox/check
GET /api/inbox/proposals
POST /api/inbox/proposals/{id}/accept
POST /api/inbox/proposals/{id}/dismiss
```

## Tarefas (Jobs)

### Iniciar Tarefa

```http
POST /api/jobs
Content-Type: application/json

{
  "type": "ExecutePlan",
  "folderPath": "Plans/00042-fix-login",
  "priority": 10,
  "waitForJobs": ["00140"]
}
```

O corpo da requisição usa um discriminador polimórfico `"type"`. Tipos de tarefas disponíveis: `CreatePlan`, `ExecutePlan`, `RetryPlan`, `ExpandPlan`, `UpdatePlan`, `SplitPlan`, `CreatePr`, `CreateIssue`, `SetupProject`, `SyncRepo`, `AddProject`.

### Listar Tarefas

```http
GET /api/jobs?status=Running&limit=20
```

### Consultar Tarefas (Paginadas e Filtradas pelo Servidor)

```http
POST /api/jobs/query
Content-Type: application/json

{
  "offset": 0,
  "limit": 25,
  "sort": [{ "column": "StartedAt", "descending": true }]
}
```

### Fila de Tarefas

```http
GET /api/jobs/queue
```

Retorna a lista de tarefas atualmente na fila em ordem de despacho.

### Obter Detalhes da Tarefa

```http
GET /api/jobs/{jobId}
```

### Cancelar ou Excluir Tarefa

```http
POST /api/jobs/{jobId}/cancel
DELETE /api/jobs/{jobId}
```

### Relatório de Progresso e Falhas

```http
PUT /api/jobs/{jobId}/status
Content-Type: application/json

{
  "message": "Running unit tests...",
  "planId": "00042",
  "planTitle": "Fix login validation bug"
}
```

```http
PUT /api/jobs/{jobId}/fail
Content-Type: application/json

{
  "message": "Test execution failed with exit code 1"
}
```

### Logs e Streams de Tarefas

```http
# Add narrative agent log entry
POST /api/jobs/{jobId}/logs
Content-Type: application/json

{
  "action": "ExecutePlan",
  "summary": "Completed successfully"
}

# Fetch logs
GET /api/jobs/{jobId}/logs

# SSE real-time stream of logs
GET /api/jobs/{jobId}/logs/stream

# SSE real-time stream of job lifecycle events
GET /api/jobs/{jobId}/events
```

## WebSockets e Eventos

### Stream WebSocket ao Vivo

Conecte-se ao endpoint WebSocket para receber transmissões de eventos ao vivo para planos, tarefas, sessões de chat e transições de status:

```text
ws://127.0.0.1:5010/api/ws?token=<secret>&since=<seq>
```

Passar `?since=<seq>` reproduz todos os eventos em buffer desde esse número de sequência antes de transmitir atualizações ao vivo.

### Backfill REST

Se manter uma conexão WebSocket aberta não for viável, consulte o ring buffer de eventos via HTTP:

```http
GET /api/events?since=105
GET /api/events/backfill?since=105
```

## Verificações de Integridade

```http
GET /api/health
```

Resposta:

```json
{
  "status": "ok",
  "pid": 12345,
  "version": "2.0.0",
  "apiVersion": 1,
  "capabilities": ["jobs", "plans", "projects", "ws", "auth_bearer", "auth_api_key"]
}
```
