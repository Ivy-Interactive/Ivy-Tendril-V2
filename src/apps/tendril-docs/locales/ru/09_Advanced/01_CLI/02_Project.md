---
title: project
description: Управление проектами, сохраненными в config.yaml. Проекты
  объединяют репозитории, проверки, зависимости сборки, действия ревью,
  MCP-серверы и пользовательские навыки.
icon: FolderGit
searchHints:
  - проект
  - репозиторий
  - проверка
  - сборка
  - зависимость
  - ревью
  - действие
  - mcp
  - навыки
  - синхронизация
  - хуки
---

# project

Управление проектами, сохраненными в `config.yaml`. Проекты объединяют репозитории [Git](https://git-scm.com), [проверки](03_Verification.md), зависимости сборки, действия ревью, серверы [Model Context Protocol (MCP)](https://modelcontextprotocol.io) и пользовательские [навыки агентов](../../06_CodingAgents/00_Skills.md). Для более широких сценариев работы через интерфейс см. [Конфигурация проекта](../../03_Configuration/02_Projects.md).

## CRUD

```terminal
>tendril project list
>tendril project get <name>
>tendril project add <name>
>tendril project rename <name> <new-name>
>tendril project remove <name>
>tendril project set <name> <field> <value>
```

- **list** — выводит список всех настроенных проектов с отображением количества репозиториев и проверок
- **get** — отображает полную информацию о конфигурации в формате [YAML](https://yaml.org), включая репозитории, проверки, действия ревью, зависимости сборки, MCP-серверы и пользовательские навыки
- **add** — создает новую запись проекта в `config.yaml`
- **rename** — переименовывает существующий проект и обновляет все внутренние ссылки
- **remove** — удаляет конфигурацию проекта из `config.yaml`
- **set** — обновляет скалярное поле проекта. Поддерживаемые поля: `color` (строка цвета в hex-формате), `context` (инструкции для агентов в формате markdown), `stackHash`

## Репозитории и синхронизация

```terminal
>tendril project add-repo <project-name> <repo-path>
>tendril project remove-repo <project-name> <repo-path>
>tendril project sync <project-name> [--repo <repo>]
```

- **add-repo** — связывает путь локального чекаута репозитория с проектом
- **remove-repo** — отвязывает путь репозитория от проекта
- **sync** — подтягивает изменения из удаленных веток и выполняет fast-forward для всех репозиториев проекта с помощью [Git](https://git-scm.com). Для разошедшихся репозиториев выводятся диагностические инструкции по устранению проблем.

## Проверки

Проекты определяют, какие [проверки верификации](03_Verification.md) должны быть успешно пройдены перед завершением [плана](01_Plan.md):

```terminal
>tendril project add-verification <project-name> <verification-name> [--required | --optional] [--after <target>]
>tendril project remove-verification <project-name> <verification-name>
>tendril project move-verification <project-name> <verification-name> [--before <target> | --after <target> | --position <pos>]
```

- **add-verification** — привязывает глобальную проверку к данному проекту. По умолчанию является обязательной; передайте флаг `--optional`, чтобы сделать ее рекомендательной, или `--after`, чтобы указать очередность выполнения.
- **remove-verification** — удаляет проверку из проекта.
- **move-verification** — изменяет порядок выполнения относительно других проверок (`--before`, `--after` или отсчитываемая от нуля `--position`).

## Зависимости сборки

```terminal
>tendril project add-build-dep <project-name> <dependency>
>tendril project remove-build-dep <project-name> <dependency>
```

Настраивает внешние бинарные файлы и необходимые инструменты (например, `cargo`, `dotnet`, `node`, [gh](https://cli.github.com)), проверяемые перед выполнением плана.

## Действия ревью

```terminal
>tendril project add-review-action <project-name> <name> --command <cmd> [options]
>tendril project remove-review-action <project-name> <name>
>tendril project review-actions <project-name> [--changed-file <file>...] [--plan <plan>] [--format <table>]
```

Действия ревью — это команды оболочки, выполняемые во время интерактивного ревью кода:

| Параметр           | Действие                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| `--command <cmd>`  | Команда оболочки, выполняемая внутри интерактивного терминала PTY                                    |
| `--condition <ex>` | Необязательное выражение, вычисляемое перед запуском действия                                        |
| `--paths <prefix>` | Фильтр путей относительно репозитория, запускающий это действие при их изменении (может повторяться) |
| `--before <name>`  | Вставить перед существующим действием                                                                |
| `--after <name>`   | Вставить после существующего действия                                                                |

Команда `tendril project review-actions` оценивает и ранжирует действия ревью на основе измененных файлов из рабочего дерева плана.

## MCP-серверы и пользовательские навыки

Проекты могут регистрировать [MCP](https://modelcontextprotocol.io)-серверы уровня проекта и пользовательские навыки агентов:

```terminal
>tendril project list-mcp <project-name>
>tendril project add-mcp <project-name> <server-name> <command> [--arg <arg>...] [--env KEY=VALUE...]
>tendril project remove-mcp <project-name> <server-name>

>tendril project list-skills <project-name>
>tendril project add-skill <project-name> <skill-name> [--description <desc>] [--path <path>] [--instructions <text>]
>tendril project remove-skill <project-name> <skill-name>
```

Чтобы импортировать MCP-серверы или навыки напрямую из существующего репозитория:

```terminal
>tendril project import <project-name> <repo-path> [--mcp-only] [--skills-only]
>tendril project import-mcp <project-name> <repo-path> [--name <server>]
>tendril project import-skills <project-name> <repo-path> [--name <skill>] [--no-copy]
```

## Хуки promptware

Хуки выполняют пользовательские действия оболочки до или после запуска [promptware](../../02_Concepts/02_Promptwares.md):

```terminal
>tendril project add-hook <project-name> <name> --action <action> [options]
>tendril project remove-hook <project-name> <name>
```

| Параметр               | Действие                                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `--when <timing>`      | Момент запуска: `before` (по умолчанию) или `after`                                                             |
| `--promptwares <list>` | Список разделенных запятыми promptware для запуска (например, `ExecutePlan,CreatePr`), или все, если не указано |
| `--action <cmd>`       | Команда оболочки для выполнения                                                                                 |
| `--condition <expr>`   | Выражение, которое должно возвращать true для срабатывания хука                                                 |

## Порты и файлы окружения

Управление именованными портами сервисов и шаблонами файлов `.env`, создаваемыми в рабочих деревьях планов:

```terminal
>tendril project port list <project-name>
>tendril project port add <project-name> <port-name> --default-port <port> [--description <desc>]
>tendril project port remove <project-name> <port-name>

>tendril project env-file list <project-name>
>tendril project env-file add <project-name> <path> [--template <file>] [--override KEY=VALUE...]
>tendril project env-file remove <project-name> <path>
```
