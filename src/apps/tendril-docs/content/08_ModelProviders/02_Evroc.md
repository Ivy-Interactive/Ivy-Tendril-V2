---
title: Evroc
description: European sovereign cloud provider with open-source coding models including Kimi, Llama, and Mistral.
icon: Server
searchHints:
  - evroc
  - eu
  - european
  - sovereign
  - kimi
  - mistral
  - llama
---

# Evroc

[Evroc](https://cloud.evroc.com) is a European sovereign cloud provider operating secure, eco-friendly data centers across Europe. Through its "Think" AI platform, Evroc provides [OpenAI](https://openai.com)-compatible inference for leading open-source models such as Kimi, Llama, and Mistral with complete [GDPR](https://gdpr.eu) compliance and European data sovereignty.

## Setup

1. Create an account at [cloud.evroc.com](https://cloud.evroc.com).
2. Generate an API key in the Evroc Console under **Think > Models > + New**.
3. Connect in [OpenCode](https://opencode.ai) using the bundled sidecar or terminal:
   ```bash
   opencode
   ```
   Type `/connect`, select **evroc**, and enter your API key.
4. Select your active model with `/models`.

## Recommended Models

Evroc hosts high-capability open weights optimized for coding and technical reasoning:

| Model                     | ID                                                                          | Creator                            | Strengths                                                |
| :------------------------ | :-------------------------------------------------------------------------- | :--------------------------------- | :------------------------------------------------------- |
| **Kimi K3 / K2.5**        | `moonshotai/Kimi-K3`, `moonshotai/Kimi-K2.5`                                | [Moonshot AI](https://moonshot.cn) | Exceptional long-context coding and multi-file reasoning |
| **Mistral Large / Small** | `mistralai/Mistral-Large-2411`, `mistralai/Mistral-Small-24B-Instruct-2501` | [Mistral AI](https://mistral.ai)   | Fast, precise code generation and verification           |
| **Llama 3.3 70B**         | `meta-llama/Llama-3.3-70B-Instruct`                                         | [Meta AI](https://llama.meta.com)  | Broad coding knowledge, documentation, and refactoring   |

> [!TIP]
> Look for models carrying the **Code** tag in the Evroc console for the best results on programming tasks.

## Using with Tendril

You can route Tendril v2 plan execution through Evroc in two ways:

### Option A: Via Bundled OpenCode

1. In the Tendril desktop app, go to **Settings > Coding Agent**.
2. Select **OpenCode** as your coding agent (see [OpenCode Agent](../06_CodingAgents/04_OpenCode.md)).
3. Tendril invokes the bundled [OpenCode](https://opencode.ai) sidecar (`binaries/opencode`), which routes requests through your authenticated Evroc provider.

### Option B: Custom OpenAI Endpoint in `config.yaml`

Because Evroc offers an OpenAI-compatible interface, you can configure it directly under `codingAgents` in `~/.tendril/config.yaml` (see [Configuration Setup](../03_Configuration/01_Setup.md)):

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

## Links

- [Model Providers](_Index.md)
- [Coding Agents](../06_CodingAgents/_Index.md)
- [Evroc Cloud Console](https://cloud.evroc.com)
- [Evroc + OpenCode Documentation](https://docs.evroc.com/integrations/opencode.html)
