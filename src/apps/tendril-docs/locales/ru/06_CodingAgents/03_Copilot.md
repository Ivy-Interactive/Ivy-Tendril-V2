---
title: Copilot
description: Copilot — это альтернативный агент для написания кода на базе
  GitHub Copilot CLI.
icon: Bot
searchHints:
  - copilot
  - github
  - агент для написания кода
---

# Copilot

## Конфигурация

Укажите Copilot в качестве агента для написания кода в `config.yaml`:

```yaml
codingAgent: copilot
```

Или выберите его в **Settings > Coding Agent**.

Подробнее о структуре `config.yaml` и параметрах см. в разделе [Установка и настройки](../03_Configuration/01_Setup.md).

## Требования

- Утилита [GitHub Copilot CLI](https://github.com/features/copilot) должна быть доступна как `copilot` в переменной PATH. Установите её с помощью официального скрипта или cask-пакета [Homebrew](https://brew.sh):
  ```bash
  curl -fsSL https://gh.io/copilot-install | bash
  # или: brew install --cask copilot-cli
  ```
  Tendril автоматически переключается на `gh copilot`, если отдельный бинарный файл `copilot` не найден, но установлен [GitHub CLI](https://cli.github.com) (`gh`).
- Требуется активная подписка [GitHub Copilot](https://github.com/features/copilot).
- **Аутентификация**: В CLI Copilot отсутствует команда `login`, и он не использует общие учетные данные с `gh auth login`. Чтобы войти:
  1. Запустите CLI в терминале: `copilot`
  2. В командной строке выполните слэш-команду: `/login`
  3. Для автономных (headless) или автоматических CI-сред задайте переменную окружения `COPILOT_GITHUB_TOKEN` (или `GH_TOKEN`) с персональным токеном доступа, имеющим разрешение `Copilot Requests`.

## Профили

Tendril сопоставляет уровни усилий (effort) с Copilot:

| Profile    | Model   | Effort | Use Case                               |
| ---------- | ------- | ------ | -------------------------------------- |
| `deep`     | gpt-5.4 | high   | Сложные многофайловые изменения        |
| `balanced` | gpt-5.4 | medium | Стандартное выполнение планов          |
| `quick`    | gpt-5.4 | low    | Простые исправления и небольшие правки |

Профиль выбирается автоматически на основе [уровня сложности плана](../02_Concepts/01_Plans.md) или может быть настроен для каждого [промптваря](../02_Concepts/02_Promptwares.md) в `config.yaml`.

Модель по умолчанию для Copilot в Tendril — `gpt-5.4`.

### Поддерживаемые модели

GitHub Copilot поддерживает модели как OpenAI, так и Anthropic через свою среду выполнения:

- **Модели [OpenAI](https://openai.com)**: `gpt-5.4` (по умолчанию), `gpt-5.4-mini`, `gpt-5.3-codex`, `gpt-5.2-codex`, `gpt-5.2`, `gpt-5-mini`, `gpt-4.1` (уровень рассуждений: `low`, `medium`, `high`, `xhigh`).
- **Модели [Anthropic Claude](https://code.claude.com/docs)**: `claude-fable-5-1`, `claude-opus-5`, `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-sonnet-4-5`, `claude-haiku-4-5` (уровень рассуждений: `low`, `medium`, `high`, `xhigh`, `max`).

## Установка навыков Tendril для GitHub Copilot

Tendril предоставляет специализированные навыки для GitHub Copilot в [Visual Studio Code](https://code.visualstudio.com), охватывающие отладку планов, проверку артефактов задач, код-ревью и рассмотрение issue.

### Использование Skills CLI

Установите навыки для вашей рабочей области:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot
```

Или установите глобально для всех рабочих областей:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot -g
```

### Ручное размещение в `.agents/skills/`

Навыки также можно разместить непосредственно в каталоге `.agents/skills/`, `.github/skills/` или `~/.copilot/skills/`:

```bash
mkdir -p .agents/skills
cp -r /path/to/skills/* .agents/skills/
```

После установки навыки появятся в GitHub Copilot Chat в меню `/skills` и могут вызываться напрямую как слэш-команды (например, `/tendril-debug-plan`, `/tendril-review`).

Подробнее см. в разделе [Навыки агента](00_Skills.md).
