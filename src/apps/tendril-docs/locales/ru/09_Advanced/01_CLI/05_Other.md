---
title: Другие команды
description: Выполнение promptware, оркестрация фоновых задач, сессии чата,
  регистрация фоновых служб и утилиты.
icon: Wrench
searchHints:
  - promptware
  - память
  - инструмент
  - задача
  - чат
  - служба
  - автозапуск
  - launchd
  - systemd
  - статус
  - модели
  - hash-password
  - generate-certs
  - инструкции агента
---

# Другие команды

Справочник по выполнению promptware, отслеживанию фоновых задач, интерактивным сессиям чата, управлению фоновыми службами ОС и утилитам Tendril CLI.

## promptware

Tendril использует [promptware](../../02_Concepts/02_Promptwares.md) для структурирования рабочих процессов выполнения агентов. Подробную информацию см. в разделе [Концепция Promptware](../../02_Concepts/02_Promptwares.md).

#### promptware run

```terminal
>tendril promptware run <name> [args...] [options]
```

Запускает promptware непосредственно на хост-машине в обход очереди задач сервера.

| Опция                  | Описание                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| `--profile <profile>`  | Переопределить профиль рассуждений агента (`deep`, `balanced`, `quick`)                    |
| `--working-dir <path>` | Рабочая директория для процесса выполнения агента                                          |
| `--value <key=value>`  | Дополнительные значения заголовка firmware (можно указывать несколько раз)                 |
| `--plan <id>`          | Идентификатор целевого плана или путь к папке                                              |
| `--agent <provider>`   | Переопределить провайдера агента (`claude`, `antigravity`, `codex`, `copilot`, `opencode`) |
| `--dry-run`            | Вывести скомпилированный firmware в stdout и завершить работу без запуска агента           |

#### Память и инструменты

```terminal
>tendril promptware list-memory <name>
>tendril promptware read-memory <name> [files...]
>tendril promptware write-memory <name> <filename> [--file <path>] [--stdin]
>tendril promptware delete-memory <name> <filename>
>tendril promptware write-tool <name> <tool_name> [--file <path>] [--stdin]
```

Агенты используют эти команды для сохранения усвоенных паттернов в директории `Memory/` соответствующего promptware и создания пользовательских инструментов в `Tools/`.

#### Развертывание и слои

```terminal
>tendril promptware deploy
>tendril promptware layers [name]
```

- **deploy** — компилирует и устанавливает стандартные promptware в `<TendrilHome>/Promptwares/`.
- **layers** — проверяет, какой слой (поставляемый по умолчанию или командный оверлей) предоставил каждый файл promptware.

## job

Управление асинхронными фоновыми задачами агентов. Задачи выполняются через очередь демона и сообщают текущий статус в реальном времени. Для просмотра в графическом интерфейсе см. [Приложение Задачи](../../04_Apps/04_Jobs.md).

#### job list

```terminal
>tendril job list
>tendril job list --status Running
>tendril job list --limit 50
>tendril job list --json
```

Выводит список последних фоновых задач с сервера демона Tendril.

| Опция               | Описание                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `--status <status>` | Фильтрация по статусу (`Pending`, `Queued`, `Running`, `Completed`, `Failed`, `Timeout`, `Stopped`, `Blocked`) |
| `--limit <n>`       | Максимальное количество результатов (по умолчанию: 20)                                                         |
| `--json`            | Вывод задач в виде структурированного JSON                                                                     |

#### job start

```terminal
>tendril job start <job-type> [plan-id] [options]
```

Запускает асинхронную фоновую задачу на работающем демоне Tendril. Поддерживаемые типы задач: `CreatePlan`, `ExecutePlan`, `RetryPlan`, `UpdatePlan`, `ExpandPlan`, `SplitPlan`, `CreatePr`, `CreateIssue`, `SetupProject`, `AddProject`, `SyncRepo`.

| Опция                     | Описание                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `--priority <number>`     | Приоритет для диспетчеризации в очереди (более высокий выполняется первым)              |
| `--chat-session <id>`     | Связать задачу с сессией чата (по умолчанию `$TENDRIL_CHAT_SESSION_ID`)                 |
| `--wait-for <job-id>`     | ID задачи, которая должна завершиться до постановки этой задачи в очередь (повторяемый) |
| `--idempotency-key <key>` | Токен идемпотентности: повторные отправки возвращают существующую задачу вместо новой   |
| `--force`                 | Отправить повторно, даже если аналогичная работа уже выполняется                        |
| `--description <text>`    | Описание задачи (используется с `CreatePlan`)                                           |
| `--project <name>`        | Целевой проект (используется с `CreatePlan`)                                            |
| `--note <text>`           | Примечание к выполнению (используется с `ExecutePlan`)                                  |
| `--instructions <text>`   | Промпт для уточнения (используется с `UpdatePlan`)                                      |
| `--change-request <text>` | Отзыв рецензента (используется с `RetryPlan`)                                           |
| `--repo <name>`           | Репозиторий (используется с `CreateIssue`)                                              |
| `--assignee <user>`       | Имя пользователя исполнителя на GitHub (используется с `CreateIssue` / `CreatePr`)      |
| `--reviewer <user>`       | Имя пользователя рецензента на GitHub (используется с `CreatePr`, повторяемый)          |
| `--draft`                 | Создать как черновой PR (используется с `CreatePr`)                                     |

