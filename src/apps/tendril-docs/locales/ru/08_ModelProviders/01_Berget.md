---
title: Berget AI
description: Европейский провайдер ИИ-инфраструктуры, предоставляющий модели
  Kimi и GLM с полным хранением данных в ЕС и нативной поддержкой карточки BYO в
  Tendril v2.
icon: Server
searchHints:
  - berget
  - ес
  - европейский
  - kimi
  - glm
  - moonshot
---

# Berget AI

[Berget AI](https://berget.ai) — это европейский провайдер ИИ-инфраструктуры, предоставляющий суверенный, высокопроизводительный инференс LLM с гарантированным хранением данных в ЕС на территории Швеции. Berget предлагает эндпоинты, совместимые с [OpenAI](https://openai.com), на которых размещены передовые модели с открытыми весами, включая Kimi K3 от [Moonshot AI](https://moonshot.cn) и семейство GLM от [Zhipu AI](https://open.bigmodel.cn), полностью соответствующие требованиям [GDPR](https://gdpr.eu).

В Tendril v2 Berget AI поддерживается как в виде нативной карточки **Bring Your Own LLM** в десктопном приложении, так и через встроенный сайдкар [OpenCode](https://opencode.ai).

## Настройка через Tendril Desktop

Самый простой способ использовать Berget AI — через нативную карточку BYO в настройках десктопного приложения:

1. Создайте аккаунт и сгенерируйте API-ключ на [console.berget.ai](https://console.berget.ai).
2. Откройте Tendril и перейдите в **Settings > Coding Agent**.
3. В разделе **Bring Your Own LLM** нажмите на карточку **Berget AI**.
4. Вставьте ваш API-ключ в поле **API Key** и нажмите **Save**.

> [!NOTE]
> В интерфейсе нет поля для настройки базового URL для Berget. Tendril v2 автоматически закрепляет эндпоинт за `https://api.berget.ai/v1` и маршрутизирует запросы через встроенный сайдкар [OpenCode](../06_CodingAgents/04_OpenCode.md).

## Ручная настройка в `config.yaml`

Вы также можете настроить Berget AI напрямую в файле `~/.tendril/config.yaml` (см. [Настройка конфигурации](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "sk-berget-..."
      OPENAI_BASE_URL: "https://api.berget.ai/v1"
      ANTHROPIC_API_KEY: "sk-berget-..."
      ANTHROPIC_BASE_URL: "https://api.berget.ai"
    profiles:
      - name: deep
        model: "moonshotai/Kimi-K3"
        effort: max
      - name: balanced
        model: "moonshotai/Kimi-K3"
        effort: high
      - name: quick
        model: "moonshotai/Kimi-K3"
        effort: low
```

## Рекомендуемые модели

Механизм разрешения профилей в Tendril v2 сопоставляет Berget AI напрямую с Kimi K3 для всех уровней:

| Уровень      | ID модели            | Усилие по умолчанию | Назначение                                                              |
| :----------- | :------------------- | :------------------ | :---------------------------------------------------------------------- |
| **Deep**     | `moonshotai/Kimi-K3` | `max`               | Архитектурное планирование, сложное рассуждение, масштабный рефакторинг |
| **Balanced** | `moonshotai/Kimi-K3` | `high`              | Стандартное выполнение планов и генерация кода                          |
| **Quick**    | `moonshotai/Kimi-K3` | `low`               | Быстрая проверка, сводки коммитов, отчеты о статусе                     |

Berget также предоставляет модели семейства GLM (такие как `GLM-4.7`). Вы можете указать любой доступный идентификатор модели Berget в конфигурации своего профиля или выбрать его с помощью команды `/models` в [OpenCode](../06_CodingAgents/04_OpenCode.md).

## Настройка через OpenCode CLI

В качестве альтернативы вы можете настроить Berget через OpenCode:

1. Запустите утилиту настройки Berget:
   ```bash
   npx berget code init
   ```
2. Запустите OpenCode:
   ```bash
   opencode
   ```
3. Установите активного агента в Tendril на OpenCode в разделе **Settings > Coding Agent** (`codingAgent: opencode`).

> [!TIP]
> Tendril v2 поставляется со встроенным бинарным файлом [OpenCode](https://opencode.ai) (`binaries/opencode`). Вам не нужно глобально устанавливать Node.js или OpenCode в вашей системе, чтобы использовать Berget с Tendril. Узнайте больше в [Руководстве по агенту OpenCode](../06_CodingAgents/04_OpenCode.md).

## Ссылки

- [Провайдеры моделей](_Index.md)
- [Агенты для написания кода](../06_CodingAgents/_Index.md)
- [Главная страница Berget AI](https://berget.ai)
- [Консоль Berget](https://console.berget.ai)
- [Документация по Berget + OpenCode](https://docs.berget.ai/integrations/opencode)
