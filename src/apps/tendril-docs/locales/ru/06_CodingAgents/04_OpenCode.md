---
title: OpenCode
description: OpenCode — это альтернативный агент для написания кода,
  поддерживающий нескольких провайдеров моделей через единый CLI.
icon: Cpu
searchHints:
  - opencode
  - open code
  - агент для написания кода
---

# OpenCode

## Конфигурация

Укажите OpenCode в качестве вашего агента для написания кода в `config.yaml`:

```yaml
codingAgent: opencode
```

Или выберите его в разделе **Settings > Coding Agent** (Настройки > Агент для написания кода).

Дополнительные сведения о структуре и параметрах `config.yaml` см. в разделе [Установка и настройки](../03_Configuration/01_Setup.md).

## Требования

- **Встроенный Sidecar**: Tendril поставляет [OpenCode](https://opencode.ai) как встроенный sidecar вместе с десктопным приложением и автоматически отдает ему предпочтение перед любой версией в PATH. При чистой установке ручная инсталляция не требуется.
- **Автономная установка** (необязательно): Если вы хотите установить или запустить отдельную копию:
  ```bash
  curl -fsSL https://opencode.ai/install | bash
  ```
- **Аутентификация**: Выполните команду `opencode providers login` (или `opencode auth login`) для прохождения аутентификации в выбранном провайдере (например, [Anthropic](https://www.anthropic.com), [OpenAI](https://openai.com), [Google AI](https://ai.google.dev), [Groq](https://groq.com)).

## Профили

Tendril сопоставляет уровни усилий (effort) с моделями OpenCode:

| Профиль    | Модель  | Усилие | Сценарий использования              |
| ---------- | ------- | ------ | ----------------------------------- |
| `deep`     | default | high   | Сложные многофайловые правки        |
| `balanced` | default | medium | Стандартное выполнение плана        |
| `quick`    | default | low    | Простые исправления и мелкие правки |

Уровни усилий напрямую соответствуют флагу `--variant` в OpenCode (`low`, `medium`, `high`, `max`).

Модель по умолчанию в каталоге — `moonshotai/Kimi-K3`. OpenCode также поддерживает закрепленные модели от Anthropic и OpenAI, такие как `claude-fable-5-1`, `claude-opus-5`, `claude-opus-4-7`, `claude-sonnet-5`, `claude-sonnet-4-6` и `gpt-5.5`.

## Bring-Your-Own LLM и провайдеры

OpenCode обеспечивает работу карточек **Bring-Your-Own LLM** (Использование собственной LLM) в Tendril в разделе **Settings > Coding Agent**:

- **[OpenAI](https://openai.com)**: Направляет OpenCode на `https://api.openai.com` с вашим `OPENAI_API_KEY`.
- **[Anthropic](https://www.anthropic.com)**: Направляет OpenCode на `https://api.anthropic.com/v1` с вашим `ANTHROPIC_API_KEY`.
- **[Berget AI](../08_ModelProviders/01_Berget.md)**: Направляет OpenCode на `https://api.berget.ai/v1` с вашим API-ключом [Berget AI](https://berget.ai).
- **Пользовательские эндпоинты**: Настройте пользовательские базовые URL и ключи для любого OpenAI-совместимого или Anthropic-совместимого обратного прокси. Информацию о других провайдерах см. в разделе [Провайдеры моделей](../08_ModelProviders/_Index.md).

Tendril настраивает этих провайдеров без перезаписи исходных файлов с помощью `OPENCODE_CONFIG_CONTENT`, поэтому ваша глобальная конфигурация `opencode.json` никогда не перезаписывается.

## Локальная настройка [Ollama](https://ollama.com)

При запуске OpenCode с локальными моделями [Ollama](https://ollama.com) укажите URL-адрес сервера напрямую в `config.yaml`:

```yaml
codingAgents:
  - name: opencode
    environmentVariables:
      OLLAMA_HOST: "http://localhost:11434"
      OLLAMA_BASE_URL: "http://localhost:11434"
```
