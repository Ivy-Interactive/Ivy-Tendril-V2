---
title: Serveur MCP
description: Tendril inclut un serveur Model Context Protocol (MCP) qui expose des outils de gestion de plans aux agents de codage IA comme Claude Code.
icon: Bot
searchHints:
  - mcp
  - model context protocol
  - claude
  - outils
  - tendril_get_plan
  - tendril_list_plans
  - tendril_start_job
  - tendril_inbox
  - tendril_get_config
---

# Serveur MCP

Tendril inclut un serveur Model Context Protocol (MCP) qui expose des outils de gestion de plans, d'orchestration de tâches et de découverte de projets aux agents de codage IA comme Claude Code.

## Démarrage du serveur MCP

```bash
tendril mcp
```

Cela lance le serveur MCP via le transport stdio, adapté à la configuration MCP de Claude Code. L'entrée et la sortie standard sont strictement réservées aux messages JSON-RPC ; les journaux de diagnostic sont dirigés vers stderr.

## Authentification

Définissez la variable d'environnement `TENDRIL_MCP_TOKEN` pour exiger une authentification par jeton lors des sessions MCP :

- **Variables d'environnement** : Les clients se connectant via stdio peuvent fournir le jeton correspondant via `TENDRIL_MCP_CLIENT_TOKEN` (ou `TENDRIL_MCP_TOKEN`).
- **Métadonnées de requête** : Les clients peuvent également transmettre le jeton par requête dans les paramètres de `initialize` sous `_meta["io.tendril/token"]`.

Lorsque `TENDRIL_MCP_TOKEN` n'est pas défini ou est vide, l'authentification est désactivée et les requêtes locales sont autorisées.

## Outils disponibles

Tous les outils sont préfixés par `tendril_` et interagissent directement avec le démon ou le stockage local de Tendril.

### Inspection et Requête de plans

