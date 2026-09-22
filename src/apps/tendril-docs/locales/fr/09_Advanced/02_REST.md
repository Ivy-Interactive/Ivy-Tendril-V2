---
title: API REST
description: Tendril expose une API HTTP et WebSocket pour la gestion programmatique des plans et des tâches à l'URL de votre serveur Tendril (port par défaut 5010).
icon: Server
searchHints:
  - api
  - rest
  - http
  - endpoint
  - plans
  - tâches
  - boîte de réception
  - authentification
  - bearer
  - X-Api-Key
  - websocket
  - événements
---

# API REST

Tendril expose une API REST HTTP et une interface WebSocket pour la gestion programmatique des plans et des tâches. Par défaut, le serveur API écoute sur `http://127.0.0.1:5010` (ou `http://localhost:5010`). Le service en HTTPS est activé lorsque `tendril serve` est démarré avec `--tls-cert` et `--tls-key`.

## Authentification

Tendril protège les points de terminaison de l'API à l'aide d'identifiants porteur (bearer), de clés API facultatives ou d'une authentification basique par mot de passe :

### Secret Bearer du Démon

Au démarrage du démon, celui-ci génère un secret bearer de 32 octets cryptographiquement sécurisé et l'écrit dans `<home>/.master`. Les routes API protégées requièrent ce secret dans l'en-tête `Authorization` ou `X-Api-Key` :

```bash
# Utilisation de l'en-tête Authorization
curl -H "Authorization: Bearer <secret>" http://127.0.0.1:5010/api/plans

# Utilisation de l'en-tête X-Api-Key
curl -H "X-Api-Key: <secret>" http://127.0.0.1:5010/api/plans
```

Pour les connexions WebSocket sur `/api/ws`, transmettez le secret dans la chaîne de requête :

```text
ws://127.0.0.1:5010/api/ws?token=<secret>
```

### Clé API configurée

Lorsque `api.apiKey` est configuré dans `config.yaml`, les requêtes doivent également satisfaire l'exigence de clé API en envoyant `X-Api-Key: <configured-key>` :

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

### Authentification par mot de passe

Lorsque `auth:` est configuré dans `config.yaml`, les appelants peuvent s'authentifier avec `Authorization: Basic <base64(user:password)>` ou en obtenant un jeton de session JWT signé depuis `POST /api/auth/login`. Les jetons de session sont valides pendant 15 minutes et acceptés via `Authorization: Bearer <session-token>`.

### Points de terminaison non authentifiés

Les points de terminaison d'analyse suivants ne nécessitent aucune authentification :

- `GET /api/health` — vérification principale de l'état de santé renvoyant le PID, la version, la version de l'API et la liste des fonctionnalités
- `GET /api/jobs/health` — alias pour la vérification de santé
- `GET /api/ping` — vérification de disponibilité ping/pong renvoyant `{"ping": "pong"}`
- `POST /api/auth/login` — point de terminaison d'authentification par mot de passe

## Plans

### Lister les plans

```http
GET /api/plans?state=Draft&project=MyProject&limit=50
```

| Paramètre | Type   | Description                                                                                                                              |
| --------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `status`  | string | Filtrer par état du plan (`Draft`, `Creating`, `Updating`, `Executing`, `Completed`, `Failed`, `Review`, `Skipped`, `Icebox`, `Blocked`) |
| `state`   | string | Alias pour `status`                                                                                                                      |
| `project` | string | Filtrer par nom de projet                                                                                                                |
| `level`   | string | Filtrer par niveau (ex. `Feature`, `Bug`)                                                                                                |
| `q`       | string | Filtre de recherche textuelle sur le titre et le contenu du plan                                                                         |
| `limit`   | int    | Nombre maximal de résultats (illimité par défaut)                                                                                        |

### Créer un plan

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

### Obtenir un plan

```http
GET /api/plans/{planId}
GET /api/plans/{planId}?field=state
```

Renvoie l'enregistrement complet du plan ou la valeur d'un seul champ lorsque `?field=` est spécifié. Champs pris en charge : `id`, `title`, `state`, `project`, `level`, `created`, `updated`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`, `partialDelivery`, `repos`, `prs`, `commits`, `verifications`, `dependsOn`, `relatedPlans`, `recommendations`.

### Mettre à jour un champ

```http
PUT /api/plans/{planId}
Content-Type: application/json

{
  "field": "state",
  "value": "Executing"
}
```

Champs pris en charge : `state`, `title`, `level`, `project`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`.

Définir `state` sur `Completed` renvoie `400` tant qu'une des vérifications du plan est à l'état `Fail`. Ajoutez `"allowFailedVerifications": true` pour forcer l'enregistrement ; le plan sera alors marqué avec `partialDelivery: true`.

