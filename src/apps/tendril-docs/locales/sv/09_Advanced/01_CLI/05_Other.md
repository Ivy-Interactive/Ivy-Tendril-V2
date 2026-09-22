---
title: Övriga kommandon
description: Promptware-exekvering, orkestrering av bakgrundsjobb,
  chattsessioner, registrering av bakgrundstjänster och verktyg.
icon: Wrench
searchHints:
  - promptware
  - minne
  - verktyg
  - jobb
  - chatt
  - tjänst
  - autostart
  - launchd
  - systemd
  - status
  - modeller
  - hash-lösenord
  - generera-certifikat
  - agent-instruktioner
---

# Övriga kommandon

Referens för promptware-exekvering, spårning av bakgrundsjobb, interaktiva chattsessioner, hantering av operativsystemets bakgrundstjänster samt Tendril CLI-verktygskommandon.

## promptware

Tendril använder [promptwares](../../02_Concepts/02_Promptwares.md) för att strukturera agenters exekveringsarbetsflöden. För bakgrundsinformation, se [Promptwares-koncept](../../02_Concepts/02_Promptwares.md).

#### promptware run

```terminal
>tendril promptware run <name> [args...] [options]
```

Kör ett promptware direkt på värddatorn och kringgår serverns jobbkö.

| Alternativ             | Effekt                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `--profile <profile>`  | Åsidosätt agentens resonemangsprofil (`deep`, `balanced`, `quick`)                  |
| `--working-dir <path>` | Arbetskatalog för agentens exekveringsprocess                                       |
| `--value <key=value>`  | Ytterligare firmware-huvudvärden (kan upprepas)                                     |
| `--plan <id>`          | Målplanens ID eller mappsökväg                                                      |
| `--agent <provider>`   | Åsidosätt agentleverantör (`claude`, `antigravity`, `codex`, `copilot`, `opencode`) |
| `--dry-run`            | Skriv ut kompilerad firmware till stdout och avsluta utan att starta en agent       |

#### Memory and Tools

```terminal
>tendril promptware list-memory <name>
>tendril promptware read-memory <name> [files...]
>tendril promptware write-memory <name> <filename> [--file <path>] [--stdin]
>tendril promptware delete-memory <name> <filename>
>tendril promptware write-tool <name> <tool_name> [--file <path>] [--stdin]
```

Agenter använder dessa kommandon för att spara inlärda mönster i ett promptwares `Memory/`-katalog och skapa anpassade verktyg i `Tools/`.

#### Deployment & Layers

```terminal
>tendril promptware deploy
>tendril promptware layers [name]
```

- **deploy** — kompilerar och installerar standard-promptwares i `<TendrilHome>/Promptwares/`.
- **layers** — inspekterar vilket lager (medföljande standard eller team-overlay) som tillhandahöll varje promptware-fil.

## job

Hantera asynkrona bakgrundsagentjobb. Jobb körs genom daemon-kön och rapporterar live-status. För granskning i användargränssnittet, se [Jobs-appen](../../04_Apps/04_Jobs.md).

#### job list

```terminal
>tendril job list
>tendril job list --status Running
>tendril job list --limit 50
>tendril job list --json
```

Listar senaste bakgrundsjobb från Tendril-daemon-servern.

| Alternativ          | Effekt                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `--status <status>` | Filtrera efter status (`Pending`, `Queued`, `Running`, `Completed`, `Failed`, `Timeout`, `Stopped`, `Blocked`) |
| `--limit <n>`       | Maximalt antal resultat (standard: 20)                                                                         |
| `--json`            | Mata ut jobb som strukturerad JSON                                                                             |

#### job start

```terminal
>tendril job start <job-type> [plan-id] [options]
```

Startar ett asynkront bakgrundsjobb på den körande Tendril-daemonen. Jobbtyper som stöds: `CreatePlan`, `ExecutePlan`, `RetryPlan`, `UpdatePlan`, `ExpandPlan`, `SplitPlan`, `CreatePr`, `CreateIssue`, `SetupProject`, `AddProject`, `SyncRepo`.

| Alternativ                | Effekt                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `--priority <number>`     | Prioritetsordning för köhantering (högre körs först)                                                      |
| `--chat-session <id>`     | Associera jobb med en chattsession (standard är `$TENDRIL_CHAT_SESSION_ID`)                               |
| `--wait-for <job-id>`     | Jobb-ID som måste slutföras innan detta jobb kan läggas i kö (kan upprepas)                               |
| `--idempotency-key <key>` | Idempotensnyckel: återinskickade förfrågningar returnerar befintligt jobb istället för att skapa ett nytt |
| `--force`                 | Skicka in igen även om identiskt arbete redan pågår                                                       |
| `--description <text>`    | Uppgiftsbeskrivning (används med `CreatePlan`)                                                            |
| `--project <name>`        | Målprojekt (används med `CreatePlan`)                                                                     |
| `--note <text>`           | Exekveringsanteckning (används med `ExecutePlan`)                                                         |
| `--instructions <text>`   | Förfiningsprompt (används med `UpdatePlan`)                                                               |
| `--change-request <text>` | Granskarfeedback (används med `RetryPlan`)                                                                |
| `--repo <name>`           | Lagringsplats (används med `CreateIssue`)                                                                 |
| `--assignee <user>`       | Tilldelat användarnamn på GitHub (används med `CreateIssue` / `CreatePr`)                                 |
| `--reviewer <user>`       | Granskarens användarnamn på GitHub (används med `CreatePr`, kan upprepas)                                 |
| `--draft`                 | Skapa som ett PR-utkast (används med `CreatePr`)                                                          |

