---
title: Codex
description: Codex 是由 OpenAI 的 GPT 模型驱动的替代编程智能体。
icon: Terminal
searchHints:
  - codex
  - openai
  - gpt
  - 编程智能体
---

# Codex

## 配置

在 `config.yaml` 中将 Codex 设置为您的编程智能体：

```yaml
codingAgent: codex
```

或者在 **Settings > Coding Agent** 中选择它。

有关 `config.yaml` 结构和设置的更多详细信息，请参阅[安装与设置](../03_Configuration/01_Setup.md)。

## 前置要求

- 必须安装 [Codex](https://chatgpt.com/codex) CLI 并作为 `codex` 存在于 PATH 中。使用官方脚本或 [Homebrew](https://brew.sh) cask 安装：
  ```bash
  curl -fsSL https://chatgpt.com/codex/install.sh | sh
  # 或者: brew install --cask codex
  ```
- 在使用 Tendril 之前，运行以下命令进行身份验证：
  ```bash
  codex login
  ```
  对于无头或无人值守环境，通过 stdin 传递 [OpenAI 平台 API 密钥](https://platform.openai.com/api-keys)：
  ```bash
  printenv OPENAI_API_KEY | codex login --with-api-key
  ```

## 配置文件

Tendril 将思考预算（effort 级别）映射到 Codex 模型：

| 配置文件   | 模型          | Effort | 使用场景           |
| ---------- | ------------- | ------ | ------------------ |
| `deep`     | gpt-5.6-sol   | high   | 复杂的跨文件更改   |
| `balanced` | gpt-5.6-terra | medium | 标准计划执行       |
| `quick`    | gpt-5.6-luna  | low    | 简单修复与细微修改 |

配置文件会根据[计划的复杂度级别](../02_Concepts/01_Plans.md)自动选择，也可以在 `config.yaml` 中针对每个 [promptware](../02_Concepts/02_Promptwares.md) 单独配置。

Tendril 中 Codex 的默认模型是 `gpt-5.6-terra`。

### 支持的模型与推理思考预算

Codex 目录支持以下 [OpenAI](https://openai.com) 模型：

- `gpt-6-astra`
- `gpt-5.6-sol`
- `gpt-5.6-terra`（默认）
- `gpt-5.6-luna`
- `gpt-5.5`
- `gpt-5.4` / `gpt-5.4-mini`
- `gpt-5.3-codex`
- `o3` / `o4-mini`
- `gpt-4.1`
- `codex-mini`

Codex 支持五个推理 effort 级别：`none`、`low`、`medium`、`high` 和 `xhigh`。`none` 级别允许在零推理开销下运行 Codex 以进行快速编辑。

## 执行与沙箱

Tendril 以非交互模式通过 `codex exec` 启动 Codex：

- 沙箱默认设置为 `--sandbox workspace-write` 并启用网络访问。当在项目安全设置中禁用沙箱模式时，Tendril 会传递 `danger-full-access`。
- 来自安全规则的其他允许路径通过 `--add-dir` 提供。
- 配置的 [MCP (Model Context Protocol)](https://modelcontextprotocol.io) 服务端会被写入临时 JSON 配置文件并通过 `--mcp-config` 提供。
