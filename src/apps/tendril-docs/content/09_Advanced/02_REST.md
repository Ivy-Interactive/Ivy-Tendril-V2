---
title: REST API
description: Tendril exposes an HTTP and WebSocket API for programmatic plan and job management at your Tendril server URL (default port 5010).
icon: Server
searchHints:
  - api
  - rest
  - http
  - endpoint
  - plans
  - jobs
  - inbox
  - authentication
  - bearer
  - X-Api-Key
  - websocket
  - events
---

# REST API

Tendril exposes an HTTP REST API and WebSocket interface for programmatic plan and job management. By default, the API server listens on `http://127.0.0.1:5010` (or `http://localhost:5010`). Serving HTTPS is enabled when `tendril serve` is started with `--tls-cert` and `--tls-key`.

## Authentication

Tendril protects API endpoints using bearer credentials, optional API keys, or basic password authentication:

### Daemon Bearer Secret

When the daemon starts, it generates a cryptographically secure 32-byte bearer secret and writes it to `<home>/.master`. Protected API routes require this secret in either the `Authorization` or `X-Api-Key` header:

```bash
# Using Authorization header
curl -H "Authorization: Bearer <secret>" http://127.0.0.1:5010/api/plans

# Using X-Api-Key header
curl -H "X-Api-Key: <secret>" http://127.0.0.1:5010/api/plans
```

For WebSocket connections at `/api/ws`, pass the secret in the query string:

```text
ws://127.0.0.1:5010/api/ws?token=<secret>
```

### Configured API Key

When `api.apiKey` is configured in `config.yaml`, requests must also satisfy the API key requirement by sending `X-Api-Key: <configured-key>`:

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

### Password Authentication

When `auth:` is configured in `config.yaml`, callers may authenticate with `Authorization: Basic <base64(user:password)>` or by obtaining a signed JWT session token from `POST /api/auth/login`. Session tokens are valid for 15 minutes and accepted via `Authorization: Bearer <session-token>`.

### Unauthenticated Endpoints

The following probe endpoints do not require authentication:

- `GET /api/health` — primary health check returning PID, version, API version, and capability list
- `GET /api/jobs/health` — alias for the health check
- `GET /api/ping` — ping/pong readiness check returning `{"ping": "pong"}`
- `POST /api/auth/login` — password authentication endpoint

## Plans

### List Plans

```http
GET /api/plans?state=Draft&project=MyProject&limit=50
```

| Parameter | Type   | Description                                                                                                                          |
| --------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `status`  | string | Filter by plan state (`Draft`, `Creating`, `Updating`, `Executing`, `Completed`, `Failed`, `Review`, `Skipped`, `Icebox`, `Blocked`) |
| `state`   | string | Alias for `status`                                                                                                                   |
| `project` | string | Filter by project name                                                                                                               |
| `level`   | string | Filter by level (e.g. `Feature`, `Bug`)                                                                                              |
| `q`       | string | Text search filter across plan title and content                                                                                     |
| `limit`   | int    | Maximum results (unbounded by default)                                                                                               |

### Create Plan

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

### Get Plan

```http
GET /api/plans/{planId}
GET /api/plans/{planId}?field=state
```

Returns the full plan record, or a single field string when `?field=` is specified. Supported fields: `id`, `title`, `state`, `project`, `level`, `created`, `updated`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`, `partialDelivery`, `repos`, `prs`, `commits`, `verifications`, `dependsOn`, `relatedPlans`, `recommendations`.

### Update Field

```http
PUT /api/plans/{planId}
Content-Type: application/json

{
  "field": "state",
  "value": "Executing"
}
```

Supported fields: `state`, `title`, `level`, `project`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`.

Setting `state` to `Completed` returns `400` while any of the plan's verifications is in the `Fail` state. Add `"allowFailedVerifications": true` to record it anyway; the plan is then flagged with `partialDelivery: true`.

### Delete Plan

```http
DELETE /api/plans/{planId}
```

### Repositories

```http
POST /api/plans/{planId}/repos
DELETE /api/plans/{planId}/repos
Content-Type: application/json

{
  "repoPath": "/path/to/repo"
}
```

### Pull Requests & Commits

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

### Dependencies & Related Plans

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

### Plan Verifications

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

Valid verification statuses: `Pending`, `Pass`, `Fail`, `Skipped`.

### Revisions & Validation

```http
GET /api/plans/{planId}/revisions
POST /api/plans/{planId}/revisions
PUT /api/plans/{planId}/revisions/latest
POST /api/plans/{planId}/validate
```

## Recommendations

### List Recommendations

```http
GET /api/plans/{planId}/recommendations
GET /api/plans/{planId}/recommendations?state=Pending
GET /api/recommendations
```

Filter states: `Pending`, `Accepted`, `AcceptedWithNotes`, `Declined`. `GET /api/recommendations` queries across every plan.

### Add Recommendation

```http
POST /api/plans/{planId}/recommendations
Content-Type: application/json

{
  "title": "Add integration test",
  "description": "Coverage is missing for the password reset route",
  "impact": "Medium"
}
```

Impact levels: `Small`, `Medium`, `High`.

### Accept / Decline Recommendation

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

### Delete Recommendation

```http
DELETE /api/plans/{planId}/recommendations/{title}
```

## Inbox

### Submit Plan Task

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

Starts a `CreatePlan` background job and returns:

```json
{
  "jobId": "00143",
  "status": "Started",
  "message": "Plan creation job started successfully"
}
```

### Proposals & Sweeps

```http
POST /api/inbox/check
GET /api/inbox/proposals
POST /api/inbox/proposals/{id}/accept
POST /api/inbox/proposals/{id}/dismiss
```

## Jobs

### Start Job

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

The request body uses a polymorphic `"type"` discriminator. Available job types: `CreatePlan`, `ExecutePlan`, `RetryPlan`, `ExpandPlan`, `UpdatePlan`, `SplitPlan`, `CreatePr`, `CreateIssue`, `SetupProject`, `SyncRepo`, `AddProject`.

### List Jobs

```http
GET /api/jobs?status=Running&limit=20
```

### Query Jobs (Server Paged & Filtered)

```http
POST /api/jobs/query
Content-Type: application/json

{
  "offset": 0,
  "limit": 25,
  "sort": [{ "column": "StartedAt", "descending": true }]
}
```

### Job Queue

```http
GET /api/jobs/queue
```

Returns the list of currently queued jobs in dispatch order.

### Get Job Details

```http
GET /api/jobs/{jobId}
```

### Cancel or Delete Job

```http
POST /api/jobs/{jobId}/cancel
DELETE /api/jobs/{jobId}
```

### Progress & Failure Reporting

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

### Job Logs & Streams

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

## WebSockets & Events

### Live WebSocket Stream

Connect to the WebSocket endpoint to receive live broadcast events for plans, jobs, chat sessions, and status transitions:

```text
ws://127.0.0.1:5010/api/ws?token=<secret>&since=<seq>
```

Passing `?since=<seq>` replays all buffered events since that sequence number before streaming live updates.

### REST Backfill

If holding an open WebSocket connection is not practical, poll the event ring buffer over HTTP:

```http
GET /api/events?since=105
GET /api/events/backfill?since=105
```

## Health Checks

```http
GET /api/health
```

Response:

```json
{
  "status": "ok",
  "pid": 12345,
  "version": "2.0.0",
  "apiVersion": 1,
  "capabilities": ["jobs", "plans", "projects", "ws", "auth_bearer", "auth_api_key"]
}
```
