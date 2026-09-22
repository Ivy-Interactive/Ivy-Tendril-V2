---
title: MCP-сервер
description: Tendril включает в себя сервер Model Context Protocol (MCP),
  который предоставляет инструменты управления планами для ИИ-агентов написания
  кода, таких как Claude Code.
icon: Bot
searchHints:
  - mcp
  - model context protocol
  - протокол контекста модели
  - claude
  - инструменты
  - tendril_get_plan
  - tendril_list_plans
  - tendril_start_job
  - tendril_inbox
  - tendril_get_config
---

# MCP-сервер

Tendril включает в себя сервер Model Context Protocol (MCP), который предоставляет инструменты управления планами, оркестрации задач и обнаружения проектов для ИИ-агентов написания кода, таких как Claude Code.

## Запуск MCP-сервера

```bash
tendril mcp
```

Эта команда запускает MCP-сервер через транспорт stdio, подходящий для использования в конфигурации MCP Claude Code. Стандартный ввод и вывод зарезервированы исключительно для сообщений JSON-RPC; диагностические логи направляются в stderr.

## Аутентификация

Установите переменную окружения `TENDRIL_MCP_TOKEN`, чтобы требовать токен-аутентификацию для сессий MCP:

- **Переменные окружения**: Клиенты, подключающиеся через stdio, могут предоставить соответствующий токен через `TENDRIL_MCP_CLIENT_TOKEN` (или `TENDRIL_MCP_TOKEN`).
- **Метаданные запроса**: Клиенты также могут передавать токен в каждом запросе в параметрах `initialize` под ключом `_meta["io.tendril/token"]`.

Если `TENDRIL_MCP_TOKEN` не задан или пуст, аутентификация отключена и локальные запросы разрешены.

## Доступные инструменты

Все инструменты имеют префикс `tendril_` и работают напрямую с демоном или локальным хранилищем Tendril.

### Просмотр и запрос планов

