---
title: Isbox
description: Lågprioriterade planer eller planer för "senare" i Isbox-läge så
  att Utkast förblir fokuserat.
icon: Snowflake
searchHints:
  - isbox
  - lägga på is
  - backlog
---

# Isbox

Isboxen är Tendrils dedikerade backlog och parkeringsplats för uppskjutna, lågprioriterade eller framtida utvecklingsplaner. Genom att lägga planer på is hålls den aktiva utkastkön i [Planer](03_Plans.md) fokuserad på nuvarande sprintprioriteringar utan att efterforskning, diskussioner eller utkast till specifikationer går förlorade (se [Planlivscykel](../02_Concepts/03_Lifecycle.md)).

## Lägga planer på is

En plan kan läggas på is när som helst medan den befinner sig i läget `Draft` eller `Blocked`:

- I appen [Planer](03_Plans.md), välj **Lägg på is (Isbox)** i åtgärdsmenyn.
- Tendril uppdaterar planens status till `Icebox`.
- Plankatalogen under `$TENDRIL_HOME/plans/<planId>/`, dess versionshanterade revisioner och kostnadsregister bevaras fullständigt på disken (se [CLI-planhantering](../09_Advanced/01_CLI/01_Plan.md)).

## Bläddring och filtrering

Isbox-appen erbjuder fokuserad sökning och filtrering i din backlog:

- **Sökfält** — Filtrera planer efter nyckelord i titeln eller numeriskt plan-`#ID`.
- **Projektfilter** — Avgränsa planer på is till ett specifikt projekt konfigurerat i [Projektkonfiguration](../03_Configuration/02_Projects.md).
- **Nivåfilter** — Filtrera planer efter komplexitetsnivå (t.ex. L1, L2, L3 konfigurerade i [Konfiguration och inställningar](../03_Configuration/01_Setup.md#in-app-settings)).

## Plankort och åtgärder

Varje plan på is visas i ett kort som visar dess `#ID`-tagg, titel, projektbricka, komplexitetsnivåbricka och verifieringsindikatorer:

| Åtgärd           | Kontroll            | Effekt                                                                                                                                                                                                                                  |
| ---------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Granska plan** | Klicka på korttitel | Öppnar planens arbetsyta i [Planer](03_Plans.md) för att granska hela specifikationen, metadata eller tidigare revisioner.                                                                                                              |
| **Tina upp**     | Flamikon-knapp      | Ändrar planens status från `Icebox` tillbaka till `Draft` optimistiskt. Planen lämnar Isboxen omedelbart och återgår till den aktiva kön i [Planer](03_Plans.md), redo för körning via [ExecutePlan](../02_Concepts/02_Promptwares.md). |
| **Ta bort**      | Papperskorgs-knapp  | Öppnar `DeletePlanDialog` för att permanent ta bort planmappen, revisioner och databasposter.                                                                                                                                           |
