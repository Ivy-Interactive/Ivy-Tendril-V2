---
title: verifiering
description: Hantera globala verifieringsdefinitioner lagrade i config.yaml.
  Dessa kan refereras av projekt och planer.
icon: ClipboardCheck
searchHints:
  - verifiering
  - verifiera
  - kontroll
  - prompt
  - definition
  - grindar
---

# verifiering

Hantera globala verifieringsdefinitioner lagrade i `config.yaml`. Verifieringsgrindar (verification gates) definierar automatiserade kvalitets-, bygg- och testkontroller som kodningsagenter måste uppfylla innan en [plan](01_Plan.md) kan övergå till `Completed`. De tilldelas projekt via [`tendril project add-verification`](02_Project.md#verifications).

## Kommandon

```terminal
>tendril verification list [--json]
>tendril verification get <name>
>tendril verification add <name> [--prompt <text>]
>tendril verification set <name> [--new-name <name>] [--prompt <text>]
>tendril verification remove <name> [--force]
```

- **list** — visar alla registrerade globala verifieringar. Skicka med `--json` för att mata ut som strukturerad JSON.
- **get** — skriver ut verifieringens namn och fullständiga utvärderingsprompttext till stdout.
- **add** — registrerar en ny verifieringskontroll med en valfri promptbeskrivning.
- **set** — uppdaterar en verifieringsdefinitions prompt eller byter namn på den. Att byta namn på en verifiering uppdaterar automatiskt alla projektreferenser, plan-YAML-poster och databasrader.
- **remove** — tar bort en verifieringsdefinition. Om något aktivt projekt refererar till kontrollen nekar Tendril borttagningen såvida inte `--force` (eller `-f`) anges, vilket rensar referenser över alla projekt.

## Exempel

```terminal
># Add a new verification gate with prompt instructions
>tendril verification add CargoTest --prompt "Run cargo test --workspace and ensure all test suites pass with exit code 0."

># Inspect full prompt details
>tendril verification get CargoTest

># Update the evaluation prompt
>tendril verification set CargoTest --prompt "Run cargo test --workspace --all-targets and verify zero test failures."

># Rename a verification definition across projects and plans
>tendril verification set CargoTest --new-name RustWorkspaceTests

># List all definitions in JSON format
>tendril verification list --json

># Remove a verification, cleaning up project references
>tendril verification remove RustWorkspaceTests --force
```

## Relaterat

- [projektverifieringar](02_Project.md#verifications) — konfigurera vilka kontroller som krävs för ett projekt
- [planverifieringar](01_Plan.md#verifications) — inspektera eller åsidosätt status för verifieringsgrindar på en plan
- [Konfigurationsreferens](../../03_Configuration/01_Setup.md) — hantera globala inställningar i `config.yaml`
