---
title: Databas
description: Hantera den lokala SQLite-databasen som lagrar
  plansynkroniseringsdata, rekommendationer, jobbhistorik och kostnadsspårning.
icon: Database
searchHints:
  - databas
  - db
  - migrera
  - migrering
  - schema
  - version
  - återställ
  - sqlite
  - integritet
  - vacuum
---

# Databas

Hantera den lokala [SQLite](https://www.sqlite.org)-databasen (`<TendrilHome>/tendril.db`) som lagrar [plansynkroniseringsdata](../../02_Concepts/01_Plans.md), [jobbhistorik](../../04_Apps/04_Jobs.md), rekommendationer och kostnadsspårning. I Tendril v2 nås all databashantering via underkommandoträdet `tendril db`.

## Kommandon

#### db version

```terminal
>tendril db version
```

Inspekterar databasschemat utan att tillämpa migreringar. Skriver ut aktuell databasversion, den senaste versionen som förväntas av den installerade binären samt migreringsstatus (`Up to date`, `Needs migration` eller `Newer than application`).

```terminal
Database version: 12
Latest version:   12
Status:           Up to date
```

#### db migrate

```terminal
>tendril db migrate
```

Tillämpar alla väntande migreringar för att uppdatera databasschemat. Säker att köra upprepade gånger — redan tillämpade migreringar hoppas över idempotent.

> [!NOTE]
> `tendril run` tillämpar automatiskt väntande migreringar innan daemon-servern startas, så manuell migrering krävs sällan.

#### db reset

```terminal
>tendril db reset
>tendril db reset --force
```

Tar bort varje tabell i `tendril.db` och återskapar schemat från grunden. Frågar efter bekräftelse om inte `--force` anges. Vägrar att köra om daemonen för närvarande är aktiv såvida inte `--force` anges.

> [!WARNING]
> Återställning raderar alla databasposter (cachad jobbhistorik, telemetri, rekommendationer). Dina författade [plan-YAML-filer](01_Plan.md) och revisions-markdownfiler på disken förblir helt orörda.

#### db integrity

```terminal
>tendril db integrity
```

Kör en SQLite [PRAGMA integrity_check](https://www.sqlite.org/pragma.html#pragma_integrity_check) över alla tabeller, index och sidor. Skriver ut varje verifieringsresultat och avslutar med statuskod 1 om någon korruption eller strukturell anomali upptäcks.

#### db vacuum

```terminal
>tendril db vacuum
>tendril db vacuum --force
```

Kör SQLite [VACUUM](https://www.sqlite.org/lang_vacuum.html) för att defragmentera databasen, bygga om index och återvinna oanvänt diskutrymme. Rapporterar databasstorleken före och efter körning, tillsammans med det totala antalet återvunna byte.

## Relaterat

- [CLI-översikt](00_Overview.md) — globala alternativ, sökvägar till datakataloger och hälsokontroller för installationen
- [plan-kommandon](01_Plan.md) — skapa, lista och validera planer som lagras på disk
