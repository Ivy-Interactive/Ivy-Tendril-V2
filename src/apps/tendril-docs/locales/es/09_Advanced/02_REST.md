---
title: API REST
description: Tendril expone una API HTTP y WebSocket para la gestión programática de planes y trabajos en la URL de su servidor Tendril (puerto predeterminado 5010).
icon: Server
searchHints:
  - api
  - rest
  - http
  - endpoint
  - planes
  - trabajos
  - inbox
  - autenticación
  - bearer
  - X-Api-Key
  - websocket
  - eventos
---

# API REST

Tendril expone una API REST HTTP y una interfaz WebSocket para la gestión programática de planes y trabajos. De forma predeterminada, el servidor API escucha en `http://127.0.0.1:5010` (o `http://localhost:5010`). Servir mediante HTTPS se habilita cuando se inicia `tendril serve` con `--tls-cert` y `--tls-key`.

## Autenticación

Tendril protege los endpoints de la API mediante credenciales bearer, claves API opcionales o autenticación básica por contraseña:

### Secreto Bearer del Demonio

Cuando el demonio se inicia, genera un secreto bearer criptográficamente seguro de 32 bytes y lo escribe en `<home>/.master`. Las rutas protegidas de la API requieren este secreto en la cabecera `Authorization` o `X-Api-Key`:

```bash
# Usando la cabecera Authorization
curl -H "Authorization: Bearer <secret>" http://127.0.0.1:5010/api/plans

# Usando la cabecera X-Api-Key
curl -H "X-Api-Key: <secret>" http://127.0.0.1:5010/api/plans
```

Para conexiones WebSocket en `/api/ws`, pase el secreto en la cadena de consulta:

```text
ws://127.0.0.1:5010/api/ws?token=<secret>
```

### Clave API configurada

Cuando se configura `api.apiKey` en `config.yaml`, las solicitudes también deben cumplir el requisito de clave API enviando `X-Api-Key: <configured-key>`:

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

### Autenticación por contraseña

Cuando se configura `auth:` en `config.yaml`, los clientes pueden autenticarse con `Authorization: Basic <base64(user:password)>` o mediante la obtención de un token de sesión JWT firmado desde `POST /api/auth/login`. Los tokens de sesión son válidos durante 15 minutos y se aceptan a través de `Authorization: Bearer <session-token>`.

### Endpoints no autenticados

Los siguientes endpoints de sondeo no requieren autenticación:

- `GET /api/health` — comprobación de estado principal que devuelve PID, versión, versión de API y lista de capacidades
- `GET /api/jobs/health` — alias para la comprobación de estado
- `GET /api/ping` — comprobación de disponibilidad ping/pong que devuelve `{"ping": "pong"}`
- `POST /api/auth/login` — endpoint de autenticación por contraseña

## Planes

### Listar planes

```http
GET /api/plans?state=Draft&project=MyProject&limit=50
```

| Parámetro | Tipo   | Descripción                                                                                                                                |
| --------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `status`  | string | Filtrar por estado de plan (`Draft`, `Creating`, `Updating`, `Executing`, `Completed`, `Failed`, `Review`, `Skipped`, `Icebox`, `Blocked`) |
| `state`   | string | Alias de `status`                                                                                                                          |
| `project` | string | Filtrar por nombre de proyecto                                                                                                             |
| `level`   | string | Filtrar por nivel (p. ej., `Feature`, `Bug`)                                                                                               |
| `q`       | string | Filtro de búsqueda de texto en el título y contenido del plan                                                                              |
| `limit`   | int    | Resultados máximos (sin límite de forma predeterminada)                                                                                    |

### Crear plan

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

### Obtener plan

```http
GET /api/plans/{planId}
GET /api/plans/{planId}?field=state
```

Devuelve el registro completo del plan, o una cadena de un solo campo cuando se especifica `?field=`. Campos admitidos: `id`, `title`, `state`, `project`, `level`, `created`, `updated`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`, `partialDelivery`, `repos`, `prs`, `commits`, `verifications`, `dependsOn`, `relatedPlans`, `recommendations`.

### Actualizar campo

```http
PUT /api/plans/{planId}
Content-Type: application/json

{
  "field": "state",
  "value": "Executing"
}
```

Campos admitidos: `state`, `title`, `level`, `project`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`.

Establecer `state` en `Completed` devuelve `400` mientras alguna de las verificaciones del plan esté en estado `Fail`. Añada `"allowFailedVerifications": true` para registrarlo de todos modos; el plan se marcará entonces con `partialDelivery: true`.

### Eliminar plan

```http
DELETE /api/plans/{planId}
```

