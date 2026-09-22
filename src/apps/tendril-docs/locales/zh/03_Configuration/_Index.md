---
title: 配置
description: 配置 Tendril 设置、环境变量、守护进程选项和项目配置文件。
icon: Settings
groupExpanded: true
searchHints:
  - 配置
  - 设置
  - 选项
  - 首选项
  - 环境变量
---

# 配置

Tendril 将其设置、项目和执行偏好存储在位于 `$TENDRIL_HOME/config.yaml` 的中心化 [YAML](https://yaml.org) 配置文件中。

本节涵盖配置全局 Tendril 环境、管理 [项目设置](02_Projects.md)、调整守护进程设置以及设置 [编程智能体](../06_CodingAgents/_Index.md) 配置文件：

- [设置与配置](01_Setup.md) — 在设置 UI 或 `$TENDRIL_HOME/config.yaml` 中配置全局选项，管理 [编程智能体](../06_CodingAgents/_Index.md)、会话认证、[Cloudflare](https://www.cloudflare.com) 穿透隧道和内置 [验证门禁](01_Setup.md#verifications)。
- [项目设置](02_Projects.md) — 注册 [Git](https://git-scm.com) 仓库，配置视觉色块、验证流水线、审查操作、端口分配、[Docker](https://www.docker.com) 沙箱、[MCP](../09_Advanced/03_MCP.md) 服务器以及 [Git 工作区](02_Projects.md#repositories--git-worktrees) 隔离。

关于计划与 Promptware 工作原理的背景概念，请参阅 [计划](../02_Concepts/01_Plans.md)、[Promptware](../02_Concepts/02_Promptwares.md) 和 [任务生命周期](../02_Concepts/03_Lifecycle.md)。
