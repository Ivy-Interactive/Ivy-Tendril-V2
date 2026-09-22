---
title: REST API
description: Tendril предоставляет HTTP и WebSocket API для программного
  управления планами и задачами по URL вашего сервера Tendril (порт по умолчанию
  5010).
icon: Server
searchHints:
  - api
  - rest
  - http
  - эндпоинт
  - планы
  - задачи
  - входящие
  - аутентификация
  - bearer
  - X-Api-Key
  - websocket
  - события
---

# REST API

Tendril предоставляет HTTP REST API и интерфейс WebSocket для программного управления планами и задачами. По умолчанию сервер API принимает соединения по адресу `http://127.0.0.1:5010` (или `http://localhost:5010`). Работа по протоколу HTTPS включается при запуске `tendril serve` с флагами `--tls-cert` и `--tls-key`.

## Аутентификация

Tendril защищает эндпоинты API с помощью bearer-токенов, опциональных ключей API или базовой аутентификации по паролю:

### Секретный токен демона (Bearer Secret)

При запуске демон генерирует криптографически стойкий 32-байтный bearer-секрет и записывает его в `<home>/.master`. Защищенные маршруты API требуют передачи этого секрета либо в заголовке `Authorization`, либо в `X-Api-Key`:

```bash
# Использование заголовка Authorization
curl -H "Authorization: Bearer <secret>" http://127.0.0.1:5010/api/plans

# Использование заголовка X-Api-Key
curl -H "X-Api-Key: <secret>" http://127.0.0.1:5010/api/plans
```

Для подключений по протоколу WebSocket к `/api/ws` передавайте секрет в параметрах строки запроса:

```text
ws://127.0.0.1:5010/api/ws?token=<secret>
```

### Настроенный ключ API

Когда `api.apiKey` задан в `config.yaml`, запросы также должны удовлетворять требованию ключа API путем отправки `X-Api-Key: <configured-key>`:

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

### Аутентификация по паролю

Когда `auth:` настроен в `config.yaml`, вызывающие стороны могут проходить аутентификацию с помощью `Authorization: Basic <base64(user:password)>` или путем получения подписанного JWT-токена сессии через `POST /api/auth/login`. Токены сессии действительны в течение 15 минут и принимаются через `Authorization: Bearer <session-token>`.

### Неаутентифицированные эндпоинты

Следующие диагностические эндпоинты не требуют аутентификации:

- `GET /api/health` — основная проверка работоспособности, возвращающая PID, версию, версию API и список возможностей
- `GET /api/jobs/health` — псевдоним для проверки работоспособности
- `GET /api/ping` — проверка готовности ping/pong, возвращающая `{"ping": "pong"}`
- `POST /api/auth/login` — эндпоинт аутентификации по паролю

## Планы

### Список планов

```http
GET /api/plans?state=Draft&project=MyProject&limit=50
```

| Параметр  | Тип    | Описание                                                                                                                                      |
| --------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`  | string | Фильтрация по состоянию плана (`Draft`, `Creating`, `Updating`, `Executing`, `Completed`, `Failed`, `Review`, `Skipped`, `Icebox`, `Blocked`) |
| `state`   | string | Псевдоним для `status`                                                                                                                        |
| `project` | string | Фильтрация по имени проекта                                                                                                                   |
| `level`   | string | Фильтрация по уровню (например, `Feature`, `Bug`)                                                                                             |
| `q`       | string | Текстовый поиск по заголовку и содержимому плана                                                                                              |
| `limit`   | int    | Максимальное количество результатов (по умолчанию не ограничено)                                                                              |

### Создать план

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

### Получить план

```http
GET /api/plans/{planId}
GET /api/plans/{planId}?field=state
```

Возвращает полную запись плана или строку отдельного поля, если указан параметр `?field=`. Поддерживаемые поля: `id`, `title`, `state`, `project`, `level`, `created`, `updated`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`, `partialDelivery`, `repos`, `prs`, `commits`, `verifications`, `dependsOn`, `relatedPlans`, `recommendations`.

### Обновить поле

```http
PUT /api/plans/{planId}
Content-Type: application/json

{
  "field": "state",
  "value": "Executing"
}
```

Поддерживаемые поля: `state`, `title`, `level`, `project`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`.

Установка `state` в значение `Completed` возвращает `400`, если какая-либо из проверок плана находится в состоянии `Fail`. Добавьте `"allowFailedVerifications": true`, чтобы сохранить статус в любом случае; тогда план будет помечен флагом `partialDelivery: true`.

### Удалить план

```http
DELETE /api/plans/{planId}
```

### Репозитории

```http
POST /api/plans/{planId}/repos
DELETE /api/plans/{planId}/repos
Content-Type: application/json

