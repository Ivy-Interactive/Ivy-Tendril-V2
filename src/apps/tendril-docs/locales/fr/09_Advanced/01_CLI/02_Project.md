---
title: project
description: Gérez les projets stockés dans config.yaml. Les projets regroupent les dépôts, les vérifications, les dépendances de compilation, les actions de revue, les serveurs MCP et les compétences personnalisées.
icon: FolderGit
searchHints:
  - project
  - repo
  - vérification
  - compilation
  - dépendance
  - revue
  - action
  - mcp
  - compétences
  - sync
  - hooks
---

# project

Gérez les projets stockés dans `config.yaml`. Les projets regroupent les dépôts [Git](https://git-scm.com), les [vérifications](03_Verification.md), les dépendances de compilation, les actions de revue, les serveurs [Model Context Protocol (MCP)](https://modelcontextprotocol.io) et les [compétences d'agent](../../06_CodingAgents/00_Skills.md) personnalisées. Pour les flux de travail plus larges dans l'interface, consultez [Configuration des projets](../../03_Configuration/02_Projects.md).

## CRUD

```terminal
>tendril project list
>tendril project get <name>
>tendril project add <name>
>tendril project rename <name> <new-name>
>tendril project remove <name>
>tendril project set <name> <field> <value>
```

- **list** — liste tous les projets configurés, en affichant le nombre de dépôts et de vérifications
- **get** — affiche les détails complets de configuration au format [YAML](https://yaml.org), y compris les dépôts, les vérifications, les actions de revue, les dépendances de compilation, les serveurs MCP et les compétences personnalisées
- **add** — crée une nouvelle entrée de projet dans `config.yaml`
- **rename** — renomme un projet existant et met à jour toutes les références internes
- **remove** — supprime la configuration du projet de `config.yaml`
- **set** — met à jour un champ scalaire du projet. Champs pris en charge : `color` (chaîne hexadécimale de couleur), `context` (instructions d'invite markdown pour les agents), `stackHash`

## Dépôts et Synchronisation

```terminal
>tendril project add-repo <project-name> <repo-path>
>tendril project remove-repo <project-name> <repo-path>
>tendril project sync <project-name> [--repo <repo>]
```

- **add-repo** — associe un chemin de clone de dépôt local au projet
- **remove-repo** — dissocie un chemin de dépôt du projet
- **sync** — extrait les branches distantes et avance rapidement (fast-forward) tous les dépôts du projet avec [Git](https://git-scm.com). Les dépôts divergents signalent des instructions de remédiation diagnostiques.

## Vérifications

Les projets définissent quels [contrôles de vérification](03_Verification.md) doivent réussir avant qu'un [plan](01_Plan.md) puisse être achevé :

```terminal
>tendril project add-verification <project-name> <verification-name> [--required | --optional] [--after <target>]
>tendril project remove-verification <project-name> <verification-name>
>tendril project move-verification <project-name> <verification-name> [--before <target> | --after <target> | --position <pos>]
```

- **add-verification** — associe un contrôle de vérification global à ce projet. Obligatoire par défaut ; passez `--optional` pour le rendre consultatif, ou `--after` pour préciser l'ordre d'exécution.
- **remove-verification** — supprime une porte de vérification du projet.
- **move-verification** — ajuste la position dans l'ordre d'exécution par rapport aux autres vérifications (`--before`, `--after` ou `--position` basé sur zéro).

## Dépendances de compilation

```terminal
>tendril project add-build-dep <project-name> <dependency>
>tendril project remove-build-dep <project-name> <dependency>
```

Configure les prérequis binaires et outils externes (ex. `cargo`, `dotnet`, `node`, [gh](https://cli.github.com)) vérifiés avant d'exécuter un plan.

## Actions de revue

```terminal
>tendril project add-review-action <project-name> <name> --command <cmd> [options]
>tendril project remove-review-action <project-name> <name>
>tendril project review-actions <project-name> [--changed-file <file>...] [--plan <plan>] [--format <table>]
```

Les actions de revue sont des commandes shell exécutées lors de la revue interactive de code :

| Option             | Effet                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `--command <cmd>`  | Ligne de commande shell exécutée dans un terminal interactif PTY                             |
| `--condition <ex>` | Expression facultative évaluée avant d'exécuter l'action                                     |
| `--paths <prefix>` | Filtre de chemin relatif au dépôt déclenchant cette action lorsqu'il est modifié (répétable) |
| `--before <name>`  | Insérer avant une action existante                                                           |
| `--after <name>`   | Insérer après une action existante                                                           |

`tendril project review-actions` évalue et classe les actions de revue par rapport aux fichiers modifiés issus du worktree d'un plan.

## Serveurs MCP et Compétences personnalisées

Les projets peuvent enregistrer des serveurs [MCP](https://modelcontextprotocol.io) et des compétences d'agent personnalisées à portée de projet :

```terminal
>tendril project list-mcp <project-name>
>tendril project add-mcp <project-name> <server-name> <command> [--arg <arg>...] [--env KEY=VALUE...]
>tendril project remove-mcp <project-name> <server-name>

>tendril project list-skills <project-name>
>tendril project add-skill <project-name> <skill-name> [--description <desc>] [--path <path>] [--instructions <text>]
>tendril project remove-skill <project-name> <skill-name>
```

Pour importer des serveurs MCP ou des compétences directement depuis un dépôt existant :

```terminal
>tendril project import <project-name> <repo-path> [--mcp-only] [--skills-only]
>tendril project import-mcp <project-name> <repo-path> [--name <server>]
>tendril project import-skills <project-name> <repo-path> [--name <skill>] [--no-copy]
```

## Hooks de promptware

Les hooks exécutent des actions shell personnalisées avant ou après l'exécution d'un [promptware](../../02_Concepts/02_Promptwares.md) :

```terminal
>tendril project add-hook <project-name> <name> --action <action> [options]
>tendril project remove-hook <project-name> <name>
```

| Option                 | Effet                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| `--when <timing>`      | Déclencheur temporel : `before` (par défaut) ou `after`                                                |
| `--promptwares <list>` | Liste séparée par des virgules des promptwares concernés (ex. `ExecutePlan,CreatePr`), ou tous si omis |
| `--action <cmd>`       | Commande shell à exécuter                                                                              |
| `--condition <expr>`   | Expression qui doit s'évaluer à vrai pour que le hook se déclenche                                     |

## Ports et Fichiers d'environnement

Gérez les ports de service nommés et les modèles de fichiers `.env` matérialisés dans les worktrees de plan :

```terminal
>tendril project port list <project-name>
>tendril project port add <project-name> <port-name> --default-port <port> [--description <desc>]
>tendril project port remove <project-name> <port-name>

>tendril project env-file list <project-name>
>tendril project env-file add <project-name> <path> [--template <file>] [--override KEY=VALUE...]
>tendril project env-file remove <project-name> <path>
```