| Outil                            | Paramètres                                                               | Description                                                                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tendril_get_plan`               | `plan_id` (obligatoire), `field` (facultatif)                            | Récupère les métadonnées d'un plan et sa dernière révision. Lorsque `field` est spécifié, renvoie uniquement ce champ (ex. `title`, `state`, `project`, `level`, `repos`, `commits`, `prs`, `verifications`, `dependsOn`, `revision`). |
| `tendril_list_plans`             | `state` (facultatif), `project` (facultatif), `search`, `since`, `limit` | Liste les plans correspondant aux filtres. `since` accepte un horodatage RFC 3339 ; `search` filtre par titre ou ID.                                                                                                                   |
| `tendril_get_revision`           | `plan_id` (obligatoire), `number` (facultatif)                           | Récupère le texte markdown d'une révision de plan (la plus récente par défaut, ou un numéro de révision spécifique).                                                                                                                   |
| `tendril_plan_validate`          | `plan_id` (obligatoire)                                                  | Vérifie l'état du plan et signale tout problème structurel ou de schéma.                                                                                                                                                               |
| `tendril_plan_verification_list` | `plan_id` (obligatoire)                                                  | Liste toutes les vérifications et leurs états actuels (`Pending`, `Pass`, `Fail`, `Skipped`) pour un plan.                                                                                                                             |
| `tendril_plan_rec_list`          | `plan_id` (obligatoire), `state` (facultatif)                            | Liste les recommandations pour un plan. États de filtrage : `Pending`, `Accepted`, `AcceptedWithNotes`, `Declined`.                                                                                                                    |

### Rédaction et Modification de plans

| Outil                              | Paramètres                                                                                                                    | Description                                                                                                                                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tendril_plan_create`              | `title` (obligatoire), `project` (obligatoire), `level`, `initial_prompt`, `source_url`, `execution_profile`, `priority`, ... | Crée un nouveau plan. Les portes de vérification sont initialisées automatiquement depuis la configuration du projet.                                                                                                        |
| `tendril_plan_write_revision`      | `plan_id` (obligatoire), `content` (obligatoire), `reason` (facultatif)                                                       | Écrit une nouvelle révision markdown numérotée. Les blocs de questions sont validés par rapport au schéma.                                                                                                                   |
| `tendril_plan_set`                 | `plan_id` (obligatoire), `field` (obligatoire), `value` (obligatoire)                                                         | Met à jour un champ scalaire (`state`, `title`, `level`, `project`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`). Les changements d'état imposent les portes de vérification avant d'autoriser `Completed`. |
| `tendril_plan_set_verification`    | `plan_id` (obligatoire), `name` (obligatoire), `status` (obligatoire)                                                         | Définit l'état de la porte de vérification (`Pending`, `Pass`, `Fail`, `Skipped`).                                                                                                                                           |
| `tendril_plan_verification_remove` | `plan_id` (obligatoire), `name` (obligatoire)                                                                                 | Supprime une porte de vérification d'un plan.                                                                                                                                                                                |
| `tendril_plan_add_repo`            | `plan_id` (obligatoire), `path` (obligatoire)                                                                                 | Associe un chemin de dépôt à un plan.                                                                                                                                                                                        |
| `tendril_plan_remove_repo`         | `plan_id` (obligatoire), `path` (obligatoire)                                                                                 | Dissocie un chemin de dépôt d'un plan.                                                                                                                                                                                       |
| `tendril_plan_add_pr`              | `plan_id` (obligatoire), `url` (obligatoire)                                                                                  | Enregistre l'URL d'une pull request sur un plan.                                                                                                                                                                             |
| `tendril_plan_add_commit`          | `plan_id` (obligatoire), `sha` (obligatoire)                                                                                  | Enregistre le SHA d'un commit sur un plan.                                                                                                                                                                                   |
| `tendril_plan_add_depends_on`      | `plan_id` (obligatoire), `folder` (obligatoire)                                                                               | Ajoute une dépendance de plan bloquante. Le plan dépendant ne s'exécutera pas tant que la cible n'atteint pas `Completed` et que ses PR ne sont pas fusionnées.                                                              |
| `tendril_plan_remove_depends_on`   | `plan_id` (obligatoire), `folder` (obligatoire)                                                                               | Supprime une dépendance de plan bloquante.                                                                                                                                                                                   |
| `tendril_plan_add_related_plan`    | `plan_id` (obligatoire), `folder` (obligatoire)                                                                               | Associe un plan lié pour référence contextuelle.                                                                                                                                                                             |
| `tendril_plan_remove_related_plan` | `plan_id` (obligatoire), `folder` (obligatoire)                                                                               | Supprime le lien vers un plan associé.                                                                                                                                                                                       |

### Recommandations

| Outil                      | Paramètres                                                                                         | Description                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `tendril_plan_rec_add`     | `plan_id` (obligatoire), `title` (obligatoire), `description` (obligatoire), `impact` (facultatif) | Ajoute une nouvelle recommandation avec un niveau d'impact (`Small`, `Medium`, `High`). |
| `tendril_plan_rec_accept`  | `plan_id` (obligatoire), `title` (obligatoire)                                                     | Accepte une recommandation.                                                             |
| `tendril_plan_rec_decline` | `plan_id` (obligatoire), `title` (obligatoire), `reason` (facultatif)                              | Refuse une recommandation avec une justification facultative.                           |
| `tendril_plan_rec_remove`  | `plan_id` (obligatoire), `title` (obligatoire)                                                     | Supprime une recommandation du plan.                                                    |

### Tâches et Boîte de réception

| Outil                 | Paramètres                                                                             | Description                                                                                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tendril_inbox`       | `description` (obligatoire), `project` (facultatif), `source_path` (facultatif)        | Soumet une nouvelle description de tâche à la boîte de réception Tendril, en lançant automatiquement une tâche `CreatePlan`.                                                                                   |
| `tendril_start_job`   | `job_type` (obligatoire), `plan_id`, `description`, `project`, `note`, `priority`, ... | Démarre une tâche en arrière-plan sur le démon actif (`CreatePlan`, `ExecutePlan`, `RetryPlan`, `UpdatePlan`, `ExpandPlan`, `SplitPlan`, `CreatePr`, `CreateIssue`, `SetupProject`, `SyncRepo`, `AddProject`). |
| `tendril_list_jobs`   | `status` (facultatif), `limit` (facultatif)                                            | Liste les tâches récentes en arrière-plan issues du démon.                                                                                                                                                     |
| `tendril_get_job`     | `job_id` (obligatoire)                                                                 | Récupère l'état, la durée, le décompte de jetons et le détail des coûts pour une tâche spécifique.                                                                                                             |
| `tendril_cancel_job`  | `job_id` (obligatoire), `message` (facultatif)                                         | Annule une tâche en cours d'exécution en arrière-plan.                                                                                                                                                         |
| `tendril_job_add_log` | `job_id` (obligatoire), `action` (obligatoire), `summary` (facultatif)                 | Ajoute une entrée de journal narrative dans `<TendrilHome>/Jobs/`. Fonctionne hors ligne même si le démon est arrêté.                                                                                          |

### Configuration et Découverte

| Outil                        | Paramètres          | Description                                                                                                                            |
| ---------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `tendril_get_config`         | `key` (facultatif)  | Lit les valeurs de configuration publiques (ex. `codingAgent`, `jobTimeout`, `planTemplate`). Les identifiants sensibles sont masqués. |
| `tendril_list_projects`      | —                   | Liste tous les projets configurés avec leurs chemins de dépôts, vérifications et paramètres.                                           |
| `tendril_list_verifications` | `name` (facultatif) | Liste les définitions globales de contrôle de vérification, ou en inspecte une par son nom.                                            |

> [!NOTE]
> La configuration est en lecture seule via MCP : la modification de paramètres globaux au niveau de la machine comme `planFolder` ou `codingAgent` nécessite d'utiliser la CLI (`tendril config set`) ou l'interface Tendril.

## Configuration de Claude Code

Ajoutez le serveur MCP de Tendril à vos paramètres Claude Code (`~/.claude/settings.json` ou `.claude/settings.json` au niveau du projet) :

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

Avec l'authentification par jeton activée :

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
