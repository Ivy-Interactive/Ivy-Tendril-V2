---
title: Vue d'ensemble de la CLI
description: Gérez les plans, les projets, les bases de données et les agents directement depuis votre terminal. Le binaire tendril fonctionne à la fois comme un démon serveur et comme un outil CLI complet.
icon: Terminal
searchHints:
  - cli
  - commande
  - terminal
  - tendril
  - shell
  - reset
  - report-bug
  - run
  - serve
  - doctor
  - version
  - config
---

# Vue d'ensemble de la CLI

Gérez les plans, les projets, les bases de données et les agents directement depuis votre terminal. Le binaire `tendril` fonctionne à la fois comme un démon serveur et comme un outil CLI complet.

Tendril CLI vous offre un contrôle total sur votre flux de travail sans passer par l'interface utilisateur :

- **Plans** — créez, listez, mettez à jour et inspectez les plans ; gérez les dépôts, les worktrees, les vérifications et les recommandations
- **Projets** — configurez les projets, leurs dépôts, les dépendances de compilation, les actions de revue, les serveurs MCP et les compétences personnalisées
- **Vérifications** — définissez et gérez des contrôles de vérification réutilisables
- **Configuration** — lisez et mettez à jour les paramètres de premier niveau stockés dans `config.yaml`
- **Vault** — connectez des vaults d'équipe, découvrez des dépôts distants, synchronisez des ressources et importez ou publiez des projets
- **Base de données** — exécutez les migrations, inspectez les versions de schéma, réinitialisez les tables, vérifiez l'intégrité et exécutez vacuum
- **Agents et Tâches** — exécutez des promptwares, gérez les tâches en arrière-plan et menez des sessions de chat interactives

## Démarrage rapide

**1. Vérifiez votre installation**

```terminal
>tendril doctor
```

**2. Démarrez le serveur démon**

```terminal
>tendril run
```

**3. Créez un nouveau plan**

```terminal
>tendril plan create "Fix login bug" MyProject
```

**4. Listez les plans actifs**

```terminal
>tendril plan list --state Executing
```

**5. Réinitialisez tout et repartez à zéro**

```terminal
>tendril reset
```

> [!TIP]
> Chaque commande prend en charge `--help` pour obtenir des informations détaillées. Par exemple : `tendril plan create --help`.

## Options globales

| Option          | Effet                                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `--home <path>` | Chemin d'accès au répertoire personnel de Tendril (peut également être défini via la variable d'environnement `TENDRIL_HOME`) |

## Variables d'environnement

