---
title: plan
description: Создание, чтение, обновление и валидация планов из терминала. Все
  подкоманды определяют папку планов из TENDRIL_PLANS, TENDRIL_HOME/Plans или
  ~/.tendril/Plans, если переменные окружения не заданы.
icon: ListChecks
searchHints:
  - план
  - создать
  - список
  - получить
  - установить
  - обновить
  - валидировать
  - репозиторий
  - pr
  - коммит
  - проверка
  - рекомендация
  - rec
  - журнал
  - ревизия
  - доктор
  - зависит
  - связанный
  - env
  - вайрфреймы
---

# plan

Создание, чтение, обновление и валидация планов из терминала. Все подкоманды определяют папку планов из `TENDRIL_PLANS`, `TENDRIL_HOME/Plans` или `~/.tendril/Plans`, если переменные окружения не заданы.

## CRUD

#### plan create

```terminal
>tendril plan create <title> <project> [options]
```

Создает новую папку плана и шаблон `plan.yaml` в состоянии `Draft`. Идентификатор плана автоматически выделяется из файла `.counter`. Репозитории и стандартные проверки берутся из конфигурации проекта.

| Параметр                        | Описание                                                          |
| ------------------------------- | ----------------------------------------------------------------- |
| `--level <level>`               | Уровень приоритета (по умолчанию: Feature)                        |
| `--initial-prompt <text>`       | Текст начального промпта                                          |
| `--source-url <url>`            | Исходный URL (GitHub issue или PR)                                |
| `--execution-profile <profile>` | Профиль выполнения (`deep` или `balanced`)                        |
| `--priority <number>`           | Номер приоритета (по умолчанию: 0)                                |
| `--verification <Name=Status>`  | Запись проверки (можно повторять)                                 |
| `--related-plan <folder>`       | Имя папки связанного плана (можно повторять)                      |
| `--depends-on <folder>`         | Имя папки зависимого плана (можно повторять)                      |
| `--chat-session <id>`           | Связать с сессией чата                                            |
| `--plans-dir <path>`            | Переопределить путь к каталогу планов                             |
| `--no-duplicate-check`          | Пропустить проверку дубликатов среди существующих активных планов |

#### plan list

```terminal
>tendril plan list [options]
```

Выводит список планов с возможностью фильтрации.

| Параметр                   | Назначение                                                         |
| -------------------------- | ------------------------------------------------------------------ |
| `--status` / `--state <s>` | Фильтрация по состоянию (например, `Draft`, `Executing`, `Failed`) |
| `-p, --project <name>`     | Фильтрация по имени проекта (проверяется по настроенным проектам)  |
| `--level <level>`          | Фильтрация по уровню (например, `Bug`, `Feature`, `Epic`)          |
| `--has-pr`                 | Только планы, имеющие связанные PR                                 |
| `--has-worktree`           | Только планы, имеющие рабочие деревья (worktrees)                  |
| `-q, --search <query>`     | Фильтрация по подстроке поиска в заголовке или ID                  |
| `--limit <n>`              | Максимальное количество результатов                                |
| `--format <fmt>`           | Формат вывода: `table` (по умолчанию), `ids`, `folders`, `json`    |
| `--plans-dir <path>`       | Переопределить путь к каталогу планов                              |

```terminal
>tendril plan list --state Draft
>tendril plan list --project Tendril --level Critical
>tendril plan list --state Failed --format ids
>tendril plan list --format json --limit 10
```

