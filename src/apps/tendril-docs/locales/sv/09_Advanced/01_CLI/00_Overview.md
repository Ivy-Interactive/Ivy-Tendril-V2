---
title: CLI-översikt
description: Hantera planer, projekt, databaser och agenter direkt från din
  terminal. Binärfilen tendril fungerar både som en serverdemon och ett
  fullfjädrat CLI-verktyg.
icon: Terminal
searchHints:
  - cli
  - kommando
  - terminal
  - tendril
  - skal
  - återställ
  - rapportera-bugg
  - kör
  - servera
  - doktor
  - version
  - konfiguration
---

# CLI-översikt

Hantera planer, projekt, databaser och agenter direkt från din terminal. Binärfilen `tendril` fungerar både som en serverdemon och ett fullfjädrat CLI-verktyg.

Tendril CLI ger dig fullständig kontroll över ditt arbetsflöde utan att behöva använda gränssnittet:

- **Planer** — skapa, lista, uppdatera och inspektera planer; hantera arkiv, worktrees, verifieringar och rekommendationer
- **Projekt** — konfigurera projekt, deras arkiv, byggberoenden, granskningsåtgärder, MCP-servrar och anpassade färdigheter
- **Verifieringar** — definiera och hantera återanvändbara verifieringskontroller
- **Konfiguration** — läs och uppdatera inställningar på toppnivå som lagras i `config.yaml`
- **Valv** — anslut teamvalv, upptäck fjärrarkiv, synkronisera resurser samt importera eller publicera projekt
- **Databas** — kör migreringar, inspektera schemaversioner, återställ tabeller, kontrollera integritet och kör vacuum
- **Agenter & jobb** — kör promptwares, hantera bakgrundsjobb och driv interaktiva chattsessioner

## Snabbstart

**1. Kontrollera din installation**

```terminal
>tendril doctor
```

**2. Starta demonservern**

```terminal
>tendril run
```

**3. Skapa en ny plan**

```terminal
>tendril plan create "Fix login bug" MyProject
```

**4. Lista aktiva planer**

```terminal
>tendril plan list --state Executing
```

**5. Återställ allt och börja om på nytt**

```terminal
>tendril reset
```

> [!TIP]
> Alla kommandon stöder `--help` för detaljerad användningsinformation. Till exempel: `tendril plan create --help`.

## Globala alternativ

| Flagga          | Effekt                                                                                  |
| --------------- | --------------------------------------------------------------------------------------- |
| `--home <path>` | Sökväg till Tendrils hemkatalog (kan även ställas in via miljövariabeln `TENDRIL_HOME`) |

## Miljövariabler

