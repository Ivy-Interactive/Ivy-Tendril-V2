---
title: Evroc
description: Европейский суверенный облачный провайдер с открытыми моделями для
  кодинга, включая Kimi, Llama и Mistral.
icon: Server
searchHints:
  - evroc
  - ес
  - европейский
  - суверенный
  - kimi
  - mistral
  - llama
---

# Evroc

[Evroc](https://cloud.evroc.com) — это европейский суверенный облачный провайдер, управляющий безопасными и экологичными дата-центрами по всей Европе. Через свою платформу искусственного интеллекта «Think» Evroc предоставляет [OpenAI](https://openai.com)-совместимый инференс для ведущих моделей с открытыми весами, таких как Kimi, Llama и Mistral, с полным соответствием [GDPR](https://gdpr.eu) и европейским цифровым суверенитетом.

## Настройка

1. Создайте аккаунт на [cloud.evroc.com](https://cloud.evroc.com).
2. Сгенерируйте API-ключ в консоли Evroc в разделе **Think > Models > + New**.
3. Подключитесь в [OpenCode](https://opencode.ai), используя встроенный сайдкар или терминал:
   ```bash
   opencode
   ```
   Введите `/connect`, выберите **evroc** и укажите ваш API-ключ.
4. Выберите активную модель с помощью команды `/models`.

## Рекомендуемые модели

Evroc предоставляет доступ к высокопроизводительным моделям с открытыми весами, оптимизированным для программирования и технических задач:

| Модель                    | ID                                                                          | Создатель                          | Сильные стороны                                                           |
| :------------------------ | :-------------------------------------------------------------------------- | :--------------------------------- | :------------------------------------------------------------------------ |
| **Kimi K3 / K2.5**        | `moonshotai/Kimi-K3`, `moonshotai/Kimi-K2.5`                                | [Moonshot AI](https://moonshot.cn) | Исключительное понимание длинного контекста и мультифайловых репозиториев |
| **Mistral Large / Small** | `mistralai/Mistral-Large-2411`, `mistralai/Mistral-Small-24B-Instruct-2501` | [Mistral AI](https://mistral.ai)   | Быстрая и точная генерация кода и проверка                                |
| **Llama 3.3 70B**         | `meta-llama/Llama-3.3-70B-Instruct`                                         | [Meta AI](https://llama.meta.com)  | Обширные знания в области кодинга, документация и рефакторинг             |

> [!TIP]
> Для наилучших результатов в задачах разработки выбирайте в консоли Evroc модели с тегом **Code**.

## Использование с Tendril

Вы можете направить выполнение планов Tendril v2 через Evroc двумя способами:

### Вариант A: Через встроенный OpenCode

1. В десктопном приложении Tendril перейдите в **Settings > Coding Agent**.
2. Выберите **OpenCode** в качестве вашего агента для кодинга (см. [Агент OpenCode](../06_CodingAgents/04_OpenCode.md)).
3. Tendril вызовет встроенный сайдкар [OpenCode](https://opencode.ai) (`binaries/opencode`), который будет перенаправлять запросы через настроенный провайдер Evroc.

### Вариант B: Пользовательский эндпоинт OpenAI в `config.yaml`

Поскольку Evroc предоставляет OpenAI-совместимый интерфейс, вы можете настроить его напрямую в секции `codingAgents` файла `~/.tendril/config.yaml` (см. [Настройка конфигурации](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-evroc-api-key"
      OPENAI_BASE_URL: "https://api.evroc.com/v1"
    profiles:
      - name: deep
        model: "moonshotai/Kimi-K3"
        effort: high
      - name: balanced
        model: "moonshotai/Kimi-K2.5"
        effort: medium
      - name: quick
        model: "mistralai/Mistral-Small-24B-Instruct-2501"
        effort: low
```

## Ссылки

- [Провайдеры моделей](_Index.md)
- [Агенты для кодинга](../06_CodingAgents/_Index.md)
- [Облачная консоль Evroc](https://cloud.evroc.com)
- [Документация по Evroc + OpenCode](https://docs.evroc.com/integrations/opencode.html)
