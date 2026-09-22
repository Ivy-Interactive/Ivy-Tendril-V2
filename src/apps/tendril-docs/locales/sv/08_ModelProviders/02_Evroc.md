---
title: Evroc
description: Europeisk suverän molnleverantör med modeller för kodning med öppen
  källkod inklusive Kimi, Llama och Mistral.
icon: Server
searchHints:
  - evroc
  - eu
  - europeisk
  - suverän
  - kimi
  - mistral
  - llama
---

# Evroc

[Evroc](https://cloud.evroc.com) är en europeisk suverän molnleverantör som driver säkra, miljövänliga datacenter runt om i Europa. Genom sin AI-plattform "Think" tillhandahåller Evroc [OpenAI](https://openai.com)-kompatibel inferens för ledande modeller med öppen källkod som Kimi, Llama och Mistral med fullständig efterlevnad av [GDPR](https://gdpr.eu) och europeisk datasuveränitet.

## Konfiguration

1. Skapa ett konto på [cloud.evroc.com](https://cloud.evroc.com).
2. Generera en API-nyckel i Evroc-konsolen under **Think > Models > + New**.
3. Anslut i [OpenCode](https://opencode.ai) med hjälp av den medföljande sidovagnen eller terminalen:
   ```bash
   opencode
   ```
   Skriv `/connect`, välj **evroc** och ange din API-nyckel.
4. Välj din aktiva modell med `/models`.

## Rekommenderade modeller

Evroc tillhandahåller högpresterande öppna vikter optimerade för kodning och tekniskt resonemang:

| Modell                    | ID                                                                          | Skapare                            | Styrkor                                                               |
| :------------------------ | :-------------------------------------------------------------------------- | :--------------------------------- | :-------------------------------------------------------------------- |
| **Kimi K3 / K2.5**        | `moonshotai/Kimi-K3`, `moonshotai/Kimi-K2.5`                                | [Moonshot AI](https://moonshot.cn) | Exceptionell kodning med lång kontext och resonemang över flera filer |
| **Mistral Large / Small** | `mistralai/Mistral-Large-2411`, `mistralai/Mistral-Small-24B-Instruct-2501` | [Mistral AI](https://mistral.ai)   | Snabb, precis kodgenerering och verifiering                           |
| **Llama 3.3 70B**         | `meta-llama/Llama-3.3-70B-Instruct`                                         | [Meta AI](https://llama.meta.com)  | Bred kodningskunskap, dokumentation och refaktorisering               |

> [!TIP]
> Leta efter modeller med taggen **Code** i Evroc-konsolen för bästa resultat vid programmeringsuppgifter.

## Användning med Tendril

Du kan dirigera planexekvering i Tendril v2 genom Evroc på två sätt:

### Alternativ A: Via medföljande OpenCode

1. I Tendril-skrivbordsappen, gå till **Settings > Coding Agent**.
2. Välj **OpenCode** som din kodningsagent (se [OpenCode-agent](../06_CodingAgents/04_OpenCode.md)).
3. Tendril anropar den medföljande [OpenCode](https://opencode.ai)-sidovagnen (`binaries/opencode`), som dirigerar förfrågningar via din autentiserade Evroc-leverantör.

### Alternativ B: Anpassad OpenAI-ändpunkt i `config.yaml`

Eftersom Evroc erbjuder ett OpenAI-kompatibelt gränssnitt kan du konfigurera det direkt under `codingAgents` i `~/.tendril/config.yaml` (se [Konfigurationsinställningar](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-evroc-api-key"
      OPENAI_BASE_URL: "https://api.evroc.com/v1"
    profiles:
      - name: deep
        model: "moonshotai/Kimi-K3"
        effort: high
      - name: balanced
        model: "moonshotai/Kimi-K2.5"
        effort: medium
      - name: quick
        model: "mistralai/Mistral-Small-24B-Instruct-2501"
        effort: low
```

## Länkar

- [Modellleverantörer](_Index.md)
- [Kodningsagenter](../06_CodingAgents/_Index.md)
- [Evroc Cloud Console](https://cloud.evroc.com)
- [Dokumentation för Evroc + OpenCode](https://docs.evroc.com/integrations/opencode.html)
