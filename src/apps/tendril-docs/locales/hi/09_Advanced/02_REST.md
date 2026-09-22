---
title: REST API
description: Tendril आपके Tendril सर्वर URL (डिफ़ॉल्ट पोर्ट 5010) पर
  प्रोग्रामेटिक प्लान और जॉब प्रबंधन के लिए एक HTTP और WebSocket API प्रदान करता
  है।
icon: Server
searchHints:
  - एपीआई
  - रेस्ट
  - एचटीटीपी
  - एंडपॉइंट
  - प्लान्स
  - जॉब्स
  - इनबॉक्स
  - प्रमाणीकरण
  - बेयरर
  - X-Api-Key
  - वेबसॉकेट
  - इवेंट्स
---

# REST API

Tendril प्रोग्रामेटिक प्लान और जॉब प्रबंधन के लिए एक HTTP REST API और WebSocket इंटरफ़ेस प्रदान करता है। डिफ़ॉल्ट रूप से, API सर्वर `http://127.0.0.1:5010` (या `http://localhost:5010`) पर सुनता है। जब `tendril serve` को `--tls-cert` और `--tls-key` के साथ शुरू किया जाता है, तो HTTPS सर्विसिंग सक्षम हो जाती है।

## Authentication

Tendril बेयरर क्रेडेंशियल्स, वैकल्पिक API कीज़, या बुनियादी पासवर्ड प्रमाणीकरण का उपयोग करके API एंडपॉइंट्स को सुरक्षित करता है:

### Daemon Bearer Secret

जब डेमॉन शुरू होता है, तो यह एक क्रिप्टोग्राफ़िक रूप से सुरक्षित 32-बाइट बेयरर सीक्रेट उत्पन्न करता है और इसे `<home>/.master` में लिखता है। संरक्षित API रूट्स को `Authorization` या `X-Api-Key` हेडर में इस सीक्रेट की आवश्यकता होती है:

```bash
# Using Authorization header
curl -H "Authorization: Bearer <secret>" http://127.0.0.1:5010/api/plans

# Using X-Api-Key header
curl -H "X-Api-Key: <secret>" http://127.0.0.1:5010/api/plans
```

`/api/ws` पर WebSocket कनेक्शन के लिए, क्वेरी स्ट्रिंग में सीक्रेट पास करें:

```text
ws://127.0.0.1:5010/api/ws?token=<secret>
```

### Configured API Key

जब `config.yaml` में `api.apiKey` कॉन्फ़िगर किया जाता है, तो अनुरोधों को `X-Api-Key: <configured-key>` भेजकर API की आवश्यकता को भी पूरा करना होगा:

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

जब `config.yaml` में `auth:` कॉन्फ़िगर किया जाता है, तो कॉल करने वाले `Authorization: Basic <base64(user:password)>` के साथ या `POST /api/auth/login` से हस्ताक्षरित JWT सेशन टोकन प्राप्त करके प्रमाणित कर सकते हैं। सेशन टोकन 15 मिनट के लिए मान्य होते हैं और `Authorization: Bearer <session-token>` के माध्यम से स्वीकार किए जाते हैं।

### Unauthenticated Endpoints

निम्नलिखित प्रोब एंडपॉइंट्स को प्रमाणीकरण की आवश्यकता नहीं होती है:

- `GET /api/health` — प्राथमिक स्वास्थ्य जांच जो PID, संस्करण, API संस्करण और क्षमता सूची लौटाती है
- `GET /api/jobs/health` — स्वास्थ्य जांच के लिए उपनाम (alias)
- `GET /api/ping` — पिंग/पॉन्ग तत्परता जांच जो `{"ping": "pong"}` लौटाती है
- `POST /api/auth/login` — पासवर्ड प्रमाणीकरण एंडपॉइंट

## Plans

### List Plans

```http
GET /api/plans?state=Draft&project=MyProject&limit=50
```

