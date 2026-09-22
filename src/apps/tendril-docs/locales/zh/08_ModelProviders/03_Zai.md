---
title: Z.AI
description: Z.AI 提供对 GLM 前沿模型的高吞吐量访问，并包含专属编程套餐选项。
icon: Server
searchHints:
  - z.ai
  - zai
  - glm
  - zhipu
  - 智谱
  - bigmodel
---

# Z.AI

[Z.AI](https://z.ai)（由 [智谱 AI](https://open.bigmodel.cn) 开发）提供对 GLM 模型家族的企业级访问，包括专为自主编程智能体、[计划](../02_Concepts/01_Plans.md) 以及自动化软件开发工作流优化的专用编程套餐。

## 配置设置

1. 从 [Z.AI API 控制台](https://z.ai/manage-apikey/apikey-list) 获取 API Key。
2. 通过终端或 Tendril 的嵌入式 PTY 在 [OpenCode](https://opencode.ai) 中进行认证：
   ```bash
   opencode auth login
   ```
   选择 **Z.AI**（如果您已订购专用编程套餐，请选择 **Z.AI Coding Plan**），并在提示时粘贴您的 API Key。
3. 启动 OpenCode 并浏览可用模型：
   ```bash
   opencode
   ```
   输入 `/models` 切换您的活跃模型。

## 推荐模型

| 模型                  | ID                         | Profile 层级 | 最适合场景                                      |
| :-------------------- | :------------------------- | :----------- | :---------------------------------------------- |
| **GLM 4.7**           | `glm-4.7`                  | Deep         | 复杂代码生成、架构规划、调试                    |
| **GLM 4 Plus**        | `glm-4-plus`               | Balanced     | 功能增加、代码重构、代码审查                    |
| **GLM 4 Air / Flash** | `glm-4-air`, `glm-4-flash` | Quick        | 快速代码检查 (Lint)、单元测试生成、提交信息摘要 |

## 与 Tendril 配合使用

1. 打开 Tendril 桌面应用程序并导航至 **Settings > Coding Agent**。
2. 选择 **OpenCode** 作为您的活跃编程智能体（参见 [OpenCode 智能体](../06_CodingAgents/04_OpenCode.md)）。
3. Tendril 会调用捆绑的 [OpenCode](https://opencode.ai) Sidecar（`binaries/opencode`），将智能体任务直接通过 Z.AI 的后端路由。

您也可以在 `~/.tendril/config.yaml` 中按执行层级指定 GLM 模型（参见 [配置设置](../03_Configuration/01_Setup.md)）：

```yaml
codingAgent: opencode

codingAgents:
  - name: opencode
    profiles:
      - name: deep
        model: "glm-4.7"
        effort: high
      - name: balanced
        model: "glm-4-plus"
        effort: medium
      - name: quick
        model: "glm-4-air"
        effort: low
```

> [!NOTE]
> Z.AI 的 Coding Plan（编程套餐）提供了更高的速率限制和并发请求配额，专为持续运行智能体任务和复杂 [计划](../02_Concepts/01_Plans.md) 构建量身定制。

## 相关链接

- [模型提供商](_Index.md)
- [编程智能体](../06_CodingAgents/_Index.md)
- [Z.AI 平台](https://z.ai)
- [Z.AI 控制台](https://z.ai/manage-apikey/apikey-list)
- [Z.AI + OpenCode 文档](https://docs.z.ai/scenario-example/develop-tools/opencode)
