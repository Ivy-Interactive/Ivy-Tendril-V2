---
title: Cloudflare
description: Använd Cloudflare Workers AI som modellleverantör och anslut till
  Cloudflare MCP-servrar för att bygga och distribuera Workers.
icon: Globe
searchHints:
  - cloudflare
  - workers ai
  - cf
  - edge
  - cloudflared
  - tunnlar
---

# Cloudflare

[Cloudflare](https://www.cloudflare.com) tillhandahåller global edge-beräkning och serverlös AI-inferens via [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/). Utvecklare kan köra snabba, kostnadseffektiva öppna modeller (såsom [Metas Llama](https://llama.meta.com)) på edge-nätverket samtidigt som de kombineras med officiella Cloudflare [Model Context Protocol (MCP)](../09_Advanced/03_MCP.md)-färdigheter för fullstack-utveckling med [Cloudflare Workers](https://workers.cloudflare.com).

## Konfiguration via OpenCode

1. Starta [OpenCode](https://opencode.ai) via terminalen eller Tendrils inbäddade PTY:
   ```bash
   opencode
   ```
   Skriv `/connect` och välj **Cloudflare**.
2. Slutför auktoriseringen i webbläsaren när du uppmanas till det.
3. Välj en aktiv modell med `/models`.

## Cloudflare MCP-färdigheter (Valfritt)

Du kan lägga till Cloudflare MCP-servrar för att ge din [kodningsagent](../06_CodingAgents/_Index.md) direkt kontroll över Cloudflare Workers, KV, D1-databaser och distributioner (se [Färdigheter](../06_CodingAgents/00_Skills.md)):

```bash
npx skills add https://github.com/cloudflare/skills
```

När det är installerat kan kodningsagenter som kör Tendril-planer självständigt skapa bindningar, distribuera worker-skript och granska edge-loggar i realtid.

## Användning med Tendril

1. Öppna Tendril och navigera till **Inställningar > Kodningsagent**.
2. Ställ in din kodningsagent till **OpenCode** (se [OpenCode-agent](../06_CodingAgents/04_OpenCode.md)).
3. Tendril dirigerar planuppgifter till OpenCode, som anropar Cloudflare Workers AI.

Du kan även rikta in dig på Cloudflare Workers AI via dess [OpenAI](https://openai.com)-kompatibla slutpunkt i `~/.tendril/config.yaml` (se [Konfigurationsinställningar](../03_Configuration/01_Setup.md)):

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
> Utöver modellinferens med Workers AI integrerar Tendril v2 inbyggt Cloudflare Quick Tunnels (`cloudflared`) för säker, skrivskyddad plandelning med teammedlemmar. Tunneldelning konfigureras separat under **Inställningar > Säkerhet & Tunnlar**.

## Länkar

- [Modellleverantörer](_Index.md)
- [Kodningsagenter](../06_CodingAgents/_Index.md)
- [Dokumentation för Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
- [Guide för Cloudflare + OpenCode](https://developers.cloudflare.com/agent-setup/opencode/)