| Tool                             | Parameters                                                           | Description                                                                                                                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tendril_get_plan`               | `plan_id` (required), `field` (optional)                             | Получить метаданные плана и последнюю ревизию. Если указано поле `field`, возвращает только это поле (например, `title`, `state`, `project`, `level`, `repos`, `commits`, `prs`, `verifications`, `dependsOn`, `revision`). |
| `tendril_list_plans`             | `state` (optional), `project` (optional), `search`, `since`, `limit` | Список планов, соответствующих фильтрам. `since` принимает метку времени в формате RFC 3339; `search` фильтрует по названию или ID.                                                                                         |
| `tendril_get_revision`           | `plan_id` (required), `number` (optional)                            | Получить markdown-текст ревизии плана (по умолчанию последней или указанной по номеру).                                                                                                                                     |
| `tendril_plan_validate`          | `plan_id` (required)                                                 | Проверить состояние плана и сообщить о любых структурных проблемах или ошибках схемы.                                                                                                                                       |
| `tendril_plan_verification_list` | `plan_id` (required)                                                 | Получить список всех проверок и их текущих статусов (`Pending`, `Pass`, `Fail`, `Skipped`) для плана.                                                                                                                       |
| `tendril_plan_rec_list`          | `plan_id` (required), `state` (optional)                             | Получить список рекомендаций для плана. Фильтры статусов: `Pending`, `Accepted`, `AcceptedWithNotes`, `Declined`.                                                                                                           |

### Создание и изменение планов

| Tool                               | Parameters                                                                                                              | Description                                                                                                                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tendril_plan_create`              | `title` (required), `project` (required), `level`, `initial_prompt`, `source_url`, `execution_profile`, `priority`, ... | Создать новый план. Гейты верификации заполняются автоматически из конфигурации проекта.                                                                                                                              |
| `tendril_plan_write_revision`      | `plan_id` (required), `content` (required), `reason` (optional)                                                         | Записать новую пронумерованную markdown-ревизию. Блоки вопросов проверяются на соответствие схеме.                                                                                                                    |
| `tendril_plan_set`                 | `plan_id` (required), `field` (required), `value` (required)                                                            | Обновить скалярное поле (`state`, `title`, `level`, `project`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`). Изменения статуса проверяют гейты верификации перед разрешением перехода в `Completed`. |
| `tendril_plan_set_verification`    | `plan_id` (required), `name` (required), `status` (required)                                                            | Установить статус гейта верификации (`Pending`, `Pass`, `Fail`, `Skipped`).                                                                                                                                           |
| `tendril_plan_verification_remove` | `plan_id` (required), `name` (required)                                                                                 | Удалить гейт верификации из плана.                                                                                                                                                                                    |
| `tendril_plan_add_repo`            | `plan_id` (required), `path` (required)                                                                                 | Привязать путь репозитория к плану.                                                                                                                                                                                   |
| `tendril_plan_remove_repo`         | `plan_id` (required), `path` (required)                                                                                 | Отвязать путь репозитория от плана.                                                                                                                                                                                   |
| `tendril_plan_add_pr`              | `plan_id` (required), `url` (required)                                                                                  | Записать URL pull request в план.                                                                                                                                                                                     |
| `tendril_plan_add_commit`          | `plan_id` (required), `sha` (required)                                                                                  | Записать SHA коммита в план.                                                                                                                                                                                          |
| `tendril_plan_add_depends_on`      | `plan_id` (required), `folder` (required)                                                                               | Добавить блокирующую зависимость плана. Зависимый план не будет выполняться до тех пор, пока целевой план не перейдет в статус `Completed` и его PR не будут объединены (merged).                                     |
| `tendril_plan_remove_depends_on`   | `plan_id` (required), `folder` (required)                                                                               | Удалить блокирующую зависимость плана.                                                                                                                                                                                |
| `tendril_plan_add_related_plan`    | `plan_id` (required), `folder` (required)                                                                               | Связать связанный план для контекстной ссылки.                                                                                                                                                                        |
| `tendril_plan_remove_related_plan` | `plan_id` (required), `folder` (required)                                                                               | Удалить ссылку на связанный план.                                                                                                                                                                                     |

### Рекомендации

| Tool                       | Parameters                                                                              | Description                                                                |
| -------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `tendril_plan_rec_add`     | `plan_id` (required), `title` (required), `description` (required), `impact` (optional) | Добавить новую рекомендацию с уровнем влияния (`Small`, `Medium`, `High`). |
| `tendril_plan_rec_accept`  | `plan_id` (required), `title` (required)                                                | Принять рекомендацию.                                                      |
| `tendril_plan_rec_decline` | `plan_id` (required), `title` (required), `reason` (optional)                           | Отклонить рекомендацию с необязательным обоснованием.                      |
| `tendril_plan_rec_remove`  | `plan_id` (required), `title` (required)                                                | Удалить рекомендацию из плана.                                             |

### Задачи и входящие

| Tool                  | Parameters                                                                          | Description                                                                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tendril_inbox`       | `description` (required), `project` (optional), `source_path` (optional)            | Отправить новое описание задачи во входящие Tendril, автоматически запуская задачу `CreatePlan`.                                                                                                        |
| `tendril_start_job`   | `job_type` (required), `plan_id`, `description`, `project`, `note`, `priority`, ... | Запустить фоновую задачу на работающем демоне (`CreatePlan`, `ExecutePlan`, `RetryPlan`, `UpdatePlan`, `ExpandPlan`, `SplitPlan`, `CreatePr`, `CreateIssue`, `SetupProject`, `SyncRepo`, `AddProject`). |
| `tendril_list_jobs`   | `status` (optional), `limit` (optional)                                             | Получить список последних фоновых задач демона.                                                                                                                                                         |
| `tendril_get_job`     | `job_id` (required)                                                                 | Получить статус, тайминги, количество токенов и детали стоимости для конкретной задачи.                                                                                                                 |
| `tendril_cancel_job`  | `job_id` (required), `message` (optional)                                           | Отменить выполняющуюся фоновую задачу.                                                                                                                                                                  |
| `tendril_job_add_log` | `job_id` (required), `action` (required), `summary` (optional)                      | Добавить запись журнала в `<TendrilHome>/Jobs/`. Работает в автономном режиме, даже если демон остановлен.                                                                                              |

### Конфигурация и обнаружение

| Tool                         | Parameters        | Description                                                                                                                             |
| ---------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `tendril_get_config`         | `key` (optional)  | Чтение публичных значений конфигурации (например, `codingAgent`, `jobTimeout`, `planTemplate`). Конфиденциальные учетные данные скрыты. |
| `tendril_list_projects`      | —                 | Список всех настроенных проектов с путями к их репозиториям, верификациями и настройками.                                               |
| `tendril_list_verifications` | `name` (optional) | Список определений глобальных проверок верификации или просмотр конкретной по имени.                                                    |

> [!NOTE]
> Конфигурация доступна только для чтения через MCP: изменение общесистемных настроек, таких как `planFolder` или `codingAgent`, требует использования CLI (`tendril config set`) или интерфейса Tendril.

## Настройка Claude Code

Добавьте MCP-сервер Tendril в настройки Claude Code (`~/.claude/settings.json` или на уровне проекта `.claude/settings.json`):

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

С включенной аутентификацией по токену:

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
