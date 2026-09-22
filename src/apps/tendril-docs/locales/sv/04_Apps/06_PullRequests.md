---
title: Pull Requests
description: Spåra och öppna GitHub PR:er från Tendril efter att Granskning
  godkänner CreatePr.
icon: GitPullRequest
searchHints:
  - pull requests
  - pr
  - sammanfoga
  - github
---

# Pull Requests

Appen Pull Requests tillhandahåller spårning över flera projekt för alla [GitHub](https://github.com)-pull requests som skapats från godkända Tendril-planer. Den erbjuder en samlad instrumentpanel för att övervaka vilka PR:er som är öppna, sammanfogade eller stängda, tillsammans med tokenförbrukning och kostnad associerad med varje leverans.

## Livscykel & arbetsflöde för PR

1. **Godkännande** — När en plan har slutfört körningen och godkänts i [Granskning](02_Review.md), startar ett klick på **Create Pull Request** promptwaret `CreatePr` (se [Promptwares](../02_Concepts/02_Promptwares.md)).
2. **Skapande** — Tendril använder [GitHub CLI](https://cli.github.com) (`gh`) för att pusha den isolerade [Git](https://git-scm.com)-worktree-grenen och öppna en pull request på [GitHub](https://github.com) med en AI-genererad sammanfattning (se [GitHub-integrering](../07_Integrations/01_Github.md)).
3. **Spårning** — Pull requesten kopplas till planen och spåras i denna vy tills den har sammanfogats eller stängts.

## Tabellen Pull Requests

Tabellen listar varje pull request som registrerats över dina projekt:

| Kolumn         | Beskrivning                                                | Interaktion                                                                                       |
| -------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Plan**       | Planens `#ID` och titel.                                   | Klicka för att öppna en förhandsgranskningspanel som visar hela planspecifikationen.              |
| **Projekt**    | Projektbricka.                                             | Visar projektfärgen som definierats i [Projektinställningar](../03_Configuration/02_Projects.md). |
| **Status**     | Statusbricka (`Open`, `Merged`, `Closed` eller `Unknown`). | Verktygstips vid hovring visar tidsstämpeln för den senaste GitHub-kontrollen.                    |
| **PR**         | GitHub pull request-nummer (t.ex. `#84`).                  | Klicka för att öppna pull requesten på [GitHub](https://github.com) i din standardwebbläsare.     |
| **Tokens**     | Ackumulerade tokens som förbrukats av planen.              | Kompakt tokenantal (t.ex. `450K`, `1.2M`).                                                        |
| **Kostnad**    | Total kostnad i USD för alla jobb i denna plan.            | Formaterad valutakostnad.                                                                         |
| **Repository** | Mål för GitHub-repository (`owner/repo`).                  | Fullständig sökväg till målrepositoryt.                                                           |
| **Gren**       | Namn på Git-gren.                                          | Källgren i repositoryt.                                                                           |

## Filtrering & synkronisering

- **Statusfilter** — Använd statusbricksväljaren ovanför tabellen för att filtrera efter `Open`, `Merged`, `Closed` eller `Unknown`.
- **Sök** — Filtrera rader i realtid över plan-ID, titel, projektnamn, repository eller grennamn.
- **Synka om med GitHub** — Klicka på knappen **Resync** för att köra en synkroniseringsomgång (`gh pr list`) över konfigurerade repositories. Tendril rapporterar eventuella onåbara, oautentiserade eller hastighetsbegränsade repositories.

> [!NOTE]
> Sammanfogade pull requests är slutgiltiga och kontrolleras inte på nytt under periodiska synkroniseringsomgångar.

## Radåtgärder

Varje pull request-rad erbjuder fyra snabbåtgärder:

- **Visa plan** — Navigerar till planens detaljarbetsyta i appen [Planer](03_Plans.md).
- **Följ upp** — Öppnar dialogrutan för Ny plan förifylld med referens till repository, projekt och gren så att du enkelt kan bygga uppföljningsuppgifter, buggfixar eller förfiningar i [Planer](03_Plans.md).
- **Öppna PR** — Öppnar pull requesten på [GitHub](https://github.com) i din webbläsare.
- **Synka om** — Uppdaterar status från GitHub för det specifika repositoryt.