> [!NOTE]
> `plan list` показывает планы (из файлов `plan.yaml`), а не задачи (jobs). Историю задач и статус выполнения смотрите с помощью `job list` (см. [Other Commands](05_Other.md#job-list)).

#### plan get

```terminal
>tendril plan get <plan-id> [field]
```

Выводит полный YAML или значение одного поля, если указан `[field]`.

**Скалярные поля:** `id`, `title`, `state`, `project`, `level`, `created`, `updated`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`, `partialDelivery`

**Поля-списки:** `repos`, `prs`, `commits`, `verifications`, `dependsOn`, `relatedPlans`, `recommendations` (каждый элемент на отдельной строке)

#### plan set

```terminal
>tendril plan set <plan-id> <field> <value> [options]
>tendril plan set <plan-id> state Completed --allow-failed-verifications
```

Обновляет отдельное поле и автоматически обновляет временную метку `updated`.

Поддерживаемые поля: `state`, `title`, `level`, `project`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`.

Установка `state` в `Completed` отклоняется, если хотя бы одна проверка находится в состоянии `Fail`: план, помеченный как выполненный при непройденной проверке, скрывает недоставленный результат от механизма обнаружения дубликатов. Запустите проверку повторно или установите для неё состояние `Skipped` с указанием явной причины. Передача `--allow-failed-verifications` в любом случае фиксирует переход и устанавливает `partialDelivery: true`.

| Параметр                       | Назначение                                                            |
| ------------------------------ | --------------------------------------------------------------------- |
| `--allow-failed-verifications` | Разрешить переход в `Completed` даже при непройденных проверках       |
| `--reason <text>`              | Объяснить причину редактирования (передается слушающим сессиям чата)  |
| `--chat-session <id>`          | Исходная сессия чата (исключается из отправки уведомления самой себе) |

#### plan update

```terminal
>cat revised.yaml | tendril plan update <plan-id> --stdin
>tendril plan update <plan-id> --file revised.yaml
```

Заменяет все содержимое `plan.yaml` из `--file` или `--stdin` (обязательно — `--stdin` не подразумевается автоматически).

#### plan check-wireframes

```terminal
>tendril plan check-wireframes <plan-id>
```

Проверяет измененные файлы плана на предмет утечки кода вайрфреймов. Завершается с кодом 0, если всё чисто, или с кодом 1 с диагностическим отчетом при обнаружении маркеров вайрфреймов.

#### plan validate

```terminal
>tendril plan validate <plan-id>
```

Проверяет наличие всех обязательных полей плана и его внутреннюю согласованность. Завершается с кодом `1` при структурных ошибках.

## Repos

```terminal
>tendril plan add-repo <plan-id> <repo-path> [--reason <text>] [--chat-session <id>]
>tendril plan remove-repo <plan-id> <repo-path> [--reason <text>] [--chat-session <id>]
```

Управление списком репозиториев, связанных с планом. Добавление уже существующего репозитория является идемпотентной операцией no-op.

## Links

```terminal
>tendril plan add-pr <plan-id> <pr-url> [--reason <text>] [--chat-session <id>]
>tendril plan remove-pr <plan-id> <pr-url> [--reason <text>] [--chat-session <id>]
>tendril plan add-commit <plan-id> <sha> [--reason <text>] [--chat-session <id>]
>tendril plan add-related-plan <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
>tendril plan remove-related-plan <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
>tendril plan add-depends-on <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
>tendril plan remove-depends-on <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
```

Управление URL-адресами PR, SHA коммитов, связанными планами и блокирующими зависимостями. `add-depends-on` заставляет `ExecutePlan` ожидать перехода зависимости в состояние `Completed` и слияния её PR перед выполнением. Все имена сопоставляются без учета регистра.

## Verifications

```terminal
>tendril plan set-verification <plan-id> <name> <status> [--reason <text>] [--chat-session <id>]
>tendril plan verification list <plan-id> [--status <status>] [--json]
>tendril plan verification add <plan-id> <name> [--status <status>] [--reason <text>] [--chat-session <id>]
>tendril plan verification remove <plan-id> <name> [--reason <text>] [--chat-session <id>]
```

Управление проверками плана. Допустимые статусы: `Pending`, `Pass`, `Fail`, `Skipped`. Статус по умолчанию для `add` — `Pending`.

## Worktrees

#### plan cleanup

```terminal
>tendril plan cleanup <plan-id> [--force]
```

Удаляет все рабочие деревья git (worktrees), связанные с планом. По умолчанию выполняется только для планов в терминальном состоянии (`Completed`, `Failed`, `Skipped`, `Icebox`). Используйте `--force` для удаления рабочих деревьев нетерминальных планов.

#### plan add-worktree

```terminal
>tendril plan add-worktree <plan-id> <repo> [--base <branch>]
```

Создает рабочее дерево git для указанного плана по пути `<plan-folder>/Worktrees/<repo-name>`, ответвляясь от `origin/<base>` (по умолчанию: автоматически определенная ветка по умолчанию). Ветка получает имя `tendril/<plan-folder-name>`.

#### plan remove-worktree

```terminal
>tendril plan remove-worktree <plan-id> <repo-name> [--branch <branch>]
```

Удаляет отдельное рабочее дерево из `Worktrees/<repo-name>`. Сначала выполняется попытка `git worktree remove --force`; в случае неудачи выполняется принудительное удаление. Также удаляется связанная ветка (`tendril/<plan-folder>` по умолчанию).

## Revisions

```terminal
>cat revision.md | tendril plan write-revision <plan-id> --stdin
>tendril plan write-revision <plan-id> --file revision.md
```

Записывает пронумерованный файл ревизии в `Revisions/` (например, `002.md`) из stdin или `--file`. Поддерживает `--no-question-check` для обхода валидации, а также `--reason` / `--chat-session` для указания авторства в аудите.

```terminal
>tendril plan get-revision <plan-id> [--number <n>]
```

Выводит содержимое ревизии в stdout — последней ревизии по умолчанию или конкретной пронумерованной ревизии при указании `--number`.

## Questions

Ревизия может содержать вопросы для пользователя в блоках `questions`:

````markdown
```questions
questions:                    # 1-4 элемента
  - id:          string       # обязательно, стабильный, уникальный во всей ревизии
    title:       string       # обязательно, вопрос
    header:      string       # опционально, метка <=12 символов
    description: markdown     # опционально, контекст, отображаемый под вопросом
    multiple:    bool         # опционально, по умолчанию false; true = множественный выбор
    options:                  # 2-4 элемента; опустите полностью для вопроса со свободным текстовым ответом
      - title:       string   # обязательно, 1-5 слов
        description: markdown # опционально
        value:       slug     # обязательно, ^[a-z0-9][a-z0-9-]*$, используется в `answer`
        recommended: bool     # опционально, не более одного на вопрос
    answer:      value | [values] | string   # заполняется при ответе
```
````

`write-revision` валидирует каждый блок вопросов на соответствие этой схеме и отклоняет ревизию при некорректной структуре блока. Используйте `--no-question-check` только в автоматизированных тестах.

## Recommendations

```terminal
>tendril plan rec list <plan-id> [--state <state>]
>tendril plan rec all [--project <project>] [--state <state>]
>tendril plan rec rebuild
>tendril plan rec add <plan-id> <title> [-d <description>] [--impact <level>]
>tendril plan rec set <plan-id> <title> <field> <value>
>tendril plan rec accept <plan-id> <title> [--notes <text>]
>tendril plan rec decline <plan-id> <title> [--reason <text>] [--edit-reason <text>]
>tendril plan rec remove <plan-id> <title>
```

Управление рекомендациями, хранящимися в YAML плана:

- **list** — список рекомендаций для плана; фильтрация по состоянию: `Pending`, `Accepted`, `AcceptedWithNotes`, `Declined`
- **all** — список рекомендаций по всем планам
- **rebuild** — перестроить денормализованную проекцию рекомендаций с диска
- **add** — уровни влияния: `Small`, `Medium`, `High`
- **set** — поддерживаемые поля: `title`, `description`, `state`, `impact`, `declineReason`, `notes`
- **accept** — переводит состояние в `Accepted` или в `AcceptedWithNotes`, если указан `--notes`
- **decline** — переводит состояние в `Declined`. `--reason` сохраняет причину отклонения в `plan.yaml`; `--edit-reason` указывает причину уведомления для сессий чата
- **remove** — безвозвратно удаляет рекомендацию

## Environment

```terminal
>tendril plan env materialize <plan-id> [--repo <repo>] [--force] [--json]
>tendril plan env get <plan-id> [--repo <repo>] [--json]
```

Просмотр и запись выделенных портов плана и файлов окружения:

- **materialize** — выделяет неконфликтующие порты сервисов и записывает файлы окружения в рабочие деревья плана. Используйте `--force` для перезаписи существующих файлов.
- **get** — выводит выделенные порты и разрешенные переменные окружения для рабочего дерева.

## Doctor

```terminal
>tendril plan doctor [options]
```

Сканирует каждую папку в каталоге планов и сообщает о проблемах с состоянием.

| Параметр        | Назначение                                                                        |
| --------------- | --------------------------------------------------------------------------------- |
| `--fix`         | Автоматически мигрировать схемы планов на последнюю версию                        |
| `--prs`         | Проверить каждый сохраненный pull request на GitHub через `gh`                    |
| `--prune-husks` | Удалить пустые папки планов, не содержащие ревизий и рабочих артефактов           |
| `--dry-run`     | Вместе с `--prune-husks` сообщает, что было бы удалено, без фактического удаления |

```terminal
>tendril plan doctor
>tendril plan doctor --fix
>tendril plan doctor --prs
>tendril plan doctor --prune-husks --dry-run
```

### Partial delivery backfill

В отчете перечисляются планы, помеченные как `Completed`, имеющие проверку в состоянии `Fail` и без флага `partialDelivery`. Они были созданы до появления проверки завершения. Чтобы подтвердить частичную доставку:

```terminal
>tendril plan set <id> state Completed --allow-failed-verifications
```
