---
title: Z.AI
description: Z.AI erbjuder åtkomst med hög genomströmning till
  GLM-frontiermodeller med dedikerade kodningsplansalternativ.
icon: Server
searchHints:
  - z.ai
  - zai
  - glm
  - zhipu
  - bigmodel
---

# Z.AI

[Z.AI](https://z.ai) (utvecklat av [Zhipu AI](https://open.bigmodel.cn)) tillhandahåller företagsåtkomst till GLM-modellfamiljen, inklusive specialiserade kodningsplaner optimerade för autonoma programmeringsagenter, [planer](../02_Concepts/01_Plans.md) och automatiserade arbetsflöden för mjukvaruutveckling.

## Installation

1. Hämta en API-nyckel från [Z.AI API Console](https://z.ai/manage-apikey/apikey-list).
2. Autentisera i [OpenCode](https://opencode.ai) via terminalen eller Tendrils inbäddade PTY:
   ```bash
   opencode auth login
   ```
   Välj **Z.AI** (eller **Z.AI Coding Plan** om du prenumererar på en dedikerad kodningsplan), och klistra sedan in din API-nyckel när du uppmanas.
3. Starta OpenCode och bläddra bland tillgängliga modeller:
   ```bash
   opencode
   ```
   Skriv `/models` för att byta din aktiva modell.

## Rekommenderade modeller

| Modell                | ID                         | Profilnivå | Bäst för                                                          |
| :-------------------- | :------------------------- | :--------- | :---------------------------------------------------------------- |
| **GLM 4.7**           | `glm-4.7`                  | Deep       | Komplex kodgenerering, arkitekturplanering, felsökning            |
| **GLM 4 Plus**        | `glm-4-plus`               | Balanced   | Funktionsutökningar, refaktorering, kodgranskning                 |
| **GLM 4 Air / Flash** | `glm-4-air`, `glm-4-flash` | Quick      | Snabb linting, generering av enhetstester, commitsammanfattningar |

## Användning med Tendril

1. Öppna Tendril-skrivbordsapplikationen och navigera till **Settings > Coding Agent**.
2. Välj **OpenCode** som din aktiva kodningsagent (se [OpenCode Agent](../06_CodingAgents/04_OpenCode.md)).
3. Tendril anropar den medföljande [OpenCode](https://opencode.ai)-sidovagnen (`binaries/opencode`) och dirigerar agentjobb direkt genom Z.AI:s backend.

Du kan också specificera GLM-modeller per körningsnivå i `~/.tendril/config.yaml` (se [Konfigurationsinställning](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: opencode

codingAgents:
  - name: opencode
    profiles:
      - name: deep
        model: "glm-4.7"
        effort: high
      - name: balanced
        model: "glm-4-plus"
        effort: medium
      - name: quick
        model: "glm-4-air"
        effort: low
```

> [!NOTE]
> Z.AI:s Coding Plan ger högre hastighetsgränser och samtidiga förfrågningsplatser särskilt anpassade för kontinuerliga agentkörningar och komplexa [planbyggen](../02_Concepts/01_Plans.md).

## Länkar

- [Modellleverantörer](_Index.md)
- [Kodningsagenter](../06_CodingAgents/_Index.md)
- [Z.AI-plattform](https://z.ai)
- [Z.AI-konsol](https://z.ai/manage-apikey/apikey-list)
- [Z.AI + OpenCode-dokumentation](https://docs.z.ai/scenario-example/develop-tools/opencode)
