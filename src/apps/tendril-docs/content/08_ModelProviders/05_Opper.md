---
title: Opper.ai
description: AI gateway providing access to 300+ models from Anthropic, OpenAI, Google, and open-weight providers with EU data residency options.
icon: Server
searchHints:
  - opper
  - gateway
  - eu
  - multi-provider
  - router
---

# Opper.ai

[Opper.ai](https://opper.ai) is an enterprise AI gateway headquartered in Europe that provides unified access to over 300 foundation models from [Anthropic](https://www.anthropic.com), [OpenAI](https://openai.com), [Google AI](https://ai.google.dev), [Mistral AI](https://mistral.ai), and open-source ecosystems. Opper features automatic fallback routing, latency optimization, and strict EU data residency controls.

## Setup via Opper CLI

1. Install the Opper CLI (requires [Node.js](https://nodejs.org)):
   ```bash
   npm i -g @opperai/cli
   ```
2. Sign in using browser OAuth:
   ```bash
   opper login
   ```
3. Launch [OpenCode](https://opencode.ai) through Opper:
   ```bash
   opper launch opencode
   ```

Authentication is managed by the Opper CLI session; individual provider API keys are not required.

## Switching Models

You can specify a model at launch time using the `--model` flag:

```bash
opper launch opencode --model anthropic/claude-sonnet-5
```

Or switch models interactively during an active OpenCode session using `/models`.

## Using with Tendril

### Option A: Via Bundled OpenCode

1. In the Tendril desktop application, navigate to **Settings > Coding Agent**.
2. Set **OpenCode** as your active coding agent (see [OpenCode Agent](../06_CodingAgents/04_OpenCode.md)).
3. Tendril dispatches execution through OpenCode, routed via Opper.

### Option B: Direct Gateway in `config.yaml`

Opper also exposes an OpenAI-compatible gateway at `https://api.opper.ai/v1`. You can configure Tendril to connect directly by supplying your Opper API key in `~/.tendril/config.yaml` (see [Configuration Setup](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "opp_..."
      OPENAI_BASE_URL: "https://api.opper.ai/v1"
    profiles:
      - name: deep
        model: "anthropic/claude-opus-5"
        effort: max
      - name: balanced
        model: "anthropic/claude-sonnet-5"
        effort: high
      - name: quick
        model: "google/gemini-3.8-flash"
        effort: medium
```

> [!TIP]
> Opper automatically caches prompt prefixes and routes queries to European data regions when EU residency policies are enabled in your Opper dashboard.

## Links

- [Model Providers](_Index.md)
- [Coding Agents](../06_CodingAgents/_Index.md)
- [Opper Platform](https://opper.ai)
- [Opper Agent CLI Documentation](https://opper.ai/agent-cli)
