---
title: config
description: Hämta och ställ in toppnivåinställningar för Tendril lagrade i
  config.yaml direkt från kommandoraden.
icon: Settings
searchHints:
  - config
  - konfiguration
  - inställningar
  - jobTimeout
  - codingAgent
  - planTemplate
  - gitTimeout
  - daemonRequestTimeout
  - llm
---

# config

Hämta och ställ in toppnivåinställningar för Tendril lagrade i [YAML](https://yaml.org)-format inuti `config.yaml` — samma globala värden som hanteras under Inställningar i skrivbords- och webbgränssnitten. Se [Installationsguiden](../../03_Configuration/01_Setup.md) för mer information om miljö- och kataloglayout.

## Kommandon

```terminal
>tendril config get <key>
>tendril config set <key> <value>
```

- **`get`** — Skriver ut råvärdet till standard output utan dekorativ formatering, vilket gör det idealiskt för skalskript och för att skicka direkt till filer eller andra verktyg.
- **`set`** — Validerar och uppdaterar värdet i `config.yaml`. Nycklar är skiftlägesokänsliga.

## Primitiva nycklar

Tendril modellerar flera primitiva konfigurationsnycklar med typvalidering:

| Nyckel                         | Typ                                 | Standard           | Beskrivning                                                                                                                                             |
| ------------------------------ | ----------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codingAgent`                  | string                              | `claude`           | Standardmässig körbar fil eller alias för kodningsagent (t.ex. `claude`, `aider`, `codestory`).                                                         |
| `jobTimeout`                   | integer (minuter)                   | `120`              | Maximal timeout för körning av ett aktivt planjobb.                                                                                                     |
| `staleOutputTimeout`           | integer (minuter)                   | `10`               | Inaktivitetstid innan ett jobb utan utdata flaggas som avstannat.                                                                                       |
| `gitTimeout`                   | integer (minuter)                   | `5`                | Kommandotimeout för [Git](https://git-scm.com)-operationer.                                                                                             |
| `daemonRequestTimeout`         | integer (sekunder)                  | `30`               | Timeout i sekunder för HTTP-förfrågningar till den lokala Tendril-demonen (`0` eller negativt inaktiverar).                                             |
| `maxConcurrentJobs`            | integer                             | `2`                | Maximalt antal tillåtna samtidiga körningsjobb.                                                                                                         |
| `planTemplate`                 | string                              | `""`               | [Markdown](https://daringfireball.net/projects/markdown/)-mall som infogas i början när nya planer skapas.                                              |
| `planFolder`                   | string (valfri)                     | `None`             | Anpassad filsystemkatalog där plan-markdownfiler lagras. Skicka `""` för att avmarkera.                                                                 |
| `promptwareOverlay`            | string (valfri)                     | `None`             | Sökväg till en overlay-katalog som innehåller anpassade promptwares. Skicka `""` för att avmarkera.                                                     |
| `telemetry`                    | boolean (valfri)                    | `None`             | Växel för anonym telemetri (`true` eller `false`). Skicka `""` för att rensa.                                                                           |
| `beta`                         | boolean                             | `false`            | Aktiverar experimentella förhandsgranskningsfunktioner (`true` eller `false`).                                                                          |
| `desktopNotifications`         | boolean                             | `true`             | Aktiverar skrivbordsaviseringar i systemet för planstatus och slutförda agentkörningar (`true` eller `false`).                                          |
| `theme`                        | string                              | `default`          | ID för färgförval i användargränssnittet (t.ex. `default`, `dracula`).                                                                                  |
| `worktreeReaperInterval`       | integer (minuter)                   | `60`               | Frekvens för automatiserade [Git](https://git-scm.com)-worktree-rensningspass (`0` eller negativt inaktiverar).                                         |
| `worktreeReaperGrace`          | integer (minuter)                   | `1440`             | Inaktiv respitperiod i minuter innan ett inaktivt worktree anses kvalificerat för rensning.                                                             |
| `worktreeBranchDeleteMode`     | string                              | `PreserveUnpushed` | Säkerhetsläge för borttagning av grenar vid worktree-rensning (`PreserveUnpushed` eller `Force`).                                                       |
| `coAuthor`                     | string (valfri)                     | `None`             | [Git](https://git-scm.com)-trailer-attributionsidentitet i formatet `Name <email>` som läggs till i automatiska commits. Skicka `""` för att avmarkera. |
| `enrichModels`                 | boolean                             | `true`             | Aktiverar automatisk identifiering och berikning av modeller i bakgrunden (`true` eller `false`).                                                       |
| `modelEnrichmentIntervalHours` | integer (timmar)                    | `24`               | Uppdateringsintervall i bakgrunden för modellmetadata.                                                                                                  |
| `modelCacheWarnAgeDays`        | integer (dagar)                     | `7`                | Mjuk åldersgräns innan inaktuell modellcache genererar varningar.                                                                                       |
| `modelCacheMaxAgeDays`         | integer (dagar)                     | `30`               | Hård åldersgräns efter vilken cachad modellmetadata upphör att gälla.                                                                                   |
| `llm`                          | [JSON](https://www.json.org)-objekt | `None`             | Slutpunkt, API-nyckel och modellkonfiguration för den kompletterande LLM-tjänsten. Slås samman med befintliga fält.                                     |

> [!NOTE]
> Omodellerade skalära nycklar kan också lagras och hämtas; de lagras i en extra attributtabell i `config.yaml`.

## Strukturerade nycklar

Tendril-inställningar innehåller också strukturerade listor och tabeller som inte kan ställas in eller hämtas via `tendril config`:

- `projects` — Konfigurerade projektdefinitioner (hanteras med [`tendril project`](02_Project.md)).
- `verifications` — Globala verifieringssvitdefinitioner (hanteras med [`tendril verification`](03_Verification.md)).
- `levels` — Plankomplexitetsnivåer och verifieringsbindningar.
- `onboarding` — Slutförandestatus för förstagångsguiden.
- `codingAgents` — Binärsökvägar, argument, miljövariabler och profiler per agent.
- `promptwares` — Instruktioner, profiler och verktygsregler per promptware.
- `inbox` — Regler för inkommande aviseringar och leveransintegrationer.

Att försöka köra `tendril config get` eller `tendril config set` på en strukturerad nyckel skriver ut ett felmeddelande som hänvisar dig till det dedikerade CLI-kommandot eller till att redigera `config.yaml` direkt.

## Exempel

```terminal
># Läs ett konfigurationsvärde
>tendril config get jobTimeout

># Uppdatera en numerisk inställning eller textinställning
>tendril config set jobTimeout 60
>tendril config set codingAgent claude

># Växla booleska alternativ
>tendril config set desktopNotifications false
>tendril config set beta true

># Slå samman konfiguration för kompletterande LLM
>tendril config set llm '{"model":"gpt-4o"}'

># Rensa en valfri inställning genom att skicka en tom sträng
>tendril config set coAuthor ""
>tendril config set planFolder ""

># Ange en flerraders planmall med hjälp av kommandosubstitution i skalet
>tendril config set planTemplate "$(cat template.md)"

># Exportera planmallen tillbaka ut till en fil
>tendril config get planTemplate > template.md
```

> [!TIP]
> När du tilldelar flerraderstext som `planTemplate` eller [JSON](https://www.json.org)-objekt som `llm`, använd citattecken i skalet eller kommandosubstitution (`"$(cat file.md)"`) för att säkerställa att värden skickas rent som ett enda argument.
