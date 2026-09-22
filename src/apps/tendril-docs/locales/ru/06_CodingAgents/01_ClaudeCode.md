---
title: Claude Code
description: Claude Code — это агент написания кода по умолчанию в Tendril,
  работающий на базе моделей Claude от Anthropic.
icon: Bot
searchHints:
  - claude
  - claude code
  - anthropic
  - агент написания кода
  - ии агент
---

# Claude Code

## Конфигурация

Укажите Claude Code в качестве вашего агента написания кода в `config.yaml`:

```yaml
codingAgent: claude
```

Или выберите его в **Settings > Coding Agent**.

Для получения дополнительной информации о структуре и настройках `config.yaml` см. [Настройка и параметры](../03_Configuration/01_Setup.md).

## Требования

- CLI [Claude Code](https://code.claude.com/docs) должен быть установлен и доступен как `claude` в вашей переменной PATH. Используйте нативный установщик или cask [Homebrew](https://brew.sh):
  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  # или: brew install --cask claude-code
  ```
- Перед использованием Tendril выполните аутентификацию, запустив `claude auth login` (или `claude login`). Для Claude Code требуется тарифный план [Anthropic](https://www.anthropic.com) Pro, Max, Team, Enterprise или [Console](https://console.anthropic.com) (бесплатный уровень claude.ai не включает доступ к CLI).
- Для headless-окружений или альтернативных бэкендов задайте переменную `ANTHROPIC_API_KEY` либо настройте [AWS Bedrock](https://aws.amazon.com/bedrock/) (`CLAUDE_CODE_USE_BEDROCK=1`) или [Google Cloud Vertex AI](https://cloud.google.com/vertex-ai) (`CLAUDE_CODE_USE_VERTEX=1`).

## Профили

Tendril сопоставляет уровни усилий с моделями Claude:

| Профиль    | Модель | Усилие | Сценарий использования                             |
| ---------- | ------ | ------ | -------------------------------------------------- |
| `deep`     | opus   | max    | Сложные многофайловые изменения, архитектура       |
| `balanced` | sonnet | high   | Стандартное выполнение планов, большинство задач   |
| `quick`    | haiku  | low    | Простые исправления, форматирование, мелкие правки |

Профиль выбирается автоматически на основе [уровня сложности плана](../02_Concepts/01_Plans.md) или может быть настроен для каждого [промптвара (promptware)](../02_Concepts/02_Promptwares.md) в `config.yaml`.

## Доступные модели

| Модель           | ID                 | Окно контекста | Стоимость (вход / выход за MTok) |
| ---------------- | ------------------ | -------------- | -------------------------------- |
| Claude Fable 5.1 | `claude-fable-5-1` | 1M             | $10.00 / $50.00                  |
| Claude Opus 5    | `claude-opus-5`    | 1M             | $5.00 / $25.00                   |
| Claude Opus      | `opus`             | 1M             | $5.00 / $25.00                   |
| Claude Sonnet 5  | `claude-sonnet-5`  | 1M             | $2.00 / $10.00                   |
| Claude Sonnet    | `sonnet`           | 1M             | $2.00 / $10.00                   |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200k           | $1.00 / $5.00                    |
| Claude Haiku     | `haiku`            | 200k           | $1.00 / $5.00                    |

`opus`, `sonnet` и `haiku` — это псевдонимы Claude Code, которые отслеживают текущую модель Anthropic для соответствующего уровня, тогда как `claude-opus-5` (по умолчанию в каталоге) и `claude-fable-5-1` являются фиксированными идентификаторами.

Ознакомительная стоимость Claude Sonnet в $2.00 / $10.00 действует до 2026-08-31; после этого применяется стандартная стоимость $3.00 / $15.00.

## Плагин навыков Tendril

Вы можете установить официальные навыки инженерии и отладки Tendril в виде плагина Claude Code:

```
/plugin marketplace add ivy-interactive/ivy-tendril-v2
/plugin install tendril-skills@ivy-tendril-v2
```

Во время локальной разработки и тестирования загружайте навыки напрямую из вашего репозитория:

```bash
claude --plugin-dir /path/to/ivy-tendril-v2
```

Для получения дополнительной информации см. [Навыки агента](00_Skills.md).