| Parameter | Type   | Description                                                                                                                                      |
| --------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `status`  | string | प्लान स्थिति (`Draft`, `Creating`, `Updating`, `Executing`, `Completed`, `Failed`, `Review`, `Skipped`, `Icebox`, `Blocked`) द्वारा फ़िल्टर करें |
| `state`   | string | `status` के लिए उपनाम (alias)                                                                                                                    |
| `project` | string | प्रोजेक्ट नाम द्वारा फ़िल्टर करें                                                                                                                |
| `level`   | string | स्तर द्वारा फ़िल्टर करें (उदा. `Feature`, `Bug`)                                                                                                 |
| `q`       | string | प्लान शीर्षक और सामग्री में टेक्स्ट खोज फ़िल्टर                                                                                                  |
| `limit`   | int    | अधिकतम परिणाम (डिफ़ॉल्ट रूप से असीमित)                                                                                                           |

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

पूर्ण प्लान रिकॉर्ड लौटाता है, या `?field=` निर्दिष्ट होने पर एकल फ़ील्ड स्ट्रिंग लौटाता है। समर्थित फ़ील्ड: `id`, `title`, `state`, `project`, `level`, `created`, `updated`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`, `partialDelivery`, `repos`, `prs`, `commits`, `verifications`, `dependsOn`, `relatedPlans`, `recommendations`।

### Update Field

```http
PUT /api/plans/{planId}
Content-Type: application/json

{
  "field": "state",
  "value": "Executing"
}
```

समर्थित फ़ील्ड: `state`, `title`, `level`, `project`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`।

जब प्लान के सत्यापन में से कोई भी `Fail` स्थिति में होता है, तो `state` को `Completed` पर सेट करने पर `400` वापस आता है। इसे किसी भी तरह रिकॉर्ड करने के लिए `"allowFailedVerifications": true` जोड़ें; फिर प्लान को `partialDelivery: true` के साथ फ़्लैग किया जाता है।

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

मान्य सत्यापन स्थितियाँ: `Pending`, `Pass`, `Fail`, `Skipped`।

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

फ़िल्टर स्थितियाँ: `Pending`, `Accepted`, `AcceptedWithNotes`, `Declined`। `GET /api/recommendations` प्रत्येक प्लान में क्वेरी करता है।

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

प्रभाव स्तर: `Small`, `Medium`, `High`।

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

एक `CreatePlan` बैकग्राउंड जॉब शुरू करता है और लौटाता है:

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

अनुरोध बॉडी एक बहुरूपी (polymorphic) `"type"` डिस्क्रिमिनेटर का उपयोग करती है। उपलब्ध जॉब प्रकार: `CreatePlan`, `ExecutePlan`, `RetryPlan`, `ExpandPlan`, `UpdatePlan`, `SplitPlan`, `CreatePr`, `CreateIssue`, `SetupProject`, `SyncRepo`, `AddProject`।

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

डिस्पैच क्रम में वर्तमान में कतारबद्ध जॉब्स की सूची लौटाता है।

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

प्लान, जॉब्स, चैट सेशन और स्थिति परिवर्तनों के लिए लाइव प्रसारण इवेंट प्राप्त करने के लिए WebSocket एंडपॉइंट से कनेक्ट करें:

```text
ws://127.0.0.1:5010/api/ws?token=<secret>&since=<seq>
```

`?since=<seq>` पास करने से लाइव अपडेट स्ट्रीम करने से पहले उस अनुक्रम संख्या के बाद के सभी बफ़र किए गए इवेंट फिर से प्ले (replay) हो जाते हैं।

### REST Backfill

यदि एक खुला WebSocket कनेक्शन बनाए रखना व्यावहारिक नहीं है, तो HTTP पर इवेंट रिंग बफ़र को पोल करें:

```http
GET /api/events?since=105
GET /api/events/backfill?since=105
```

## Health Checks

```http
GET /api/health
```

प्रतिक्रिया:

```json
{
  "status": "ok",
  "pid": 12345,
  "version": "2.0.0",
  "apiVersion": 1,
  "capabilities": ["jobs", "plans", "projects", "ws", "auth_bearer", "auth_api_key"]
}
```