### Supprimer un plan

```http
DELETE /api/plans/{planId}
```

### Dépôts

```http
POST /api/plans/{planId}/repos
DELETE /api/plans/{planId}/repos
Content-Type: application/json

{
  "repoPath": "/path/to/repo"
}
```

### Pull Requests et Commits

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

### Dépendances et Plans associés

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

### Vérifications du plan

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

États valides de vérification : `Pending`, `Pass`, `Fail`, `Skipped`.

### Révisions et Validation

```http
GET /api/plans/{planId}/revisions
POST /api/plans/{planId}/revisions
PUT /api/plans/{planId}/revisions/latest
POST /api/plans/{planId}/validate
```

## Recommandations

### Lister les recommandations

```http
GET /api/plans/{planId}/recommendations
GET /api/plans/{planId}/recommendations?state=Pending
GET /api/recommendations
```

États de filtrage : `Pending`, `Accepted`, `AcceptedWithNotes`, `Declined`. `GET /api/recommendations` interroge l'ensemble des plans.

### Ajouter une recommandation

```http
POST /api/plans/{planId}/recommendations
Content-Type: application/json

{
  "title": "Add integration test",
  "description": "Coverage is missing for the password reset route",
  "impact": "Medium"
}
```

Niveaux d'impact : `Small`, `Medium`, `High`.

### Accepter / Refuser une recommandation

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

### Supprimer une recommandation

```http
DELETE /api/plans/{planId}/recommendations/{title}
```

## Boîte de réception

### Soumettre une tâche de plan

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

Démarre une tâche en arrière-plan `CreatePlan` et renvoie :

```json
{
  "jobId": "00143",
  "status": "Started",
  "message": "Plan creation job started successfully"
}
```

### Propositions et Balayages

```http
POST /api/inbox/check
GET /api/inbox/proposals
POST /api/inbox/proposals/{id}/accept
POST /api/inbox/proposals/{id}/dismiss
```

## Tâches (Jobs)

### Démarrer une tâche

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

Le corps de la requête utilise un discriminateur polymorphique `"type"`. Types de tâches disponibles : `CreatePlan`, `ExecutePlan`, `RetryPlan`, `ExpandPlan`, `UpdatePlan`, `SplitPlan`, `CreatePr`, `CreateIssue`, `SetupProject`, `SyncRepo`, `AddProject`.

### Lister les tâches

```http
GET /api/jobs?status=Running&limit=20
```

### Interroger les tâches (Paginé et Filtré côté Serveur)

```http
POST /api/jobs/query
Content-Type: application/json

{
  "offset": 0,
  "limit": 25,
  "sort": [{ "column": "StartedAt", "descending": true }]
}
```

### File d'attente des tâches

```http
GET /api/jobs/queue
```

Renvoie la liste des tâches actuellement en file d'attente par ordre de traitement.

### Obtenir les détails d'une tâche

```http
GET /api/jobs/{jobId}
```

### Annuler ou Supprimer une tâche

```http
POST /api/jobs/{jobId}/cancel
DELETE /api/jobs/{jobId}
```

### Rapports de progression et d'échec

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

### Journaux et flux de tâches

```http
# Ajouter une entrée de journal narrative pour l'agent
POST /api/jobs/{jobId}/logs
Content-Type: application/json

{
  "action": "ExecutePlan",
  "summary": "Completed successfully"
}

# Récupérer les journaux
GET /api/jobs/{jobId}/logs

# Flux SSE en temps réel des journaux
GET /api/jobs/{jobId}/logs/stream

# Flux SSE en temps réel des événements de cycle de vie de la tâche
GET /api/jobs/{jobId}/events
```

## WebSockets et Événements

### Flux WebSocket en direct

Connectez-vous au point de terminaison WebSocket pour recevoir les diffusions d'événements en direct pour les plans, les tâches, les sessions de chat et les transitions d'état :

```text
ws://127.0.0.1:5010/api/ws?token=<secret>&since=<seq>
```

Transmettre `?since=<seq>` rejoue tous les événements mis en mémoire tampon depuis ce numéro de séquence avant de diffuser les mises à jour en direct.

### Remplissage par REST

S'il n'est pas pratique de maintenir une connexion WebSocket ouverte, interrogez le tampon circulaire d'événements via HTTP :

```http
GET /api/events?since=105
GET /api/events/backfill?since=105
```

## Vérifications d'état

```http
GET /api/health
```

Réponse :

```json
{
  "status": "ok",
  "pid": 12345,
  "version": "2.0.0",
  "apiVersion": 1,
  "capabilities": ["jobs", "plans", "projects", "ws", "auth_bearer", "auth_api_key"]
}
```
