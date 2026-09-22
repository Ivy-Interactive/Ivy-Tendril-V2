---
title: Planer
description: "Planer i Utkast (eller Blockerad): utforma arbetet före exekvering
  (PlansApp)."
icon: Feather
searchHints:
  - utkast
  - plan
  - idéarbete
  - blockerad
  - makeplan
---

# Planer

Plans-appen är Tendrils arbetsyta för att utforma, förfina och förbereda utvecklingsarbete innan kodändringar exekveras. Genom att arbeta med planer först säkerställs att krav, arkitektur och verifieringssteg är tydliga innan agentkörningar startas.

## Hantera utkast

- **Skapa planer** — Tryck på `Ctrl+Alt+N` (`Cmd+Option+N` på macOS) eller klicka på **+ New Plan** i skalets sidhuvud för att öppna dialogrutan för att skapa.
- **Utkastkön** — Sidopanelen listar alla planer med status `Draft` eller `Blocked`. Planer som för närvarande körs i exekveringsjobb hålls säkert borta från utkastkön för att undvika samtidiga redigeringar.
- **Märken** — Varje utkast visar sin `#ID`-tagg, titel, projektmärke och komplexitetsnivåmärke (t.ex. L1, L2, L3) utformat med projektets konfigurerade nivåpalett.
- **Processbakgrund** — När kön är tom visar Tendril den interaktiva bakgrundsbilden för processlivscykeln med navigering till Planer, [Granskning](02_Review.md) och [Jobb](04_Jobs.md).

## Arbetsyta för plan (`PlanWorkspace`)

När du väljer en plan öppnas det innehållsrika arbetsytegränssnittet:

### Flikar

- **Plan** — Visar den senaste specifikationsrevisionen för planen i [Markdown](https://www.markdownguide.org) med dynamiska uppgiftschecklistor, problembeskrivning, föreslagen metod och verifieringskriterier.
- **Detaljer** — Metadata för planen, tilldelad projektkontext (från [Projektkonfiguration](../03_Configuration/02_Projects.md)), tidsstämplar för skapande/uppdatering samt revisionshistorik.
- **Diff-vy** — Visas när en plan har flera revisioner (`revisionCount > 1`) och erbjuder jämförelse sida vid sida eller sammanslagen diff mellan revisioner.
- **Rekommendationer** — Listar proaktiva [Rekommendationer](07_Recommendations.md) som genererats för denna plan med integrerade kontroller för att acceptera eller avvisa.
- **Git** — Visas när det finns exekveringsartefakter. Spårar aktiva [Git](https://git-scm.com)-worktrees, sparade commits, PR-referenser (se [Pull-förfrågningar](06_PullRequests.md)) och varnar om icke-mergade commits är i riskzonen, med en knapp för att synkronisera worktrees med fjärrförråd.

### Paneler och chatt

- **Verifieringspanel** — Nås via rullgardinsmenyn i det övre högra hörnet. Denna panel visar konfigurerade [Verifieringskontroller](../03_Configuration/01_Setup.md#verifications) (`Build`, `Test`, `Lint`, etc.) med deras godkänd/underkänd-status i realtid och utdataloggar.
- **Planchatt** — Inbäddad interaktiv chattpanel (`PlanChatPanel`) för att brainstorma, förfina tillvägagångssättet eller ställa frågor till agenten om planen innan kodändringar lanseras.

## Promptware-åtgärder

Se [Promptwares](../02_Concepts/02_Promptwares.md) för bakgrundsinformation om hur dessa arbetsflöden exekveras:

| Åtgärd               | Syfte                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ExecutePlan**      | Låser den senaste planrevisionen, skapar en isolerad [Git](https://git-scm.com)-worktree-gren och startar [Kodningsagenten](../06_CodingAgents/_Index.md) för att implementera ändringarna. |
| **ExpandPlan**       | Uppmanar en agent att utveckla en kort sammanfattning till en strukturerad plan med detaljerade steg, filmål och testplaner.                                                                |
| **SplitPlan**        | Delar upp en stor eller komplex plan i mindre, fokuserade delplaner som kan exekveras oberoende av varandra.                                                                                |
| **Shelve to Icebox** | Flyttar planen till [Frysen](05_Icebox.md) för att rensa upp i den aktiva kön samtidigt som all kontext bevaras.                                                                            |
| **Delete Plan**      | Begär bekräftelse för att permanent ta bort planmappen och dess poster.                                                                                                                     |

## Filer på disk och realtidssynkronisering

Varje plan backas upp av en katalog under `$TENDRIL_HOME/plans/<planId>/`:

- `plan.yaml` — Planmetadata i [YAML](https://yaml.org), tillstånd, projektkoppling och verifieringsposter. Se [CLI Plan](../09_Advanced/01_CLI/01_Plan.md).
- `revisions/` — Versionshanterade markdown-filer (`001.md`, `002.md`, etc.) som representerar varje iteration av specifikationen.
- `costs.csv` — Append-only token- och kostnadslogg.

Tendril använder filsystemsövervakare för att upptäcka redigeringar som gjorts i externa textredigerare eller IDE:er, vilket uppdaterar gränssnittet omedelbart utan manuell uppdatering.
