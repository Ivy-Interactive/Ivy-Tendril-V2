---
title: Провайдеры моделей
description: Настройка провайдеров моделей и бэкендов инференса для агентов
  Tendril v2 с помощью встроенных карточек BYO или встроенного сайдкара
  OpenCode.
icon: Server
groupExpanded: true
searchHints:
  - провайдеры моделей
  - провайдеры
  - api
  - инференс
  - шлюз
  - llm
  - opencode
  - собственная llm
  - byo
---

# Провайдеры моделей

Tendril v2 поддерживает гибкую маршрутизацию провайдеров моделей, позволяя запускать [агентов кодинга](../06_CodingAgents/_Index.md) на европейской суверенной инфраструктуре, унифицированных API-шлюзах, облачных хабах моделей или локальных on-premises эндпоинтах.

В Tendril v2 выполнение запросов к провайдерам моделей осуществляется через два основных механизма:

1. **Нативная поддержка собственной LLM (Bring Your Own LLM / BYO LLM)**: Встроенные карточки настроек и прямая [конфигурация](../03_Configuration/01_Setup.md) в `config.yaml` для [OpenAI](https://openai.com), [Anthropic](https://www.anthropic.com) и европейского суверенного провайдера [Berget AI](01_Berget.md).
2. **Встроенный сайдкар OpenCode**: Tendril v2 поставляется с готовым бинарным файлом [OpenCode](https://opencode.ai) «из коробки» (`binaries/opencode`), обеспечивая прямой доступ к мультипровайдерным шлюзам и пользовательским бэкендам инференса без необходимости ручной установки через CLI (см. [Агент OpenCode](../06_CodingAgents/04_OpenCode.md)).

## Поддерживаемые провайдеры

- [Berget AI](01_Berget.md) ([console.berget.ai](https://console.berget.ai)) — Европейский провайдер инфраструктуры ИИ, предлагающий модели Kimi и GLM с полным хранением данных в ЕС (EU data residency) и первоклассной интеграцией карточек Tendril BYO.
- [Evroc](02_Evroc.md) ([cloud.evroc.com](https://cloud.evroc.com)) — Европейский суверенный облачный провайдер с открытыми моделями для кодинга, включая Kimi, Llama и Mistral.
- [Z.AI](03_Zai.md) ([z.ai](https://z.ai)) — Высокопроизводительный доступ к моделям GLM с выделенными тарифными планами для задач кодинга.
- [Scaleway](04_Scaleway.md) ([scaleway.com](https://www.scaleway.com)) — Европейский облачный провайдер, предоставляющий OpenAI-совместимые Generative API для кодинга и рассуждений (reasoning).
- [Opper.ai](05_Opper.md) ([opper.ai](https://opper.ai)) — Шлюз ИИ, предоставляющий единый доступ к более чем 300 моделям с возможностью хранения данных в ЕС.
- [OpenRouter](06_OpenRouter.md) ([openrouter.ai](https://openrouter.ai)) — Унифицированный API-шлюз, предоставляющий доступ к моделям от Anthropic, OpenAI, Google, Meta и DeepSeek.
- [Cloudflare](07_Cloudflare.md) ([cloudflare.com](https://developers.cloudflare.com/workers-ai/)) — Бессерверный инференс через Cloudflare Workers AI наряду с интеграцией инструментов Workers MCP.
- [NVIDIA](08_NVIDIA.md) ([build.nvidia.com](https://build.nvidia.com)) — Микросервисы корпоративного уровня [NVIDIA NIM](https://build.nvidia.com) и открытые модели, размещенные на NVIDIA Build.
- [Vercel AI Gateway](09_Vercel.md) ([vercel.com](https://vercel.com/docs/ai-gateway)) — Унифицированная мультипровайдерная маршрутизация со встроенной телеметрией, контролем расходов и кэшированием запросов.

## Как работает настройка

### 1. В десктопном приложении Tendril

Перейдите в **Settings > Coding Agent**:

- **Предустановленные агенты**: Выберите из встроенных агентов, включая [Claude Code](../06_CodingAgents/01_ClaudeCode.md), [Copilot](../06_CodingAgents/03_Copilot.md), [Codex](../06_CodingAgents/02_Codex.md), [Gemini](../06_CodingAgents/05_Gemini.md), [Antigravity](https://antigravity.google), [OpenCode](../06_CodingAgents/04_OpenCode.md), [Cursor](https://cursor.com) и [модели на устройствах Apple](https://developer.apple.com).
- **Карточки собственной LLM (BYO LLM)**: Выберите **OpenAI**, **Anthropic** или **Berget AI**. Введите свой API-ключ, и Tendril автоматически настроит соответствующие базовые URL-адреса, распределит их по переменным окружения соответствующих SDK и заполнит значения по умолчанию для уровней профилей.
- **Уровни профилей (Profile Tiers)**: Настройте модели по умолчанию и уровни усилий рассуждения (reasoning effort) для трех уровней выполнения:
  - **Deep**: Высокий уровень рассуждений для архитектурного планирования, сложного рефакторинга и первоначальных черновиков.
  - **Balanced**: Сбалансированные возможности и скорость для повседневной реализации функций и правок по результатам ревью.
  - **Quick**: Быстрые модели с низкой задержкой для генерации сообщений коммитов, проверки тестов и проверки статуса.

### 2. В `config.yaml`

Все настройки провайдеров и агентов сохраняются в `~/.tendril/config.yaml` (см. [Настройка конфигурации](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy # or opencode, claude, codex, gemini, etc.

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "sk-..."
      OPENAI_BASE_URL: "https://api.openai.com/v1"
      ANTHROPIC_API_KEY: "sk-..."
      ANTHROPIC_BASE_URL: "https://api.anthropic.com"
    profiles:
      - name: deep
        model: "gpt-5.6-sol"
        effort: high
      - name: balanced
        model: "gpt-5.6-terra"
        effort: medium
      - name: quick
        model: "gpt-5.6-luna"
        effort: low
```

> [!TIP]
> При сохранении настроек BYO демон Tendril автоматически синхронизирует базовые URL-адреса: SDK [OpenAI](https://openai.com) ожидает `/v1` в конце URL-адреса, тогда как SDK [Anthropic](https://www.anthropic.com) ожидает только хост без `/v1`.

### 3. Через встроенный сайдкар OpenCode

Для провайдеров-шлюзов (таких как [OpenRouter](06_OpenRouter.md), [Evroc](02_Evroc.md), [Scaleway](04_Scaleway.md) или [Opper](05_Opper.md)):

1. Запустите OpenCode через терминал или встроенный терминал Tendril:
   ```bash
   opencode
   ```
2. Введите `/connect` и выберите вашего провайдера или выполните `opencode auth login`.
3. Установите активного агента кодинга в Tendril на OpenCode в разделе **Settings > Coding Agent** (`codingAgent: opencode`).
4. Tendril отправляет все задачи выполнения плана через настроенную среду выполнения [OpenCode](../06_CodingAgents/04_OpenCode.md).

> [!NOTE]
> Tendril v2 автоматически обогащает метаданные доступных моделей через [models.dev](https://models.dev). Кэш сохраняется локально в [SQLite](https://www.sqlite.org) и обновляется в фоновом режиме или по запросу через `POST /api/models/refresh`.
