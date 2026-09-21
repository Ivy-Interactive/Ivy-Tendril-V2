---
title: OpenRouter
description: Unified API gateway providing access to models from Anthropic, OpenAI, Google, xAI, Meta, DeepSeek, and more.
icon: Globe
searchHints:
  - openrouter
  - router
  - multi-provider
  - gateway
---

# OpenRouter

[OpenRouter](https://openrouter.ai) provides a unified, [OpenAI](https://openai.com)-compatible API gateway delivering access to hundreds of frontier models from [Anthropic](https://www.anthropic.com), [OpenAI](https://openai.com), [Google DeepMind](https://deepmind.google), [Meta AI](https://ai.meta.com), [Mistral AI](https://mistral.ai), [DeepSeek](https://www.deepseek.com), and [xAI](https://x.ai). OpenRouter offers competitive per-token pricing, automatic provider fallbacks, and comprehensive usage metrics.

## Setup via OpenCode

1. Create an API key at [openrouter.ai/keys](https://openrouter.ai/keys) (keys begin with `sk-or-`).
2. Launch [OpenCode](https://opencode.ai) via the terminal or Tendril's embedded terminal:
   ```bash
   opencode
   ```
   Type `/connect`, select **OpenRouter**, and paste your API key.
3. Switch your active model using `/models`.

### Project Configuration (`opencode.json`)

You can define project-level default models in `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "openrouter": {
      "models": {
        "~anthropic/claude-sonnet-5": {},
        "~google/gemini-3.8-flash": {},
        "~deepseek/deepseek-r1": {}
      }
    }
  }
}
```

## Using with Tendril

You can connect Tendril v2 directly to OpenRouter using either the desktop UI or `config.yaml`.

### Option A: Desktop Settings (Bring Your Own LLM)

1. Navigate to **Settings > Coding Agent** in the Tendril app.
2. Under **Bring Your Own LLM**, click the **OpenAI** card.
3. Set the **Base URL** to `https://openrouter.ai/api/v1`.
4. Enter your OpenRouter key (`sk-or-...`) into **API Key** and click **Save**.

### Option B: Manual Configuration in `config.yaml`

Configure OpenRouter under `codingAgents` in `~/.tendril/config.yaml` (see [Configuration Setup](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "sk-or-..."
      OPENAI_BASE_URL: "https://openrouter.ai/api/v1"
    profiles:
      - name: deep
        model: "anthropic/claude-opus-5"
        effort: max
      - name: balanced
        model: "anthropic/claude-sonnet-5"
        effort: high
      - name: quick
        model: "google/gemini-3.8-flash"
        effort: low
```

> [!TIP]
> OpenRouter model IDs include vendor prefixes (for example, `anthropic/claude-opus-5` or `deepseek/deepseek-r1`). These prefixes should be included verbatim in your profile `model` fields.

## Links

- [Model Providers](_Index.md)
- [Coding Agents](../06_CodingAgents/_Index.md)
- [OpenRouter Platform](https://openrouter.ai)
- [OpenRouter + OpenCode Integration Guide](https://openrouter.ai/docs/cookbook/coding-agents/opencode-integration)