```terminal
>tendril job start ExecutePlan 00042
>tendril job start RetryPlan 00042 --change-request "Fix failing unit tests"
>tendril job start CreatePlan --description "Add dark mode toggle" --project MyProject
```

#### job status и fail

```terminal
>tendril job status <job-id> --message <text> [--plan-id <id>] [--plan-title <title>]
>tendril job fail <job-id> --message <text>
```

Передает телеметрию прогресса или информацию о сбое задачи напрямую демону. Используется внутри скриптов promptware во время выполнения.

#### job cancel и delete

```terminal
>tendril job cancel <job-id> [--message <reason>]
>tendril job delete <job-id>
```

- **cancel** — отправляет сигнал работающей задаче на прерывание.
- **delete** — удаляет запись о задаче из базы данных (файлы логов на диске сохраняются).

#### job add-log

```terminal
>tendril job add-log <job-id> <action> [--summary <text>]
```

Добавляет запись `## Agent Log` непосредственно в файл лога задачи в `<TendrilHome>/Jobs/`. Работает напрямую с файловой системой и не требует доступности демона сервера.

#### Очередь и обслуживание

```terminal
>tendril job queue [--json]
>tendril job force-start <job-id>
>tendril job stop-all
>tendril job clear [--completed] [--failed] [--all] [-y/--yes]
>tendril job maintenance
```

- **queue** — выводит ожидающие задачи в порядке диспетчеризации
- **force-start** — обходит ограничения параллелизма и зависимостей для немедленного запуска задачи
- **stop-all** — отменяет все активные и находящиеся в очереди задачи
- **clear** — массово удаляет завершенные или неудавшиеся задачи
- **maintenance** — немедленно запускает проход очистки и согласования задач

## chat

Управляйте интерактивными сессиями написания кода с агентами из терминала:

```terminal
>tendril chat list [--json]
>tendril chat get <session-id> [--json]
>tendril chat create [--agent <agent>] [--model <model>] [--title <title>] [--effort <level>] [--plan <folder>] [--json]
>tendril chat send <session-id> "<message>" [--agent <agent>] [--model <model>] [--effort <effort>]
>tendril chat delete <session-id>
```

Команда `tendril chat send` подключается к демону, отправляет шаг промпта и транслирует ответы токенов в реальном времени и события вызова инструментов прямо в stdout.

## service

Управление службой автозапуска фонового демона Tendril на различных платформах:

- **macOS** — регистрирует агент [launchd](https://en.wikipedia.org/wiki/Launchd) в `~/Library/LaunchAgents/io.tendril.daemon.plist`
- **Linux** — регистрирует пользовательский юнит службы [systemd](https://systemd.io)
- **Windows** — регистрирует запланированную задачу в [Task Scheduler](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-start-page)

```terminal
>tendril service install [--no-start] [--force]
>tendril service status [--json]
>tendril service uninstall [--purge-binaries] [--force]
```

- **install** — регистрирует исполняемый файл в качестве фоновой службы. Используйте `--no-start`, чтобы зарегистрировать службу для следующего входа в систему без немедленного запуска.
- **status** — сообщает, зарегистрирована ли служба, загружена ли она и обслуживает ли запросы (включая URL и PID).
- **uninstall** — отменяет регистрацию конфигурации автозапуска. Используйте `--purge-binaries`, чтобы удалить sidecar-компоненты, установленные в `<home>/bin`.

## Утилиты

#### models

```terminal
>tendril models
>tendril models --refresh
```

Выводит список поддерживаемых моделей LLM, принадлежность к провайдерам, лимиты контекстного окна и актуальные цены. Используйте `--refresh`, чтобы получить обновленные тарифы из реестра моделей.

#### generate-certs

```terminal
>tendril generate-certs <output-directory>
```

Генерирует пару самоподписанных PEM-сертификатов `localhost.crt` и `localhost.key` для обслуживания HTTPS с помощью `tendril serve --tls-cert <path> --tls-key <path>`.

#### hash-password

```terminal
>tendril hash-password <password> [secret]
```

Хеширует пароль с помощью [Argon2](https://en.wikipedia.org/wiki/Argon2) для использования в секции `auth:` файла `config.yaml`. Выводит закодированную строку хеша и секретную соль (pepper).

#### project-analyzer

```terminal
>tendril project-analyzer <folder-path>
```

Анализирует директорию и выводит компактный YAML-анализ стека, определяя среды выполнения языков, пакетные менеджеры и фреймворки для тестирования.

#### agent-instructions

```terminal
>tendril agent-instructions
```

Компилирует и выводит полный шаблон системного промпта агента с подставленными путями установки, отформатированный для передачи в промпт автономного агента через конвейер (pipe).

#### wireframe

```terminal
>tendril wireframe setup [path] [--tailwind superset|jit] [--force] [--quiet]
>tendril wireframe serve [path] [--port <port>] [--host <host>] [--no-open]
>tendril wireframe screenshot [path] [--out <path>] [--width <w>] [--height <h>]
>tendril wireframe agent-readme [path]
```

Выполняет скаффолдинг, запуск сервера, предпросмотр с горячей перезагрузкой (hot reload) и создание скриншотов каркасов (wireframes) на React, спроектированных во время составления плана.
