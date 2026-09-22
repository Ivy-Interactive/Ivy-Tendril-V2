---
title: Scaleway
description: Европейский облачный провайдер, предлагающий совместимые с OpenAI
  Generative API для написания кода, логических рассуждений и работы с моделями
  с открытыми весами.
icon: Server
searchHints:
  - scaleway
  - ес
  - европейский
  - generative apis
  - суверенный
  - qwen
---

# Scaleway

[Scaleway](https://www.scaleway.com) — крупный европейский поставщик облачных услуг, предлагающий суверенную ИИ-инфраструктуру, размещенную в энергоэффективных дата-центрах во Франции, Нидерландах и Польше. Через свою платформу Generative APIs Scaleway предоставляет управляемые, полностью совместимые с [OpenAI](https://openai.com) эндпоинты для ведущих открытых моделей.

## Настройка

1. Создайте учетную запись на [scaleway.com](https://www.scaleway.com).
2. Сгенерируйте API-ключ IAM (Secret Key) в консоли Scaleway в разделе **Identity and Access Management (IAM)**.
3. Подключитесь в [OpenCode](https://opencode.ai), используя встроенный sidecar или терминал:
   ```bash
   opencode
   ```
   Введите `/connect`, выберите **Scaleway** и вставьте ваш секретный ключ IAM (Secret Key).
4. Выберите модель с помощью `/models`.

## Рекомендуемые модели

Scaleway размещает несколько моделей, оптимизированных для написания кода и разработки программного обеспечения:

| Модель                     | ID модели                         | Создатель                            | Рекомендуемый уровень |
| :------------------------- | :-------------------------------- | :----------------------------------- | :-------------------- |
| **Qwen 2.5 Coder 32B**     | `qwen2.5-coder-32b-instruct`      | [Qwen](https://github.com/QwenLM)    | Deep                  |
| **Llama 3.3 70B Instruct** | `llama-3.3-70b-instruct`          | [Meta AI](https://llama.meta.com)    | Balanced              |
| **Mistral Small 24B**      | `mistral-small-24b-instruct-2501` | [Mistral AI](https://mistral.ai)     | Quick                 |
| **DeepSeek R1 Distill**    | `deepseek-r1-distill-llama-70b`   | [DeepSeek](https://www.deepseek.com) | Deep (Reasoning)      |

## Использование с Tendril

### Вариант A: Через встроенный OpenCode

1. В десктопном приложении Tendril перейдите в **Settings > Coding Agent**.
2. Выберите **OpenCode** в качестве активного агента (см. [OpenCode Agent](../06_CodingAgents/04_OpenCode.md)).
3. OpenCode будет использовать ваши настроенные учетные данные Scaleway для всех задач по выполнению планов.

### Вариант B: Пользовательский эндпоинт OpenAI в `config.yaml`

Поскольку Generative APIs от Scaleway следуют спецификации OpenAI по адресу `https://api.scaleway.ai/v1`, вы можете настроить его напрямую в `~/.tendril/config.yaml` (см. [Configuration Setup](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-scaleway-secret-key"
      OPENAI_BASE_URL: "https://api.scaleway.ai/v1"
    profiles:
      - name: deep
        model: "qwen2.5-coder-32b-instruct"
        effort: high
      - name: balanced
        model: "llama-3.3-70b-instruct"
        effort: medium
      - name: quick
        model: "mistral-small-24b-instruct-2501"
        effort: low
```

> [!NOTE]
> Scaleway использует стандартную аутентификацию по HTTP Bearer token. Ваш IAM Secret Key выступает непосредственно в качестве `OPENAI_API_KEY`.

## Ссылки

- [Поставщики моделей](_Index.md)
- [Агенты кодирования](../06_CodingAgents/_Index.md)
- [Платформа Scaleway](https://www.scaleway.com)
- [Консоль Scaleway](https://console.scaleway.com)
- [Документация Scaleway Generative APIs](https://www.scaleway.com/en/docs/generative-apis/reference-content/integrate-with-opencode/)
