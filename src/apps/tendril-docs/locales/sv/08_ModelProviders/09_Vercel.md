---
title: Vercel AI Gateway
description: Dirigera förfrågningar via Vercels AI Gateway för enhetlig åtkomst
  till OpenAI-, Anthropic-, Google- och modeller med öppna vikter med inbyggd
  observerbarhet.
icon: Zap
searchHints:
  - vercel
  - ai gateway
  - enhetlig
  - observerbarhet
---

# Vercel AI Gateway

[Vercel AI Gateway](https://vercel.com/docs/ai-gateway) tillhandahåller en enhetlig proxy för dirigering av inferensförfrågningar över ledande modellleverantörer inklusive [Anthropic](https://www.anthropic.com), [OpenAI](https://openai.com), [Google AI](https://ai.google.dev) och [xAI](https://x.ai). Den erbjuder centraliserad API-nyckelhantering, edge-caching, telemetri i realtid och skyddsräcken för hastighetsbegränsningar (rate limits).

## Konfiguration via OpenCode

1. Skapa en API-nyckel i [Vercel Dashboard](https://vercel.com) under ditt teams **AI Gateway > API keys**.
2. Anslut i [OpenCode](https://opencode.ai) via terminalen eller Tendrils inbäddade PTY:
   ```bash
   opencode
   ```
   Skriv `/connect`, sök efter **Vercel AI Gateway** och ange din API-nyckel.
3. Byt aktiv modell med `/models`.

### Dirigeringsregler (`opencode.json`)

Du kan definiera redundansordning (failover) och dirigeringspreferenser direkt i `opencode.json`:

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

## Användning med Tendril

### Alternativ A: Via medföljande OpenCode

1. I Tendril-skrivbordsapplikationen, gå till **Settings > Coding Agent**.
2. Välj **OpenCode** som din aktiva agent (se [OpenCode-agent](../06_CodingAgents/04_OpenCode.md)).
3. Tendril dirigerar all planexekvering genom den medföljande [OpenCode](https://opencode.ai)-sidecaren som är ansluten till Vercel AI Gateway.

### Alternativ B: Direkt gateway i `config.yaml`

Vercel AI Gateway tillhandahåller en [OpenAI](https://openai.com)-kompatibel API-ändpunkt på `https://ai-gateway.vercel.sh/v1`. Du kan konfigurera Tendril att dirigera direkt via den i `~/.tendril/config.yaml` (se [Konfigurationsinställningar](../03_Configuration/01_Setup.md)):

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

## Övervakning och telemetri

Användningsstatistik, tokenförbrukning och latensanalyser loggas automatiskt i Vercel-instrumentpanelen under **AI Gateway > Analytics**, vilket kompletterar Tendrils lokala token-huvudbok.

## Länkar

- [Modellleverantörer](_Index.md)
- [Kodningsagenter](../06_CodingAgents/_Index.md)
- [Dokumentation för Vercel AI Gateway](https://vercel.com/docs/ai-gateway)
- [Guide för Vercel + OpenCode](https://vercel.com/docs/ai-gateway/coding-agents/opencode)
