---
title: Codex
description: Codex — это альтернативный агент для написания кода на базе моделей
  GPT от OpenAI.
icon: Terminal
searchHints:
  - codex
  - openai
  - gpt
  - агент для написания кода
---

# Codex

## Конфигурация

Укажите Codex в качестве вашего агента для написания кода в `config.yaml`:

```yaml
codingAgent: codex
```

Или выберите его в разделе **Настройки > Агент для написания кода** (**Settings > Coding Agent**).

Подробнее о структуре и параметрах `config.yaml` см. в разделе [Настройка и параметры](../03_Configuration/01_Setup.md).

## Требования

- CLI [Codex](https://chatgpt.com/codex) должен быть установлен и доступен как `codex` в переменной окружения PATH. Установите его с помощью официального скрипта или cask-пакета [Homebrew](https://brew.sh):
  ```bash
  curl -fsSL https://chatgpt.com/codex/install.sh | sh
  # or: brew install --cask codex
  ```
- Перед использованием Tendril пройдите аутентификацию, выполнив:
  ```bash
  codex login
  ```
  Для автономных сред без графического интерфейса передайте [API-ключ платформы OpenAI](https://platform.openai.com/api-keys) через стандартный ввод (stdin):
  ```bash
  printenv OPENAI_API_KEY | codex login --with-api-key
  ```

## Профили

Tendril сопоставляет уровни усилий (effort levels) с моделями Codex:

| Профиль    | Модель        | Усилие | Вариант использования               |
| ---------- | ------------- | ------ | ----------------------------------- |
| `deep`     | gpt-5.6-sol   | high   | Сложные многофайловые правки        |
| `balanced` | gpt-5.6-terra | medium | Стандартное выполнение плана        |
| `quick`    | gpt-5.6-luna  | low    | Простые исправления и мелкие правки |

Профиль выбирается автоматически в зависимости от [уровня сложности плана](../02_Concepts/01_Plans.md) или может быть настроен отдельно для каждого [promptware](../02_Concepts/02_Promptwares.md) в `config.yaml`.

Моделью по умолчанию для Codex в Tendril является `gpt-5.6-terra`.

### Поддерживаемые модели и уровень рассуждений (Reasoning Effort)

Каталог Codex поддерживает следующие модели [OpenAI](https://openai.com):

- `gpt-6-astra`
- `gpt-5.6-sol`
- `gpt-5.6-terra` (по умолчанию)
- `gpt-5.6-luna`
- `gpt-5.5`
- `gpt-5.4` / `gpt-5.4-mini`
- `gpt-5.3-codex`
- `o3` / `o4-mini`
- `gpt-4.1`
- `codex-mini`

Codex поддерживает пять уровней рассуждений (reasoning effort): `none`, `low`, `medium`, `high` и `xhigh`. Уровень `none` позволяет запускать Codex без затрат на рассуждения для быстрого внесения правок.

## Выполнение и изоляция (Sandboxing)

Tendril запускает Codex с помощью `codex exec` в неинтерактивном режиме:

- Режим изоляции по умолчанию настроен на `--sandbox workspace-write` с включенным доступом к сети. Если режим изоляции отключен в настройках безопасности проекта, Tendril передает флаг `danger-full-access`.
- Дополнительные разрешенные пути из правил безопасности передаются через `--add-dir`.
- Настроенные серверы [MCP (Model Context Protocol)](https://modelcontextprotocol.io) записываются во временный конфигурационный файл JSON и передаются через `--mcp-config`.
