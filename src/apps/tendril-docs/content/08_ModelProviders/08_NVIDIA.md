---
title: NVIDIA
description: Access NVIDIA NIM inference microservices and accelerated open models for coding tasks via NVIDIA Build.
icon: Cpu
searchHints:
  - nvidia
  - nim
  - spark
  - build
  - gpu
---

# NVIDIA

[NVIDIA Build](https://build.nvidia.com) provides access to [NVIDIA](https://www.nvidia.com) NIM (Inference Microservice) endpoints, offering enterprise-optimized, GPU-accelerated inference for frontier open models including [Meta's Llama](https://llama.meta.com), [DeepSeek](https://www.deepseek.com), [Mistral AI](https://mistral.ai), and [Qwen](https://github.com/QwenLM).

## Setup via OpenCode

1. Generate an API key (starting with `nvapi-`) at [build.nvidia.com](https://build.nvidia.com).
2. Connect in [OpenCode](https://opencode.ai) using the terminal or Tendril's embedded PTY:
   ```bash
   opencode
   ```
   Type `/connect`, select **NVIDIA**, and paste your API key.
3. Switch your active model using `/models`.

## Recommended Models

NVIDIA NIM hosts optimized builds for top coding models:

| Model                      | NIM Identifier                    | Execution Tier   | Creator                              |
| :------------------------- | :-------------------------------- | :--------------- | :----------------------------------- |
| **Llama 3.3 70B Instruct** | `meta/llama-3.3-70b-instruct`     | Deep             | [Meta AI](https://llama.meta.com)    |
| **DeepSeek R1**            | `deepseek-ai/deepseek-r1`         | Deep (Reasoning) | [DeepSeek](https://www.deepseek.com) |
| **Qwen 2.5 Coder 32B**     | `qwen/qwen2.5-coder-32b-instruct` | Balanced         | [Qwen](https://github.com/QwenLM)    |
| **Llama 3.1 8B Instruct**  | `meta/llama-3.1-8b-instruct`      | Quick            | [Meta AI](https://llama.meta.com)    |

## Using with Tendril

### Option A: Via Bundled OpenCode

1. In the Tendril desktop application, open **Settings > Coding Agent**.
2. Select **OpenCode** as your active coding agent (see [OpenCode Agent](../06_CodingAgents/04_OpenCode.md)).
3. Tendril runs plans through the bundled [OpenCode](https://opencode.ai) sidecar using your authenticated NVIDIA NIM models.

### Option B: Direct NIM API in `config.yaml`

NVIDIA NIM provides fully [OpenAI](https://openai.com)-compatible endpoints at `https://integrate.api.nvidia.com/v1`. You can configure Tendril to connect directly in `~/.tendril/config.yaml` (see [Configuration Setup](../03_Configuration/01_Setup.md)):

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
> NVIDIA NIM endpoints use standard OpenAI Chat Completion schemas with token streaming enabled, making them fully compatible with Tendril's live output viewers.

## Links

- [Model Providers](_Index.md)
- [Coding Agents](../06_CodingAgents/_Index.md)
- [NVIDIA Build Catalog](https://build.nvidia.com)
- [NVIDIA NIM Documentation](https://build.nvidia.com/spark/cli-coding-agent)
