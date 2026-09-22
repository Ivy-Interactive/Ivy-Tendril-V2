---
title: REST-API
description: Daemon-Endpunkte für programmatische Plan- und Job-Ausführung, Posteingang und System-Health-Checks.
icon: Globe
searchHints:
  - rest
  - api
  - daemon
  - endpoints
  - http
  - json
---

# REST-API

Der Tendril-Daemon (`tendril run` / `tendril serve`) stellt eine REST- und WebSocket-API bereit, die von der Desktop-App und dem CLI verwendet wird.

## Wichtige Endpunkte

- `GET /health` — Gibt den Systemstatus und die Version zurück.
- `GET /api/v1/plans` — Listet alle vorhandenen Pläne auf.
- `POST /api/v1/plans` — Erstellt einen neuen Plan.
- `POST /api/v1/plans/:id/execute` — Startet die Ausführung eines Plans.
- `GET /api/v1/jobs` — Ruft aktive und vergangene Jobs ab.
- `POST /api/v1/inbox` — Reicht Aufgaben in den Posteingang ein.