{
  "repoPath": "/path/to/repo"
}
```

### Pull Request'ы и коммиты

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

### Зависимости и связанные планы

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

### Проверки плана

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

Допустимые статусы проверки: `Pending`, `Pass`, `Fail`, `Skipped`.

### Ревизии и валидация

```http
GET /api/plans/{planId}/revisions
POST /api/plans/{planId}/revisions
PUT /api/plans/{planId}/revisions/latest
POST /api/plans/{planId}/validate
```

## Рекомендации

### Список рекомендаций

```http
GET /api/plans/{planId}/recommendations
GET /api/plans/{planId}/recommendations?state=Pending
GET /api/recommendations
```

Состояния фильтра: `Pending`, `Accepted`, `AcceptedWithNotes`, `Declined`. Запрос `GET /api/recommendations` выполняет поиск по всем планам.

### Добавить рекомендацию

```http
POST /api/plans/{planId}/recommendations
Content-Type: application/json

{
  "title": "Add integration test",
  "description": "Coverage is missing for the password reset route",
  "impact": "Medium"
}
```

Уровни влияния: `Small`, `Medium`, `High`.

### Принять / Отклонить рекомендацию

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

### Удалить рекомендацию

```http
DELETE /api/plans/{planId}/recommendations/{title}
```

## Входящие (Inbox)

### Отправить задачу плана

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

Запускает фоновую задачу `CreatePlan` и возвращает:

```json
{
  "jobId": "00143",
  "status": "Started",
  "message": "Plan creation job started successfully"
}
```

### Предложения и сканирования

```http
POST /api/inbox/check
GET /api/inbox/proposals
POST /api/inbox/proposals/{id}/accept
POST /api/inbox/proposals/{id}/dismiss
```

## Задачи (Jobs)

### Запустить задачу

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

Тело запроса использует полиморфный дискриминатор `"type"`. Доступные типы задач: `CreatePlan`, `ExecutePlan`, `RetryPlan`, `ExpandPlan`, `UpdatePlan`, `SplitPlan`, `CreatePr`, `CreateIssue`, `SetupProject`, `SyncRepo`, `AddProject`.

### Список задач

```http
GET /api/jobs?status=Running&limit=20
```

### Запрос задач (с серверной пагинацией и фильтрацией)

```http
POST /api/jobs/query
Content-Type: application/json

{
  "offset": 0,
  "limit": 25,
  "sort": [{ "column": "StartedAt", "descending": true }]
}
```

### Очередь задач

```http
GET /api/jobs/queue
```

Возвращает список задач, находящихся в данный момент в очереди, в порядке диспетчеризации.

### Получить сведения о задаче

```http
GET /api/jobs/{jobId}
```

### Отменить или удалить задачу

```http
POST /api/jobs/{jobId}/cancel
DELETE /api/jobs/{jobId}
```

### Отчетность о ходе выполнения и сбоях

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

### Логи и потоки задач

```http
# Добавить запись повествовательного лога агента
POST /api/jobs/{jobId}/logs
Content-Type: application/json

{
  "action": "ExecutePlan",
  "summary": "Completed successfully"
}

# Получить логи
GET /api/jobs/{jobId}/logs

# SSE-поток логов в реальном времени
GET /api/jobs/{jobId}/logs/stream

# SSE-поток событий жизненного цикла задачи в реальном времени
GET /api/jobs/{jobId}/events
```

## WebSockets и события

### Прямой WebSocket-поток

Подключитесь к эндпоинту WebSocket для получения прямых трансляций событий планов, задач, сессий чата и переходов статусов:

```text
ws://127.0.0.1:5010/api/ws?token=<secret>&since=<seq>
```

Передача параметра `?since=<seq>` воспроизводит все буферизованные события, начиная с указанного порядкового номера, перед началом трансляции обновлений в реальном времени.

### Восполнение данных через REST (Backfill)

Если поддержание открытого WebSocket-соединения нецелесообразно, опрашивайте кольцевой буфер событий по HTTP:

```http
GET /api/events?since=105
GET /api/events/backfill?since=105
```

## Проверки работоспособности (Health Checks)

```http
GET /api/health
```

Ответ:

```json
{
  "status": "ok",
  "pid": 12345,
  "version": "2.0.0",
  "apiVersion": 1,
  "capabilities": ["jobs", "plans", "projects", "ws", "auth_bearer", "auth_api_key"]
}
```
