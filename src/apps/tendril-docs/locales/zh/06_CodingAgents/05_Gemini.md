---
title: Gemini CLI
description: Gemini CLI 是由 Google 的 Gemini 模型驱动的编程智能体。
icon: Sparkles
searchHints:
  - gemini
  - google
  - 编程智能体
---

# Gemini CLI

## 配置

在 `config.yaml` 中将 Gemini 设置为您的编程智能体：

```yaml
codingAgent: gemini
```

或者在 **Settings > Coding Agent** 中选择它。

有关 `config.yaml` 结构和设置的更多详细信息，请参阅[安装与设置](../03_Configuration/01_Setup.md)。

## 前置要求

- 通过 [Homebrew](https://brew.sh) 或 [MacPorts](https://www.macports.org) 安装 `gemini` 二进制文件：
  ```bash
  brew install gemini-cli
  # 或者: sudo port install gemini-cli
  ```
- **身份验证**：请注意没有 `gemini auth` CLI 子命令。进行身份验证的方式：
  - 首次运行时，`gemini` 会通过浏览器中的 OAuth 提示 **Sign in with Google**。
  - 在活动的 CLI 会话中，使用 `/auth` 斜杠命令（或 `/auth login`）重新进行身份验证或切换账户。
  - 对于无头或 CI 环境，设置 `GEMINI_API_KEY` 环境变量（通过 [Google AI Studio](https://aistudio.google.com/apikey) 生成）。

## 配置文件

Tendril 将 Gemini 配置文件映射到以下默认设置：

| 配置文件   | 模型             | 使用场景           |
| ---------- | ---------------- | ------------------ |
| `deep`     | gemini-3.8-flash | 复杂的跨文件更改   |
| `balanced` | gemini-3.8-flash | 标准计划执行       |
| `quick`    | gemini-3.8-flash | 简单修复与细微修改 |

配置文件会根据[计划的复杂度级别](../02_Concepts/01_Plans.md)自动选择，也可以在 `config.yaml` 中针对每个 [promptware](../02_Concepts/02_Promptwares.md) 单独配置。Gemini CLI 不使用推理 effort 标志。

Tendril 中 Gemini 的默认模型是 `gemini-3.8-flash`。

## 可用模型

Tendril 中的 Gemini 目录包括：

- `gemini-3.8-flash`（默认）：下一代快速且高能力的推理，1M 上下文窗口
- `gemini-3.7-flash`：快速且强大的推理，1M 上下文窗口
- `gemini-3.6-flash`：多模态推理，1M 上下文窗口
- `gemini-3.1-pro`：面向复杂架构的高级推理，1M 上下文窗口
- `gemini-3-pro-preview`：下一代推理预览版
- `gemini-3-flash-preview`：下一代快速推理预览版

在 `config.yaml` 中覆盖模型：

```yaml
codingAgents:
  - name: gemini
    profiles:
      - name: deep
        model: gemini-3.1-pro
```

## 执行与标志

Tendril 使用以下参数启动 Gemini CLI：

- 非交互模式：`--output-format stream-json --skip-trust --approval-mode <mode>`（其中 `FullAuto` 传递 `yolo`，`AcceptEdits` 传递 `auto_edit`，`Plan` 传递 `plan`），并在启用沙箱模式时添加 `--sandbox`。
- 交互式智能体终端：`gemini --yolo --skip-trust -i "<prompt>"`。
