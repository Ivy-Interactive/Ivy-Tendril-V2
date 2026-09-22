---
title: Навыки агентов
description: Навыки агентов Tendril объединяют рабочие процессы разработки,
  отладки и ревью для автономных ИИ-агентов написания кода в Visual Studio Code,
  Claude Code, Antigravity, Cursor, OpenAI Codex и Gemini CLI.
icon: Sparkles
searchHints:
  - навыки
  - навыки агентов
  - плагины
  - copilot
  - claude
  - antigravity
  - cursor
  - codex
  - gemini
---

# Навыки агентов

## Обзор

Навыки агентов соответствуют открытой спецификации навыков агентов. Каждый навык предоставляет структурированные инструкции, справочные чек-листы и скрипты автоматизации, которые направляют агентов написания кода при выполнении сложных задач:

- `tendril-debug-plan`: детальный анализ [журналов планов](../02_Concepts/01_Plans.md), сессий JSONL, проверочных запусков и режимов сбоев.
- `tendril-debug-job`: анализ необработанных артефактов выполнения агента и журналов [промптварей](../02_Concepts/02_Promptwares.md) в [представлении задач](../04_Apps/04_Jobs.md).
- `tendril-review`: проведение тщательного код-ревью после реализации, анализ пробелов в тестах и проверки очистки кода.
- `tendrillable`: классификация задач [GitHub](../07_Integrations/01_Github.md) на готовность к автономному выполнению агентом.
- `tendril-release`: автоматизация обновлений пакетов, версионирования, pull request'ов и релизов развертывания.
- `tendril-extension`: сборка, тестирование, упаковка и связывание расширения Ivy Tendril для [VS Code](https://code.visualstudio.com) и Antigravity IDE.

## Универсальная установка

Установите навыки для любого поддерживаемого агента с помощью универсального CLI навыков:

```bash
# Install all skills
npx skills add ivy-interactive/ivy-tendril-v2

# Install an individual skill
npx skills add ivy-interactive/ivy-tendril-v2 --skill tendril-debug-plan
```

## Интеграции с агентами

### Visual Studio Code ([GitHub Copilot](03_Copilot.md) и ИИ-расширения)

Установите навыки непосредственно для [GitHub Copilot](https://github.com/features/copilot) в [VS Code](https://code.visualstudio.com):

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot
```

Или установите глобально для всех рабочих пространств:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot -g
```

Навыки сохраняются в `.agents/skills/` (или `~/.copilot/skills/`) и отображаются в Copilot Chat в меню `/skills`. Вы также можете ориентироваться на сопутствующие расширения:

- [Cline](https://github.com/cline/cline): `npx skills add ivy-interactive/ivy-tendril-v2 --agent cline`
- [Continue](https://continue.dev): `npx skills add ivy-interactive/ivy-tendril-v2 --agent continue`
- [Roo Code](https://github.com/RooVetGit/Roo-Code): `npx skills add ivy-interactive/ivy-tendril-v2 --agent roo`

Подробности см. в руководстве [Настройка VS Code](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/vscode-setup.md).

### [Claude Code](01_ClaudeCode.md)

Установка через маркетплейс плагинов [Claude Code](https://code.claude.com/docs):

```
/plugin marketplace add ivy-interactive/ivy-tendril-v2
/plugin install tendril-skills@ivy-tendril-v2
```

Для локального тестирования запустите Claude Code с указанием пути к вашей рабочей копии:

```bash
claude --plugin-dir /path/to/ivy-tendril-v2
```

Подробности см. в руководстве [Настройка Claude Code](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/claude-setup.md).

### Google Antigravity

Установка с помощью CLI [Antigravity](https://antigravity.google) (`agy`):

```bash
agy plugin install https://github.com/ivy-interactive/ivy-tendril-v2.git
```

Или из локальной рабочей копии:

```bash
agy plugin install ./
```

Подробности см. в руководстве [Настройка Antigravity](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/antigravity-setup.md).

### [Cursor](https://cursor.com)

Установка для [Cursor](https://cursor.com):

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent cursor
```

Либо поместите навыки в `.cursor/skills/`. Подробности см. в руководстве [Настройка Cursor](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/cursor-setup.md).

### [OpenAI Codex](02_Codex.md)

Добавьте маркетплейс и установите плагин в [Codex](https://chatgpt.com/codex):

```bash
codex plugin marketplace add ivy-interactive/ivy-tendril-v2
codex plugin add tendril-skills@tendril-skills
```

### [Gemini CLI](05_Gemini.md)

Установите навыки напрямую с помощью [Gemini CLI](https://github.com/google-gemini/gemini-cli):

```bash
gemini skills install https://github.com/ivy-interactive/ivy-tendril-v2.git --path src/skills
```
