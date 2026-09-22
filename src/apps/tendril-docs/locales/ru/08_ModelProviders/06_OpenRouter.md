---
title: OpenRouter
description: Единый API-шлюз, предоставляющий доступ к моделям от Anthropic,
  OpenAI, Google, xAI, Meta, DeepSeek и других.
icon: Globe
searchHints:
  - openrouter
  - роутер
  - мультипровайдер
  - шлюз
---

# OpenRouter

[OpenRouter](https://openrouter.ai) предоставляет единый, совместимый с [OpenAI](https://openai.com) API-шлюз, обеспечивающий доступ к сотням передовых моделей от [Anthropic](https://www.anthropic.com), [OpenAI](https://openai.com), [Google DeepMind](https://deepmind.google), [Meta AI](https://ai.meta.com), [Mistral AI](https://mistral.ai), [DeepSeek](https://www.deepseek.com) и [xAI](https://x.ai). OpenRouter предлагает выгодные цены за токен, автоматическое резервное переключение провайдеров и подробные метрики использования.

## Настройка через OpenCode

1. Создайте API-ключ на [openrouter.ai/keys](https://openrouter.ai/keys) (ключи начинаются с `sk-or-`).
2. Запустите [OpenCode](https://opencode.ai) через терминал или встроенный терминал Tendril:
   ```bash
   opencode
   ```
   Введите `/connect`, выберите **OpenRouter** и вставьте ваш API-ключ.
3. Переключите активную модель с помощью команды `/models`.

### Конфигурация проекта (`opencode.json`)

Вы можете определить модели по умолчанию на уровне проекта в файле `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "openrouter": {
      "models": {
        "~anthropic/claude-sonnet-5": {},
        "~google/gemini-3.8-flash": {},
        "~deepseek/deepseek-r1": {}
      }
    }
  }
}
```

## Использование с Tendril

Вы можете подключить Tendril v2 напрямую к OpenRouter, используя либо графический интерфейс десктопного приложения, либо файл `config.yaml`.

### Вариант A: Настройки приложения (Bring Your Own LLM)

1. Перейдите в **Settings > Coding Agent** в приложении Tendril.
2. В разделе **Bring Your Own LLM** нажмите на карточку **OpenAI**.
3. Установите **Base URL** на `https://openrouter.ai/api/v1`.
4. Введите ваш ключ OpenRouter (`sk-or-...`) в поле **API Key** и нажмите **Save**.

### Вариант B: Ручная настройка в `config.yaml`

Настройте OpenRouter в секции `codingAgents` файла `~/.tendril/config.yaml` (см. [Настройка конфигурации](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "sk-or-..."
      OPENAI_BASE_URL: "https://openrouter.ai/api/v1"
    profiles:
      - name: deep
        model: "anthropic/claude-opus-5"
        effort: max
      - name: balanced
        model: "anthropic/claude-sonnet-5"
        effort: high
      - name: quick
        model: "google/gemini-3.8-flash"
        effort: low
```

> [!TIP]
> Идентификаторы моделей OpenRouter содержат префиксы поставщиков (например, `anthropic/claude-opus-5` или `deepseek/deepseek-r1`). Эти префиксы должны указываться точно так же в полях `model` ваших профилей.

## Ссылки

- [Провайдеры моделей](_Index.md)
- [Агенты кодинга](../06_CodingAgents/_Index.md)
- [Платформа OpenRouter](https://openrouter.ai)
- [Руководство по интеграции OpenRouter + OpenCode](https://openrouter.ai/docs/cookbook/coding-agents/opencode-integration)
