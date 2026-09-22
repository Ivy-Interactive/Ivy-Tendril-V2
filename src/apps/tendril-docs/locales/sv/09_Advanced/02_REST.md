---
title: REST-API
description: Tendril exponerar ett HTTP- och WebSocket-API för programmatisk
  hantering av planer och jobb på din Tendril-serveradress (standardport 5010).
icon: Server
searchHints:
  - api
  - rest
  - http
  - slutpunkt
  - planer
  - jobb
  - inkorg
  - autentisering
  - bearer
  - X-Api-Key
  - websocket
  - händelser
---

# REST-API

Tendril exponerar ett HTTP REST-API och WebSocket-gränssnitt för programmatisk hantering av planer och jobb. Som standard lyssnar API-servern på `http://127.0.0.1:5010` (eller `http://localhost:5010`). HTTPS-servering aktiveras när `tendril serve` startas med `--tls-cert` och `--tls-key`.

## Autentisering

Tendril skyddar API-slutpunkter med bearer-uppgifter, valfria API-nycklar eller grundläggande lösenordsautentisering:

### Daemon Bearer-hemlighet

När daemonen startar genererar den en kryptografiskt säker 32-byte bearer-hemlighet och skriver den till `<home>/.master`. Skyddade API-rutter kräver denna hemlighet i antingen `Authorization`- eller `X-Api-Key`-headern:

```bash
# Using Authorization header
curl -H "Authorization: Bearer <secret>" http://127.0.0.1:5010/api/plans

# Using X-Api-Key header
curl -H "X-Api-Key: <secret>" http://127.0.0.1:5010/api/plans
```

För WebSocket-anslutningar vid `/api/ws`, skicka hemligheten i frågesträngen:

```text
ws://127.0.0.1:5010/api/ws?token=<secret>
```

### Konfigurerad API-nyckel

När `api.apiKey` är konfigurerad i `config.yaml` måste förfrågningar även uppfylla kravet på API-nyckel genom att skicka `X-Api-Key: <configured-key>`:

```yaml
# config.yaml
api:
  apiKey: "your-secret-key"
```

```bash
curl -H "Authorization: Bearer <daemon-secret>" \
     -H "X-Api-Key: your-secret-key" \
     http://127.0.0.1:5010/api/plans
```

### Lösenordsautentisering

När `auth:` är konfigurerat i `config.yaml` kan anropare autentisera med `Authorization: Basic <base64(user:password)>` eller genom att hämta en signerad JWT-sessionstoken från `POST /api/auth/login`. Sessionstokens är giltiga i 15 minuter och accepteras via `Authorization: Bearer <session-token>`.

### Oautentiserade slutpunkter

Följande kontrollslutpunkter kräver inte autentisering:

- `GET /api/health` — primär hälsokontroll som returnerar PID, version, API-version och lista över kapaciteter
- `GET /api/jobs/health` — alias för hälsokontrollen
- `GET /api/ping` — ping/pong-beredskapskontroll som returnerar `{"ping": "pong"}`
- `POST /api/auth/login` — slutpunkt för lösenordsautentisering

## Planer

### Lista planer

```http
GET /api/plans?state=Draft&project=MyProject&limit=50
```

| Parameter | Typ    | Beskrivning                                                                                                                               |
| --------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `status`  | string | Filtrera efter planstatus (`Draft`, `Creating`, `Updating`, `Executing`, `Completed`, `Failed`, `Review`, `Skipped`, `Icebox`, `Blocked`) |
| `state`   | string | Alias för `status`                                                                                                                        |
| `project` | string | Filtrera efter projektnamn                                                                                                                |
| `level`   | string | Filtrera efter nivå (t.ex. `Feature`, `Bug`)                                                                                              |
| `q`       | string | Textsökfilter över planens titel och innehåll                                                                                             |
| `limit`   | int    | Maximalt antal resultat (obegränsat som standard)                                                                                         |