### Repositorios

```http
POST /api/plans/{planId}/repos
DELETE /api/plans/{planId}/repos
Content-Type: application/json

{
  "repoPath": "/path/to/repo"
}
```

### Pull Requests y Commits

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

### Dependencias y Planes relacionados

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

### Verificaciones del plan

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

Estados válidos de verificación: `Pending`, `Pass`, `Fail`, `Skipped`.

### Revisiones y Validación

```http
GET /api/plans/{planId}/revisions
POST /api/plans/{planId}/revisions
PUT /api/plans/{planId}/revisions/latest
POST /api/plans/{planId}/validate
```

## Recomendaciones

### Listar recomendaciones

```http
GET /api/plans/{planId}/recommendations
GET /api/plans/{planId}/recommendations?state=Pending
GET /api/recommendations
```

Estados de filtrado: `Pending`, `Accepted`, `AcceptedWithNotes`, `Declined`. `GET /api/recommendations` consulta en todos los planes.

### Agregar recomendación

```http
POST /api/plans/{planId}/recommendations
Content-Type: application/json

{
  "title": "Add integration test",
  "description": "Coverage is missing for the password reset route",
  "impact": "Medium"
}
```

Niveles de impacto: `Small`, `Medium`, `High`.

### Aceptar / Rechazar recomendación

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

### Eliminar recomendación

```http
DELETE /api/plans/{planId}/recommendations/{title}
```

## Bandeja de entrada

### Enviar tarea de plan

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

Inicia un trabajo en segundo plano `CreatePlan` y devuelve:

```json
{
  "jobId": "00143",
  "status": "Started",
  "message": "Plan creation job started successfully"
}
```

### Propuestas y Barridos

```http
POST /api/inbox/check
GET /api/inbox/proposals
POST /api/inbox/proposals/{id}/accept
POST /api/inbox/proposals/{id}/dismiss
```

## Trabajos

### Iniciar trabajo

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

El cuerpo de la solicitud utiliza un discriminador polimórfico `"type"`. Tipos de trabajo disponibles: `CreatePlan`, `ExecutePlan`, `RetryPlan`, `ExpandPlan`, `UpdatePlan`, `SplitPlan`, `CreatePr`, `CreateIssue`, `SetupProject`, `SyncRepo`, `AddProject`.

### Listar trabajos

```http
GET /api/jobs?status=Running&limit=20
```

### Consultar trabajos (Paginación y Filtrado en el Servidor)

```http
POST /api/jobs/query
Content-Type: application/json

{
  "offset": 0,
  "limit": 25,
  "sort": [{ "column": "StartedAt", "descending": true }]
}
```

### Cola de trabajos

```http
GET /api/jobs/queue
```

Devuelve la lista de trabajos actualmente en cola en orden de despacho.

### Obtener detalles del trabajo

```http
GET /api/jobs/{jobId}
```

### Cancelar o Eliminar trabajo

```http
POST /api/jobs/{jobId}/cancel
DELETE /api/jobs/{jobId}
```

### Informe de progreso y fallo

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

### Registros y transmisiones de trabajos

```http
# Agregar entrada narrativa de registro de agente
POST /api/jobs/{jobId}/logs
Content-Type: application/json

{
  "action": "ExecutePlan",
  "summary": "Completed successfully"
}

# Obtener registros
GET /api/jobs/{jobId}/logs

# Flujo SSE en tiempo real de registros
GET /api/jobs/{jobId}/logs/stream

# Flujo SSE en tiempo real de eventos del ciclo de vida del trabajo
GET /api/jobs/{jobId}/events
```

## WebSockets y Eventos

### Flujo en vivo por WebSocket

Conéctese al endpoint WebSocket para recibir eventos transmitidos en vivo sobre planes, trabajos, sesiones de chat y transiciones de estado:

```text
ws://127.0.0.1:5010/api/ws?token=<secret>&since=<seq>
```

Pasar `?since=<seq>` reproduce todos los eventos almacenados en búfer desde ese número de secuencia antes de transmitir actualizaciones en vivo.

### Reposición por REST

Si mantener una conexión WebSocket abierta no resulta práctico, sondee el búfer circular de eventos a través de HTTP:

```http
GET /api/events?since=105
GET /api/events/backfill?since=105
```

## Comprobaciones de estado

```http
GET /api/health
```

Respuesta:

```json
{
  "status": "ok",
  "pid": 12345,
  "version": "2.0.0",
  "apiVersion": 1,
  "capabilities": ["jobs", "plans", "projects", "ws", "auth_bearer", "auth_api_key"]
}
```
