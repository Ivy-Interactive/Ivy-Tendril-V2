---
title: Scaleway
description: Europeisk molnleverantör som erbjuder OpenAI-kompatibla Generative
  API:er för kodning, resonerande och modeller med öppna vikter.
icon: Server
searchHints:
  - scaleway
  - eu
  - europeisk
  - generativa api:er
  - suverän
  - qwen
---

# Scaleway

[Scaleway](https://www.scaleway.com) är en stor europeisk molntjänstleverantör som erbjuder suverän AI-infrastruktur i energieffektiva datacenter i Frankrike, Nederländerna och Polen. Genom sin plattform Generative APIs tillhandahåller Scaleway hanterade och helt [OpenAI](https://openai.com)-kompatibla slutpunkter för ledande öppna modeller.

## Konfiguration

1. Skapa ett konto på [scaleway.com](https://www.scaleway.com).
2. Generera en IAM API-nyckel (Secret Key) i Scaleway-konsolen under **Identity and Access Management (IAM)**.
3. Anslut i [OpenCode](https://opencode.ai) via den medföljande sido-processen eller terminalen:
   ```bash
   opencode
   ```
   Skriv `/connect`, välj **Scaleway** och klistra in din IAM Secret Key.
4. Välj en modell med `/models`.

## Rekommenderade modeller

Scaleway tillhandahåller flera modeller som är optimerade för kodkomplettering och programvaruutveckling:

| Modell                     | Modell-ID                         | Skapare                              | Rekommenderad nivå |
| :------------------------- | :-------------------------------- | :----------------------------------- | :----------------- |
| **Qwen 2.5 Coder 32B**     | `qwen2.5-coder-32b-instruct`      | [Qwen](https://github.com/QwenLM)    | Deep               |
| **Llama 3.3 70B Instruct** | `llama-3.3-70b-instruct`          | [Meta AI](https://llama.meta.com)    | Balanced           |
| **Mistral Small 24B**      | `mistral-small-24b-instruct-2501` | [Mistral AI](https://mistral.ai)     | Quick              |
| **DeepSeek R1 Distill**    | `deepseek-r1-distill-llama-70b`   | [DeepSeek](https://www.deepseek.com) | Deep (Resonemang)  |

## Användning med Tendril

### Alternativ A: Via medföljande OpenCode

1. I Tendril-skrivbordsappen, gå till **Settings > Coding Agent**.
2. Välj **OpenCode** som din aktiva agent (se [OpenCode-agent](../06_CodingAgents/04_OpenCode.md)).
3. OpenCode använder dina konfigurerade Scaleway-inloggningsuppgifter för alla planexekveringsuppgifter.

### Alternativ B: Anpassad OpenAI-slutpunkt i `config.yaml`

Eftersom Scaleways Generative APIs följer OpenAI-specifikationen på `https://api.scaleway.ai/v1`, kan du konfigurera det direkt i `~/.tendril/config.yaml` (se [Konfigurationsinställningar](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-scaleway-secret-key"
      OPENAI_BASE_URL: "https://api.scaleway.ai/v1"
    profiles:
      - name: deep
        model: "qwen2.5-coder-32b-instruct"
        effort: high
      - name: balanced
        model: "llama-3.3-70b-instruct"
        effort: medium
      - name: quick
        model: "mistral-small-24b-instruct-2501"
        effort: low
```

> [!NOTE]
> Scaleway tillämpar standard HTTP Bearer token-autentisering. Din IAM Secret Key fungerar direkt som `OPENAI_API_KEY`.

## Länkar

- [Modellleverantörer](_Index.md)
- [Kodningsagenter](../06_CodingAgents/_Index.md)
- [Scaleway-plattformen](https://www.scaleway.com)
- [Scaleway-konsolen](https://console.scaleway.com)
- [Dokumentation för Scaleway Generative APIs](https://www.scaleway.com/en/docs/generative-apis/reference-content/integrate-with-opencode/)
