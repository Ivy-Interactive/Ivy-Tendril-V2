---
title: MCP-server
description: Tendril inkluderar en Model Context Protocol (MCP)-server som
  exponerar planhanteringsverktyg för AI-kodningsagenter som Claude Code.
icon: Bot
searchHints:
  - mcp
  - model context protocol
  - claude
  - verktyg
  - tendril_get_plan
  - tendril_list_plans
  - tendril_start_job
  - tendril_inbox
  - tendril_get_config
---

# MCP-server

Tendril inkluderar en Model Context Protocol (MCP)-server som exponerar verktyg för planhantering, jobborkestrering och projektidentifiering för AI-kodningsagenter som Claude Code.

## Starta MCP-servern

```bash
tendril mcp
```

Detta startar MCP-servern via stdio-transport, lämplig för användning i Claude Codes MCP-konfiguration. Standard input och output är strikt reserverade för JSON-RPC-meddelanden; diagnostikloggar styrs till stderr.

## Autentisering

Ställ in miljövariabeln `TENDRIL_MCP_TOKEN` för att kräva tokenautentisering för MCP-sessioner:

- **Miljövariabler**: Klienter som ansluter över stdio kan tillhandahålla matchande token via `TENDRIL_MCP_CLIENT_TOKEN` (eller `TENDRIL_MCP_TOKEN`).
- **Begäransmetadata**: Klienter kan också skicka med token per anrop i `initialize`-parametrarna under `_meta["io.tendril/token"]`.

När `TENDRIL_MCP_TOKEN` inte är inställd eller är tom är autentisering inaktiverad och lokala förfrågningar tillåts.

## Tillgängliga verktyg

Alla verktyg har prefixet `tendril_` och körs direkt mot demonen eller lokal Tendril-lagring.

### Granskning och sökning av planer

