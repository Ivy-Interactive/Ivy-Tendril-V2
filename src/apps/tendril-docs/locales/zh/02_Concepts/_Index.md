---
title: 核心概念
description: 构成 Tendril 基础的三大核心概念 —— 计划、Promptware 与任务。
icon: Layers
groupExpanded: true
searchHints:
  - 核心概念
  - 概念
  - 模型
  - 架构
  - 计划
  - promptware
  - 任务
---

# 核心概念

Tendril 拥有简洁的概念模型，桌面应用和 CLI 中的一切都可以映射到以下三个核心原语之一：

- [计划](01_Plans.md) — 基本工作单元。计划是磁盘上的透明文件夹、状态机、不可变的修订版本集合、内联批注以及自动化验证。
- [Promptware](02_Promptwares.md) — 推动计划从一个状态迈向下一个状态的专用工作流智能体，每个智能体都拥有独立的系统提示词、受约束的工具权限和长期记忆。
- [生命周期与任务](03_Lifecycle.md) — 针对某个计划运行一次 Promptware 即构成一个任务：包含状态、遥测、隔离的 Git 工作区、成本追踪以及决定工作是否能推进到审查阶段的质量门禁。

如果您尚未体验过这一闭环流程，[教程](../01_GettingStarted/04_Tutorial.md) 将为您演示这些原语的实际运用。您也可以查阅 [代码库准备](../01_GettingStarted/03_Onboarding.md) 来为代码仓库适配并行工作区做好准备。
