---
title: GitHub
description: Tendril integreras med GitHub för ärendeimport, automatiskt
  skapande av pull requests och spårning av PR-status.
icon: GitBranch
searchHints:
  - github
  - ärenden
  - pull requests
  - prs
  - importera
---

# GitHub

## Autentisering

Tendril använder [GitHub CLI](https://cli.github.com) (`gh`) för autentisering mot [GitHub](https://github.com). Kör `gh auth login` för att autentisera innan du använder GitHub-funktioner.

> [!NOTE]
> Se till att `gh` är installerat och tillgängligt i din PATH. Tendril meddelar dig under onboarding om det saknas.

## Importera ärenden via Inkorgen

Tendril tillhandahåller en dedikerad **Inbox**-vy (Inkorg) i sidofältet för att bläddra bland [GitHub](https://github.com)-ärenden och omvandla dem till [planer](../02_Concepts/01_Plans.md):

1. Öppna **Inbox** från navigeringssidofältet.
2. Välj en kategori:
   - **My Issues**: Ärenden som tilldelats dig i konfigurerade projektarkiv.
   - **Review Requests**: Öppna pull requests som begär din granskning.
   - **Project Issues**: Alla öppna ärenden för ett valt projektarkiv.
3. Filtrera efter söktermer, etiketter eller milstolpar. En enskild fråga hämtar upp till 1 000 öppna ärenden (GitHubs söktak).
4. Välj ett eller flera ärenden och klicka på **Create Plan** för att starta `CreatePlan` [promptware](../02_Concepts/02_Promptwares.md), eller anpassa planbeskrivningen i dialogrutan New Plan innan körning.

Varje skapad plan behåller käll-URL:en som länkar direkt tillbaka till det ursprungliga GitHub-ärendet.

### Automatisk genomsökning och förslag för ärenden

Tendril inkluderar en automatisk bakgrundsgenomsökning för tilldelade GitHub-ärenden:

- Konfigurera `inbox.checkIntervalMinutes` (eller klicka på inställningskugghjulet i Inbox-vyn) för att ställa in hur ofta Tendril frågar GitHub efter nytilldelade ärenden.
- **Auto-Accept Mode**: När `inbox.autoAcceptAssignedIssues` är aktiverat startar nyligen identifierade ärenden omedelbart ett `CreatePlan`-jobb.
- **Proposals Mode**: När det är inaktiverat placeras genomsökta ärenden som **Inbox Proposals** i Inbox-vyn. Du kan granska varje förslags beskrivning och välja att **Accept** (initierar planen) eller **Dismiss** (sparar en permanent post så att ärendet aldrig återimporteras).
- Klicka på **Check Now** i Inbox-verktygsfältet för att trigga en omedelbar manuell genomsökning utan att vänta på den schemalagda timern.

## Skapa pull requests

När en plan har slutfört och verifierat sina ändringar öppnar du dialogrutan **Create PR** för att skapa en pull request:

1. Granska och redigera den genererade PR-titeln, beskrivningen och granskarna.
2. Konfigurera PR-alternativ:
   - **Solve Merge Conflicts**: Försöker automatiskt lösa merge-konflikter i grenen mot målbasen.
   - **Merge**: Slår samman din PR när alla kontroller godkänns (avmarkera för att öppna din PR för teamgranskning utan att slå samman).
   - **Delete Branch**: Raderar worktree-grenen när den har slagits samman.
   - **Include Artifacts**: Bifogar planverifieringsartefakter, skärmdumpar och loggar till PR-brödtexten.
   - **Create as Draft**: Öppnar pull requesten i utkastläge.
3. Tendril kör `CreatePr` [promptware](../02_Concepts/02_Promptwares.md) via `gh` för att pusha grenen, skapa pull requesten och länka PR-URL:en till planen.

## Spårning av PR-status

Vyn [Pull Requests](../04_Apps/06_PullRequests.md) i sidofältet spårar alla öppna, sammanslagna och stängda pull requests i dina projekt. Tendril övervakar tillståndsändringar för PRs och håller din [plantavla](../04_Apps/03_Plans.md) synkroniserad utan manuell intervention.
