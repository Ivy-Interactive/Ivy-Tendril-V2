---
title: Scaleway
description: 欧洲云提供商，提供兼容 OpenAI 的 Generative API，适用于编程、推理和开源权重模型。
icon: Server
searchHints:
  - scaleway
  - eu
  - 欧洲
  - generative apis
  - 主权云
  - qwen
---

# Scaleway

[Scaleway](https://www.scaleway.com) 是一家欧洲主流云服务提供商，在法国、荷兰和波兰的节能数据中心中提供主权 AI 基础设施。通过其 Generative APIs 平台，Scaleway 为业界前沿的开源模型提供完全兼容 [OpenAI](https://openai.com) 的托管端点。

## 配置设置

1. 在 [scaleway.com](https://www.scaleway.com) 创建账号。
2. 在 Scaleway 控制台的 **Identity and Access Management (IAM)** 下生成 IAM API Key（Secret Key）。
3. 使用捆绑的 Sidecar 或终端在 [OpenCode](https://opencode.ai) 中连接：
   ```bash
   opencode
   ```
   输入 `/connect`，选择 **Scaleway**，并粘贴您的 IAM Secret Key。
4. 使用 `/models` 选择模型。

## 推荐模型

Scaleway 托管了多款针对代码补全和软件工程优化的模型：

| 模型                       | 模型 ID                           | 创建者                               | 推荐层级         |
| :------------------------- | :-------------------------------- | :----------------------------------- | :--------------- |
| **Qwen 2.5 Coder 32B**     | `qwen2.5-coder-32b-instruct`      | [Qwen](https://github.com/QwenLM)    | Deep             |
| **Llama 3.3 70B Instruct** | `llama-3.3-70b-instruct`          | [Meta AI](https://llama.meta.com)    | Balanced         |
| **Mistral Small 24B**      | `mistral-small-24b-instruct-2501` | [Mistral AI](https://mistral.ai)     | Quick            |
| **DeepSeek R1 Distill**    | `deepseek-r1-distill-llama-70b`   | [DeepSeek](https://www.deepseek.com) | Deep (Reasoning) |

## 与 Tendril 配合使用

### 选项 A：通过捆绑的 OpenCode

1. 在 Tendril 桌面应用中，前往 **Settings > Coding Agent**。
2. 选择 **OpenCode** 作为您的活跃智能体（参见 [OpenCode 智能体](../06_CodingAgents/04_OpenCode.md)）。
3. OpenCode 将在所有计划执行任务中使用您配置的 Scaleway 凭据。

### 选项 B：在 `config.yaml` 中配置自定义 OpenAI 端点

由于 Scaleway 的 Generative API 遵循位于 `https://api.scaleway.ai/v1` 的 OpenAI 规范，您可以直接在 `~/.tendril/config.yaml` 中进行配置（参见 [配置设置](../03_Configuration/01_Setup.md)）：

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-scaleway-secret-key"
      OPENAI_BASE_URL: "https://api.scaleway.ai/v1"
    profiles:
      - name: deep
        model: "qwen2.5-coder-32b-instruct"
        effort: high
      - name: balanced
        model: "llama-3.3-70b-instruct"
        effort: medium
      - name: quick
        model: "mistral-small-24b-instruct-2501"
        effort: low
```

> [!NOTE]
> Scaleway 采用标准 HTTP Bearer Token 认证。您的 IAM Secret Key 可直接作为 `OPENAI_API_KEY` 使用。

## 相关链接

- [模型提供商](_Index.md)
- [编程智能体](../06_CodingAgents/_Index.md)
- [Scaleway 平台](https://www.scaleway.com)
- [Scaleway 控制台](https://console.scaleway.com)
- [Scaleway Generative APIs 文档](https://www.scaleway.com/en/docs/generative-apis/reference-content/integrate-with-opencode/)
