---
title: Berget AI
description: 欧洲 AI 基础设施提供商，提供 Kimi 和 GLM 模型，具备完全的欧盟数据驻留权并原生支持 Tendril v2 BYO 卡片。
icon: Server
searchHints:
  - berget
  - eu
  - 欧洲
  - kimi
  - glm
  - moonshot
---

# Berget AI

[Berget AI](https://berget.ai) 是一家欧洲 AI 基础设施提供商，在瑞典境内保证欧盟数据驻留权的同时，提供主权、高性能的 LLM 推理服务。Berget 提供兼容 [OpenAI](https://openai.com) 的端点，托管包括 [Moonshot AI](https://moonshot.cn) 的 Kimi K3 和 [智谱 AI (Zhipu AI)](https://open.bigmodel.cn) 的 GLM 家族在内的前沿开源权重模型，完全符合 [GDPR](https://gdpr.eu) 规范。

在 Tendril v2 中，Berget AI 既可以通过桌面应用中的原生 **Bring Your Own LLM** 卡片获得支持，也可以通过捆绑的 [OpenCode](https://opencode.ai) Sidecar 使用。

## 通过 Tendril 桌面端配置

使用 Berget AI 最简单的方法是通过桌面设置中的原生 BYO 卡片：

1. 在 [console.berget.ai](https://console.berget.ai) 创建账号并生成 API Key。
2. 打开 Tendril 并导航至 **Settings > Coding Agent**。
3. 在 **Bring Your Own LLM** 下，点击 **Berget AI** 卡片。
4. 将您的 API Key 粘贴到 **API Key** 输入框中，然后点击 **Save**。

> [!NOTE]
> 在 UI 中无需配置 Base URL 字段。Tendril v2 会自动将端点固定为 `https://api.berget.ai/v1`，并通过捆绑的 [OpenCode](../06_CodingAgents/04_OpenCode.md) Sidecar 路由请求。

## 在 `config.yaml` 中手动配置

您也可以在 `~/.tendril/config.yaml` 中直接配置 Berget AI（参见 [配置设置](../03_Configuration/01_Setup.md)）：

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "sk-berget-..."
      OPENAI_BASE_URL: "https://api.berget.ai/v1"
      ANTHROPIC_API_KEY: "sk-berget-..."
      ANTHROPIC_BASE_URL: "https://api.berget.ai"
    profiles:
      - name: deep
        model: "moonshotai/Kimi-K3"
        effort: max
      - name: balanced
        model: "moonshotai/Kimi-K3"
        effort: high
      - name: quick
        model: "moonshotai/Kimi-K3"
        effort: low
```

## 推荐模型

Tendril v2 的 Profile 解析器在所有层级中直接将 Berget AI 映射至 Kimi K3：

| 层级         | 模型 ID              | 默认推理强度 | 适用场景                       |
| :----------- | :------------------- | :----------- | :----------------------------- |
| **Deep**     | `moonshotai/Kimi-K3` | `max`        | 架构规划、复杂推理、大规模重构 |
| **Balanced** | `moonshotai/Kimi-K3` | `high`       | 常规计划执行与代码生成         |
| **Quick**    | `moonshotai/Kimi-K3` | `low`        | 快速验证、提交摘要、状态报告   |

Berget 还提供 GLM 家族模型（例如 `GLM-4.7`）。您可以在 Profile 配置中指定任何可用的 Berget 模型 ID，或者在 [OpenCode](../06_CodingAgents/04_OpenCode.md) 中使用 `/models` 进行选择。

## 通过 OpenCode CLI 配置

此外，您也可以通过 OpenCode 配置 Berget：

1. 运行 Berget 设置工具：
   ```bash
   npx berget code init
   ```
2. 启动 OpenCode：
   ```bash
   opencode
   ```
3. 在 Tendril 的 **Settings > Coding Agent** 下将活跃智能体设置为 OpenCode（`codingAgent: opencode`）。

> [!TIP]
> Tendril v2 自带捆绑的 [OpenCode](https://opencode.ai) 二进制文件（`binaries/opencode`）。您无需在系统上全局安装 Node.js 或 OpenCode 即可在 Tendril 中使用 Berget。详情请参阅 [OpenCode 智能体指南](../06_CodingAgents/04_OpenCode.md)。

## 相关链接

- [模型提供商](_Index.md)
- [编程智能体](../06_CodingAgents/_Index.md)
- [Berget AI 官网](https://berget.ai)
- [Berget 控制台](https://console.berget.ai)
- [Berget + OpenCode 文档](https://docs.berget.ai/integrations/opencode)