```terminal
>tendril job start ExecutePlan 00042
>tendril job start RetryPlan 00042 --change-request "Fix failing unit tests"
>tendril job start CreatePlan --description "Add dark mode toggle" --project MyProject
```

#### job status and fail

```terminal
>tendril job status <job-id> --message <text> [--plan-id <id>] [--plan-title <title>]
>tendril job fail <job-id> --message <text>
```

Rapporterar framstegstelemetri eller jobbfel direkt till daemonen. Används internt av promptware-skript under exekvering.

#### job cancel and delete

```terminal
>tendril job cancel <job-id> [--message <reason>]
>tendril job delete <job-id>
```

- **cancel** — signalerar till ett körande jobb att det ska avbrytas.
- **delete** — tar bort en jobbpost från databasen (loggfiler på disken bevaras).

#### job add-log

```terminal
>tendril job add-log <job-id> <action> [--summary <text>]
```

Lägger till en `## Agent Log`-berättelsepost direkt i jobbets loggfil i `<TendrilHome>/Jobs/`. Fungerar direkt mot filsystemet och kräver inte att server-daemonen är nåbar.

#### Queue and Maintenance

```terminal
>tendril job queue [--json]
>tendril job force-start <job-id>
>tendril job stop-all
>tendril job clear [--completed] [--failed] [--all] [-y/--yes]
>tendril job maintenance
```

- **queue** — skriver ut väntande jobb i turordning
- **force-start** — kringgår samtidighet och beroendespärrar för att schemalägga ett jobb omedelbart
- **stop-all** — avbryter alla aktiva jobb och jobb i kö
- **clear** — massraderar slutförda eller misslyckade jobb
- **maintenance** — kör en jobbrensning och synkroniseringsgenomgång omedelbart

## chat

Styr interaktiva kodningssessioner med agenter från din terminal:

```terminal
>tendril chat list [--json]
>tendril chat get <session-id> [--json]
>tendril chat create [--agent <agent>] [--model <model>] [--title <title>] [--effort <level>] [--plan <folder>] [--json]
>tendril chat send <session-id> "<message>" [--agent <agent>] [--model <model>] [--effort <effort>]
>tendril chat delete <session-id>
```

`tendril chat send` ansluter till daemonen, skickar promptomgången och strömmar tokensvar och verktygsanrop i realtid direkt till stdout.

## service

Hantera Tendrils bakgrundsdaemon-autostarttjänst över olika plattformar:

- **macOS** — registrerar en [launchd](https://en.wikipedia.org/wiki/Launchd)-agent på `~/Library/LaunchAgents/io.tendril.daemon.plist`
- **Linux** — registrerar en [systemd](https://systemd.io)-användartjänstenhet
- **Windows** — registrerar en schemalagd aktivitet med [Task Scheduler](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-start-page)

```terminal
>tendril service install [--no-start] [--force]
>tendril service status [--json]
>tendril service uninstall [--purge-binaries] [--force]
```

- **install** — registrerar den körande binären som bakgrundstjänst. Använd `--no-start` för att registrera för nästa inloggning utan att starta omedelbart.
- **status** — rapporterar om tjänsten är registrerad, laddad och körs (inklusive URL och PID).
- **uninstall** — avregistrerar autostartkonfigurationen. Använd `--purge-binaries` för att ta bort sidoapplikationer installerade i `<home>/bin`.

## Utilities

#### models

```terminal
>tendril models
>tendril models --refresh
```

Listar LLM-modeller som stöds, leverantörstillhörigheter, gränser för kontextfönster och live-priser. Använd `--refresh` för att hämta uppdaterade priser från modellregistret.

#### generate-certs

```terminal
>tendril generate-certs <output-directory>
```

Genererar ett självsignerat `localhost.crt`- och `localhost.key`-PEM-par för att tillhandahålla HTTPS med `tendril serve --tls-cert <path> --tls-key <path>`.

#### hash-password

```terminal
>tendril hash-password <password> [secret]
```

Hashar ett lösenord med [Argon2](https://en.wikipedia.org/wiki/Argon2) för användning i `config.yaml` under sektionen `auth:`. Skriver ut den kodade hashsträngen och peppar-hemligheten.

#### project-analyzer

```terminal
>tendril project-analyzer <folder-path>
```

Inspekterar en katalog och skriver ut en komprimerad YAML-stackanalys som identifierar språkkörtider, pakethanterare och testramverk.

#### agent-instructions

```terminal
>tendril agent-instructions
```

Kompilerar och skriver ut den kompletta systemsysslemallen för agenter med installationssökvägar ersatta, formaterad för att skickas vidare till en autonom agentprompt.

#### wireframe

```terminal
>tendril wireframe setup [path] [--tailwind superset|jit] [--force] [--quiet]
>tendril wireframe serve [path] [--port <port>] [--host <host>] [--no-open]
>tendril wireframe screenshot [path] [--out <path>] [--width <w>] [--height <h>]
>tendril wireframe agent-readme [path]
```

Bygger upp mallstrukturer, driftar, förhandsgranskar med direktladdning (hot reload) och tar skärmdumpar av React-wireframes skapade under planframtagning.
