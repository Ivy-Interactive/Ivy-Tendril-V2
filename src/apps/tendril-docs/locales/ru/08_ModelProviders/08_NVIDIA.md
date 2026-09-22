---
title: NVIDIA
description: Доступ к микросервисам инференса NVIDIA NIM и ускоренным открытым
  моделям для задач программирования через NVIDIA Build.
icon: Cpu
searchHints:
  - nvidia
  - nim
  - spark
  - build
  - gpu
---

# NVIDIA

[NVIDIA Build](https://build.nvidia.com) предоставляет доступ к эндпоинтам NIM (Inference Microservice) от [NVIDIA](https://www.nvidia.com), обеспечивая оптимизированный для корпоративного использования и ускоренный на GPU инференс для передовых открытых моделей, включая [Meta Llama](https://llama.meta.com), [DeepSeek](https://www.deepseek.com), [Mistral AI](https://mistral.ai) и [Qwen](https://github.com/QwenLM).

## Настройка через OpenCode

1. Сгенерируйте API-ключ (начинающийся с `nvapi-`) на [build.nvidia.com](https://build.nvidia.com).
2. Подключитесь в [OpenCode](https://opencode.ai) с помощью терминала или встроенного PTY в Tendril:
   ```bash
   opencode
   ```
   Введите `/connect`, выберите **NVIDIA** и вставьте свой API-ключ.
3. Переключите активную модель с помощью команды `/models`.

## Рекомендуемые модели

NVIDIA NIM содержит оптимизированные сборки для лучших моделей генерации кода:

| Модель                     | Идентификатор NIM                 | Уровень выполнения | Создатель                            |
| :------------------------- | :-------------------------------- | :----------------- | :----------------------------------- |
| **Llama 3.3 70B Instruct** | `meta/llama-3.3-70b-instruct`     | Deep               | [Meta AI](https://llama.meta.com)    |
| **DeepSeek R1**            | `deepseek-ai/deepseek-r1`         | Deep (Reasoning)   | [DeepSeek](https://www.deepseek.com) |
| **Qwen 2.5 Coder 32B**     | `qwen/qwen2.5-coder-32b-instruct` | Balanced           | [Qwen](https://github.com/QwenLM)    |
| **Llama 3.1 8B Instruct**  | `meta/llama-3.1-8b-instruct`      | Quick              | [Meta AI](https://llama.meta.com)    |

## Использование с Tendril

### Вариант А: Через встроенный OpenCode

1. В десктопном приложении Tendril откройте **Settings > Coding Agent**.
2. Выберите **OpenCode** в качестве активного агента кодинга (см. [OpenCode Agent](../06_CodingAgents/04_OpenCode.md)).
3. Tendril выполняет планы через встроенный сайдкар [OpenCode](https://opencode.ai), используя ваши аутентифицированные модели NVIDIA NIM.

### Вариант Б: Прямой NIM API в `config.yaml`

NVIDIA NIM предоставляет полностью совместимые с [OpenAI](https://openai.com) эндпоинты по адресу `https://integrate.api.nvidia.com/v1`. Вы можете настроить прямое подключение Tendril в `~/.tendril/config.yaml` (см. [Configuration Setup](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "nvapi-..."
      OPENAI_BASE_URL: "https://integrate.api.nvidia.com/v1"
    profiles:
      - name: deep
        model: "meta/llama-3.3-70b-instruct"
        effort: high
      - name: balanced
        model: "qwen/qwen2.5-coder-32b-instruct"
        effort: medium
      - name: quick
        model: "meta/llama-3.1-8b-instruct"
        effort: low
```

> [!TIP]
> Эндпоинты NVIDIA NIM используют стандартные схемы OpenAI Chat Completion со включенным потоковым выводом токенов (token streaming), что делает их полностью совместимыми со средствами динамического отображения вывода Tendril.

## Ссылки

- [Поставщики моделей](_Index.md)
- [Агенты кодинга](../06_CodingAgents/_Index.md)
- [Каталог NVIDIA Build](https://build.nvidia.com)
- [Документация NVIDIA NIM](https://build.nvidia.com/spark/cli-coding-agent)
