---
title: Felsökning
description: >-
  Vanliga symptom och hur du åtgärdar dem. Om du fortfarande sitter fast, kör `tendril doctor` och kontakta oss
  på Discord.
icon: Wrench
searchHints:
  - felsökning
  - fel
  - problem
  - symptom
  - felsök
  - diagnostisera
  - inaktuellt worktree
  - databas
  - doctor
  - db
---

# Felsökning

Diagnostisera och åtgärda vanliga problem med konfiguration, agenter, planer och databasen.

## Installation & miljö

| Symptom                               | Lösning                                                                                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TENDRIL_HOME` hittades inte          | Ange miljövariabeln och starta om terminalen, eller skriv sökvägen till `~/.tendril_location`. Utan någotdera använder Tendril standardplatsen `~/.tendril`.                                      |
| `config.yaml` hittades inte           | Filen måste finnas på `$TENDRIL_HOME/config.yaml` och heta exakt så — inte `tendril-config.yaml`. `tendril doctor` rapporterar vilken sökväg som förväntas.                                       |
| `gh` är inte autentiserad             | Kör autentisering för [GitHub CLI](https://cli.github.com/): `gh auth login`, därefter `gh auth status` för att bekräfta.                                                                         |
| `git` hittades inte                   | Installera [Git](https://git-scm.com/) och kontrollera att det finns i din `PATH`.                                                                                                                |
| `tendril` känns inte igen efter bygge | `cargo build --release` lämnar binären på `target/release/tendril`. Lägg antingen till den i `PATH` eller kör `cargo install --path src/crates/tendril-cli`.                                      |
| Appen startar men inget läses in      | Skrivbordsappen övervakar daemonen `tendril run`; om sidecar-binärer saknas i ett paketerat bygge finns ingen daemon att ansluta till. Se [Installation](02_Installation.md) för paketeringssteg. |

## Planer

| Symptom                                        | Lösning                                                                                                                                                               |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Planen har fastnat i `Draft`                   | Kontrollera att ett arkiv är kopplat med `tendril plan get <id>`, och verifiera att projektdefinitionen finns i `config.yaml`.                                        |
| Planmappen ser ofullständig ut eller laddas ej | Kör `tendril plan validate <id>` för att undersöka problem — ogiltig `plan.yaml`, saknad `Revisions/`, tom titel eller felaktiga schemaversioner.                     |
| Planen använder ett föråldrat schema           | Kör `tendril plan doctor --fix` för att migrera planmappar till aktuellt schema. För att ta bort övergivna tomma planhöljen, kör `tendril plan doctor --prune-husks`. |
| Planen har inga arkiv konfigurerade            | Kör `tendril plan add-repo <id> <path>`.                                                                                                                              |
| Kvarvarande worktree efter misslyckad körning  | Kör `tendril plan cleanup <id>` för att ta bort worktrees för avslutade planer. För icke-avslutade planer, ange `--force`: `tendril plan cleanup <id> --force`.       |

## Exekvering & agenter

| Symptom                             | Lösning                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agenten är inte nåbar               | Kontrollera `codingAgent` i `config.yaml`, och kör sedan agentens CLI direkt i en ren terminal. Tendril kör den som en underprocess; om `claude`, `codex`, `copilot`, `gemini`, `opencode`, `antigravity` eller `cursor` inte kan köras obevakat kommer bakgrundsjobb att stanna. För `apple`, verifiera `fm available` och att `fm serve` är aktiv. |
| Exekveringen misslyckas direkt      | Läs jobbloggen under `$TENDRIL_HOME/Jobs/{jobId}-{planId}-{promptware}/`. Vanliga orsaker är saknad arkivkontext eller saknade verktygsbehörigheter i [Promptwares](../02_Concepts/02_Promptwares.md).                                                                                                                                               |
| Verifieringar fortsätter att fela   | Kör verifieringskommandot manuellt inuti planens isolerade worktree (`$TENDRIL_HOME/Plans/{id}-{name}/Worktrees/{repo}`). Kommandot är oftast korrekt men worktreet saknar ett konfigurationssteg — se [Introducera en kodbas](03_Onboarding.md).                                                                                                    |
| Jobbet startar aldrig               | Kör `tendril job queue` för att kontrollera utskicksordning och samtidighetsgränser (`maxConcurrentJobs` i `config.yaml`). Flytta fram ett köat eller blockerat jobb med `tendril job force-start <id>`, eller stoppa fastnade jobb med `tendril job stop-all`. Se [Livscykel & Jobb](../02_Concepts/03_Lifecycle.md).                               |
| Röstinmatning uppger att den saknas | På macOS, bevilja mikrofonbehörighet under Systeminställningar → Integritet och säkerhet → Mikrofon, och starta sedan om skrivbordsappen.                                                                                                                                                                                                            |

## Databas

Tendril hanterar sin [SQLite](https://www.sqlite.org)-databas på `$TENDRIL_HOME/tendril.db`. Även om migreringar
körs automatiskt vid daemonstart tillhandahåller Tendril dedikerade databaskommandon:

```bash
# Kontrollera aktuell schemaversion för databasen
tendril db version

# Tillämpa eventuella väntande migreringar
tendril db migrate

# Verifiera databasens integritet
tendril db integrity

# Återvinn oanvänt diskutrymme
tendril db vacuum

# Återställ databasen (kräver bekräftelse)
tendril db reset
```

| Symptom                          | Lösning                                                                                                                                                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Osäker på om databasen är felfri | Kör `tendril doctor` (verifierar anslutning) eller `tendril db integrity` för att kontrollera intern SQLite-konsistens.                                                                                                            |
| Databasen är låst                | En annan process har ett exklusivt lås. Endast en daemon ska köras åt gången; stäng skrivbordsappen innan du kör `tendril run` eller `tendril serve` manuellt.                                                                     |
| Databasen är korrupt             | Stoppa appen och daemonen, kör sedan `tendril db reset` (eller ta bort `$TENDRIL_HOME/tendril.db` tillsammans med `-wal`- och `-shm`-filer). Planernas markdown-filer på disken under `$TENDRIL_HOME/Plans/` förblir helt intakta. |

> [!TIP]
> När du ber om hjälp på [Discord](https://discord.gg/FHgxkDga3y) eller GitHub, paketera fullständiga diagnostikloggar
> med `tendril report-bug <plan-id>` — se [Få hjälp](05_GettingHelp.md).
