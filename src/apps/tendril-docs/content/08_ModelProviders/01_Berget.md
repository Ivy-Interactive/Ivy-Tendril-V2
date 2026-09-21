---
title: Berget AI
description: European AI infrastructure provider offering Kimi and GLM models with full EU data residency and native Tendril v2 BYO card support.
icon: Server
searchHints:
  - berget
  - eu
  - european
  - kimi
  - glm
  - moonshot
---

# Berget AI

[Berget AI](https://berget.ai) is a European AI infrastructure provider delivering sovereign, high-performance LLM inference with guaranteed EU data residency in Sweden. Berget offers [OpenAI](https://openai.com)-compatible endpoints hosting frontier open-weight models including [Moonshot AI's](https://moonshot.cn) Kimi K3 and [Zhipu AI's](https://open.bigmodel.cn) GLM family, fully compliant with [GDPR](https://gdpr.eu).

In Tendril v2, Berget AI is supported both as a native **Bring Your Own LLM** card in the desktop application and via the bundled [OpenCode](https://opencode.ai) sidecar.

## Setup via Tendril Desktop

The simplest way to use Berget AI is through the native BYO card in the desktop settings:

1. Create an account and generate an API key at [console.berget.ai](https://console.berget.ai).
2. Open Tendril and navigate to **Settings > Coding Agent**.
3. Under **Bring Your Own LLM**, click the **Berget AI** card.
4. Paste your API key into the **API Key** field and click **Save**.

> [!NOTE]
> There is no base URL field to configure for Berget in the UI. Tendril v2 automatically pins the endpoint to `https://api.berget.ai/v1` and routes requests through the bundled [OpenCode](../06_CodingAgents/04_OpenCode.md) sidecar.

## Manual Configuration in `config.yaml`

You can also configure Berget AI directly in `~/.tendril/config.yaml` (see [Configuration Setup](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "sk-berget-..."
      OPENAI_BASE_URL: "https://api.berget.ai/v1"
      ANTHROPIC_API_KEY: "sk-berget-..."
      ANTHROPIC_BASE_URL: "https://api.berget.ai"
    profiles:
      - name: deep
        model: "moonshotai/Kimi-K3"
        effort: max
      - name: balanced
        model: "moonshotai/Kimi-K3"
        effort: high
      - name: quick
        model: "moonshotai/Kimi-K3"
        effort: low
```

## Recommended Models

Tendril v2's profile resolver maps Berget AI directly to Kimi K3 across all tiers:

| Tier         | Model ID             | Default Effort | Purpose                                                    |
| :----------- | :------------------- | :------------- | :--------------------------------------------------------- |
| **Deep**     | `moonshotai/Kimi-K3` | `max`          | Architectural planning, complex reasoning, large refactors |
| **Balanced** | `moonshotai/Kimi-K3` | `high`         | Standard plan execution and code generation                |
| **Quick**    | `moonshotai/Kimi-K3` | `low`          | Rapid verification, commit summaries, status reports       |

Berget also provides GLM family models (such as `GLM-4.7`). You can set any available Berget model ID in your profile configuration or select it with `/models` in [OpenCode](../06_CodingAgents/04_OpenCode.md).

## Setup via OpenCode CLI

Alternatively, you can configure Berget through OpenCode:

1. Run the Berget setup utility:
   ```bash
   npx berget code init
   ```
2. Launch OpenCode:
   ```bash
   opencode
   ```
3. Set your active agent in Tendril to OpenCode under **Settings > Coding Agent** (`codingAgent: opencode`).

> [!TIP]
> Tendril v2 ships with the [OpenCode](https://opencode.ai) binary bundled (`binaries/opencode`). You do not need to install Node.js or OpenCode globally on your system to use Berget with Tendril. Learn more in the [OpenCode Agent Guide](../06_CodingAgents/04_OpenCode.md).

## Links

- [Model Providers](_Index.md)
- [Coding Agents](../06_CodingAgents/_Index.md)
- [Berget AI Homepage](https://berget.ai)
- [Berget Console](https://console.berget.ai)
- [Berget + OpenCode Documentation](https://docs.berget.ai/integrations/opencode)
