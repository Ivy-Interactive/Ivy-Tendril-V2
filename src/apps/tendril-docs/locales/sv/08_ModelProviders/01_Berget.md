---
title: Berget AI
description: Europeisk AI-infrastrukturleverantör som erbjuder Kimi- och
  GLM-modeller med fullständig datasuveränitet inom EU och inbyggt stöd för
  Tendril v2 BYO-kort.
icon: Server
searchHints:
  - berget
  - eu
  - europeisk
  - kimi
  - glm
  - moonshot
---

# Berget AI

[Berget AI](https://berget.ai) är en europeisk AI-infrastrukturleverantör som levererar suverän, högpresterande LLM-inferens med garanterad datalagring inom EU i Sverige. Berget erbjuder [OpenAI](https://openai.com)-kompatibla slutpunkter som tillhandahåller ledande modeller med öppna vikter, inklusive [Moonshot AI:s](https://moonshot.cn) Kimi K3 och [Zhipu AI:s](https://open.bigmodel.cn) GLM-familj, i full överensstämmelse med [GDPR](https://gdpr.eu).

I Tendril v2 stöds Berget AI både som ett inbyggt **Bring Your Own LLM**-kort i skrivbordsapplikationen och via den medföljande sidoapplikationen [OpenCode](https://opencode.ai).

## Konfigurera via Tendril Desktop

Det enklaste sättet att använda Berget AI är via det inbyggda BYO-kortet i skrivbordsinställningarna:

1. Skapa ett konto och generera en API-nyckel på [console.berget.ai](https://console.berget.ai).
2. Öppna Tendril och navigera till **Settings > Coding Agent**.
3. Klicka på kortet **Berget AI** under **Bring Your Own LLM**.
4. Klistra in din API-nyckel i fältet **API Key** och klicka på **Save**.

> [!NOTE]
> Det finns inget bas-URL-fält att konfigurera för Berget i gränssnittet. Tendril v2 låser automatiskt slutpunkten till `https://api.berget.ai/v1` och dirigerar förfrågningar via den medföljande sidoapplikationen [OpenCode](../06_CodingAgents/04_OpenCode.md).

## Manuell konfiguration i `config.yaml`

Du kan även konfigurera Berget AI direkt i `~/.tendril/config.yaml` (se [Konfigurationsguide](../03_Configuration/01_Setup.md)):

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

## Rekommenderade modeller

Profilmatcharen i Tendril v2 mappar Berget AI direkt till Kimi K3 över samtliga nivåer:

| Nivå         | Modell-ID            | Standardinsats | Syfte                                                                  |
| :----------- | :------------------- | :------------- | :--------------------------------------------------------------------- |
| **Deep**     | `moonshotai/Kimi-K3` | `max`          | Arkitekturplanering, komplex resonemangsförmåga, stora refaktoreringar |
| **Balanced** | `moonshotai/Kimi-K3` | `high`         | Standardmässig planexekvering och kodgenerering                        |
| **Quick**    | `moonshotai/Kimi-K3` | `low`          | Snabb verifiering, commit-sammanfattningar, statusrapporter            |

Berget tillhandahåller även modeller i GLM-familjen (såsom `GLM-4.7`). Du kan ange vilket tillgängligt Berget-modell-ID som helst i din profilkonfiguration eller välja det med `/models` i [OpenCode](../06_CodingAgents/04_OpenCode.md).

## Konfigurera via OpenCode CLI

Alternativt kan du konfigurera Berget via OpenCode:

1. Kör Bergets installationsverktyg:
   ```bash
   npx berget code init
   ```
2. Starta OpenCode:
   ```bash
   opencode
   ```
3. Ställ in din aktiva agent i Tendril till OpenCode under **Settings > Coding Agent** (`codingAgent: opencode`).

> [!TIP]
> Tendril v2 levereras med den binära filen för [OpenCode](https://opencode.ai) inbäddad (`binaries/opencode`). Du behöver inte installera Node.js eller OpenCode globalt på ditt system för att använda Berget med Tendril. Läs mer i [OpenCode Agent-guiden](../06_CodingAgents/04_OpenCode.md).

## Länkar

- [Modell-leverantörer](_Index.md)
- [Kodningsagenter](../06_CodingAgents/_Index.md)
- [Berget AI Hemsida](https://berget.ai)
- [Berget Console](https://console.berget.ai)
- [Berget + OpenCode Dokumentation](https://docs.berget.ai/integrations/opencode)
