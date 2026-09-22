---
title: 欢迎来到 Ivy Tendril
description: >-
  Tendril 是一个开源、本地优先的桌面应用程序，充当 AI 驱动软件开发的操作系统 —— 通过从构想到合并 PR 的结构化生命周期，编排 Claude Code、Codex、Copilot、Gemini、OpenCode、Antigravity、Cursor 和 Apple Foundation Models 等编程智能体。
icon: Rocket
searchHints:
  - 概览
  - 什么是 tendril
  - 智能体编排
  - 架构
  - tauri
  - 守护进程
---

# 欢迎来到 Ivy Tendril

[![两分钟了解 Ivy Tendril: 在 YouTube 上观看](../assets/yt-thumbnail-in-two-minutes-2.png)](https://youtu.be/_KVG1NnAj-8)

## 核心理念

在 Tendril 中，工作被组织为 [**计划 (plans)**](../02_Concepts/01_Plans.md) —— 即结构化、可审查的工作单元。Tendril 不是输出未经审查代码的黑盒，而是使用 [**Promptware**](../02_Concepts/02_Promptwares.md)（专注于特定阶段的单用途隔离工作流智能体），推动计划沿着明确的 [生命周期](../02_Concepts/03_Lifecycle.md) 演进。无论是在起草计划、在并行工作区中实施更改、运行验证门禁还是创建 Pull Request，您都始终保持完全的透明度与控制力。Tendril 不仅仅在编辑器中自动补全代码，它编排了您的整个自主开发工作流。

## 关键功能

- **并行工作区 (Parallel worktrees)** — 每个智能体都在独立的 [Git 工作区 (worktree)](https://git-scm.com/docs/git-worktree) 中运行，允许多个计划并发执行，杜绝分支污染或工作目录冲突。
- **远程与移动办公穿透** — 通过 [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) 安全地暴露本地守护进程，随时从手机或远程浏览器查看进度并引导运行中的智能体。
- **语音与富文本输入** — 使用内置的 [OpenAI Whisper](https://github.com/openai/whisper) 语音转写口述需求，或直接拖入终端日志、Markdown 规范与设计文件作为上下文。
- **计划批注 (Plan annotations)** — 直接在草稿计划中内联添加修改意见；Tendril 会将您的批注直接送入 [UpdatePlan](../02_Concepts/02_Promptwares.md) 以修订规范。
- **带验证门禁的代码审查** — 检查 Git diff、查看自动化测试结果（`Cargo`、`pnpm`、代码检查与格式化），仅批准经过充分验证的修改。
- **GitHub 与收件箱接入** — 通过 Webhook 自动将收到的 [GitHub](https://github.com) Issue 和 [Jam.dev](https://jam.dev) 缺陷报告转换为可执行的计划。

## 架构组成

Tendril 由在您本地机器上运行的三个核心组件构成：

- 基于 [Tauri 2](https://tauri.app) 构建的 **桌面应用程序** — 承载 [React](https://react.dev) 前端的高性能原生桌面外壳。
- 使用 [Rust](https://www.rust-lang.org) 编写的 **后台守护服务**（`tendril run` / `tendril serve`）— 暴露 REST 和 WebSocket API。桌面端会在后台自动启动并监管该服务。
- 连接到同一服务并共享相同数据存储的 **CLI**（`tendril`）。凡是在桌面端可操作的内容，均可通过命令行执行。

所有状态均完全保留在本地：

- 位于 `$TENDRIL_HOME/tendril.db` 的本地 [SQLite](https://www.sqlite.org) 数据库记录任务、成本与遥测数据。
- 位于 `$TENDRIL_HOME/Plans/` 的纯文件系统存储将计划文件、修订版本、批注、日志和验证报告保存为透明的 YAML 与 Markdown 文档。

> [!NOTE]
> `$TENDRIL_HOME` 默认为 `~/.tendril`。自定义路径配置请参阅 [安装](02_Installation.md)。

您的源代码绝不会离开本地设备。唯一的出站网络流量是您配置的编程智能体直接发起的 API 请求（例如发往 Anthropic、OpenAI 或 Google）以及您明确启动的可选 Cloudflare 穿透隧道。

支持的编程智能体包括：

- [Claude Code](https://code.claude.com/docs) (`claude`)
- [OpenAI Codex](https://openai.com) (`codex`)
- [GitHub Copilot](https://github.com/features/copilot) (`copilot`)
- [Google Gemini](https://ai.google.dev) (`gemini`)
- [OpenCode](https://opencode.ai) (`opencode`)
- Antigravity (`antigravity` / `agy`)
- [Cursor](https://www.cursor.com) (`cursor`)
- Apple Foundation Models（通过设备端 `fm` 实现的 `apple`）

## 为什么选择 Tendril？

在 [Ivy Interactive](https://ivy.app)，我们测试了多种用于自主编程的多智能体架构。虽然各个独立的 CLI 智能体功能强大，但同时管理十几个终端标签页并审查未经追踪的 diff 很快就会陷入混乱。

Tendril 为智能体工程化带来了秩序。通过我们的 [Promptware](../02_Concepts/02_Promptwares.md) 架构，工作流智能体能够在多次运行中积累特定于项目的记忆，学习代码库惯用法，并防止重复失败。通过围绕持久耐用的 [计划](../02_Concepts/01_Plans.md) 构建整个工作流程，人类开发者保留了最终的审查控制权，而自主智能体则承担了繁重的具体实现工作。

> [!TIP]
> 我们非常期待听到您的反馈。欢迎在 [GitHub 仓库](https://github.com/Ivy-Interactive/Ivy-Tendril-V2) 上反馈问题和提交功能建议。如需获取技术支持或参与讨论，请加入我们的 [Discord 社区](https://discord.gg/FHgxkDga3y)。

## 后续步骤

- [安装](02_Installation.md) — 构建并安装桌面应用与 CLI。
- [核心概念](../02_Concepts/_Index.md) — 深入了解计划、Promptware 以及任务生命周期。
