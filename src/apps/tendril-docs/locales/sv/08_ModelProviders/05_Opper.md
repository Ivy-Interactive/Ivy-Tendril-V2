---
title: Opper.ai
description: AI-gateway som ger åtkomst till 300+ modeller från Anthropic,
  OpenAI, Google och öppen källkods-leverantörer med alternativ för datalagring
  inom EU.
icon: Server
searchHints:
  - opper
  - gateway
  - eu
  - flerval-leverantör
  - router
---

# Opper.ai

[Opper.ai](https://opper.ai) är en företags-AI-gateway med huvudkontor i Europa som tillhandahåller enhetlig åtkomst till över 300 grundmodeller från [Anthropic](https://www.anthropic.com), [OpenAI](https://openai.com), [Google AI](https://ai.google.dev), [Mistral AI](https://mistral.ai) och ekosystem med öppen källkod. Opper erbjuder automatisk fallback-routning, latensoptimering och strikta kontroller för datalagring inom EU.

## Konfiguration via Opper CLI

1. Installera Opper CLI (kräver [Node.js](https://nodejs.org)):
   ```bash
   npm i -g @opperai/cli
   ```
2. Logga in med webbläsar-OAuth:
   ```bash
   opper login
   ```
3. Starta [OpenCode](https://opencode.ai) genom Opper:
   ```bash
   opper launch opencode
   ```

Autentisering hanteras av Opper CLI-sessionen; individuella API-nycklar för leverantörer krävs inte.

## Byta modeller

Du kan specificera en modell vid start med flaggan `--model`:

```bash
opper launch opencode --model anthropic/claude-sonnet-5
```

Eller byta modeller interaktivt under en aktiv OpenCode-session med `/models`.

## Användning med Tendril

### Alternativ A: Via medföljande OpenCode

1. I Tendril-skrivbordsapplikationen navigerar du till **Settings > Coding Agent**.
2. Ställ in **OpenCode** som din aktiva kodningsagent (se [OpenCode Agent](../06_CodingAgents/04_OpenCode.md)).
3. Tendril skickar exekvering genom OpenCode, routat via Opper.

### Alternativ B: Direkt gateway i `config.yaml`

Opper exponerar även en OpenAI-kompatibel gateway på `https://api.opper.ai/v1`. Du kan konfigurera Tendril att ansluta direkt genom att ange din Opper API-nyckel i `~/.tendril/config.yaml` (se [Configuration Setup](../03_Configuration/01_Setup.md)):

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
> Opper cachar automatiskt prompt-prefix och dirigerar förfrågningar till europeiska dataregioner när EU-datalagringspolicyer är aktiverade i din Opper-instrumentpanel.

## Länkar

- [Model Providers](_Index.md)
- [Coding Agents](../06_CodingAgents/_Index.md)
- [Opper Platform](https://opper.ai)
- [Opper Agent CLI Documentation](https://opper.ai/agent-cli)
