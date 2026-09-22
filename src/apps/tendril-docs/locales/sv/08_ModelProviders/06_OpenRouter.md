---
title: OpenRouter
description: Enhetlig API-gateway som ger åtkomst till modeller från Anthropic,
  OpenAI, Google, xAI, Meta, DeepSeek och fler.
icon: Globe
searchHints:
  - openrouter
  - router
  - flera leverantörer
  - gateway
---

# OpenRouter

[OpenRouter](https://openrouter.ai) tillhandahåller en enhetlig, [OpenAI](https://openai.com)-kompatibel API-gateway som ger åtkomst till hundratals ledande modeller från [Anthropic](https://www.anthropic.com), [OpenAI](https://openai.com), [Google DeepMind](https://deepmind.google), [Meta AI](https://ai.meta.com), [Mistral AI](https://mistral.ai), [DeepSeek](https://www.deepseek.com) och [xAI](https://x.ai). OpenRouter erbjuder konkurrenskraftig prissättning per token, automatisk fallback mellan leverantörer och omfattande användningsstatistik.

## Konfiguration via OpenCode

1. Skapa en API-nyckel på [openrouter.ai/keys](https://openrouter.ai/keys) (nycklar börjar med `sk-or-`).
2. Starta [OpenCode](https://opencode.ai) via terminalen eller Tendrils inbäddade terminal:
   ```bash
   opencode
   ```
   Skriv `/connect`, välj **OpenRouter** och klistra in din API-nyckel.
3. Byt din aktiva modell med hjälp av `/models`.

### Projektkonfiguration (`opencode.json`)

Du kan definiera standardmodeller på projektnivå i `opencode.json`:

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

## Användning med Tendril

Du kan ansluta Tendril v2 direkt till OpenRouter med antingen skrivbordsgränssnittet eller `config.yaml`.

### Alternativ A: Skrivbordsinställningar (Bring Your Own LLM)

1. Navigera till **Settings > Coding Agent** i Tendril-appen.
2. Under **Bring Your Own LLM**, klicka på kortet för **OpenAI**.
3. Sätt **Base URL** till `https://openrouter.ai/api/v1`.
4. Ange din OpenRouter-nyckel (`sk-or-...`) i **API Key** och klicka på **Save**.

### Alternativ B: Manuell konfiguration i `config.yaml`

Konfigurera OpenRouter under `codingAgents` i `~/.tendril/config.yaml` (se [Konfigurationsguide](../03_Configuration/01_Setup.md)):

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
> OpenRouters modell-ID:n inkluderar leverantörsprefix (till exempel `anthropic/claude-opus-5` eller `deepseek/deepseek-r1`). Dessa prefix bör inkluderas ordagrant i dina profilfält för `model`.

## Länkar

- [Modell-leverantörer](_Index.md)
- [Kodningsagenter](../06_CodingAgents/_Index.md)
- [OpenRouter-plattformen](https://openrouter.ai)
- [Integrationsguide för OpenRouter + OpenCode](https://openrouter.ai/docs/cookbook/coding-agents/opencode-integration)