### Skapa plan

```http
POST /api/plans
Content-Type: application/json

{
  "title": "Fix login validation bug",
  "project": "MyProject",
  "level": "Bug",
  "initialPrompt": "Fix the issue where empty passwords crash the auth handler",
  "priority": 10
}
```

### Hämta plan

```http
GET /api/plans/{planId}
GET /api/plans/{planId}?field=state
```

Returnerar hela planposten, eller en enskild fältsträng när `?field=` anges. Fält som stöds: `id`, `title`, `state`, `project`, `level`, `created`, `updated`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`, `partialDelivery`, `repos`, `prs`, `commits`, `verifications`, `dependsOn`, `relatedPlans`, `recommendations`.

### Uppdatera fält

```http
PUT /api/plans/{planId}
Content-Type: application/json

{
  "field": "state",
  "value": "Executing"
}
```

Fält som stöds: `state`, `title`, `level`, `project`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`.

Att sätta `state` till `Completed` returnerar `400` så länge någon av planens verifieringar befinner sig i tillståndet `Fail`. Lägg till `"allowFailedVerifications": true` för att registrera det ändå; planen flaggas då med `partialDelivery: true`.

### Ta bort plan

```http
DELETE /api/plans/{planId}
```

### Kodförråd

```http
POST /api/plans/{planId}/repos
DELETE /api/plans/{planId}/repos
Content-Type: application/json

{
  "repoPath": "/path/to/repo"
}
```

### Pull requests & commits

```http
POST /api/plans/{planId}/prs
Content-Type: application/json

{
  "prUrl": "https://github.com/org/repo/pull/42"
}
```

```http
POST /api/plans/{planId}/commits
Content-Type: application/json

{
  "sha": "abc1234def5678"
}
```

### Beroenden & relaterade planer

```http
POST /api/plans/{planId}/depends-on
DELETE /api/plans/{planId}/depends-on
Content-Type: application/json

{
  "dependsOn": "00041-setup-database"
}
```

```http
POST /api/plans/{planId}/related-plans
DELETE /api/plans/{planId}/related-plans
Content-Type: application/json

{
  "relatedPlan": "00039-refactor-auth"
}
```

### Planverifieringar

```http
GET /api/plans/{planId}/verifications
POST /api/plans/{planId}/verifications
Content-Type: application/json

{
  "name": "CargoTest",
  "status": "Pending"
}
```

```http
PUT /api/plans/{planId}/verifications/{name}
Content-Type: application/json

{
  "status": "Pass"
}
```

```http
DELETE /api/plans/{planId}/verifications/{name}
```

Giltiga verifieringsstatusar: `Pending`, `Pass`, `Fail`, `Skipped`.

### Revisioner & validering

```http
GET /api/plans/{planId}/revisions
POST /api/plans/{planId}/revisions
PUT /api/plans/{planId}/revisions/latest
POST /api/plans/{planId}/validate
```

## Rekommendationer

### Lista rekommendationer

```http
GET /api/plans/{planId}/recommendations
GET /api/plans/{planId}/recommendations?state=Pending
GET /api/recommendations
```

Filtertillstånd: `Pending`, `Accepted`, `AcceptedWithNotes`, `Declined`. `GET /api/recommendations` gör en sökning över alla planer.

### Lägg till rekommendation

```http
POST /api/plans/{planId}/recommendations
Content-Type: application/json

{
  "title": "Add integration test",
  "description": "Coverage is missing for the password reset route",
  "impact": "Medium"
}
```

Effektnivåer: `Small`, `Medium`, `High`.

### Acceptera / avvisa rekommendation

```http
PUT /api/plans/{planId}/recommendations/{title}/accept
Content-Type: application/json

{
  "notes": "Covered via end-to-end suite"
}
```

```http
PUT /api/plans/{planId}/recommendations/{title}/decline
Content-Type: application/json

{
  "reason": "Scope intentionally deferred to next milestone"
}
```

