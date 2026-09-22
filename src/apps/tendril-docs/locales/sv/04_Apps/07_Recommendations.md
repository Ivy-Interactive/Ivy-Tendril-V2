---
title: Rekommendationer
description: Föreslagna uppföljningar (omstruktureringar, kodhygien, tester) som
  härletts från dina kodbaser – inget manuellt ärende krävs.
icon: Lightbulb
searchHints:
  - rekommendationer
  - förslag
  - auto
---

# Rekommendationer

Appen Rekommendationer är Tendrils prioriteringscenter för AI-föreslagna förbättringar i kodbasen, tillägg av testtäckning, arkitektoniska upprensningar och teknisk skuld som upptäckts under planexekveringar.

## Ursprung och behörighet

När [Kodningsagenter](../06_CodingAgents/_Index.md) analyserar, exekverar och verifierar planer lyfter de fram relaterade förbättringar (t.ex. otestade gränsfall, föråldrade beroenden, möjligheter till refaktorisering eller flaskhalsar i prestanda).

För att hålla rekommendationerna åtgärdsbara och undvika för tidigt arbete:

- Endast rekommendationer som härrör från **Färdiga** (Completed) planer visas i appen Rekommendationer (se [Planens livscykel](../02_Concepts/03_Lifecycle.md)).
- Rekommendationer som härrör från misslyckade eller pågående planer förblir kopplade till sin källplan tills den planen lyckas.

## Rekommendationskön

Sidofältet visar alla väntande rekommendationer:

- **Tagg för källplan** — Visar ursprungsplanens nummer (t.ex. `#14`).
- **Titel** — Kortfattad beskrivning av den föreslagna förbättringen.
- **Projektbricka** — Identifierar vilket projektarkiv rekommendationen riktar sig till (konfigureras i [Projektkonfiguration](../03_Configuration/02_Projects.md)).
- **Konsekvensbricka** — Färgkodad bedömning av angelägenhetsgrad och värde:
  - `High` (grön) — Kritiska korrigeringar, betydande refaktoriseringar eller väsentliga luckor i testningen.
  - `Medium` (gul) — Upprensningar, underhållsförbättringar eller icke-blockerande förbättringar.
  - `Low` (neutral) — Mindre putsningar eller kosmetiska förbättringar.

## Detaljvy och prioriteringsåtgärder

När en rekommendation väljs visas dess fullständiga tekniska motivering, konsekvensbedömning och en länk för att öppna den ursprungliga **källplanen** i [Planer](03_Plans.md).

Utvecklare kan prioritera rekommendationer med hjälp av fyra huvudåtgärder:

| Åtgärd                         | Kontroll          | Effekt                                                                                                                                                                                                                                   |
| ------------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Acceptera**                  | CircleCheck-knapp | Markerar rekommendationen som `Accepted` och startar omedelbart ett `CreatePlan`-bakgrunds-[Jobb](04_Jobs.md) (se [Promptwares](../02_Concepts/02_Promptwares.md)) för att skapa ett nytt implementeringsutkast i [Planer](03_Plans.md). |
| **Acceptera med anteckningar** | Check-knapp       | Öppnar `RecommendationNoteDialog` så att utvecklaren kan lägga till specifika begränsningar eller krav. Agenten tar emot både den ursprungliga rekommendationen och operatörens anteckningar.                                            |
| **Avvisa**                     | X-knapp           | Markerar rekommendationen som `Declined` med valfria avvisningsanteckningar och tar bort den från den väntande kön.                                                                                                                      |
| **Skapa GitHub-issue**         | GitHub-ikonknapp  | Öppnar `CreateIssueDialog` för att registrera rekommendationen direkt som ett [GitHub](https://github.com)-ärende via [GitHub CLI](https://cli.github.com) (`gh`) i projektarkivet. Lämnar rekommendationen som `Pending`.               |

När en åtgärd har slutförts går Tendril automatiskt vidare till nästa rekommendation i kön, vilket möjliggör en snabb genomgång av föreslagna förbättringar.
