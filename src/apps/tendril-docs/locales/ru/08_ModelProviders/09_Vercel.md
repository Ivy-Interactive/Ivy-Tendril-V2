---
title: Vercel AI Gateway
description: Маршрутизируйте запросы через Vercel AI Gateway для единого доступа
  к моделям OpenAI, Anthropic, Google и моделям с открытыми весами со встроенной
  наблюдаемостью.
icon: Zap
searchHints:
  - vercel
  - ai gateway
  - единый доступ
  - наблюдаемость
---

# Vercel AI Gateway

[Vercel AI Gateway](https://vercel.com/docs/ai-gateway) предоставляет единый прокси-сервер для маршрутизации запросов на инференс между основными поставщиками моделей, включая [Anthropic](https://www.anthropic.com), [OpenAI](https://openai.com), [Google AI](https://ai.google.dev) и [xAI](https://x.ai). Он включает централизованное управление API-ключами, кэширование на edge-узлах, телеметрию в реальном времени и ограничения по частоте запросов (rate limits).

## Настройка через OpenCode

1. Создайте API-ключ в [Vercel Dashboard](https://vercel.com) в разделе вашей команды **AI Gateway > API keys**.
2. Подключитесь в [OpenCode](https://opencode.ai), используя терминал или встроенный PTY в Tendril:
   ```bash
   opencode
   ```
   Введите `/connect`, найдите **Vercel AI Gateway** и укажите ваш API-ключ.
3. Переключите активную модель с помощью команды `/models`.

### Правила маршрутизации (`opencode.json`)

Вы можете настроить порядок переключения при сбоях (failover) и параметры маршрутизации прямо в `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "vercel": {
      "models": {
        "anthropic/claude-sonnet-5": {
          "options": {
            "order": ["anthropic", "vertex"]
          }
        }
      }
    }
  }
}
```

## Использование с Tendril

### Вариант A: Через встроенный OpenCode

1. В десктопном приложении Tendril перейдите в **Settings > Coding Agent**.
2. Выберите **OpenCode** в качестве активного агента (см. [OpenCode Agent](../06_CodingAgents/04_OpenCode.md)).
3. Tendril будет направлять выполнение всех планов через встроенный sidecar-процесс [OpenCode](https://opencode.ai), подключенный к Vercel AI Gateway.

### Вариант B: Прямое подключение Gateway в `config.yaml`

Vercel AI Gateway предоставляет совместимый с [OpenAI](https://openai.com) API-эндпоинт по адресу `https://ai-gateway.vercel.sh/v1`. Вы можете настроить Tendril для прямой маршрутизации в файле `~/.tendril/config.yaml` (см. [Configuration Setup](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-vercel-ai-key"
      OPENAI_BASE_URL: "https://ai-gateway.vercel.sh/v1"
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

## Мониторинг и телеметрия

Метрики использования, расход токенов и детализация задержек автоматически регистрируются в панели управления Vercel в разделе **AI Gateway > Analytics**, дополняя локальный реестр токенов Tendril.

## Ссылки

- [Поставщики моделей](_Index.md)
- [Агенты разработки](../06_CodingAgents/_Index.md)
- [Документация Vercel AI Gateway](https://vercel.com/docs/ai-gateway)
- [Руководство по Vercel + OpenCode](https://vercel.com/docs/ai-gateway/coding-agents/opencode)