| Verktyg                          | Parametrar                                                       | Beskrivning                                                                                                                                                                                                     |
| -------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tendril_get_plan`               | `plan_id` (obligatorisk), `field` (valfri)                       | Hämta en plans metadata och senaste revision. När `field` anges returneras endast det fältet (t.ex. `title`, `state`, `project`, `level`, `repos`, `commits`, `prs`, `verifications`, `dependsOn`, `revision`). |
| `tendril_list_plans`             | `state` (valfri), `project` (valfri), `search`, `since`, `limit` | Lista planer som matchar filter. `since` accepterar en RFC 3339-tidsstämpel; `search` filtrerar på titel eller ID.                                                                                              |
| `tendril_get_revision`           | `plan_id` (obligatorisk), `number` (valfri)                      | Hämta markdown-texten för en planrevision (den senaste som standard, eller ett specifikt revisionsnummer).                                                                                                      |
| `tendril_plan_validate`          | `plan_id` (obligatorisk)                                         | Kontrollera planens hälsostatus och rapportera eventuella strukturella fel eller schemaproblem.                                                                                                                 |
| `tendril_plan_verification_list` | `plan_id` (obligatorisk)                                         | Lista alla verifieringar och deras nuvarande status (`Pending`, `Pass`, `Fail`, `Skipped`) för en plan.                                                                                                         |
| `tendril_plan_rec_list`          | `plan_id` (obligatorisk), `state` (valfri)                       | Lista rekommendationer för en plan. Filtrera på status: `Pending`, `Accepted`, `AcceptedWithNotes`, `Declined`.                                                                                                 |

### Skapande och redigering av planer

| Verktyg                            | Parametrar                                                                                                                      | Beskrivning                                                                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tendril_plan_create`              | `title` (obligatorisk), `project` (obligatorisk), `level`, `initial_prompt`, `source_url`, `execution_profile`, `priority`, ... | Skapa en ny plan. Verifieringsspärrar initieras automatiskt från projektkonfigurationen.                                                                                                                        |
| `tendril_plan_write_revision`      | `plan_id` (obligatorisk), `content` (obligatorisk), `reason` (valfri)                                                           | Skriv en ny numrerad markdown-revision. Frågeblock valideras mot schemat.                                                                                                                                       |
| `tendril_plan_set`                 | `plan_id` (obligatorisk), `field` (obligatorisk), `value` (obligatorisk)                                                        | Uppdatera ett skalärt fält (`state`, `title`, `level`, `project`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`). Statusändringar kräver godkända verifieringsspärrar innan `Completed` tillåts. |
| `tendril_plan_set_verification`    | `plan_id` (obligatorisk), `name` (obligatorisk), `status` (obligatorisk)                                                        | Ställ in status för en verifieringsspärr (`Pending`, `Pass`, `Fail`, `Skipped`).                                                                                                                                |
| `tendril_plan_verification_remove` | `plan_id` (obligatorisk), `name` (obligatorisk)                                                                                 | Ta bort en verifieringsspärr från en plan.                                                                                                                                                                      |
| `tendril_plan_add_repo`            | `plan_id` (obligatorisk), `path` (obligatorisk)                                                                                 | Associera en lagringsplats-sökväg (repository path) med en plan.                                                                                                                                                |
| `tendril_plan_remove_repo`         | `plan_id` (obligatorisk), `path` (obligatorisk)                                                                                 | Ta bort associationen mellan en lagringsplats-sökväg och en plan.                                                                                                                                               |
| `tendril_plan_add_pr`              | `plan_id` (obligatorisk), `url` (obligatorisk)                                                                                  | Registrera en pull request-URL på en plan.                                                                                                                                                                      |
| `tendril_plan_add_commit`          | `plan_id` (obligatorisk), `sha` (obligatorisk)                                                                                  | Registrera en commit-SHA på en plan.                                                                                                                                                                            |
| `tendril_plan_add_depends_on`      | `plan_id` (obligatorisk), `folder` (obligatorisk)                                                                               | Lägg till ett blockerande planberoende. Den beroende planen körs inte förrän målplanen når `Completed` och dess PR:er har sammanfogats (merge).                                                                 |
| `tendril_plan_remove_depends_on`   | `plan_id` (obligatorisk), `folder` (obligatorisk)                                                                               | Ta bort ett blockerande planberoende.                                                                                                                                                                           |
| `tendril_plan_add_related_plan`    | `plan_id` (obligatorisk), `folder` (obligatorisk)                                                                               | Länka en relaterad plan för kontextuell referens.                                                                                                                                                               |
| `tendril_plan_remove_related_plan` | `plan_id` (obligatorisk), `folder` (obligatorisk)                                                                               | Ta bort länken till en relaterad plan.                                                                                                                                                                          |

### Rekommendationer

| Verktyg                    | Parametrar                                                                                        | Beskrivning                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `tendril_plan_rec_add`     | `plan_id` (obligatorisk), `title` (obligatorisk), `description` (obligatorisk), `impact` (valfri) | Lägg till en ny rekommendation med påverkansgrad (`Small`, `Medium`, `High`). |
| `tendril_plan_rec_accept`  | `plan_id` (obligatorisk), `title` (obligatorisk)                                                  | Acceptera en rekommendation.                                                  |
| `tendril_plan_rec_decline` | `plan_id` (obligatorisk), `title` (obligatorisk), `reason` (valfri)                               | Avböj en rekommendation med en valfri motivering.                             |
| `tendril_plan_rec_remove`  | `plan_id` (obligatorisk), `title` (obligatorisk)                                                  | Ta bort en rekommendation från planen.                                        |

### Jobb och inkorg

| Verktyg               | Parametrar                                                                              | Beskrivning                                                                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tendril_inbox`       | `description` (obligatorisk), `project` (valfri), `source_path` (valfri)                | Skicka en ny uppgiftsbeskrivning till Tendrils inkorg, vilket automatiskt startar ett `CreatePlan`-jobb.                                                                                                 |
| `tendril_start_job`   | `job_type` (obligatorisk), `plan_id`, `description`, `project`, `note`, `priority`, ... | Starta ett bakgrundsjobb på den aktiva demonen (`CreatePlan`, `ExecutePlan`, `RetryPlan`, `UpdatePlan`, `ExpandPlan`, `SplitPlan`, `CreatePr`, `CreateIssue`, `SetupProject`, `SyncRepo`, `AddProject`). |
| `tendril_list_jobs`   | `status` (valfri), `limit` (valfri)                                                     | Lista senaste bakgrundsjobb från demonen.                                                                                                                                                                |
| `tendril_get_job`     | `job_id` (obligatorisk)                                                                 | Hämta status, tidsåtgång, tokenantal och kostnadsinformation för ett specifikt jobb.                                                                                                                     |
| `tendril_cancel_job`  | `job_id` (obligatorisk), `message` (valfri)                                             | Avbryt ett pågående bakgrundsjobb.                                                                                                                                                                       |
| `tendril_job_add_log` | `job_id` (obligatorisk), `action` (obligatorisk), `summary` (valfri)                    | Lägg till en loggpost i `<TendrilHome>/Jobs/`. Fungerar offline även om demonen är stoppad.                                                                                                              |

### Konfiguration och identifiering

| Verktyg                      | Parametrar      | Beskrivning                                                                                                               |
| ---------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `tendril_get_config`         | `key` (valfri)  | Läs offentliga konfigurationsvärden (t.ex. `codingAgent`, `jobTimeout`, `planTemplate`). Känsliga uppgifter är maskerade. |
| `tendril_list_projects`      | —               | Lista alla konfigurerade projekt med deras lagringsplatssökvägar, verifieringar och inställningar.                        |
| `tendril_list_verifications` | `name` (valfri) | Lista globala definitioner för verifieringskontroller, eller inspektera en via namn.                                      |

> [!NOTE]
> Konfiguration är skrivskyddad över MCP: för att ändra systemövergripande inställningar som `planFolder` eller `codingAgent` krävs CLI (`tendril config set`) eller Tendril-gränssnittet.

## Claude Code-konfiguration

Lägg till Tendrils MCP-server i dina Claude Code-inställningar (`~/.claude/settings.json` eller `.claude/settings.json` på projektnivå):

```json
{
  "mcpServers": {
    "tendril": {
      "command": "tendril",
      "args": ["mcp"]
    }
  }
}
```

Med tokenautentisering aktiverad:

```json
{
  "mcpServers": {
    "tendril": {
      "command": "tendril",
      "args": ["mcp"],
      "env": {
        "TENDRIL_MCP_CLIENT_TOKEN": "your-secret-token"
      }
    }
  }
}
```
