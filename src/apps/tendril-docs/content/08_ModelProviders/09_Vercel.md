---
title: Vercel AI Gateway
description: Route requests through Vercel's AI Gateway for unified access to OpenAI, Anthropic, Google, and open-weight models with built-in observability.
icon: Zap
searchHints:
  - vercel
  - ai gateway
  - unified
  - observability
---

# Vercel AI Gateway

[Vercel AI Gateway](https://vercel.com/docs/ai-gateway) provides a unified proxy for routing inference requests across major model providers including [Anthropic](https://www.anthropic.com), [OpenAI](https://openai.com), [Google AI](https://ai.google.dev), and [xAI](https://x.ai). It features centralized API key management, edge caching, real-time telemetry, and rate-limit guardrails.

## Setup via OpenCode

1. Create an API key in the [Vercel Dashboard](https://vercel.com) under your team's **AI Gateway > API keys**.
2. Connect in [OpenCode](https://opencode.ai) using the terminal or Tendril's embedded PTY:
   ```bash
   opencode
   ```
   Type `/connect`, search for **Vercel AI Gateway**, and enter your API key.
3. Switch your active model using `/models`.

### Routing Rules (`opencode.json`)

You can define failover order and routing preferences directly in `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "vercel": {
      "models": {
        "anthropic/claude-sonnet-5": {
          "options": {
            "order": ["anthropic", "vertex"]
          }
        }
      }
    }
  }
}
```

## Using with Tendril

### Option A: Via Bundled OpenCode

1. In the Tendril desktop application, go to **Settings > Coding Agent**.
2. Select **OpenCode** as your active agent (see [OpenCode Agent](../06_CodingAgents/04_OpenCode.md)).
3. Tendril routes all plan execution through the bundled [OpenCode](https://opencode.ai) sidecar connected to Vercel AI Gateway.

### Option B: Direct Gateway in `config.yaml`

Vercel AI Gateway provides an [OpenAI](https://openai.com)-compatible API endpoint at `https://ai-gateway.vercel.sh/v1`. You can configure Tendril to route through it directly in `~/.tendril/config.yaml` (see [Configuration Setup](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-vercel-ai-key"
      OPENAI_BASE_URL: "https://ai-gateway.vercel.sh/v1"
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

## Monitoring & Telemetry

Usage metrics, token consumption, and latency breakdowns are automatically logged in the Vercel dashboard under **AI Gateway > Analytics**, complementing Tendril's local token ledger.

## Links

- [Model Providers](_Index.md)
- [Coding Agents](../06_CodingAgents/_Index.md)
- [Vercel AI Gateway Documentation](https://vercel.com/docs/ai-gateway)
- [Vercel + OpenCode Guide](https://vercel.com/docs/ai-gateway/coding-agents/opencode)
