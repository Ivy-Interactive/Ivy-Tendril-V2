---
title: NVIDIA
description: 通过 NVIDIA Build 访问 NVIDIA NIM 推理微服务和针对编程任务加速的开源模型。
icon: Cpu
searchHints:
  - nvidia
  - nim
  - spark
  - build
  - gpu
---

# NVIDIA

[NVIDIA Build](https://build.nvidia.com) 提供了对 [NVIDIA](https://www.nvidia.com) NIM（推理微服务）端点的访问，为包括 [Meta 的 Llama](https://llama.meta.com)、[DeepSeek](https://www.deepseek.com)、[Mistral AI](https://mistral.ai) 和 [Qwen](https://github.com/QwenLM) 在内的前沿开源模型提供企业级优化且基于 GPU 加速的推理服务。

## 通过 OpenCode 配置

1. 在 [build.nvidia.com](https://build.nvidia.com) 生成 API Key（以 `nvapi-` 开头）。
2. 使用终端或 Tendril 的嵌入式 PTY 在 [OpenCode](https://opencode.ai) 中连接：
   ```bash
   opencode
   ```
   输入 `/connect`，选择 **NVIDIA**，并粘贴您的 API Key。
3. 使用 `/models` 切换您的活跃模型。

## 推荐模型

NVIDIA NIM 托管了针对顶级编程模型优化的构建版本：

| 模型                       | NIM 标识符                        | 执行层级         | 创建者                               |
| :------------------------- | :-------------------------------- | :--------------- | :----------------------------------- |
| **Llama 3.3 70B Instruct** | `meta/llama-3.3-70b-instruct`     | Deep             | [Meta AI](https://llama.meta.com)    |
| **DeepSeek R1**            | `deepseek-ai/deepseek-r1`         | Deep (Reasoning) | [DeepSeek](https://www.deepseek.com) |
| **Qwen 2.5 Coder 32B**     | `qwen/qwen2.5-coder-32b-instruct` | Balanced         | [Qwen](https://github.com/QwenLM)    |
| **Llama 3.1 8B Instruct**  | `meta/llama-3.1-8b-instruct`      | Quick            | [Meta AI](https://llama.meta.com)    |

## 与 Tendril 配合使用

### 选项 A：通过捆绑的 OpenCode

1. 在 Tendril 桌面应用程序中，打开 **Settings > Coding Agent**。
2. 选择 **OpenCode** 作为您的活跃编程智能体（参见 [OpenCode 智能体](../06_CodingAgents/04_OpenCode.md)）。
3. Tendril 会使用您已认证的 NVIDIA NIM 模型，通过捆绑的 [OpenCode](https://opencode.ai) Sidecar 运行计划。

### 选项 B：在 `config.yaml` 中配置直接 NIM API

NVIDIA NIM 在 `https://integrate.api.nvidia.com/v1` 提供了完全兼容 [OpenAI](https://openai.com) 的端点。您可以配置 Tendril 在 `~/.tendril/config.yaml` 中直接连接（参见 [配置设置](../03_Configuration/01_Setup.md)）：

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "nvapi-..."
      OPENAI_BASE_URL: "https://integrate.api.nvidia.com/v1"
    profiles:
      - name: deep
        model: "meta/llama-3.3-70b-instruct"
        effort: high
      - name: balanced
        model: "qwen/qwen2.5-coder-32b-instruct"
        effort: medium
      - name: quick
        model: "meta/llama-3.1-8b-instruct"
        effort: low
```

> [!TIP]
> NVIDIA NIM 端点采用启用了 Token 流式传输的标准 OpenAI Chat Completion Schema，使其与 Tendril 的实时输出查看器完全兼容。

## 相关链接

- [模型提供商](_Index.md)
- [编程智能体](../06_CodingAgents/_Index.md)
- [NVIDIA Build 目录](https://build.nvidia.com)
- [NVIDIA NIM 文档](https://build.nvidia.com/spark/cli-coding-agent)
