---
title: OpenCode
description: OpenCode 是一款通过统一 CLI 支持多家模型提供商的替代编程智能体。
icon: Cpu
searchHints:
  - opencode
  - open code
  - 编程智能体
---

# OpenCode

## 配置

在 `config.yaml` 中将 OpenCode 设置为您的编程智能体：

```yaml
codingAgent: opencode
```

或者在 **Settings > Coding Agent** 中选择它。

有关 `config.yaml` 结构和设置的更多详细信息，请参阅[安装与设置](../03_Configuration/01_Setup.md)。

## 前置要求

- **内置 Sidecar**：Tendril 将 [OpenCode](https://opencode.ai) 作为内置 sidecar 与桌面应用一起提供，并自动优先使用它而不是 PATH 中的任何版本。在全新安装的环境中无需手动安装。
- **独立安装**（可选）：如果您想安装或运行独立副本：
  ```bash
  curl -fsSL https://opencode.ai/install | bash
  ```
- **身份验证**：运行 `opencode providers login`（或 `opencode auth login`）对所选提供商（例如 [Anthropic](https://www.anthropic.com)、[OpenAI](https://openai.com)、[Google AI](https://ai.google.dev)、[Groq](https://groq.com)）进行身份验证。

## 配置文件

Tendril 将思考预算（effort 级别）映射到 OpenCode 模型：

| 配置文件   | 模型    | Effort | 使用场景           |
| ---------- | ------- | ------ | ------------------ |
| `deep`     | default | high   | 复杂的跨文件更改   |
| `balanced` | default | medium | 标准计划执行       |
| `quick`    | default | low    | 简单修复与细微修改 |

Effort 级别直接映射到 OpenCode 的 `--variant` 标志（`low`、`medium`、`high`、`max`）。

默认目录模型为 `moonshotai/Kimi-K3`。OpenCode 还支持锁定的 Anthropic 和 OpenAI 模型，例如 `claude-fable-5-1`、`claude-opus-5`、`claude-opus-4-7`、`claude-sonnet-5`、`claude-sonnet-4-6` 和 `gpt-5.5`。

## 自带 LLM 与提供商

OpenCode 为 **Settings > Coding Agent** 中的 Tendril **自带 LLM (Bring-Your-Own LLM)** 卡片提供底层支持：

- **[OpenAI](https://openai.com)**：通过您的 `OPENAI_API_KEY` 将 OpenCode 指向 `https://api.openai.com`。
- **[Anthropic](https://www.anthropic.com)**：通过您的 `ANTHROPIC_API_KEY` 将 OpenCode 指向 `https://api.anthropic.com/v1`。
- **[Berget AI](../08_ModelProviders/01_Berget.md)**：通过您的 [Berget AI](https://berget.ai) API 密钥将 OpenCode 指向 `https://api.berget.ai/v1`。
- **自定义端点**：为任何兼容 OpenAI 或 Anthropic 的反向代理配置自定义基础 URL 和密钥。有关更多提供商，请参阅[模型提供商](../08_ModelProviders/_Index.md)。

Tendril 使用 `OPENCODE_CONFIG_CONTENT` 非破坏性地配置这些提供商，因此您的全局 `opencode.json` 配置绝不会被覆盖。

## 本地 [Ollama](https://ollama.com) 设置

使用本地 [Ollama](https://ollama.com) 模型运行 OpenCode 时，请在 `config.yaml` 中直接指定服务器 URL：

```yaml
codingAgents:
  - name: opencode
    environmentVariables:
      OLLAMA_HOST: "http://localhost:11434"
      OLLAMA_BASE_URL: "http://localhost:11434"
```
