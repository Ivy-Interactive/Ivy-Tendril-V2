---
title: Jobb
description: "Pågående och tidigare promptware-körningar: status, kostnad,
  varaktighet och live-utdata."
icon: Activity
searchHints:
  - jobb
  - körs
  - exekvering
  - agenter
  - status
---

# Jobb

Appen Jobb är Tendrils monitor för realtidsexekvering och historiska granskningslogg. Varje anrop av [Promptware](../02_Concepts/02_Promptwares.md) (`CreatePlan`, `ExecutePlan`, `UpdatePlan`, `CreatePr`, `SplitPlan` osv.) körs som ett asynkront jobb som spåras här.

## Översikt & statusförlopp

Högst upp i vyn för Jobb visar en **staplad förloppsindikator** (`StackedProgress`) realtidsfördelningen av jobbtillstånd:

- **Körs** (blå) — Agentprocesser som körs aktivt.
- **Slutförda** (grön) — Framgångsrikt avslutade exekveringar.
- **Misslyckades** (röd) — Körningar som avslutades med fel eller misslyckade verifieringar.
- **Blockerade** (gul/bärnsten) — Jobb som väntar på beroenden, samtidighetstak eller bekräftelse från operatören.
- **Väntar** (dämpad) — Köade jobb som väntar på tillgängliga agentplatser.

Masskörningskontroller i sidhuvudet gör att operatörer kan **Stoppa alla köade** eller **Stoppa alla** jobb vid behov, eller rensa historiska rader i batch via rullgardinsmenyn **Rensa** (`Clear Completed`, `Clear Failed` eller `Clear All`).

## Jobbtabellen

Tabellen använder oändlig rullning med serversortering och filtrering som utvärderas på daemonsidan:

| Kolumn      | Beskrivning                                                | Interaktion                                                                                        |
| ----------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Id**      | Numerisk jobbidentifierare (t.ex. `00042`).                | Klicka på kolumnrubriken för att sortera efter nyast/äldst.                                        |
| **Plan Id** | Målplanens identifierare.                                  | Klicka för att navigera direkt till planen i [Planer](03_Plans.md).                                |
| **Status**  | Bricka för aktuell jobbstatus.                             | Färgkodad efter tillstånd.                                                                         |
| **Typ**     | Identifierare för promptware (t.ex. `ExecutePlan`).        | Sorterbar efter promptware.                                                                        |
| **Projekt** | Projektbricka.                                             | Formgiven med projektfärg från [Projektkonfiguration](../03_Configuration/02_Projects.md).         |
| **Utdata**  | Agentens exekveringstillstånd (`running`, `done`, `idle`). | **Klicka för att öppna panelen för live-utdata** (`JobSessionView`) med strömmande terminalutdata. |
| **Tokens**  | Totalt antal förbrukade tokens.                            | **Klicka för att öppna panelen för kostnad & tokens** (`JobCostSheet`).                            |
| **Kostnad** | Beräknad exekveringskostnad i USD.                         | **Klicka för att öppna panelen för kostnad & tokens**.                                             |
| **Timer**   | Förfluten tid i realtid eller registrerad körtid.          | Visar varaktighet i realtid.                                                                       |
| **Datum**   | Tidsstämpel när jobbet startades.                          | Kronologisk sortering.                                                                             |

## Paneler & slide-overs

Genom att klicka på celler eller radåtgärder öppnas fokuserade slide-over-paneler direkt ovanpå tabellen utan att du tappar bort var du är:

### Panelen för live-utdata (`JobSessionView`)

Genom att klicka på cellen **Utdata** öppnas vyn för strömmande live-agentdata. Du ser terminalutdata för `stdout`/`stderr` i realtid från agenten (byggloggar, testutdata, verktygsanrop och agentens resonemang), inte bara en generisk laddningsindikator.

### Panelen för kostnad & tokens (`JobCostSheet`)

Genom att klicka på cellen **Tokens** eller **Kostnad** visas en detaljerad redovisningsuppdelning:

- **Indatatokens** — Prompt- och kontexttokens som skickats till modellen.
- **Utdata-tokens** — Tokens som genererats av modellen.
- **Cachelästa tokens** — Tokens som hämtats från promptcachen (sparar kostnad och latens).
- **Cacheskrivna tokens** — Tokens som skrivits till leverantörens promptcache.
- **Resonemangstokens** — Tokens som spenderats på interna resonemangsmodeller (t.ex. OpenAI o1/o3 eller Anthropic extended thinking).
- **Kostnadsberäkning** — Valutakostnad avstämd mot prisspecifikationer från [models.dev](https://models.dev).

### Panelen för fullständig prompt

Genom att klicka på **Prompt**-texten öppnas hela den oavkortade prompten som skickades till agenten med fullständig syntaxmarkering.

## Menyn för radåtgärder

Varje jobbrad tillhandahåller en åtgärdsmeny (`...`):

| Åtgärd           | Tillgänglighet          | Effekt                                                                                                                                                                     |
| ---------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stoppa**       | Aktiva jobb             | Avbryter den pågående agentprocessen omedelbart. Arbetskatalogen i [Git](https://git-scm.com) bevaras så att du kan återuppta eller inspektera delvis genomfört arbete.    |
| **Tvinga start** | Blockerade jobb         | Kringgår samtidighetstak eller beroendelås för att starta jobbet omedelbart.                                                                                               |
| **Felsök**       | Alla jobb               | Öppnar **panelen för jobbfelsökning** (`JobDebugSheet`) som ger flikåtkomst till jobblogg, jobbprompt, rå utdatalogg och Eventwire-logg, med "Öppna i redigerare"-knappar. |
| **Ta bort**      | Slutförda / Misslyckade | Raderar jobbposten permanent från historiken efter bekräftelse.                                                                                                            |
