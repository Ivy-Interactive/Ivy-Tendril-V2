---
title: Model Providers
description: Configure model providers and inference backends for Tendril v2 agents using built-in BYO cards or the bundled OpenCode sidecar.
icon: Server
groupExpanded: true
searchHints:
  - model providers
  - providers
  - api
  - inference
  - gateway
  - llm
  - opencode
  - bring your own llm
  - byo
---

# Model Providers

Tendril v2 supports flexible model provider routing, allowing you to run [coding agents](../06_CodingAgents/_Index.md) against European sovereign infrastructure, unified API gateways, cloud model hubs, or local on-premises endpoints.

In Tendril v2, model provider execution routes through two primary mechanisms:

1. **Native Bring Your Own LLM (BYO LLM)**: Built-in settings cards and direct [configuration](../03_Configuration/01_Setup.md) in `config.yaml` for [OpenAI](https://openai.com), [Anthropic](https://www.anthropic.com), and European sovereign provider [Berget AI](01_Berget.md).
2. **Bundled OpenCode Sidecar**: Tendril v2 ships with the [OpenCode](https://opencode.ai) binary bundled out of the box (`binaries/opencode`), providing direct access to multi-provider gateways and custom inference backends without requiring manual CLI installations (see [OpenCode Agent](../06_CodingAgents/04_OpenCode.md)).

## Supported Providers

- [Berget AI](01_Berget.md) ([console.berget.ai](https://console.berget.ai)) — European AI infrastructure provider offering Kimi and GLM models with full EU data residency and first-class Tendril BYO card integration.
- [Evroc](02_Evroc.md) ([cloud.evroc.com](https://cloud.evroc.com)) — European sovereign cloud provider featuring open-source coding models including Kimi, Llama, and Mistral.
- [Z.AI](03_Zai.md) ([z.ai](https://z.ai)) — High-throughput access to GLM models with dedicated coding plan options.
- [Scaleway](04_Scaleway.md) ([scaleway.com](https://www.scaleway.com)) — European cloud provider offering OpenAI-compatible Generative APIs for coding and reasoning.
- [Opper.ai](05_Opper.md) ([opper.ai](https://opper.ai)) — AI gateway providing unified access to 300+ models with EU data residency options.
- [OpenRouter](06_OpenRouter.md) ([openrouter.ai](https://openrouter.ai)) — Unified API gateway providing access to models from Anthropic, OpenAI, Google, Meta, and DeepSeek.
- [Cloudflare](07_Cloudflare.md) ([cloudflare.com](https://developers.cloudflare.com/workers-ai/)) — Serverless inference via Cloudflare Workers AI alongside Workers MCP tool integration.
- [NVIDIA](08_NVIDIA.md) ([build.nvidia.com](https://build.nvidia.com)) — Enterprise-grade [NVIDIA NIM](https://build.nvidia.com) microservices and open models hosted on NVIDIA Build.
- [Vercel AI Gateway](09_Vercel.md) ([vercel.com](https://vercel.com/docs/ai-gateway)) — Unified multi-provider routing with built-in telemetry, spend guardrails, and request caching.

## How Configuration Works

### 1. In the Tendril Desktop App

Navigate to **Settings > Coding Agent**:

- **Pre-Configured Agents**: Select from bundled agents including [Claude Code](../06_CodingAgents/01_ClaudeCode.md), [Copilot](../06_CodingAgents/03_Copilot.md), [Codex](../06_CodingAgents/02_Codex.md), [Gemini](../06_CodingAgents/05_Gemini.md), [Antigravity](https://antigravity.google), [OpenCode](../06_CodingAgents/04_OpenCode.md), [Cursor](https://cursor.com), and [Apple on-device models](https://developer.apple.com).
- **Bring Your Own LLM Cards**: Choose **OpenAI**, **Anthropic**, or **Berget AI**. Enter your API key, and Tendril automatically configures the appropriate base URLs, splits them into respective SDK environment variables, and populates tiered profile defaults.
- **Profile Tiers**: Configure default models and reasoning effort levels across three execution tiers:
  - **Deep**: High-effort reasoning for architectural planning, complex refactors, and initial drafts.
  - **Balanced**: Balanced capability and speed for day-to-day feature implementation and review fixes.
  - **Quick**: Fast, low-latency models for commit message generation, test verification, and status checks.

### 2. In `config.yaml`

All provider and agent settings persist to `~/.tendril/config.yaml` (see [Configuration Setup](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy # or opencode, claude, codex, gemini, etc.

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "sk-..."
      OPENAI_BASE_URL: "https://api.openai.com/v1"
      ANTHROPIC_API_KEY: "sk-..."
      ANTHROPIC_BASE_URL: "https://api.anthropic.com"
    profiles:
      - name: deep
        model: "gpt-5.6-sol"
        effort: high
      - name: balanced
        model: "gpt-5.6-terra"
        effort: medium
      - name: quick
        model: "gpt-5.6-luna"
        effort: low
```

> [!TIP]
> When saving BYO settings, Tendril's daemon automatically synchronizes base URLs: the [OpenAI](https://openai.com) SDK expects `/v1` at the end of the URL, whereas the [Anthropic](https://www.anthropic.com) SDK expects the bare host without `/v1`.

### 3. Via the Bundled OpenCode Sidecar

For gateway providers (such as [OpenRouter](06_OpenRouter.md), [Evroc](02_Evroc.md), [Scaleway](04_Scaleway.md), or [Opper](05_Opper.md)):

1. Launch OpenCode via terminal or through Tendril's embedded terminal:
   ```bash
   opencode
   ```
2. Type `/connect` and select your provider, or run `opencode auth login`.
3. Set your active coding agent in Tendril to OpenCode under **Settings > Coding Agent** (`codingAgent: opencode`).
4. Tendril dispatches all plan execution tasks through the configured [OpenCode](../06_CodingAgents/04_OpenCode.md) runtime.

> [!NOTE]
> Tendril v2 enriches available model metadata automatically via [models.dev](https://models.dev). The cache is stored locally in [SQLite](https://www.sqlite.org) and refreshed in the background or on demand via `POST /api/models/refresh`.
