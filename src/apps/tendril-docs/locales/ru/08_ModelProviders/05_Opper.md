---
title: Opper.ai
description: ИИ-шлюз, предоставляющий доступ к более чем 300 моделям от
  Anthropic, OpenAI, Google и поставщиков открытых весов с возможностью
  размещения данных в ЕС.
icon: Server
searchHints:
  - opper
  - шлюз
  - ес
  - мультипровайдер
  - маршрутизатор
---

# Opper.ai

[Opper.ai](https://opper.ai) — это корпоративный ИИ-шлюз со штаб-квартирой в Европе, который обеспечивает единый доступ к более чем 300 базовым моделям от [Anthropic](https://www.anthropic.com), [OpenAI](https://openai.com), [Google AI](https://ai.google.dev), [Mistral AI](https://mistral.ai) и экосистем с открытым исходным кодом. Opper предлагает автоматическую маршрутизацию с резервным переключением (fallback), оптимизацию задержки и строгий контроль размещения данных в ЕС.

## Настройка через Opper CLI

1. Установите Opper CLI (требуется [Node.js](https://nodejs.org)):
   ```bash
   npm i -g @opperai/cli
   ```
2. Выполните вход через OAuth в браузере:
   ```bash
   opper login
   ```
3. Запустите [OpenCode](https://opencode.ai) через Opper:
   ```bash
   opper launch opencode
   ```

Аутентификация управляется сессией Opper CLI; отдельные ключи API провайдеров не требуются.

## Переключение моделей

Вы можете указать модель во время запуска с помощью флага `--model`:

```bash
opper launch opencode --model anthropic/claude-sonnet-5
```

Либо интерактивно переключать модели во время активной сессии OpenCode с помощью `/models`.

## Использование с Tendril

### Вариант А: Через встроенный OpenCode

1. В десктопном приложении Tendril перейдите в **Settings > Coding Agent**.
2. Установите **OpenCode** в качестве активного агента кодирования (см. [OpenCode Agent](../06_CodingAgents/04_OpenCode.md)).
3. Tendril передает выполнение через OpenCode, маршрутизируемый через Opper.

### Вариант Б: Прямой шлюз в `config.yaml`

Opper также предоставляет совместимый с OpenAI шлюз по адресу `https://api.opper.ai/v1`. Вы можете настроить Tendril на прямое подключение, указав свой API-ключ Opper в `~/.tendril/config.yaml` (см. [Configuration Setup](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "opp_..."
      OPENAI_BASE_URL: "https://api.opper.ai/v1"
    profiles:
      - name: deep
        model: "anthropic/claude-opus-5"
        effort: max
      - name: balanced
        model: "anthropic/claude-sonnet-5"
        effort: high
      - name: quick
        model: "google/gemini-3.8-flash"
        effort: medium
```

> [!TIP]
> Opper автоматически кэширует префиксы промптов и маршрутизирует запросы в европейские регионы данных, когда в панели управления Opper включены политики размещения данных в ЕС.

## Ссылки

- [Провайдеры моделей](_Index.md)
- [Агенты кодирования](../06_CodingAgents/_Index.md)
- [Платформа Opper](https://opper.ai)
- [Документация Opper Agent CLI](https://opper.ai/agent-cli)