### Ta bort rekommendation

```http
DELETE /api/plans/{planId}/recommendations/{title}
```

## Inkorg

### Skicka in planuppgift

```http
POST /api/inbox
Content-Type: application/json

{
  "description": "Fix login validation bug",
  "project": "MyProject",
  "sourcePath": "/path/to/source",
  "force": false
}
```

Startar ett `CreatePlan`-bakgrundsjobb och returnerar:

```json
{
  "jobId": "00143",
  "status": "Started",
  "message": "Plan creation job started successfully"
}
```

### Förslag & genomgångar

```http
POST /api/inbox/check
GET /api/inbox/proposals
POST /api/inbox/proposals/{id}/accept
POST /api/inbox/proposals/{id}/dismiss
```

## Jobb

### Starta jobb

```http
POST /api/jobs
Content-Type: application/json

{
  "type": "ExecutePlan",
  "folderPath": "Plans/00042-fix-login",
  "priority": 10,
  "waitForJobs": ["00140"]
}
```

Anropskroppen använder en polymorf `"type"`-diskriminator. Tillgängliga jobbtyper: `CreatePlan`, `ExecutePlan`, `RetryPlan`, `ExpandPlan`, `UpdatePlan`, `SplitPlan`, `CreatePr`, `CreateIssue`, `SetupProject`, `SyncRepo`, `AddProject`.

### Lista jobb

```http
GET /api/jobs?status=Running&limit=20
```

### Fråga efter jobb (serversidpaginerat & filtrerat)

```http
POST /api/jobs/query
Content-Type: application/json

{
  "offset": 0,
  "limit": 25,
  "sort": [{ "column": "StartedAt", "descending": true }]
}
```

### Jobbkö

```http
GET /api/jobs/queue
```

Returnerar listan över för närvarande köade jobb i utsändningsordning.

### Hämta jobbinformation

```http
GET /api/jobs/{jobId}
```

### Avbryt eller ta bort jobb

```http
POST /api/jobs/{jobId}/cancel
DELETE /api/jobs/{jobId}
```

### Förlopps- & felrapportering

```http
PUT /api/jobs/{jobId}/status
Content-Type: application/json

{
  "message": "Running unit tests...",
  "planId": "00042",
  "planTitle": "Fix login validation bug"
}
```

```http
PUT /api/jobs/{jobId}/fail
Content-Type: application/json

{
  "message": "Test execution failed with exit code 1"
}
```

### Jobbloggar & strömmar

```http
# Add narrative agent log entry
POST /api/jobs/{jobId}/logs
Content-Type: application/json

{
  "action": "ExecutePlan",
  "summary": "Completed successfully"
}

# Fetch logs
GET /api/jobs/{jobId}/logs

# SSE real-time stream of logs
GET /api/jobs/{jobId}/logs/stream

# SSE real-time stream of job lifecycle events
GET /api/jobs/{jobId}/events
```

## WebSockets & händelser

### WebSocket-liveström

Anslut till WebSocket-slutpunkten för att ta emot direktsända händelser för planer, jobb, chattsessioner och statusövergångar:

```text
ws://127.0.0.1:5010/api/ws?token=<secret>&since=<seq>
```

Att skicka `?since=<seq>` spelar upp alla buffrade händelser sedan det sekvensnumret innan direktuppdateringar börjar strömmas.

### REST-återfyllning

Om det inte är praktiskt att hålla en öppen WebSocket-anslutning kan du polla händelsens ringbuffert över HTTP:

```http
GET /api/events?since=105
GET /api/events/backfill?since=105
```

## Hälsokontroller

```http
GET /api/health
```

Svar:

```json
{
  "status": "ok",
  "pid": 12345,
  "version": "2.0.0",
  "apiVersion": 1,
  "capabilities": ["jobs", "plans", "projects", "ws", "auth_bearer", "auth_api_key"]
}
```
