---
title: OpenCode
description: OpenCode is an alternative coding agent that supports multiple model providers through a unified CLI.
icon: Cpu
searchHints:
  - opencode
  - open code
  - coding agent
---

# OpenCode

## Configuration

Set OpenCode as your coding agent in `config.yaml`:

```yaml
codingAgent: opencode
```

Or select it in **Settings > Coding Agent**.

For more details on `config.yaml` structure and settings, see [Setup & Settings](../03_Configuration/01_Setup.md).

## Requirements

- **Bundled Sidecar**: Tendril ships [OpenCode](https://opencode.ai) as a bundled sidecar beside the desktop app and automatically prefers it over any version on PATH. No manual installation is required on fresh setups.
- **Standalone Installation** (optional): If you want to install or run a standalone copy:
  ```bash
  curl -fsSL https://opencode.ai/install | bash
  ```
- **Authentication**: Run `opencode providers login` (or `opencode auth login`) to authenticate with your selected provider (e.g. [Anthropic](https://www.anthropic.com), [OpenAI](https://openai.com), [Google AI](https://ai.google.dev), [Groq](https://groq.com)).

## Profiles

Tendril maps effort levels to OpenCode models:

| Profile    | Model   | Effort | Use Case                     |
| ---------- | ------- | ------ | ---------------------------- |
| `deep`     | default | high   | Complex multi-file changes   |
| `balanced` | default | medium | Standard plan execution      |
| `quick`    | default | low    | Simple fixes and small edits |

Effort levels map directly to OpenCode's `--variant` flag (`low`, `medium`, `high`, `max`).

The default catalog model is `moonshotai/Kimi-K3`. OpenCode also supports pinned Anthropic and OpenAI models such as `claude-opus-5-5`, `claude-fable-5-1`, `claude-opus-5`, `claude-opus-4-7`, `claude-sonnet-5`, `claude-sonnet-4-6`, and `gpt-5.5`.

## Bring-Your-Own LLM & Providers

OpenCode powers Tendril's **Bring-Your-Own LLM** cards in **Settings > Coding Agent**:

- **[OpenAI](https://openai.com)**: Points OpenCode to `https://api.openai.com` with your `OPENAI_API_KEY`.
- **[Anthropic](https://www.anthropic.com)**: Points OpenCode to `https://api.anthropic.com/v1` with your `ANTHROPIC_API_KEY`.
- **[Berget AI](../08_ModelProviders/01_Berget.md)**: Points OpenCode to `https://api.berget.ai/v1` with your [Berget AI](https://berget.ai) API key.
- **Custom Endpoints**: Configure custom base URLs and keys for any OpenAI-compatible or Anthropic-compatible reverse proxy. For more providers, see [Model Providers](../08_ModelProviders/_Index.md).

Tendril configures these providers non-destructively using `OPENCODE_CONFIG_CONTENT` so your global `opencode.json` configuration is never overwritten.

## Local [Ollama](https://ollama.com) Setup

When running OpenCode with local [Ollama](https://ollama.com) models, specify the server URL directly in `config.yaml`:

```yaml
codingAgents:
  - name: opencode
    environmentVariables:
      OLLAMA_HOST: "http://localhost:11434"
      OLLAMA_BASE_URL: "http://localhost:11434"
```
