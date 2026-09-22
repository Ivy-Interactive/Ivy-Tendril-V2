---
title: plan
description: Skapa, läs, uppdatera och validera planer från terminalen. Alla
  underkommandon härleder planmappen från TENDRIL_PLANS, TENDRIL_HOME/Plans
  eller ~/.tendril/Plans när miljövariabler inte är satta.
icon: ListChecks
searchHints:
  - plan
  - skapa
  - lista
  - hämta
  - ange
  - uppdatera
  - validera
  - repo
  - pr
  - commit
  - verifiering
  - rekommendation
  - rec
  - logg
  - revision
  - doctor
  - beror på
  - relaterad
  - miljö
  - wireframes
---

# plan

Skapa, läs, uppdatera och validera planer från terminalen. Alla underkommandon härleder planmappen från `TENDRIL_PLANS`, `TENDRIL_HOME/Plans` eller `~/.tendril/Plans` när miljövariabler inte är satta.

## CRUD

#### plan create

```terminal
>tendril plan create <title> <project> [options]
```

Skapar en ny planmapp och ett `plan.yaml`-skelett med tillståndet `Draft`. Plan-ID:t tilldelas automatiskt från `.counter`-filen. Databaser (repositories) och standardverifieringar härleds från projektkonfigurationen.

| Flagga                          | Beskrivning                                                   |
| ------------------------------- | ------------------------------------------------------------- |
| `--level <level>`               | Prioritetsnivå (standard: Feature)                            |
| `--initial-prompt <text>`       | Initial prompttext                                            |
| `--source-url <url>`            | Käll-URL (GitHub-issue eller PR)                              |
| `--execution-profile <profile>` | Exekveringsprofil (`deep` eller `balanced`)                   |
| `--priority <number>`           | Prioritetsnummer (standard: 0)                                |
| `--verification <Name=Status>`  | Verifieringspost (kan upprepas)                               |
| `--related-plan <folder>`       | Relaterat planmappnamn (kan upprepas)                         |
| `--depends-on <folder>`         | Beroende planmappnamn (kan upprepas)                          |
| `--chat-session <id>`           | Associera med en chattsession                                 |
| `--plans-dir <path>`            | Åsidosätt sökväg till plankatalog                             |
| `--no-duplicate-check`          | Hoppa över dubblettidentifiering mot befintliga aktiva planer |

#### plan list

```terminal
>tendril plan list [options]
```

Listar planer med valfria filter.

| Flagga                     | Effekt                                                           |
| -------------------------- | ---------------------------------------------------------------- |
| `--status` / `--state <s>` | Filtrera efter tillstånd (t.ex. `Draft`, `Executing`, `Failed`)  |
| `-p, --project <name>`     | Filtrera efter projektnamn (valideras mot konfigurerade projekt) |
| `--level <level>`          | Filtrera efter nivå (t.ex. `Bug`, `Feature`, `Epic`)             |
| `--has-pr`                 | Endast planer som har associerade PRs                            |
| `--has-worktree`           | Endast planer som har worktrees                                  |
| `-q, --search <query>`     | Filtrera med textsökning på delsträng i titel eller ID           |
| `--limit <n>`              | Maximalt antal resultat                                          |
| `--format <fmt>`           | Utdataformat: `table` (standard), `ids`, `folders`, `json`       |
| `--plans-dir <path>`       | Åsidosätt sökväg till plankatalog                                |

```terminal
>tendril plan list --state Draft
>tendril plan list --project Tendril --level Critical
>tendril plan list --state Failed --format ids
>tendril plan list --format json --limit 10
```

