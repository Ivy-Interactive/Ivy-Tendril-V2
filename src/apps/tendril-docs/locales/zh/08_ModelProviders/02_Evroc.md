---
title: Evroc
description: 欧洲主权云提供商，提供包括 Kimi、Llama 和 Mistral 在内的开源编程模型。
icon: Server
searchHints:
  - evroc
  - eu
  - 欧洲
  - 主权云
  - kimi
  - mistral
  - llama
---

# Evroc

[Evroc](https://cloud.evroc.com) 是一家欧洲主权云提供商，在欧洲各地运营安全、环保的数据中心。通过其“Think” AI 平台，Evroc 在完全符合 [GDPR](https://gdpr.eu) 规范并保证欧洲数据主权的前提下，为包括 Kimi、Llama 和 Mistral 在内的主流开源模型提供兼容 [OpenAI](https://openai.com) 的推理服务。

## 配置设置

1. 在 [cloud.evroc.com](https://cloud.evroc.com) 创建账号。
2. 在 Evroc 控制台的 **Think > Models > + New** 下生成 API Key。
3. 使用捆绑的 Sidecar 或终端在 [OpenCode](https://opencode.ai) 中连接：
   ```bash
   opencode
   ```
   输入 `/connect`，选择 **evroc**，然后输入您的 API Key。
4. 使用 `/models` 选择您的活跃模型。

## 推荐模型

Evroc 托管了针对编程和技术推理进行优化的强能力开源权重模型：

| 模型                      | ID                                                                          | 创建者                             | 优势                               |
| :------------------------ | :-------------------------------------------------------------------------- | :--------------------------------- | :--------------------------------- |
| **Kimi K3 / K2.5**        | `moonshotai/Kimi-K3`, `moonshotai/Kimi-K2.5`                                | [Moonshot AI](https://moonshot.cn) | 出色的长上下文编程与多文件推理能力 |
| **Mistral Large / Small** | `mistralai/Mistral-Large-2411`, `mistralai/Mistral-Small-24B-Instruct-2501` | [Mistral AI](https://mistral.ai)   | 快速、精确的代码生成与验证         |
| **Llama 3.3 70B**         | `meta-llama/Llama-3.3-70B-Instruct`                                         | [Meta AI](https://llama.meta.com)  | 广泛的编程知识、文档编写与重构能力 |

> [!TIP]
> 在 Evroc 控制台中寻找带有 **Code** 标签的模型，以便在编程任务中获得最佳效果。

## 与 Tendril 配合使用

您可以通过以下两种方式将 Tendril v2 计划执行路由至 Evroc：

### 选项 A：通过捆绑的 OpenCode

1. 在 Tendril 桌面应用中，前往 **Settings > Coding Agent**。
2. 选择 **OpenCode** 作为您的编程智能体（参见 [OpenCode 智能体](../06_CodingAgents/04_OpenCode.md)）。
3. Tendril 会调用捆绑的 [OpenCode](https://opencode.ai) Sidecar（`binaries/opencode`），通过您已认证的 Evroc 提供商路由请求。

### 选项 B：在 `config.yaml` 中配置自定义 OpenAI 端点

由于 Evroc 提供了兼容 OpenAI 的接口，您可以直接在 `~/.tendril/config.yaml` 的 `codingAgents` 下进行配置（参见 [配置设置](../03_Configuration/01_Setup.md)）：

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-evroc-api-key"
      OPENAI_BASE_URL: "https://api.evroc.com/v1"
    profiles:
      - name: deep
        model: "moonshotai/Kimi-K3"
        effort: high
      - name: balanced
        model: "moonshotai/Kimi-K2.5"
        effort: medium
      - name: quick
        model: "mistralai/Mistral-Small-24B-Instruct-2501"
        effort: low
```

## 相关链接

- [模型提供商](_Index.md)
- [编程智能体](../06_CodingAgents/_Index.md)
- [Evroc 云控制台](https://cloud.evroc.com)
- [Evroc + OpenCode 文档](https://docs.evroc.com/integrations/opencode.html)
