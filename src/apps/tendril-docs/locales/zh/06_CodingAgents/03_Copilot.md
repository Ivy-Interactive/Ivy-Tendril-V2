---
title: Copilot
description: Copilot 是由 GitHub Copilot CLI 驱动的替代编程智能体。
icon: Bot
searchHints:
  - copilot
  - github
  - 编程智能体
---

# Copilot

## 配置

在 `config.yaml` 中将 Copilot 设置为您的编程智能体：

```yaml
codingAgent: copilot
```

或者在 **Settings > Coding Agent** 中选择它。

有关 `config.yaml` 结构和设置的更多详细信息，请参阅[安装与设置](../03_Configuration/01_Setup.md)。

## 前置要求

- 必须在 PATH 中提供 [GitHub Copilot CLI](https://github.com/features/copilot)（作为 `copilot`）。使用官方脚本或 [Homebrew](https://brew.sh) cask 安装：
  ```bash
  curl -fsSL https://gh.io/copilot-install | bash
  # 或者: brew install --cask copilot-cli
  ```
  如果未找到独立的 `copilot` 二进制文件，但已安装 [GitHub CLI](https://cli.github.com) (`gh`)，Tendril 会自动回退到 `gh copilot`。
- 需要有效激活的 [GitHub Copilot](https://github.com/features/copilot) 订阅。
- **身份验证**：Copilot 没有 `login` CLI 命令，也不与 `gh auth login` 共享凭据。登录方式：
  1. 在终端中启动 CLI：`copilot`
  2. 在提示符处运行斜杠命令：`/login`
  3. 对于无头或无人值守的 CI 环境，设置带有 `Copilot Requests` 权限的个人访问令牌环境变量 `COPILOT_GITHUB_TOKEN`（或 `GH_TOKEN`）。

## 配置文件

Tendril 将思考预算（effort 级别）映射到 Copilot：

| 配置文件   | 模型    | Effort | 使用场景           |
| ---------- | ------- | ------ | ------------------ |
| `deep`     | gpt-5.4 | high   | 复杂的跨文件更改   |
| `balanced` | gpt-5.4 | medium | 标准计划执行       |
| `quick`    | gpt-5.4 | low    | 简单修复与细微修改 |

配置文件会根据[计划的复杂度级别](../02_Concepts/01_Plans.md)自动选择，也可以在 `config.yaml` 中针对每个 [promptware](../02_Concepts/02_Promptwares.md) 单独配置。

Tendril 中 Copilot 的默认模型是 `gpt-5.4`。

### 支持的模型

GitHub Copilot 通过其运行时同时支持 OpenAI 和 Anthropic 模型：

- **[OpenAI](https://openai.com) 模型**：`gpt-5.4`（默认）、`gpt-5.4-mini`、`gpt-5.3-codex`、`gpt-5.2-codex`、`gpt-5.2`、`gpt-5-mini`、`gpt-4.1`（推理思考预算：`low`、`medium`、`high`、`xhigh`）。
- **[Anthropic Claude](https://code.claude.com/docs) 模型**：`claude-fable-5-1`、`claude-opus-5`、`claude-sonnet-5`、`claude-sonnet-4-6`、`claude-sonnet-4-5`、`claude-haiku-4-5`（推理思考预算：`low`、`medium`、`high`、`xhigh`、`max`）。

## 为 GitHub Copilot 安装 Tendril Skills

Tendril 为 [Visual Studio Code](https://code.visualstudio.com) 中的 GitHub Copilot 提供专用技能，涵盖计划调试、作业产物检查、代码审查和问题分类分流。

### 使用 Skills CLI

为当前工作区安装技能：

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot
```

或在所有工作区中全局安装：

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot -g
```

### 手动放置在 `.agents/skills/`

技能也可以直接放置在 `.agents/skills/`、`.github/skills/` 或 `~/.copilot/skills/` 目录中：

```bash
mkdir -p .agents/skills
cp -r /path/to/skills/* .agents/skills/
```

安装后，技能会显示在 GitHub Copilot Chat 的 `/skills` 菜单下，并可直接作为斜杠命令调用（例如 `/tendril-debug-plan`、`/tendril-review`）。

有关更多详细信息，请参阅[智能体技能](00_Skills.md)。
