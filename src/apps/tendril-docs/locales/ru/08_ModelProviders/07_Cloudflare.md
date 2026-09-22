---
title: Cloudflare
description: Использование Cloudflare Workers AI в качестве провайдера моделей и
  подключение к MCP-серверам Cloudflare для создания и развертывания Workers.
icon: Globe
searchHints:
  - cloudflare
  - workers ai
  - cf
  - edge
  - cloudflared
  - туннели
---

# Cloudflare

[Cloudflare](https://www.cloudflare.com) предоставляет глобальные периферийные вычисления (edge compute) и бессерверный инференс ИИ с помощью [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/). Разработчики могут запускать быстрые и экономичные модели с открытыми весами (такие как [Meta Llama](https://llama.meta.com)) на периферии, сочетая их с официальными навыками Cloudflare [Model Context Protocol (MCP)](../09_Advanced/03_MCP.md) для полнофункциональной разработки под [Cloudflare Workers](https://workers.cloudflare.com).

## Настройка через OpenCode

1. Запустите [OpenCode](https://opencode.ai) через терминал или встроенный PTY в Tendril:
   ```bash
   opencode
   ```
   Введите `/connect` и выберите **Cloudflare**.
2. Пройдите авторизацию в браузере по запросу.
3. Выберите активную модель с помощью команды `/models`.

## Навыки Cloudflare MCP (необязательно)

Вы можете добавить MCP-серверы Cloudflare, чтобы предоставить вашему [агенту для написания кода](../06_CodingAgents/_Index.md) прямой контроль над Cloudflare Workers, KV, базами данных D1 и развертываниями (см. раздел [Навыки](../06_CodingAgents/00_Skills.md)):

```bash
npx skills add https://github.com/cloudflare/skills
```

После установки агенты для написания кода, выполняющие планы Tendril, смогут автономно создавать привязки (bindings), развертывать скрипты воркеров и просматривать логи с edge-узлов в реальном времени.

## Использование с Tendril

1. Откройте Tendril и перейдите в **Settings > Coding Agent**.
2. Установите в качестве агента для написания кода **OpenCode** (см. раздел [Агент OpenCode](../06_CodingAgents/04_OpenCode.md)).
3. Tendril перенаправляет задачи плана в OpenCode, который вызывает Cloudflare Workers AI.

Вы также можете обращаться к Cloudflare Workers AI через эндпоинт, совместимый с [OpenAI](https://openai.com), в файле `~/.tendril/config.yaml` (см. раздел [Настройка конфигурации](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-cloudflare-api-token"
      OPENAI_BASE_URL: "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1"
    profiles:
      - name: deep
        model: "@cf/meta/llama-3.3-70b-instruct"
        effort: high
      - name: balanced
        model: "@cf/meta/llama-3.1-8b-instruct"
        effort: medium
      - name: quick
        model: "@cf/meta/llama-3.1-8b-instruct"
        effort: low
```

> [!NOTE]
> В дополнение к инференсу моделей через Workers AI, Tendril v2 нативно интегрирует Cloudflare Quick Tunnels (`cloudflared`) для безопасного совместного доступа участников команды к планам в режиме только для чтения. Общий доступ через туннели настраивается отдельно в меню **Settings > Security & Tunneling**.

## Ссылки

- [Провайдеры моделей](_Index.md)
- [Агенты для написания кода](../06_CodingAgents/_Index.md)
- [Документация Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
- [Руководство по Cloudflare + OpenCode](https://developers.cloudflare.com/agent-setup/opencode/)