| Variable        | Rôle                                                                                                                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TENDRIL_HOME`  | Répertoire racine pour la configuration, la base de données, la boîte de réception et les plans (par défaut `~/.tendril` ou `D:\.tendril`)                                                                      |
| `TENDRIL_PLANS` | Remplace le répertoire des plans (par défaut `TENDRIL_HOME/Plans`)                                                                                                                                              |
| `RUST_LOG`      | Directive de filtrage pour les journaux de processus sur stderr (par défaut : `warn,tendril_cli=info,tendril_core=info,tendril_server=info`). Définissez sur `debug` pour des journaux de diagnostic détaillés. |

## Commandes courantes

#### doctor

```terminal
>tendril doctor
>tendril doctor --rebuild-search-index
```

Valide votre installation de Tendril — vérifie `TENDRIL_HOME`, `config.yaml`, les outils requis (`git`, `gh`), la connectivité à la base de données et la disponibilité des modèles d'agent. Utilisez `--rebuild-search-index` pour régénérer l'index de recherche plein texte à partir de la base de données.

#### plan doctor

```terminal
>tendril plan doctor
>tendril plan doctor --fix
>tendril plan doctor --prs
>tendril plan doctor --prune-husks --dry-run
```

Analyse chaque dossier de plan et signale son état : `plan.yaml` manquant ou mal formé, worktrees obsolètes et plans laissés à l'état `Completed` après une vérification échouée. Consultez [Plan](01_Plan.md#doctor) pour la référence complète des options et des codes d'état.

#### serve et run

```terminal
>tendril serve --port 5010 --host 127.0.0.1
>tendril serve --tls-cert /path/localhost.crt --tls-key /path/localhost.key
>tendril run
```

`tendril serve` démarre le serveur API HTTP et WebSocket (port par défaut `5010`, hôte `127.0.0.1`). Les options facultatives `--tls-cert` et `--tls-key` permettent de servir en HTTPS.

`tendril run` vérifie que le port cible est disponible, applique automatiquement les migrations de base de données en attente, puis lance le démon.

#### reset

```terminal
>tendril reset
>tendril reset --force
```

Supprime toutes les données Tendril de la machine — efface `TENDRIL_HOME` et `TENDRIL_PLANS`. Demande une confirmation sauf si `--force` est fourni.

> [!WARNING]
> Cela supprime définitivement tous les plans, tâches et données de configuration dans les répertoires cibles.

#### report-bug

```terminal
>tendril report-bug --plan 00042
>tendril report-bug --job 00150 -d "Agent failed to create worktree"
>tendril report-bug --plan 00042 --out ~/Desktop/diagnostics.zip
>tendril report-bug --plan 00042 --submit --yes
```

Rassemble les fichiers du plan et tous les artefacts de travail — le journal du travail (Job Log), l'invite du travail (Job Prompt), le journal brut (Job Raw Log) et le journal d'événements (Job Eventwire Log) depuis `<TendrilHome>/Jobs/` — dans une archive zip avec configuration nettoyée et diagnostics d'état. Lorsque `--submit` et `--yes` sont fournis, téléverse l'archive et ouvre un ticket GitHub.

| Option                  | Effet                                                                        |
| ----------------------- | ---------------------------------------------------------------------------- |
| `--plan <id>`           | Inclut ce dossier de plan et toutes les tâches exécutées pour celui-ci       |
| `--job <id>`            | Inclut les quatre artefacts de cette tâche ainsi que le contexte de son plan |
| `-d, --description <t>` | Description du bug (demandée de manière interactive si omise)                |
| `--out <path>`          | Chemin de destination pour l'archive zip                                     |
| `--github-user <name>`  | Nom d'utilisateur GitHub pour le suivi du ticket                             |
| `--submit`              | Téléverse le rapport sur GitHub (requiert `--yes`)                           |
| `-y, --yes`             | Ignore la demande de confirmation                                            |

> [!WARNING]
> La soumission d'un rapport attache l'archive zip à un ticket GitHub **public**. Les secrets sont supprimés des configurations et des journaux de travail, mais vérifiez le contenu du plan avant de soumettre.

#### version

```terminal
>tendril version
```

Affiche la version installée de Tendril (par exemple `tendril v2.0.0`).

#### update-promptwares

```terminal
>tendril update-promptwares
>tendril update-promptwares --dry-run
>tendril update-promptwares --source /path/to/promptwares
```

Actualise les promptwares déployés dans `<TendrilHome>/Promptwares/`, en préservant leurs répertoires `Memory/` et `Tools/`.

## Étapes suivantes

- [Commandes plan](01_Plan.md) — référence complète pour créer et gérer des plans
- [Commandes project](02_Project.md) — configurer des projets, dépôts, actions de revue, serveurs MCP et compétences
- [Commandes verification](03_Verification.md) — gérer les définitions de vérification globales
- [Commandes base de données](04_Database.md) — migrations, versions de schéma, intégrité et vacuum
- [Autres commandes](05_Other.md) — promptwares, tâches, chat, services et utilitaires
- [Commandes config](06_Config.md) — lire et mettre à jour les paramètres de premier niveau de `config.yaml`
- [Commandes vault](07_Vault.md) — connecter des vaults d'équipe, synchroniser des ressources et importer ou publier des projets
