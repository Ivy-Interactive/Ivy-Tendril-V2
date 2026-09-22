---
title: Jam.dev
description: Intégrez jam.dev à Tendril pour créer automatiquement des plans à partir de rapports de bugs via le webhook de l'API inbox.
icon: Bug
searchHints:
  - jam
  - jam.dev
  - webhook
  - api inbox
  - rapports de bugs
---

# Jam.dev

## Vue d'ensemble

[Jam.dev](https://jam.dev) peut envoyer des rapports de bugs au point de terminaison de l'API inbox de Tendril, qui crée automatiquement des [plans](../02_Concepts/01_Plans.md) via le [promptware](../02_Concepts/02_Promptwares.md) `CreatePlan`. Pour plus de détails sur les points de terminaison HTTP sous-jacents, consultez [API REST](../09_Advanced/02_REST.md).

## URL du webhook

Configurez [Jam.dev](https://jam.dev) pour envoyer une requête POST à :

```
http://localhost:5010/api/inbox
```

Remplacez `localhost:5010` par l'hôte et le port de votre instance Tendril si la configuration diffère. Pour la configuration du serveur, consultez [Installation et configuration](../03_Configuration/01_Setup.md).

## Format de la requête

Envoyez une requête POST avec un corps JSON :

```json
{
  "description": "Bug description from jam.dev",
  "project": "ProjectName",
  "sourcePath": "optional/path/to/related/code",
  "force": false
}
```

| Champ         | Requis | Description                                                                           |
| ------------- | ------ | ------------------------------------------------------------------------------------- |
| `description` | Oui    | Le rapport de bug ou la description du problème                                       |
| `project`     | Non    | Nom du projet cible (par défaut `Auto`)                                               |
| `sourcePath`  | Non    | Indication de chemin pour le code source associé                                      |
| `force`       | Non    | Forcer la création même si une tâche identique est déjà en cours (par défaut `false`) |

## Authentification

Si vous avez configuré `api.apiKey` dans `config.yaml`, incluez-la dans l'en-tête de requête `X-Api-Key` :

```http
X-Api-Key: your-api-key
```

Vous pouvez également vous authentifier à l'aide du secret du démon via :

```http
Authorization: Bearer <secret>
```

> [!TIP]
> Lorsque `api.apiKey` n'est pas configuré, le secret du démon ou la connexion de bouclage local (loopback) est utilisé. Pour les environnements d'équipe ou distants, configurez une clé d'API dans `config.yaml`.

## Réponse

Une requête réussie renvoie un code HTTP 200 :

```json
{
  "jobId": "abc123",
  "status": "Started",
  "message": "Plan creation job started successfully"
}
```

Si une description identique est envoyée alors qu'une tâche `CreatePlan` est déjà en cours d'exécution et que `force` n'est pas `true`, Tendril renvoie un code HTTP 409 Conflict :

```json
{
  "error": "A CreatePlan job is already running for this description",
  "status": "Conflict"
}
```

## Configuration dans jam.dev

1. Ouvrez les paramètres de votre espace de travail jam.dev
2. Accédez aux intégrations ou webhooks
3. Ajoutez un nouveau webhook pointant vers l'URL inbox de Tendril (`http://localhost:5010/api/inbox`)
4. Configurez les en-têtes (tels que `X-Api-Key`) si l'authentification est activée
5. Configurez la charge utile (payload) pour qu'elle corresponde au format de requête ci-dessus
