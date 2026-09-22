---
title: Cloudflare
description: Use Cloudflare Workers AI as a model provider and connect to Cloudflare MCP servers for building and deploying Workers.
icon: Globe
searchHints:
  - cloudflare
  - workers ai
  - cf
  - edge
  - cloudflared
  - tunnels
---

# Cloudflare

[Cloudflare](https://www.cloudflare.com) provides global edge compute and serverless AI inference through [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/). Developers can run fast, cost-effective open-weight models (such as [Meta's Llama](https://llama.meta.com)) at the edge while pairing them with official Cloudflare [Model Context Protocol (MCP)](../09_Advanced/03_MCP.md) skills for full-stack [Cloudflare Workers](https://workers.cloudflare.com) development.

## Setup via OpenCode

1. Launch [OpenCode](https://opencode.ai) via the terminal or Tendril's embedded PTY:
   ```bash
   opencode
   ```
   Type `/connect` and select **Cloudflare**.
2. Complete browser authorization when prompted.
3. Select an active model with `/models`.

## Cloudflare MCP Skills (Optional)

You can add Cloudflare MCP servers to equip your [coding agent](../06_CodingAgents/_Index.md) with direct control over Cloudflare Workers, KV, D1 databases, and deployments (see [Skills](../06_CodingAgents/00_Skills.md)):

```bash
npx skills add https://github.com/cloudflare/skills
```

Once installed, coding agents executing Tendril plans can create bindings, deploy worker scripts, and inspect real-time edge logs autonomously.

## Using with Tendril

1. Open Tendril and navigate to **Settings > Coding Agent**.
2. Set your coding agent to **OpenCode** (see [OpenCode Agent](../06_CodingAgents/04_OpenCode.md)).
3. Tendril routes plan tasks to OpenCode, which calls Cloudflare Workers AI.

You can also target Cloudflare Workers AI via its [OpenAI](https://openai.com)-compatible endpoint in `~/.tendril/config.yaml` (see [Configuration Setup](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-cloudflare-api-token"
      OPENAI_BASE_URL: "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1"
    profiles:
      - name: deep
        model: "@cf/meta/llama-3.3-70b-instruct"
        effort: high
      - name: balanced
        model: "@cf/meta/llama-3.1-8b-instruct"
        effort: medium
      - name: quick
        model: "@cf/meta/llama-3.1-8b-instruct"
        effort: low
```

> [!NOTE]
> In addition to Workers AI model inference, Tendril v2 natively integrates Cloudflare Quick Tunnels (`cloudflared`) for secure, read-only plan sharing with teammates. Tunnel sharing is configured separately under **Settings > Security & Tunneling**.

## Links

- [Model Providers](_Index.md)
- [Coding Agents](../06_CodingAgents/_Index.md)
- [Cloudflare Workers AI Documentation](https://developers.cloudflare.com/workers-ai/)
- [Cloudflare + OpenCode Guide](https://developers.cloudflare.com/agent-setup/opencode/)
