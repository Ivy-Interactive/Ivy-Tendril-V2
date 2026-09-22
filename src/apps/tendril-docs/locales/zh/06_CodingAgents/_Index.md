---
title: 编程智能体
description: 编程智能体是执行 Tendril 计划的 AI 驱动运行时。选择智能体、配置配置文件、安装智能体技能，让 Tendril 来编排工作。
icon: Bot
groupExpanded: true
searchHints:
  - 编程智能体
  - 智能体
  - claude
  - codex
  - copilot
  - opencode
  - gemini
  - 技能
---

# 编程智能体

编程智能体是执行 Tendril [计划](../02_Concepts/01_Plans.md)的 AI 驱动运行时。选择智能体、配置配置文件、安装智能体技能，让 Tendril 来编排工作。

- [智能体技能](00_Skills.md) — 面向自主 AI 编程智能体，封装工程、调试和审查工作流。
- [Claude Code](01_ClaudeCode.md) — Tendril 中的默认编程智能体，由 [Anthropic Claude](https://code.claude.com/docs) 模型驱动。
- [Codex](02_Codex.md) — 由 [OpenAI](https://openai.com) GPT 模型驱动的替代编程智能体。
- [Copilot](03_Copilot.md) — 由 GitHub [Copilot CLI](https://github.com/features/copilot) 驱动的编程智能体。
- [OpenCode](04_OpenCode.md) — 支持多种推理后端的跨提供商编程智能体。
- [Gemini CLI](05_Gemini.md) — 由 Google [Gemini](https://ai.google.dev) 模型驱动的编程智能体。

## 环境变量

您可以通过 `config.yaml` 向编程智能体进程注入环境变量。这些变量会同时应用于作业执行（[计划](../02_Concepts/01_Plans.md)）和交互式智能体标签页（PTY）。有关完整的配置选项，请参阅[安装与设置](../03_Configuration/01_Setup.md)。

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

`environmentVariables` 下的所有键值对都会在智能体启动前注入到其进程环境中。可用于配置提供商（例如 [AWS Bedrock](https://aws.amazon.com/bedrock/)、自定义 API 端点）或智能体 CLI 支持的任何运行时标志。
