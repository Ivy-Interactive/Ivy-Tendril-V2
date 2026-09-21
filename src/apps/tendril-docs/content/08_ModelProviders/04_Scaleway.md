---
title: Scaleway
description: European cloud provider offering OpenAI-compatible Generative APIs for coding, reasoning, and open-weight models.
icon: Server
searchHints:
  - scaleway
  - eu
  - european
  - generative apis
  - sovereign
  - qwen
---

# Scaleway

[Scaleway](https://www.scaleway.com) is a major European cloud service provider offering sovereign AI infrastructure hosted in energy-efficient data centers located across France, the Netherlands, and Poland. Through its Generative APIs platform, Scaleway provides managed, fully [OpenAI](https://openai.com)-compatible endpoints for premier open models.

## Setup

1. Create an account at [scaleway.com](https://www.scaleway.com).
2. Generate an IAM API key (Secret Key) in the Scaleway console under **Identity and Access Management (IAM)**.
3. Connect in [OpenCode](https://opencode.ai) using the bundled sidecar or terminal:
   ```bash
   opencode
   ```
   Type `/connect`, select **Scaleway**, and paste your IAM Secret Key.
4. Select a model using `/models`.

## Recommended Models

Scaleway hosts several models optimized for code completion and software engineering:

| Model                      | Model ID                          | Creator                              | Recommended Tier |
| :------------------------- | :-------------------------------- | :----------------------------------- | :--------------- |
| **Qwen 2.5 Coder 32B**     | `qwen2.5-coder-32b-instruct`      | [Qwen](https://github.com/QwenLM)    | Deep             |
| **Llama 3.3 70B Instruct** | `llama-3.3-70b-instruct`          | [Meta AI](https://llama.meta.com)    | Balanced         |
| **Mistral Small 24B**      | `mistral-small-24b-instruct-2501` | [Mistral AI](https://mistral.ai)     | Quick            |
| **DeepSeek R1 Distill**    | `deepseek-r1-distill-llama-70b`   | [DeepSeek](https://www.deepseek.com) | Deep (Reasoning) |

## Using with Tendril

### Option A: Via Bundled OpenCode

1. In the Tendril desktop app, go to **Settings > Coding Agent**.
2. Select **OpenCode** as your active agent (see [OpenCode Agent](../06_CodingAgents/04_OpenCode.md)).
3. OpenCode will use your configured Scaleway credentials for all plan execution tasks.

### Option B: Custom OpenAI Endpoint in `config.yaml`

Because Scaleway's Generative APIs follow the OpenAI specification at `https://api.scaleway.ai/v1`, you can configure it directly in `~/.tendril/config.yaml` (see [Configuration Setup](../03_Configuration/01_Setup.md)):

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
> Scaleway enforces standard HTTP Bearer token authentication. Your IAM Secret Key serves directly as the `OPENAI_API_KEY`.

## Links

- [Model Providers](_Index.md)
- [Coding Agents](../06_CodingAgents/_Index.md)
- [Scaleway Platform](https://www.scaleway.com)
- [Scaleway Console](https://console.scaleway.com)
- [Scaleway Generative APIs Documentation](https://www.scaleway.com/en/docs/generative-apis/reference-content/integrate-with-opencode/)
