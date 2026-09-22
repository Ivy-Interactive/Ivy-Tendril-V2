---
title: Livscykel & Jobb
description: >-
  Ett jobb är en körning av ett promptware. Detta är vad som händer medan det körs — status, utdata,
  verifieringar och kostnad.
icon: RefreshCw
searchHints:
  - jobb
  - livscykel
  - status
  - verifiering
  - worktree
  - samtidighet
  - kostnad
  - tokens
  - kö
  - stop-all
---

# Livscykel & Jobb

Varje gång Tendril utför en handling för din räkning skapas ett **jobb**: en körning av en enskild
[arbetsflödesagent (promptware)](02_Promptwares.md) mot en [plan](01_Plans.md). Jobb är hur en plan
rör sig genom sin livscykel, och det är vad du observerar i realtid i skrivbordsappen och CLI:et.

## Jobbstatusar

| Status        | Betydelse                                                              |
| ------------- | ---------------------------------------------------------------------- |
| **Pending**   | Skapad, ännu inte insläppt i kön.                                      |
| **Queued**    | Väntar på en ledig samtidighetsplats.                                  |
| **Running**   | Kodningsagentens process exekveras aktivt.                             |
| **Completed** | Slutfördes framgångsrikt och klarade alla obligatoriska grindar.       |
| **Failed**    | Agenten stötte på fel eller obligatoriska verifieringskontroller föll. |
| **Timeout**   | Överskred sin konfigurerade tidsgräns och avbröts.                     |
| **Stopped**   | Stoppades av användaråtgärd.                                           |
| **Blocked**   | Kan inte fortsätta — väntar på ett beroende jobb, inloggning el. val.  |

## Exekveringsloopen

1. **Kö (Queue)** — jobbet skapas och köas bakom pågående uppgifter.
2. **Förberedelse (Prepare)** — för kodändrande promptwares ([ExecutePlan](02_Promptwares.md),
   [RetryPlan](02_Promptwares.md)) skapar Tendril ett isolerat
   [Git-worktree](https://git-scm.com/docs/git-worktree) per arkiv under planens
   `Worktrees/{repo-name}/`-mapp. Körningen rör eller låser aldrig din primära arbetskatalog.
3. **Implementering (Implement)** — arbetsflödesagenten arbetar igenom planens faser och gör stegvisa commits.
4. **Verifiering (Verify)** — varje konfigurerad verifieringsgrind körs i worktreet och sparar sitt resultat.
5. **Rapportering (Report)** — utdatalogg, tokenkostnader och uppdaterat plantillstånd sparas på disken och skickas till
   daemonen.

Att stoppa ett jobb återställer planen till det tillstånd den hade innan jobbet startade, samtidigt som worktreets
innehåll bevaras så att du kan inspektera delvisa framsteg. Se [Planer](01_Plans.md) för den fullständiga tillståndstabellen.

## Verifieringar

En verifiering är en automatiserad kvalitetsgrind som registreras i `plan.yaml`. Varje kontroll producerar ett resultat —
`Pass`, `Fail` eller `Skipped` — tillsammans med en detaljerad rapport i planens `Verification/`-mapp.
Vilka kontroller som körs beror på vilka filer som planen modifierar:

| Verifiering     | Kontrollerar                                                         |
| --------------- | -------------------------------------------------------------------- |
| **NpmBuild**    | Pnpm / npm-arbetsytan byggs felfritt.                                |
| **NpmLint**     | Linting och formatering passerar för TypeScript- / JavaScript-paket. |
| **NpmTest**     | Automatiserade testsviter passerar (Vitest, Jest, etc.).             |
| **RustBuild**   | Cargo-paket kompileras utan kompilatorfel.                           |
| **RustClippy**  | Clippy-luddet rapporterar inga varningar eller fel.                  |
| **RustFormat**  | `cargo fmt --check` rapporterar konsekvent formatering.              |
| **RustTest**    | Rusts enhets- och integrationstestsviter passerar.                   |
| **Screenshots** | Visuella bevis har samlats in för UI-ändringar.                      |
| **CheckResult** | Agentens egen bekräftelse på att planens kriterier uppfylls.         |

En verifiering som inte är tillämplig för en plan markeras som `Skipped` snarare än att uteslutas i det tysta,
vilket säkerställer en tydlig granskningskedja. En plan når **Review** endast när dess obligatoriska verifieringar passerar.
Om en verifiering misslyckas övergår planen till **Failed**, och
[RetryPlan](02_Promptwares.md) kan göra ett nytt försök med det exakta felmeddelandet
och aktuell differens som kontext.

> [!TIP]
> När en verifiering misslyckas, inspektera rapporten i `Verification/` och testa kommandot direkt i
> planens worktree. Kontrollen är oftast korrekt och worktreet saknar kanske bara ett beroende eller
> en byggtillgång — se [Introducera en kodbas](../01_GettingStarted/03_Onboarding.md).

## Samtidighet & worktrees

Flera jobb kan köras samtidigt, vilket styrs av `maxConcurrentJobs` i
[~/.tendril/config.yaml](../03_Configuration/01_Setup.md) (standard `20`):

```yaml
maxConcurrentJobs: 4
```

Eftersom varje exekverande plan arbetar inuti dedikerade [git-worktrees](https://git-scm.com/docs/git-worktree)
krockar inte parallella jobb på samma kodarkiv. Däremot delar parallella körningar CPU, minne och
API-hastighetsbegränsningar för kodningsagenten, så anpassa `maxConcurrentJobs` efter din arbetsstation.

## Kostnadsuppföljning

Varje körning registrerar förbrukade tokens och uppskattade dollarkostnader. Den beständiga granskningsloggen är planens
`costs.csv`, dit en rad läggs till per körning:

```csv
Promptware,Tokens,Cost,Model,CostSource,Agent
ExecutePlan,148213,1.9042,claude-opus-5,api,claude
```

När en agent körs på en fast prenumeration (eller en lokal modell som Apple Foundation Models)
lämnas fältet `Cost` tomt istället för att registrera noll, vilket bevarar tokenmätvärden utan att hitta på
dollarbelopp.

## Hantera och inspektera jobb

Skrivbordsappen visar aktuell jobbstatus och strömmande terminalutdata via daemonens WebSocket-ström.
CLI:et erbjuder fullständig paritet:

```bash
# Lista alla aktiva och nyligen körda jobb
tendril job list

# Filtrera jobb efter status
tendril job list --status Running
tendril job list --status Failed

# Inspektera utskicksköns ordning och lediga platser
tendril job queue

# Flytta fram ett köat eller blockerat jobb så att det körs direkt
tendril job force-start <job-id>

# Avbryt ett pågående jobb
tendril job cancel <job-id> -m "Stopping for review"

# Stoppa alla pågående, köade och blockerade jobb
tendril job stop-all

# Rensa avslutade eller misslyckade jobb från databasen
tendril job clear --completed
tendril job clear --failed
```

Fullständiga loggar och transkriptioner för varje körning sparas permanent på disken på
`$TENDRIL_HOME/Jobs/{jobId}-{planId}-{promptware}/`, inklusive den råa systemprompten,
spår för verktygskörningar och agenttranskriptioner.

## Nästa steg

- [Planer](01_Plans.md) — de tillstånd jobb flyttar en plan mellan.
- [Promptwares](02_Promptwares.md) — vad som faktiskt körs inuti ett jobb.
- [Felsökning](../01_GettingStarted/06_Troubleshooting.md) — felsöka fastnade eller misslyckade jobb.
