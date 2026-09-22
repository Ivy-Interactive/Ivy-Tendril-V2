---
title: vault
description: Управление командными хранилищами конфигураций (vaults),
  обнаружение и подключение общих репозиториев на GitHub, просмотр ресурсов
  каталога, импорт проектов и публикация обновлений конфигурации напрямую из
  CLI.
icon: KeyRound
searchHints:
  - хранилище
  - синхронизация
  - pull
  - импорт
  - push
  - каталог
  - обнаружение
  - подключение
  - автосинхронизация
  - команда
---

# vault

Управление командными хранилищами конфигураций на базе [Git](https://git-scm.com) и [GitHub](https://github.com). Хранилища позволяют командам совместно использовать конфигурации проектов, пользовательские навыки (skills), конфигурации серверов [Model Context Protocol (MCP)](https://modelcontextprotocol.io), память promptware и проверки (verifications) на разных рабочих станциях. CLI взаимодействует с [GitHub CLI (`gh`)](https://cli.github.com) для обнаружения репозиториев команды, импорта шаблонов проектов и отправки обновлений через [GitHub Pull Requests](https://docs.github.com/en/pull-requests).

Смотрите [Projects](02_Project.md) для настройки локальных проектов и [Global Config](06_Config.md) для глобальных параметров.

## Команды

```terminal
>tendril vault list [--json]
>tendril vault status [vault-id] [--json]
>tendril vault discover [--json]
>tendril vault connect <repo-url> [--name <custom-name>]
>tendril vault create <repo-name> [--public] [--org <org>]
>tendril vault disconnect [vault-id] [-y, --yes]
>tendril vault sync [vault-id]
>tendril vault pull [vault-id]
>tendril vault set-auto-sync <enabled> [--vault <vault-id>]
>tendril vault catalog [vault-id] [--json]
>tendril vault import <project-name> [options]
>tendril vault push <projects...> [options]
>tendril vault delete <project-name> [--vault <vault-id>] [-y, --yes]
```

## Управление хранилищами

#### list

```terminal
>tendril vault list
>tendril vault list --json
```

Отображает список всех подключенных хранилищ, показывая их ID, имя, URL удаленного репозитория [Git](https://git-scm.com), активную ветку, количество опережающих/отстающих коммитов (ahead/behind), временную метку последней синхронизации и статус автосинхронизации.

#### status

```terminal
>tendril vault status
>tendril vault status <vault-id>
>tendril vault status --json
```

Отображает подробную диагностику и статус синхронизации для конкретного хранилища или основного настроенного хранилища, включая незакоммиченные локальные изменения и состояние отслеживания ветки.

#### discover

```terminal
>tendril vault discover
>tendril vault discover --json
```

Выполняет сканирование [GitHub](https://github.com) с помощью [GitHub CLI (`gh`)](https://cli.github.com) для поиска существующих репозиториев хранилищ, доступных вашей учетной записи и организациям.

#### connect

```terminal
>tendril vault connect https://github.com/my-org/team-vault.git
>tendril vault connect my-org/team-vault --name "Engineering Vault"
```

Подключает существующий репозиторий [Git](https://git-scm.com) в качестве командного хранилища. Принимает полные URL репозиториев или краткую запись вида `org/repo`.

#### create

```terminal
>tendril vault create engineering-vault
>tendril vault create team-vault --org my-org --public
```

Создает новый репозиторий на [GitHub](https://github.com) (по умолчанию приватный), инициализирует стандартную структуру каталогов хранилища и подключает его локально. Используйте `--org` для указания организации и `--public` для публичной видимости.

#### disconnect

```terminal
>tendril vault disconnect
>tendril vault disconnect <vault-id> -y
```

Отключает хранилище от локальной конфигурации Tendril без удаления локального каталога клонирования. Передайте `-y` или `--yes`, чтобы пропустить запрос подтверждения.

#### sync / pull

```terminal
>tendril vault sync
>tendril vault pull
>tendril vault sync <vault-id>
```

Загружает последние коммиты конфигурации из удаленного репозитория хранилища и обновляет отслеживаемые локальные проекты. `pull` является псевдонимом для `sync`.

#### set-auto-sync

```terminal
>tendril vault set-auto-sync true
>tendril vault set-auto-sync false --vault <vault-id>
```

Включает или отключает автоматическую синхронизацию для хранилища. Принимает значения `true`, `false`, `1`, `0`, `yes` или `no`.

## Каталог и совместный доступ к проектам

#### catalog

```terminal
>tendril vault catalog
>tendril vault catalog <vault-id> --json
```

Отображает список всех проектов и количество ресурсов (репозитории, пользовательские навыки, серверы [Model Context Protocol (MCP)](https://modelcontextprotocol.io), память promptware и проверки), опубликованных в каталоге хранилища.

#### import

```terminal
>tendril vault import MyProject
>tendril vault import MyProject --target-name LocalProject --merge
>tendril vault import MyProject --repo api=~/code/api --repo web=~/code/web
```

Импортирует определение проекта из каталога хранилища в локальную конфигурацию Tendril.

| Опция                  | Описание                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| `--target-name <name>` | Пользовательское имя локального проекта для регистрации вместо имени из каталога                       |
| `--vault <vault-id>`   | ID или имя хранилища для импорта (по умолчанию используется активное хранилище)                        |
| `--repo <name=path>`   | Сопоставить идентификатор репозитория хранилища с путем в локальной файловой системе (можно повторять) |
| `--no-permissions`     | Пропустить импорт правил безопасности и разрешений на выполнение                                       |
| `--merge`              | Объединить настройки с существующим локальным проектом вместо его перезаписи                           |

#### push

```terminal
>tendril vault push MyProject
>tendril vault push ProjectA ProjectB --version "1.2.0" --changelog "Added new skills and verifications"
>tendril vault push MyProject --reviewer alice,bob --title "feat(vault): update MyProject"
```

Собирает конфигурацию проекта, пользовательские навыки, конфигурации [Model Context Protocol (MCP)](https://modelcontextprotocol.io), память promptware и проверки, фиксирует их в ветке функциональности (feature branch) и открывает [GitHub Pull Request](https://docs.github.com/en/pull-requests) к репозиторию хранилища.

| Опция                 | Описание                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| `--vault <vault-id>`  | Идентификатор целевого хранилища                                                                         |
| `--version <version>` | Пользовательская строка версии (по умолчанию метка времени UTC)                                          |
| `--changelog <text>`  | Заметки списка изменений, включаемые в описание pull request                                             |
| `--title <title>`     | Пользовательский заголовок для создаваемого pull request                                                 |
| `--body <body>`       | Пользовательское описание для pull request                                                               |
| `--reviewer <names>`  | Имя/имена пользователей [GitHub](https://github.com) в качестве проверяющих (через запятую или повтором) |

#### delete

```terminal
>tendril vault delete OldProject
>tendril vault delete OldProject --vault <vault-id> -y
```

Удаляет проект из репозитория хранилища и создает [GitHub Pull Request](https://docs.github.com/en/pull-requests) для применения удаления. Передайте `-y` или `--yes`, чтобы пропустить подтверждение.

## Примеры

**Подключение и синхронизация командного хранилища:**

```terminal
># Поиск доступных командных хранилищ на GitHub
>tendril vault discover

># Подключение репозитория хранилища
>tendril vault connect https://github.com/my-org/shared-vault.git

># Загрузка обновлений
>tendril vault sync
```

**Импорт проекта из каталога:**

```terminal
># Просмотр доступных проектов в каталоге
>tendril vault catalog

># Импорт с пользовательскими локальными путями к репозиториям
>tendril vault import BackendService --repo backend=~/Projects/backend
```

**Публикация обновлений проекта через pull request:**

```terminal
># Отправка изменений и открытие pull request с назначенными проверяющими
>tendril vault push BackendService --changelog "Added Playwright E2E verification" --reviewer alice,bob
```
