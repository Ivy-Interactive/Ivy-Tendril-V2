---
title: 智能体技能
description: Tendril 智能体技能为 Visual Studio Code、Claude Code、Antigravity、Cursor、OpenAI Codex 和 Gemini CLI 上的自主 AI 编程智能体封装了工程、调试和审查工作流。
icon: Sparkles
searchHints:
  - 技能
  - 智能体技能
  - 插件
  - copilot
  - claude
  - antigravity
  - cursor
  - codex
  - gemini
---

# 智能体技能

## 概述

智能体技能遵循开放智能体技能规范（open agent skills specification）。每个技能均提供结构化说明、参考核对清单和自动化脚本，指导编程智能体完成复杂任务：

- `tendril-debug-plan`：深入剖析[计划日志](../02_Concepts/01_Plans.md)、JSONL 会话、验证运行和故障模式。
- `tendril-debug-job`：在[作业视图](../04_Apps/04_Jobs.md)中分析原始智能体执行产物和 [promptware](../02_Concepts/02_Promptwares.md) 日志。
- `tendril-review`：执行深入的实现后代码审查、测试覆盖空缺分析以及清理检查。
- `tendrillable`：对 [GitHub](../07_Integrations/01_Github.md) issue 进行分类，评估自主智能体执行的准备状态。
- `tendril-release`：自动化包更新、版本发布、Pull Request 和部署发布。
- `tendril-extension`：构建、测试、打包并将 Ivy Tendril 扩展链接到 [VS Code](https://code.visualstudio.com) 和 Antigravity IDE。

## 通用安装

使用通用 skills CLI 为任何受支持的智能体安装技能：

```bash
# 安装所有技能
npx skills add ivy-interactive/ivy-tendril-v2

# 安装单个技能
npx skills add ivy-interactive/ivy-tendril-v2 --skill tendril-debug-plan
```

## 智能体集成

### Visual Studio Code（[GitHub Copilot](03_Copilot.md) 与 AI 扩展）

直接针对 [VS Code](https://code.visualstudio.com) 中的 [GitHub Copilot](https://github.com/features/copilot) 安装技能：

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot
```

或在所有工作区中全局安装：

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot -g
```

技能存储在 `.agents/skills/`（或 `~/.copilot/skills/`）中，并显示在 Copilot Chat 的 `/skills` 菜单下。您还可以针对配套扩展进行安装：

- [Cline](https://github.com/cline/cline): `npx skills add ivy-interactive/ivy-tendril-v2 --agent cline`
- [Continue](https://continue.dev): `npx skills add ivy-interactive/ivy-tendril-v2 --agent continue`
- [Roo Code](https://github.com/RooVetGit/Roo-Code): `npx skills add ivy-interactive/ivy-tendril-v2 --agent roo`

有关配套指南的详细信息，请参阅 [VS Code 设置](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/vscode-setup.md)。

### [Claude Code](01_ClaudeCode.md)

通过 [Claude Code](https://code.claude.com/docs) 插件市场进行安装：

```
/plugin marketplace add ivy-interactive/ivy-tendril-v2
/plugin install tendril-skills@ivy-tendril-v2
```

在进行本地测试时，启动 Claude Code 并指向您的本地检出目录：

```bash
claude --plugin-dir /path/to/ivy-tendril-v2
```

有关配套指南的详细信息，请参阅 [Claude Code 设置](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/claude-setup.md)。

### Google Antigravity

使用 [Antigravity](https://antigravity.google) CLI (`agy`) 进行安装：

```bash
agy plugin install https://github.com/ivy-interactive/ivy-tendril-v2.git
```

或从本地检出目录安装：

```bash
agy plugin install ./
```

有关配套指南的详细信息，请参阅 [Antigravity 设置](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/antigravity-setup.md)。

### [Cursor](https://cursor.com)

针对 [Cursor](https://cursor.com) 进行安装：

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent cursor
```

或将技能放置在 `.cursor/skills/` 中。有关配套指南的详细信息，请参阅 [Cursor 设置](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/cursor-setup.md)。

### [OpenAI Codex](02_Codex.md)

在 [Codex](https://chatgpt.com/codex) 中添加市场并安装插件：

```bash
codex plugin marketplace add ivy-interactive/ivy-tendril-v2
codex plugin add tendril-skills@tendril-skills
```

### [Gemini CLI](05_Gemini.md)

使用 [Gemini CLI](https://github.com/google-gemini/gemini-cli) 直接安装技能：

```bash
gemini skills install https://github.com/ivy-interactive/ivy-tendril-v2.git --path src/skills
```