| Variabel        | Syfte                                                                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TENDRIL_HOME`  | Rotkatalog för konfiguration, databas, inkorg och planer (standard är `~/.tendril` eller `D:\.tendril`)                                                                     |
| `TENDRIL_PLANS` | Åsidosätt planers katalog (standard är `TENDRIL_HOME/Plans`)                                                                                                                |
| `RUST_LOG`      | Filterdirektiv för processloggning på stderr (standard: `warn,tendril_cli=info,tendril_core=info,tendril_server=info`). Sätt till `debug` för detaljerade diagnostikloggar. |

## Vanliga kommandon

#### doctor

```terminal
>tendril doctor
>tendril doctor --rebuild-search-index
```

Validerar din Tendril-installation — kontrollerar `TENDRIL_HOME`, `config.yaml`, nödvändiga verktyg (`git`, `gh`), databasanslutning och tillgänglighet för agentmodeller. Använd `--rebuild-search-index` för att återskapa fulltextsökningsindexet från databasen.

#### plan doctor

```terminal
>tendril plan doctor
>tendril plan doctor --fix
>tendril plan doctor --prs
>tendril plan doctor --prune-husks --dry-run
```

Skannar varje planmapp och rapporterar hälsostatus: saknad eller felaktigt formaterad `plan.yaml`, inaktuella worktrees och planer som lämnats i status `Completed` trots en misslyckad verifiering. Se [Plan](01_Plan.md#doctor) för fullständig referens över alternativ och hälsokoder.

#### serve och run

```terminal
>tendril serve --port 5010 --host 127.0.0.1
>tendril serve --tls-cert /path/localhost.crt --tls-key /path/localhost.key
>tendril run
```

`tendril serve` startar HTTP- och WebSocket API-servern (standardport `5010`, värd `127.0.0.1`). Valfria flaggor `--tls-cert` och `--tls-key` tillhandahåller HTTPS.

`tendril run` verifierar att målporten är tillgänglig, tillämpar automatiskt eventuella väntande databasmigreringar och startar sedan demonen.

#### reset

```terminal
>tendril reset
>tendril reset --force
```

Tar bort all Tendril-data från datorn — raderar `TENDRIL_HOME` och `TENDRIL_PLANS`. Ber om bekräftelse om inte `--force` anges.

> [!WARNING]
> Detta raderar permanent alla planer, jobb och konfigurationsdata i målkatalogerna.

#### report-bug

```terminal
>tendril report-bug --plan 00042
>tendril report-bug --job 00150 -d "Agent failed to create worktree"
>tendril report-bug --plan 00042 --out ~/Desktop/diagnostics.zip
>tendril report-bug --plan 00042 --submit --yes
```

Samlar in planfiler och alla jobbartefakter — Job Log, Job Prompt, Job Raw Log och Job Eventwire Log från `<TendrilHome>/Jobs/` — till ett zip-arkiv med rensad konfiguration och hälsodiagnostik. När `--submit` och `--yes` anges laddas arkivet upp och ett GitHub-ärende öppnas.

| Alternativ              | Effekt                                                           |
| ----------------------- | ---------------------------------------------------------------- |
| `--plan <id>`           | Inkludera denna planmapp och alla jobb som kördes mot den        |
| `--job <id>`            | Inkludera detta jobbs fyra artefakter plus dess plans sammanhang |
| `-d, --description <t>` | Beskrivning av felet (efterfrågas interaktivt om det utelämnas)  |
| `--out <path>`          | Målsökväg för zip-arkivet                                        |
| `--github-user <name>`  | GitHub-användarnamn för uppföljning av ärendet                   |
| `--submit`              | Ladda upp rapport till GitHub (kräver `--yes`)                   |
| `-y, --yes`             | Hoppa över bekräftelsefrågan                                     |

> [!WARNING]
> Att skicka in en rapport bifogar zip-paketet till ett **offentligt** GitHub-ärende. Hemligheter rensas bort från konfigurationer och jobbloggar, men granska planens innehåll innan du skickar.

#### version

```terminal
>tendril version
```

Skriver ut den installerade Tendril-versionen (t.ex. `tendril v2.0.0`).

#### update-promptwares

```terminal
>tendril update-promptwares
>tendril update-promptwares --dry-run
>tendril update-promptwares --source /path/to/promptwares
```

Uppdaterar distribuerade promptwares i `<TendrilHome>/Promptwares/` och bevarar deras `Memory/`- och `Tools/`-kataloger.

## Nästa steg

- [Plankommandon](01_Plan.md) — fullständig referens för att skapa och hantera planer
- [Projektkommandon](02_Project.md) — konfigurera projekt, arkiv, granskningsåtgärder, MCP-servrar och färdigheter
- [Verifieringskommandon](03_Verification.md) — hantera globala verifieringsdefinitioner
- [Databaskommandon](04_Database.md) — migreringar, schemaversion, integritet och vacuum
- [Övriga kommandon](05_Other.md) — promptware, jobb, chatt, tjänst och verktyg
- [Konfigurationskommandon](06_Config.md) — läs och uppdatera inställningar på toppnivå i `config.yaml`
- [Valvkommandon](07_Vault.md) — anslut teamvalv, synkronisera resurser samt importera eller publicera projekt
