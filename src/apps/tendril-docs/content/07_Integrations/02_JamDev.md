---
title: Jam.dev
description: Integrate jam.dev with Tendril to automatically create plans from bug reports via the inbox API webhook.
icon: Bug
searchHints:
  - jam
  - jam.dev
  - webhook
  - inbox api
  - bug reports
---

# Jam.dev

## Overview

[Jam.dev](https://jam.dev) can send bug reports to Tendril's inbox API endpoint, which automatically creates [plans](../02_Concepts/01_Plans.md) via the `CreatePlan` [promptware](../02_Concepts/02_Promptwares.md). For details on the underlying HTTP endpoints, see [REST API](../09_Advanced/02_REST.md).

## Webhook URL

Configure [Jam.dev](https://jam.dev) to POST to:

```
http://localhost:5010/api/inbox
```

Replace `localhost:5010` with your Tendril host and port if configured differently. For server configuration, see [Setup & Settings](../03_Configuration/01_Setup.md).

## Request Format

Send a POST request with a JSON body:

```json
{
  "description": "Bug description from jam.dev",
  "project": "ProjectName",
  "sourcePath": "optional/path/to/related/code",
  "force": false
}
```

| Field         | Required | Description                                                                      |
| ------------- | -------- | -------------------------------------------------------------------------------- |
| `description` | Yes      | The bug report or issue description                                              |
| `project`     | No       | Target project name (defaults to `Auto`)                                         |
| `sourcePath`  | No       | Path hint for related source code                                                |
| `force`       | No       | Force creation even if an identical job is already running (defaults to `false`) |

## Authentication

If you have configured `api.apiKey` in `config.yaml`, include it as the `X-Api-Key` request header:

```http
X-Api-Key: your-api-key
```

You can also authenticate using the daemon secret via:

```http
Authorization: Bearer <secret>
```

> [!TIP]
> When `api.apiKey` is not configured, the daemon secret or local loopback connection is used. For team or remote environments, configure an API key in `config.yaml`.

## Response

A successful request returns HTTP 200:

```json
{
  "jobId": "abc123",
  "status": "Started",
  "message": "Plan creation job started successfully"
}
```

If an identical description is submitted while a `CreatePlan` job is already in flight and `force` is not `true`, Tendril returns HTTP 409 Conflict:

```json
{
  "error": "A CreatePlan job is already running for this description",
  "status": "Conflict"
}
```

## Setting Up in jam.dev

1. Open your jam.dev workspace settings
2. Navigate to integrations or webhooks
3. Add a new webhook pointing to your Tendril inbox URL (`http://localhost:5010/api/inbox`)
4. Configure headers (such as `X-Api-Key`) if authentication is enabled
5. Configure the payload to match the request format above
