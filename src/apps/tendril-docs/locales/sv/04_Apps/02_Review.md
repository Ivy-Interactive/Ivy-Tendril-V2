---
title: Granskning
description: "Kö för färdigt arbete: Granska eller Misslyckade planer. Ingenting
  slås samman utan dig."
icon: ThumbsUp
searchHints:
  - granskning
  - godkänn
  - avvisa
  - diff
  - verifiera
---

# Granskning

Granskningsappen är Tendrils kvalitetsgrind. När en agent slutför exekveringen av en plan via `ExecutePlan` (se [Promptwares](../02_Concepts/02_Promptwares.md)), bevaras det isolerade [Git](https://git-scm.com)-arbetsträdet (worktree) och presenteras här för utvecklarens inspektion, verifiering och prioritering. Ingenting slås samman eller hamnar i din standardgren utan uttryckligt godkännande från operatören.

## Granskningskön

Sidofältet listar alla planer som kräver utvecklarens uppmärksamhet (planer med status `Review` eller `Failed`):

- **Brickor** — Varje rad visar planens `#ID`, projektbricka samt status för [Verifiering](../03_Configuration/01_Setup.md#verifications):
  - `Verified` (grön) — Alla nödvändiga verifieringsgrindar passerades.
  - `Unverified` (varning) — En eller flera verifieringsgrindar misslyckades, eller så har grindarna ännu inte körts.
  - Tillståndsindikator (t.ex. `Failed`) för att enkelt upptäcka exekveringar som kräver felsökning.
- **Kortkommandon** — Använd `ArrowLeft` och `ArrowRight` för att snabbt stega igenom planerna i granskningskön.

## Granskningsarbetsyta

Huvudarbetsytan presenterar planens implementerings- och inspektionsverktyg:

- **Planöversikt och kommentarer** — Läs planspecifikationen och lämna inline-kommentarer (`DraftComment`) för att ge specifik feedback rad för rad.
- **Fält för granskningsåtgärder** — Projektkonfigurerade granskningsåtgärder (definierade under `reviewActions` i [Projektinställningar](../03_Configuration/02_Projects.md)) visas som klickbara knappar i verktygsfältet (t.ex. `Run E2E`, `Smoke Test`).
- **Öppna fullständig specifikation & diff** — Tillgänglig från arbetsytans meny; detta öppnar planens fullständiga detaljsida i [Planer](03_Plans.md) för att inspektera diffar över flera revisioner, commit-nåbarhet i git worktree och genererade artefakter.
- **Inbäddad planchatt** — Använd den integrerade `PlanChatPanel` för att ställa frågor till agenten, inspektera exekveringslogik eller förtydliga implementeringsdetaljer innan godkännande.

## Åtgärder för prioritering och hantering

| Åtgärd                      | Kontroll                 | Effekt                                                                                                                                                                                                 |
| --------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Create Pull Request**     | Primär CTA               | Skapar en [GitHub](https://github.com)-pull request via [GitHub CLI](https://cli.github.com) (`gh`), länkar den till planen i [Pull Requests](06_PullRequests.md) och markerar planen som `Completed`. |
| **Push to PR**              | Primär CTA (om PR finns) | Skickar nya worktree-commits till en befintlig pull request-gren.                                                                                                                                      |
| **Request Changes**         | Ikonknapp (med bricka)   | Öppnar `SuggestChangesDialog` för att skicka utkastkommentarer och feedback, vilket startar ett `UpdatePlan`-[Jobb](04_Jobs.md) i det befintliga arbetsträdet.                                         |
| **Accept Partial Delivery** | Sekundär knapp           | Öppnar `PartialDeliveryDialog` för att godkänna fungerande delar av en leverans samtidigt som återstående objekt förbereds (stage).                                                                    |
| **Reset to Draft**          | Spillmeny                | Öppnar `ResetToDraftDialog` för att flytta planen tillbaka till `Draft` i [Planer](03_Plans.md) för omdefiniering av omfattning.                                                                       |
| **Delete Plan**             | Spillmeny (destruktiv)   | Öppnar `DeletePlanDialog` för att permanent ta bort planen och kasta dess isolerade arbetsträd.                                                                                                        |
