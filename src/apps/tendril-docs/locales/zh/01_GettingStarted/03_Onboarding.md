---
title: 代码库准备
description: 准备开发机与代码仓库的检查清单，以便 Tendril 能够无人值守地规划、执行、验证和交付代码变更。
icon: ClipboardCheck
searchHints:
  - 接入准备
  - 检查清单
  - 准备
  - 开发机
  - 环境
  - 工作区
  - AGENTS.md
  - gh
  - mcp
---

# 代码库准备

Tendril 在独立的 [Git 工作区 (worktree)](https://git-scm.com/docs/git-worktree) 中针对您的仓库运行编程智能体，随后进行构建、测试并创建 Pull Request。为了使该闭环流程能够在无需人工干预的情况下成功执行，必须预先配置好开发机和代码仓库。请在每台开发机和每个代码库上各完成一次以下检查清单。

> [!TIP]
> 完成后，运行 `tendril doctor`。它会检查 Tendril home、`config.yaml`、数据库、plans 目录、`git` 和 `gh`。但它**不会**测试您的编程智能体 —— 请在下文的步骤 2 中自行验证。

## 开发机检查清单

### 1. 安装所需的构建软件

编译项目所需的每个工具都必须已安装并可在 `PATH` 中找到。智能体无法在运行中临时安装缺失的编译器或 SDK。对于像 Tendril 自身这样的 Rust 和 pnpm 仓库，这意味着需要 [Rustup](https://rustup.rs/)、[Node.js](https://nodejs.org/) 和 [pnpm](https://pnpm.io/)；对于您自己的项目，则指您的脚本所调用的任何构建工具链。

> [!NOTE]
> 达标要求：全新克隆的仓库可以在干净的终端中使用文档中记录的命令完成构建，无需交互式提示，也无需仅在 IDE 中才能完成的手动操作。

### 2. 安装并认证首选编程 CLI

安装您在 `config.yaml` 中设置为 `codingAgent` 的智能体并完成登录，以便它能够以非交互方式执行：

```bash
# 示例：Claude Code
npm install -g @anthropic-ai/claude-code
claude login
```

验证 CLI 已在 `PATH` 中，且直接调用时不会停下来等待凭据输入：

- [Claude Code](https://code.claude.com/docs) (`claude`)
- [OpenAI Codex](https://openai.com) (`codex`)
- [GitHub Copilot](https://github.com/features/copilot) (`copilot`)
- [Google Gemini](https://ai.google.dev) (`gemini`)
- [OpenCode](https://opencode.ai) (`opencode`)
- Antigravity (`antigravity` / `agy`)
- [Cursor](https://www.cursor.com) (`cursor` / `cursor-agent`)
- Apple Foundation Models（通过设备端 `fm` 实现的 `apple`）

`apple` 智能体是个例外：它通过内置的 OpenCode 针对 Apple 的设备端模型运行，因此请确保已安装 `fm`（通过 `fm available` 验证）且已有 `fm serve` 进程在监听。

### 3. 安装 Git 并授权无人值守使用

Tendril 会代表您拉取代码、创建工作区、提交和推送。请确认所有操作均无需交互式提示即可正常执行：

- 已配置全局身份（`git config --global user.name` 和 `user.email`）。
- 凭据已通过凭据助手或加载到 agent 中的 SSH 密钥进行缓存，因此 `git pull` 和 `git push` 绝不会提示输入密码。
- 可以正常添加和清理工作区（`git worktree add` 和 `git worktree remove`）。

> [!WARNING]
> 如果通过 HTTPS 推送时提示输入凭据，请配置凭据助手或使用已加载至活跃 `ssh-agent` 的 SSH 密钥。任何一次交互式提示都会导致原本无人值守的任务停滞。

### 4. 安装并认证 GitHub CLI

[CreatePr](../02_Concepts/02_Promptwares.md) 使用 [GitHub CLI](https://cli.github.com/) (`gh`) 来创建 Pull Request。请安装并验证身份认证：

```bash
gh auth login
gh auth status
```

### 5. 全局安装所需的 MCP 服务

如果您依赖 [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) 服务（例如用于 Issue 上下文的 Jira 或用于 UI 设计的 Figma），请进行全局安装并注册，以便每个工作区都可以访问它们。MCP 服务是向编程智能体注册的，而不是在 Tendril 内部：

```bash
# 示例：为 Claude Code 全局注册 MCP 服务
claude mcp add --scope user jira -- npx -y @your-org/jira-mcp
claude mcp add --scope user figma -- npx -y figma-developer-mcp
claude mcp list   # 验证是否可访问
```

> [!NOTE]
> 请使用全局 (global) 或用户 (user) 作用域，而非项目作用域，这样 MCP 服务才能在智能体工作的临时 Git 工作区中持续生效。将所有必需的 API Token 存储为系统环境变量。

确保您实际上已经对每个 MCP 服务完成了*认证*，而不仅仅是完成了注册。从 Tendril 执行一个小型测试计划，确认每个服务都能正常初始化且不会触发 OAuth 弹窗。

## 代码仓库检查清单

### 6. 仓库已做好支持 Worktree 的准备

[ExecutePlan](../02_Concepts/02_Promptwares.md) 在独立的 [Git 工作区 (worktree)](https://git-scm.com/docs/git-worktree) 中运行，而不是在您当前活跃的工作目录中。工作区始于一个干净的提交 —— 其中不存在 `target/`、`node_modules/` 或未跟踪的 `.env` 文件。

- 记录检出后、代码编译前所需的任何设置命令（例如依赖还原、代码生成、复制示例 `.env`），并提供已提交到版本控制中的 setup 脚本。
- 不要依赖仅存在于主检出目录中的未提交文件。
- 使用带有集中缓存的包管理器（如 pnpm store、Cargo registry cache 或 Go module cache），以便每个工作区能在几秒钟内恢复环境，而无需重新下载依赖包。

> [!TIP]
> 快速测试：运行 `git worktree add ../repo-probe`，然后在干净的 Shell 中进入该目录执行文档中记录的构建命令。如果能够正常编译并通过测试，Tendril 也能顺利运行。测试完毕后使用 `git worktree remove ../repo-probe` 将其移除。

### 7. 为每个应用编写运行脚本

在仓库中为每个应用程序提供一个已提交到版本控制的小型启动脚本，并支持配置端口。Tendril 能够跨工作区同时并行运行多个计划，因此硬编码端口会导致端口冲突。

对于搭配 Python API 的 [Vite](https://vite.dev) 前端，脚本示例如下：

```bash
#!/usr/bin/env bash
# run.sh - 启动 Python 后端 API 和 Vite 前端
set -euo pipefail

api_port="${API_PORT:-8000}"
web_port="${WEB_PORT:-5173}"

cd "$(dirname "$0")"

# 后端：配置 virtualenv 并安装依赖
python -m venv .venv
source .venv/bin/activate
pip install -q -r requirements.txt

# 在专属端口上启动后端 API
uvicorn app.main:app --port "$api_port" &
api_pid=$!

# 前端进程退出时终止后端
trap 'kill "$api_pid" 2>/dev/null' EXIT

# 前端：安装依赖并启动 Vite 开发服务器
npm --prefix web install --prefer-offline --no-audit
npm --prefix web run dev -- --port "$web_port" --open
```

> [!NOTE]
> 将启动命令维护在已提交的脚本中，可以确保开发者和自主工作流智能体以完全相同的方式启动应用程序。

### 8. 在仓库根目录添加 AGENTS.md（或 README.md）

为工作流智能体提供浏览代码库所需的基础上下文，避免盲目猜测：

- 构建和运行代码所需的**前置条件**。
- 详细说明应用程序、库和通信协议的**架构图/说明**。
- 用于编译和验证代码库的**构建与测试命令**。
- 指向上一步中启动脚本的**运行脚本说明**。

## 后续步骤

- 在 [教程](04_Tutorial.md) 中体验端到端闭环流程。
- 探索 [核心概念：计划](../02_Concepts/01_Plans.md) 与 [Promptware](../02_Concepts/02_Promptwares.md)。
- 了解 [任务生命周期](../02_Concepts/03_Lifecycle.md)。
