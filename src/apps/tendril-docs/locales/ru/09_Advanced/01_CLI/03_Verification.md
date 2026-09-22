---
title: verification
description: Управление глобальными определениями проверок (verification),
  хранящимися в config.yaml. На них можно ссылаться из проектов и планов.
icon: ClipboardCheck
searchHints:
  - verification
  - проверка
  - проверить
  - промпт
  - определение
  - гейты
---

# verification

Управление глобальными определениями проверок (verification), хранящимися в `config.yaml`. Гейты верификации (verification gates) определяют автоматические проверки качества, сборки и тестов, которым должны соответствовать кодинг-агенты, прежде чем [план](01_Plan.md) сможет перейти в статус `Completed`. Они назначаются проектам с помощью команды [`tendril project add-verification`](02_Project.md#verifications).

## Команды

```terminal
>tendril verification list [--json]
>tendril verification get <name>
>tendril verification add <name> [--prompt <text>]
>tendril verification set <name> [--new-name <name>] [--prompt <text>]
>tendril verification remove <name> [--force]
```

- **list** — отображает все зарегистрированные глобальные проверки. Передайте `--json` для вывода в формате структурированного JSON.
- **get** — выводит имя проверки и полный текст промпта для оценки в stdout.
- **add** — регистрирует новую проверку с опциональным текстом промпта.
- **set** — обновляет промпт определения проверки или переименовывает её. Переименование проверки автоматически обновляет все ссылки в проектах, записи в YAML планов и строки базы данных.
- **remove** — удаляет определение проверки. Если какой-либо активный проект ссылается на эту проверку, Tendril отклонит удаление, если не указан флаг `--force` (или `-f`), который очищает ссылки во всех проектах.

## Примеры

```terminal
># Add a new verification gate with prompt instructions
>tendril verification add CargoTest --prompt "Run cargo test --workspace and ensure all test suites pass with exit code 0."

># Inspect full prompt details
>tendril verification get CargoTest

># Update the evaluation prompt
>tendril verification set CargoTest --prompt "Run cargo test --workspace --all-targets and verify zero test failures."

># Rename a verification definition across projects and plans
>tendril verification set CargoTest --new-name RustWorkspaceTests

># List all definitions in JSON format
>tendril verification list --json

># Remove a verification, cleaning up project references
>tendril verification remove RustWorkspaceTests --force
```

## Связанные разделы

- [проверки проектов](02_Project.md#verifications) — настройка проверок, обязательных для проекта
- [проверки планов](01_Plan.md#verifications) — просмотр или переопределение статусов гейтов верификации в плане
- [Справочник по конфигурации](../../03_Configuration/01_Setup.md) — управление глобальными настройками в `config.yaml`
