---
title: Modellleverantörer
description: Konfigurera modellleverantörer och inferens-backend för Tendril
  v2-agenter med inbyggda BYO-kort eller den medföljande sidovagnen OpenCode.
icon: Server
groupExpanded: true
searchHints:
  - modellleverantörer
  - leverantörer
  - api
  - inferens
  - gateway
  - llm
  - opencode
  - ta med egen llm
  - byo
---

# Modellleverantörer

Tendril v2 stöder flexibel dirigering av modellleverantörer, vilket gör att du kan köra [kodningsagenter](../06_CodingAgents/_Index.md) mot europeisk suverän infrastruktur, enhetliga API-gateways, molnbaserade modellhubbar eller lokala on-premises-slutpunkter.

I Tendril v2 dirigeras exekvering av modellleverantörer genom två primära mekanismer:

1. **Inbyggd Bring Your Own LLM (BYO LLM)**: Inbyggda inställningskort och direkt [konfiguration](../03_Configuration/01_Setup.md) i `config.yaml` för [OpenAI](https://openai.com), [Anthropic](https://www.anthropic.com) och den europeiska suveräna leverantören [Berget AI](01_Berget.md).
2. **Medföljande OpenCode-sidovagn**: Tendril v2 levereras med den förinstallerade binärfilen för [OpenCode](https://opencode.ai) direkt ur lådan (`binaries/opencode`), vilket ger direkt tillgång till multi-leverantörsgateways och anpassade inferens-backend utan att kräva manuella CLI-installationer (se [OpenCode Agent](../06_CodingAgents/04_OpenCode.md)).

## Leverantörer som stöds

- [Berget AI](01_Berget.md) ([console.berget.ai](https://console.berget.ai)) — Europeisk AI-infrastrukturleverantör som erbjuder Kimi- och GLM-modeller med fullständig datasuveränitet inom EU och förstklassig integration via Tendril BYO-kort.
- [Evroc](02_Evroc.md) ([cloud.evroc.com](https://cloud.evroc.com)) — Europeisk suverän molnleverantör med modeller för öppen källkodskodning inklusive Kimi, Llama och Mistral.
- [Z.AI](03_Zai.md) ([z.ai](https://z.ai)) — Åtkomst med högt genomflöde till GLM-modeller med dedikerade kodningsabonnemang.
- [Scaleway](04_Scaleway.md) ([scaleway.com](https://www.scaleway.com)) — Europeisk molnleverantör som erbjuder OpenAI-kompatibla generativa API:er för kodning och resonemang.
- [Opper.ai](05_Opper.md) ([opper.ai](https://opper.ai)) — AI-gateway som erbjuder enhetlig åtkomst till fler än 300 modeller med alternativ för datalagring inom EU.
- [OpenRouter](06_OpenRouter.md) ([openrouter.ai](https://openrouter.ai)) — Enhetlig API-gateway som ger tillgång till modeller från Anthropic, OpenAI, Google, Meta och DeepSeek.
- [Cloudflare](07_Cloudflare.md) ([cloudflare.com](https://developers.cloudflare.com/workers-ai/)) — Serverlös inferens via Cloudflare Workers AI tillsammans med integration för Workers MCP-verktyg.
- [NVIDIA](08_NVIDIA.md) ([build.nvidia.com](https://build.nvidia.com)) — [NVIDIA NIM](https://build.nvidia.com)-mikrotjänster i företagsklass och öppna modeller som driftas på NVIDIA Build.
- [Vercel AI Gateway](09_Vercel.md) ([vercel.com](https://vercel.com/docs/ai-gateway)) — Enhetlig dirigering över flera leverantörer med inbyggd telemetri, kostnadsbegränsningar och förfrågningscachning.

## Så fungerar konfigurationen

### 1. I Tendril Desktop-appen

Gå till **Settings > Coding Agent**:

- **Förkonfigurerade agenter**: Välj bland medföljande agenter inklusive [Claude Code](../06_CodingAgents/01_ClaudeCode.md), [Copilot](../06_CodingAgents/03_Copilot.md), [Codex](../06_CodingAgents/02_Codex.md), [Gemini](../06_CodingAgents/05_Gemini.md), [Antigravity](https://antigravity.google), [OpenCode](../06_CodingAgents/04_OpenCode.md), [Cursor](https://cursor.com) samt [Apple-modeller på enheten](https://developer.apple.com).
- **Kort för Bring Your Own LLM**: Välj **OpenAI**, **Anthropic** eller **Berget AI**. Ange din API-nyckel, så konfigurerar Tendril automatiskt lämpliga bas-URL:er, delar upp dem i respektive SDK-miljövariabler och fyller i standardvärden för nivåindelade profiler.
- **Profilnivåer**: Konfigurera standardmodeller och nivåer för resonemangsansträngning över tre exekveringsnivåer:
  - **Deep**: Hög resonemangsansträngning för arkitekturplanering, komplexa refaktoriseringar och initiala utkast.
  - **Balanced**: Balanserad kapacitet och hastighet för vardaglig funktionsimplementering och granskningsåtgärder.
  - **Quick**: Snabba modeller med låg latens för generering av commit-meddelanden, testverifiering och statuskontroller.

### 2. I `config.yaml`

Alla leverantörs- och agentinställningar sparas i `~/.tendril/config.yaml` (se [Konfigurationsguide](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy # or opencode, claude, codex, gemini, etc.

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "sk-..."
      OPENAI_BASE_URL: "https://api.openai.com/v1"
      ANTHROPIC_API_KEY: "sk-..."
      ANTHROPIC_BASE_URL: "https://api.anthropic.com"
    profiles:
      - name: deep
        model: "gpt-5.6-sol"
        effort: high
      - name: balanced
        model: "gpt-5.6-terra"
        effort: medium
      - name: quick
        model: "gpt-5.6-luna"
        effort: low
```

> [!TIP]
> När du sparar BYO-inställningar synkroniserar Tendrils bakgrundstjänst automatiskt bas-URL:er: [OpenAI](https://openai.com)-SDK:n förväntar sig `/v1` i slutet av webbadressen, medan [Anthropic](https://www.anthropic.com)-SDK:n förväntar sig den rena värdadressen utan `/v1`.

### 3. Via den medföljande OpenCode-sidovagnen

För gateway-leverantörer (såsom [OpenRouter](06_OpenRouter.md), [Evroc](02_Evroc.md), [Scaleway](04_Scaleway.md) eller [Opper](05_Opper.md)):

1. Starta OpenCode via terminalen eller genom Tendrils inbäddade terminal:
   ```bash
   opencode
   ```
2. Skriv `/connect` och välj din leverantör, eller kör `opencode auth login`.
3. Ställ in din aktiva kodningsagent i Tendril till OpenCode under **Settings > Coding Agent** (`codingAgent: opencode`).
4. Tendril skickar alla planexekveringsuppgifter via den konfigurerade [OpenCode](../06_CodingAgents/04_OpenCode.md)-körtiden.

> [!NOTE]
> Tendril v2 berikar tillgänglig modellmetadata automatiskt via [models.dev](https://models.dev). Cachen lagras lokalt i [SQLite](https://www.sqlite.org) och uppdateras i bakgrunden eller vid behov via `POST /api/models/refresh`.
