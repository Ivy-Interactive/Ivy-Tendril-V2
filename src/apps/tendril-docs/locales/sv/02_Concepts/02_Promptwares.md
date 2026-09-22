---
title: Promptwares
description: >-
  Promptwares är arbetsflödesagenter med ett enda syfte bakom varje plansteg — var och en med sin egen prompt,
  sina verktyg och sitt långtidsminne.
icon: Terminal
searchHints:
  - promptware
  - agent
  - prompt
  - verktyg
  - minne
  - allowedTools
  - profil
  - customInstructions
  - lager
---

# Promptwares

Ett promptware är en katalog som innehåller instruktioner, verktyg och minne som definierar en arbetsflödesagent
med ett specifikt syfte. Driftsatta kopior finns under `$TENDRIL_HOME/Promptwares/`, en mapp per promptware:

- **Program.md** — systemprompten: agentens mål, steg-för-steg-procedur och exekveringsregler.
- **Tools/** — körbara skript och verktyg som agenten kan anropa under körningen.
- **Memory/** — beständiga Markdown-anteckningar som överlever mellan körningar. Denna återkopplingsloop gör det
  möjligt för promptwares att lära sig kodbasens egenheter och förbättras istället för att upprepa fel.

Tendril kör promptwares via din konfigurerade kodningsagent (såsom
[Claude Code](../06_CodingAgents/01_ClaudeCode.md), [Codex](../06_CodingAgents/02_Codex.md),
[Copilot](../06_CodingAgents/03_Copilot.md), [Gemini](../06_CodingAgents/05_Gemini.md),
[OpenCode](../06_CodingAgents/04_OpenCode.md), Antigravity eller [Cursor](https://www.cursor.com)), och exekverar
ett jobb i taget med minsta möjliga verktygsbehörighet (least-privilege).

## Driftsättning & lager

Tendril levereras med en standarduppsättning promptwares inbyggda i plattformen. Team kan också konfigurera en
överlagringskatalog (overlay) i [config.yaml](../03_Configuration/01_Setup.md) för att åsidosätta systemprompter eller
tillhandahålla anpassade teamverktyg.

Driftsätt eller uppdatera promptwares:

```bash
tendril promptware deploy
```

För att inspektera om ett promptware körs från grundversionen eller en teamöverlagring:

```bash
tendril promptware layers
# eller kontrollera ett specifikt promptware:
tendril promptware layers ExecutePlan
```

## Centrala arbetsflödesagenter

| Promptware       | Roll                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| **CreatePlan**   | Utforma en plan från en kort beskrivning, ett inkorgsärende eller ett [GitHub](https://github.com)-ärende. |
| **ExpandPlan**   | Utöka en övergripande plan till en implementerbar specifikation med faser.                                 |
| **UpdatePlan**   | Revidera en befintlig plan utifrån granskarfeedback, chatt och infogade annoteringar.                      |
| **SplitPlan**    | Dela upp en stor plan i mindre, oberoende delplaner.                                                       |
| **ExecutePlan**  | Skapa isolerade [git-worktrees](https://git-scm.com/docs/git-worktree), implementera faser och kör tester. |
| **RetryPlan**    | Gör ett nytt försök på en plan som misslyckades vid verifiering med hjälp av loggar och differenser.       |
| **CreatePr**     | Öppna en GitHub pull request från worktree-differenser via [GitHub CLI](https://cli.github.com/) (`gh`).   |
| **CreateIssue**  | Skapa ett GitHub-ärende vid planfel, tillståndsändring eller triageringsförfrågan.                         |
| **AddProject**   | Registrera ett nytt projekt och konfigurera dess arkivsökvägar.                                            |
| **SetupProject** | Ta reda på och dokumentera hur ett projekt byggs, körs och verifieras.                                     |
| **SyncRepo**     | Uppdatera ett projekts arkiv mot uppströmsgrenar (upstream).                                               |

## Konfiguration

Varje promptware konfigureras i [~/.tendril/config.yaml](../03_Configuration/01_Setup.md) under nyckeln
`promptwares:`:

```yaml
promptwares:
  _default:
    profile: balanced

  CreatePlan:
    profile: deep
    allowedTools:
      - Read
      - Glob
      - Grep
      - Bash
      - Write(%PLANS_DIR%/**)
    deniedTools:
      - WebFetch
    customInstructions: |
      Always include acceptance criteria and verification gates in the plan.
```

| Fält                 | Krävs | Beskrivning                                                                                                                                                  |
| -------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `profile`            | Ja    | Vilken agentprofil som ska användas — `quick`, `balanced` eller `deep`. Profiler mappar till en modell och en ansträngningsnivå per agent.                   |
| `allowedTools`       | Nej   | Verktyg som beviljas utöver standardverktygen. Stöder variablerna `%PROMPTWARE_DIR%`, `%PLAN_DIR%` och `%PLANS_DIR%` för att avgränsa verktyg till sökvägar. |
| `deniedTools`        | Nej   | Verktyg som nekas, även om något annat skulle ha beviljat dem.                                                                                               |
| `customInstructions` | Nej   | Fritext som injiceras i agentens prompt med prioriterade åsidosättningsmarkörer.                                                                             |

Posten `_default` är en baslinje som tillämpas på varje promptware; en namngiven post åsidosätter den.

### Anpassade instruktioner (Custom instructions)

När `customInstructions` anges lägger Tendril till detta i den kompilerade firmware-prompten med en explicit
prioritetsmarkör. Agenten instrueras att följa detta före både firmware-mallen och promptwarets egen `Program.md`.
Använd detta för beteendeändringar per promptware utan att redigera delade programfiler.

## Exekveringsflöde

1. **Kontext** — kompilera `Program.md`, bifoga planen, infogade annoteringar, projektkonfiguration och
   eventuella `customInstructions` från `config.yaml`.
2. **Verktyg & behörigheter** — exponera `Tools/` och konfigurerade verktygsbehörigheter, där `%...%`-variabler
   expanderas till absoluta sökvägar. Skrivbara kataloger är strikt avgränsade till planmappen, promptwarets
   `Memory/` och arkivens git-worktrees.
3. **Körning** — starta kodningsagenten som en bakgrundsjobbprocess i dess isolerade worktree.
4. **Insamling & telemetri** — strömma utdata live till `$TENDRIL_HOME/Jobs/{jobId}-{planId}-{promptware}/`,
   rapportera framsteg till daemonen samt registrera tokenanvändning och kostnad i planens `costs.csv`.

## Minne & inlärning

Minnet utgör återkopplingsloopen: ett promptware antecknar vad det lärt sig om ett projekt eller ett felmönster,
och läser tillbaka detta vid framtida körningar. CLI:et exponerar minneshantering direkt:

```bash
# Lista lagrade minnesanteckningar för ett promptware
tendril promptware list-memory ExecutePlan

# Läs specifika minnesanteckningar
tendril promptware read-memory ExecutePlan worktree-hygiene.md

# Skriv eller uppdatera en minnesanteckning från en fil (eller stdin)
tendril promptware write-memory ExecutePlan worktree-hygiene.md --file notes.md

# Radera en förlegad eller felaktig minnesanteckning
tendril promptware delete-memory ExecutePlan worktree-hygiene.md
```

> [!TIP]
> Minnet är tänkt att rensas såväl som att byggas upp — ett antagande eller en regel som blivit inaktuell bör
> raderas med `delete-memory`, inte begravas under motstridiga anteckningar.

## Direkt exekvering

För att testa eller köra ett promptware direkt i förgrunden och kringgå daemonens jobbtjänst:

```bash
# Kör CreatePlan direkt med en uppgiftsprompt
tendril promptware run CreatePlan "Add a health-check endpoint" --profile deep

# Skriv ut den kompilerade firmware-prompten utan att starta agenten
tendril promptware run CreatePlan "Add a health-check endpoint" --dry-run
```

## Nästa steg

- [Livscykel & Jobb](03_Lifecycle.md) — hur en promptware-körning ser ut medan den pågår.
- [Planer](01_Plans.md) — artefakten som varje promptware läser och skriver till.