> [!NOTE]
> `plan list` visar planer (från `plan.yaml`-filer), inte jobb. För jobbhistorik och exekveringsstatus, använd `job list` istället (se [Andra kommandon](05_Other.md#job-list)).

#### plan get

```terminal
>tendril plan get <plan-id> [field]
```

Skriver ut hela YAML-filen, eller ett enskilt fältvärde när `[field]` anges.

**Skalära fält:** `id`, `title`, `state`, `project`, `level`, `created`, `updated`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`, `partialDelivery`

**Listfält:** `repos`, `prs`, `commits`, `verifications`, `dependsOn`, `relatedPlans`, `recommendations` (varje post på en egen rad)

#### plan set

```terminal
>tendril plan set <plan-id> <field> <value> [options]
>tendril plan set <plan-id> state Completed --allow-failed-verifications
```

Uppdaterar ett enskilt fält och höjer `updated`-tidsstämpeln automatiskt.

Fält som stöds: `state`, `title`, `level`, `project`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`.

Att sätta `state` till `Completed` nekas så länge någon verifiering har tillståndet `Fail`: en plan som visas som slutförd medan en grind avvisade arbetet döljer en saknad leverans från dubblettidentifiering. Kör om verifieringen, eller sätt den till `Skipped` med ett uttryckligt skäl. Att skicka med `--allow-failed-verifications` registrerar övergången ändå och sätter `partialDelivery: true`.

| Flagga                         | Effekt                                                                 |
| ------------------------------ | ---------------------------------------------------------------------- |
| `--allow-failed-verifications` | Tillåt övergång till `Completed` även med misslyckade verifieringar    |
| `--reason <text>`              | Förklara varför ändringen gjordes (rapporteras till lyssnande chattar) |
| `--chat-session <id>`          | Ursprunglig chattsession (exkluderas från självavisering)              |

#### plan update

```terminal
>cat revised.yaml | tendril plan update <plan-id> --stdin
>tendril plan update <plan-id> --file revised.yaml
```

Ersätter hela innehållet i `plan.yaml` från `--file` eller `--stdin` (krävs — `--stdin` är inte implicit).

#### plan check-wireframes

```terminal
>tendril plan check-wireframes <plan-id>
```

Söker efter läckage av wireframe-kod i en plans modifierade filer. Avslutar med 0 om allt är rent, eller avslutar med 1 och en diagnostikrapport om några wireframe-markörer hittas.

#### plan validate

```terminal
>tendril plan validate <plan-id>
```

Kontrollerar att planen innehåller alla obligatoriska fält och är internt konsekvent. Avslutar med kod `1` vid strukturella fel.

## Repos

```terminal
>tendril plan add-repo <plan-id> <repo-path> [--reason <text>] [--chat-session <id>]
>tendril plan remove-repo <plan-id> <repo-path> [--reason <text>] [--chat-session <id>]
```

Hantera listan över databaser (repositories) som är associerade med en plan. Att lägga till ett befintligt repo är en idempotent no-op.

## Länkar

```terminal
>tendril plan add-pr <plan-id> <pr-url> [--reason <text>] [--chat-session <id>]
>tendril plan remove-pr <plan-id> <pr-url> [--reason <text>] [--chat-session <id>]
>tendril plan add-commit <plan-id> <sha> [--reason <text>] [--chat-session <id>]
>tendril plan add-related-plan <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
>tendril plan remove-related-plan <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
>tendril plan add-depends-on <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
>tendril plan remove-depends-on <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
```

Hantera PR-URL:er, commit-SHA:er, relaterade planer och blockerande beroenden. `add-depends-on` gör att `ExecutePlan` väntar på att beroendet når tillståndet `Completed` och slår samman sina PRs innan exekvering. Alla namn matchas skiftlägesokänsligt.

## Verifieringar

```terminal
>tendril plan set-verification <plan-id> <name> <status> [--reason <text>] [--chat-session <id>]
>tendril plan verification list <plan-id> [--status <status>] [--json]
>tendril plan verification add <plan-id> <name> [--status <status>] [--reason <text>] [--chat-session <id>]
>tendril plan verification remove <plan-id> <name> [--reason <text>] [--chat-session <id>]
```

Hantera verifieringar för en plan. Giltiga statusar: `Pending`, `Pass`, `Fail`, `Skipped`. Standardstatus för `add` är `Pending`.

## Worktrees

#### plan cleanup

```terminal
>tendril plan cleanup <plan-id> [--force]
```

Tar bort alla git worktrees som är associerade med en plan. Körs som standard endast på planer i ett sluttillstånd (`Completed`, `Failed`, `Skipped`, `Icebox`). Använd `--force` för att ta bort worktrees för icke-avslutade planer.

#### plan add-worktree

```terminal
>tendril plan add-worktree <plan-id> <repo> [--base <branch>]
```

Skapar ett git worktree för den givna planen under `<plan-folder>/Worktrees/<repo-name>`, med utgångspunkt från `origin/<base>` (standard: automatiskt identifierad standardgren). Grenen får namnet `tendril/<plan-folder-name>`.

#### plan remove-worktree

```terminal
>tendril plan remove-worktree <plan-id> <repo-name> [--branch <branch>]
```

Tar bort ett enskilt worktree från `Worktrees/<repo-name>`. Försöker först med `git worktree remove --force`; faller tillbaka på en tvångsradering. Raderar även den associerade grenen (`tendril/<plan-folder>` som standard).

## Revisioner

```terminal
>cat revision.md | tendril plan write-revision <plan-id> --stdin
>tendril plan write-revision <plan-id> --file revision.md
```

Skriver en numrerad revisionsfil till `Revisions/` (t.ex. `002.md`) från stdin eller `--file`. Stöder `--no-question-check` för att kringgå validering, samt `--reason` / `--chat-session` för granskningsattribuering.

```terminal
>tendril plan get-revision <plan-id> [--number <n>]
```

Skriver ut revisionsinnehåll till stdout — den senaste revisionen som standard, eller en specifik numrerad revision när `--number` anges.

## Frågor

En revision kan innehålla frågor till användaren i inhägnade `questions`-block:

````markdown
```questions
questions:                    # 1-4 items
  - id:          string       # required, stable, unique across the whole revision
    title:       string       # required, the question
    header:      string       # optional, <=12 char chip label
    description: markdown     # optional, context shown under the question
    multiple:    bool         # optional, default false; true = multi-select
    options:                  # 2-4 items; omit entirely for a pure free-text question
      - title:       string   # required, 1-5 words
        description: markdown # optional
        value:       slug     # required, ^[a-z0-9][a-z0-9-]*$, referenced by `answer`
        recommended: bool     # optional, max one per question
    answer:      value | [values] | string   # filled in on response
```
````

`write-revision` validerar varje frågeblock mot detta schema och avvisar revisionen om något block är felaktigt formaterat. Använd endast `--no-question-check` i automatiserade tester.

## Rekommendationer

```terminal
>tendril plan rec list <plan-id> [--state <state>]
>tendril plan rec all [--project <project>] [--state <state>]
>tendril plan rec rebuild
>tendril plan rec add <plan-id> <title> [-d <description>] [--impact <level>]
>tendril plan rec set <plan-id> <title> <field> <value>
>tendril plan rec accept <plan-id> <title> [--notes <text>]
>tendril plan rec decline <plan-id> <title> [--reason <text>] [--edit-reason <text>]
>tendril plan rec remove <plan-id> <title>
```

Hantera rekommendationer som lagras i en plans YAML:

- **list** — lista rekommendationer för en plan; filtrera efter tillstånd: `Pending`, `Accepted`, `AcceptedWithNotes`, `Declined`
- **all** — lista rekommendationer över samtliga planer
- **rebuild** — bygg om den avnormaliserade rekommendationsprojektionen från disk
- **add** — påverkansnivåer: `Small`, `Medium`, `High`
- **set** — fält som stöds: `title`, `description`, `state`, `impact`, `declineReason`, `notes`
- **accept** — sätter tillståndet till `Accepted`, eller `AcceptedWithNotes` om `--notes` anges
- **decline** — sätter tillståndet till `Declined`. `--reason` registrerar varför den avböjdes i `plan.yaml`; `--edit-reason` anger aviseringsorsaken för chattsessioner
- **remove** — tar bort en rekommendation permanent

## Miljö

```terminal
>tendril plan env materialize <plan-id> [--repo <repo>] [--force] [--json]
>tendril plan env get <plan-id> [--repo <repo>] [--json]
```

Inspektera och skriv planens portallokeringar och miljöfiler:

- **materialize** — allokerar icke-konfliktskapande tjänsteportar och skriver miljöfiler till planens worktrees. Använd `--force` för att skriva över befintliga filer.
- **get** — skriver ut allokerade portar och matchade miljövariabler för ett worktree.

## Doctor

```terminal
>tendril plan doctor [options]
```

Söker igenom varje mapp i plankatalogen och rapporterar hälsoproblem.

| Flagga          | Effekt                                                                              |
| --------------- | ----------------------------------------------------------------------------------- |
| `--fix`         | Migrera planscheman till den senaste versionen automatiskt                          |
| `--prs`         | Verifiera varje registrerad pull request mot GitHub via `gh`                        |
| `--prune-husks` | Ta bort tomma planmappar som varken innehåller revisioner eller arbetsartefakter    |
| `--dry-run`     | Rapportera vad som skulle tas bort utan att radera, tillsammans med `--prune-husks` |

```terminal
>tendril plan doctor
>tendril plan doctor --fix
>tendril plan doctor --prs
>tendril plan doctor --prune-husks --dry-run
```

### Retroaktiv komplettering för partiell leverans

Rapporten listar planer markerade som `Completed` med en verifiering i tillståndet `Fail` och utan flaggan `partialDelivery`. Dessa föregick slutförandespärren. För att bekräfta den partiella leveransen:

```terminal
>tendril plan set <id> state Completed --allow-failed-verifications
```
