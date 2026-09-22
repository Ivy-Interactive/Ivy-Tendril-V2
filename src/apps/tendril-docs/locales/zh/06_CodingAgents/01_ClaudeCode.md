---
title: Claude Code
description: Claude Code 是 Tendril 中的默认编程智能体，由 Anthropic 的 Claude 模型驱动。
icon: Bot
searchHints:
  - claude
  - claude code
  - anthropic
  - 编程智能体
  - ai 智能体
---

# Claude Code

## 配置

在 `config.yaml` 中将 Claude Code 设置为您的编程智能体：

```yaml
codingAgent: claude
```

或者在 **Settings > Coding Agent** 中选择它。

有关 `config.yaml` 结构和设置的更多详细信息，请参阅[安装与设置](../03_Configuration/01_Setup.md)。

## 前置要求

- 必须安装 [Claude Code](https://code.claude.com/docs) CLI 并作为 `claude` 存在于 PATH 中。使用原生安装程序或 [Homebrew](https://brew.sh) cask：
  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  # 或者: brew install --cask claude-code
  ```
- 在使用 Tendril 之前，运行 `claude auth login`（或 `claude login`）进行身份验证。Claude Code 需要 [Anthropic](https://www.anthropic.com) Pro、Max、Team、Enterprise 或 [Console](https://console.anthropic.com) 计划（claude.ai 免费层不包含 CLI 访问权限）。
- 对于无头环境或替代后端，请设置 `ANTHROPIC_API_KEY`，或配置 [AWS Bedrock](https://aws.amazon.com/bedrock/) (`CLAUDE_CODE_USE_BEDROCK=1`) 或 [Google Cloud Vertex AI](https://cloud.google.com/vertex-ai) (`CLAUDE_CODE_USE_VERTEX=1`)。

## 配置文件

Tendril 将思考预算（effort 级别）映射到 Claude 模型：

| 配置文件   | 模型   | Effort | 使用场景                   |
| ---------- | ------ | ------ | -------------------------- |
| `deep`     | opus   | max    | 复杂的跨文件更改、架构工作 |
| `balanced` | sonnet | high   | 标准计划执行、大多数任务   |
| `quick`    | haiku  | low    | 简单修复、格式化、细微修改 |

配置文件会根据[计划的复杂度级别](../02_Concepts/01_Plans.md)自动选择，也可以在 `config.yaml` 中针对每个 [promptware](../02_Concepts/02_Promptwares.md) 单独配置。

## 可用模型

| 模型             | ID                 | 上下文窗口 | 定价（每 MTok 输入 / 输出） |
| ---------------- | ------------------ | ---------- | --------------------------- |
| Claude Fable 5.1 | `claude-fable-5-1` | 1M         | $10.00 / $50.00             |
| Claude Opus 5    | `claude-opus-5`    | 1M         | $5.00 / $25.00              |
| Claude Opus      | `opus`             | 1M         | $5.00 / $25.00              |
| Claude Sonnet 5  | `claude-sonnet-5`  | 1M         | $2.00 / $10.00              |
| Claude Sonnet    | `sonnet`           | 1M         | $2.00 / $10.00              |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200k       | $1.00 / $5.00               |
| Claude Haiku     | `haiku`            | 200k       | $1.00 / $5.00               |

`opus`、`sonnet` 和 `haiku` 是跟踪 Anthropic 当前对应层级模型的 Claude Code 别名，而 `claude-opus-5`（目录默认值）和 `claude-fable-5-1` 是固定 ID。

Claude Sonnet 的首发优惠价格 $2.00 / $10.00 适用至 2026-08-31；此后适用标准价格 $3.00 / $15.00。

## Tendril Skills 插件

您可以将官方 Tendril 工程与调试技能作为 Claude Code 插件进行安装：

```
/plugin marketplace add ivy-interactive/ivy-tendril-v2
/plugin install tendril-skills@ivy-tendril-v2
```

在本地开发和测试期间，直接从您的检出目录加载技能：

```bash
claude --plugin-dir /path/to/ivy-tendril-v2
```

有关更多详细信息，请参阅[智能体技能](00_Skills.md)。
