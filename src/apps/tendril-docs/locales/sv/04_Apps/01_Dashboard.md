---
title: Översiktspanel
description: "Startvy: antal planer, utgifter och tokens samt senaste
  aktiviteten över alla projekt."
icon: ChartBar
searchHints:
  - översiktspanel
  - statistik
  - översikt
  - diagram
  - kostnad
---

# Översiktspanel

Översiktspanelen är Tendrils primära operativa översikt, som ger realtidssynlighet i utvecklingspipelinen, agentutgifter, leveranshastighet och aktiva jobb över alla projekt.

## Sidhuvud och pipelineöversikt

Överst på översiktspanelen visas aktuellt datum, en tidsbaserad hälsningsfras och **Processvisaren** (`TendrilProcessViewer`):

- **Utkast** — Totalt antal planer som för närvarande är i `Draft`-tillstånd och väntar på bearbetning eller körning.
- **Pågående jobb** — Realtidsräkning av aktiva agentjobb kategoriserade efter promptware-fas (**Creating**, **Updating**, **Executing**, **Retrying** och **Creating PR**).
- **Granskning** — Planer med avslutade körningar som väntar på utvecklares prioritering och godkännande.
- **Slutförda och misslyckade** — Sammanlagt antal avslutade jobb.

Att klicka på valfritt steg i Processvisaren navigerar direkt till den vyn ([Planer](03_Plans.md), [Jobb](04_Jobs.md) eller [Granskning](02_Review.md)). Åtgärden **+ New Plan** är också tillgänglig direkt från visaren.

## Nyckeltal (KPI:er)

Fyra primära KPI-kort sammanfattar hastighet och kostnadseffektivitet:

| Mått                     | Betydelse                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| **Features Shipped**     | Totalt antal slutförda planer och sammanslagna pull requests levererade över alla projekt.       |
| **Avg cost per Feature** | Genomsnittliga utgifter i dollar som krävs för att leverera en slutförd funktion.                |
| **Forecast This Month**  | Prognostiserade månatliga utgifter beräknade från de senaste 30 dagarnas förbrukningshastighet.  |
| **Avg Cost/Plan**        | Genomsnittlig kostnad över alla körda planer, med hänsyn till indata-, utdata- och cache-tokens. |

### Fördjupningspaneler

Att klicka på ett KPI-kort skjuter upp en detaljerad **fördjupningspanel** (`BladeContainer`):

- **Projekt- och agentuppdelning** — Se vilka projekt eller kodningsagenter som står för den största andelen tokenförbrukning och kostnader.
- **Planuppdelningstabell** — Detaljerad granskningstabell per plan som listar plantitel, körningstid, tokenantal (indata, utdata, cacheläsning, resonemang) och total kostnad.
- **Direktnavigering** — Klicka på valfri plan i fördjupningspanelen för att öppna dess fullständiga specifikation.

## 28-dagars daglig trend

Kortet **Daglig trend** visar daglig körningsaktivitet och tokenutgifter över ett 28-dagarsfönster:

- **Stapeldiagram** — Dagliga kostnads- och aktivitetstotaler.
- **7-dagars rullande medelvärde** — Eftersläpande medelvärdeskurva överlagrad på diagrammet för att jämna ut variationer från dag till dag och belysa leveranstrenden.

## Pull requests

Kortet **Pull requests** tillhandahåller:

- **Veckovis PR-kadens** — Stapeldiagram som visar sammanslagna pull requests över ett 6-veckors rullande fönster.
- **Senaste sammanslagningar** — Snabblista över nyligen sammanslagna [GitHub](https://github.com)-pull requests med projektbrickor och länkar för att öppna dem i [Pull requests](06_PullRequests.md).

## Aktiva jobb

Kortet **Aktiva jobb** visar upp till åtta agentjobb som körs för närvarande i realtid:

- **Realtidsstatus** — Visar statusbricka (`Running`, `Pending` eller `Blocked`).
- **Målplan och Promptware** — Identifierar plantiteln eller specifik [Promptware](../02_Concepts/02_Promptwares.md)-typ (`CreatePlan`, `ExecutePlan`, `UpdatePlan`, etc.).
- **Direktinspektion** — Genom att klicka på ett jobb öppnas dess terminal för realtidsutdata i [Jobb](04_Jobs.md)-appen.

## Kostnads- och tokenredovisning

Varje promptware-körning lägger till en append-only-rad i planens beständiga `costs.csv`-fil som finns på `$TENDRIL_HOME/plans/<planId>/costs.csv`.

Tendril avstämmer dessa CSV-poster mot sin [SQLite](https://www.sqlite.org)-databas för att beräkna kostnader med hjälp av aktuella prisspecifikationer från [models.dev](https://models.dev) (t.ex. prompt-tokens, completion-tokens, prompt-cache-läsningar/-skrivningar och reasoning-tokens). Alla diagram återspeglar dessa avstämda siffror med projektfärger konfigurerade i [Projektinställningar](../03_Configuration/02_Projects.md).
