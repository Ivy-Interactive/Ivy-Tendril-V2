---
title: Агенты написания кода
description: Агенты написания кода — это среды выполнения на базе ИИ, которые
  выполняют планы Tendril. Выберите агента, настройте профили, установите навыки
  агента и позвольте Tendril координировать работу.
icon: Bot
groupExpanded: true
searchHints:
  - агенты написания кода
  - агент
  - claude
  - codex
  - copilot
  - opencode
  - gemini
  - навыки
---

# Агенты написания кода

Агенты написания кода — это среды выполнения на базе ИИ, которые выполняют [планы](../02_Concepts/01_Plans.md) Tendril. Выберите агента, настройте профили, установите навыки агента и позвольте Tendril координировать работу.

- [Навыки агента](00_Skills.md) — пакетные рабочие процессы разработки, отладки и ревью для автономных ИИ-агентов написания кода.
- [Claude Code](01_ClaudeCode.md) — агент написания кода по умолчанию в Tendril на базе моделей [Anthropic Claude](https://code.claude.com/docs).
- [Codex](02_Codex.md) — альтернативный агент написания кода на базе моделей [OpenAI](https://openai.com) GPT.
- [Copilot](03_Copilot.md) — агент написания кода на базе [Copilot CLI](https://github.com/features/copilot) от GitHub.
- [OpenCode](04_OpenCode.md) — мультипровайдерный агент написания кода с поддержкой различных бэкендов инференса.
- [Gemini CLI](05_Gemini.md) — агент написания кода на базе моделей Google [Gemini](https://ai.google.dev).

## Переменные окружения

Вы можете передавать переменные окружения в процесс агента написания кода через `config.yaml`. Они применяются как к выполнению задач ([планы](../02_Concepts/01_Plans.md)), так и к интерактивной вкладке Agent (PTY). Полный список параметров конфигурации см. в разделе [Установка и настройки](../03_Configuration/01_Setup.md).

```yaml
codingAgents:
  - name: claude
    environmentVariables:
      CLAUDE_CODE_USE_BEDROCK: "1"
      ANTHROPIC_BASE_URL: "https://your-endpoint.example.com"
    profiles:
      - name: balanced
        model: sonnet
        effort: high
```

Любые пары ключ/значение в `environmentVariables` устанавливаются в окружении процесса агента перед его запуском. Используйте это для настройки провайдеров (например, [AWS Bedrock](https://aws.amazon.com/bedrock/), пользовательские эндпоинты API) или любых флагов времени выполнения, поддерживаемых CLI агента.
