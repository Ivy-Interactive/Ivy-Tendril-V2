---
title: plan
description: Créez, lisez, mettez à jour et validez des plans depuis le terminal. Toutes les sous-commandes résolvent le dossier de plans à partir de TENDRIL_PLANS, TENDRIL_HOME/Plans ou ~/.tendril/Plans lorsque les variables d'environnement ne sont pas définies.
icon: ListChecks
searchHints:
  - plan
  - create
  - list
  - get
  - set
  - update
  - validate
  - repo
  - pr
  - commit
  - vérification
  - recommandation
  - rec
  - log
  - révision
  - doctor
  - depends
  - related
  - env
  - wireframes
---

# plan

Créez, lisez, mettez à jour et validez des plans depuis le terminal. Toutes les sous-commandes résolvent le dossier de plans à partir de `TENDRIL_PLANS`, `TENDRIL_HOME/Plans` ou `~/.tendril/Plans` lorsque les variables d'environnement ne sont pas définies.

## CRUD

#### plan create

```terminal
>tendril plan create <title> <project> [options]
```

Crée un nouveau dossier de plan et une ébauche `plan.yaml` avec l'état `Draft`. L'ID du plan est alloué automatiquement à partir du fichier `.counter`. Les dépôts et les vérifications par défaut sont déduits de la configuration du projet.

| Option                          | Description                                                        |
| ------------------------------- | ------------------------------------------------------------------ |
| `--level <level>`               | Niveau de priorité (par défaut : Feature)                          |
| `--initial-prompt <text>`       | Texte de l'invite initiale                                         |
| `--source-url <url>`            | URL source (ticket GitHub ou PR)                                   |
| `--execution-profile <profile>` | Profil d'exécution (`deep` ou `balanced`)                          |
| `--priority <number>`           | Numéro de priorité (par défaut : 0)                                |
| `--verification <Name=Status>`  | Entrée de vérification (répétable)                                 |
| `--related-plan <folder>`       | Nom du dossier du plan associé (répétable)                         |
| `--depends-on <folder>`         | Nom du dossier du plan de dépendance (répétable)                   |
| `--chat-session <id>`           | Associer à une session de chat                                     |
| `--plans-dir <path>`            | Remplacer le chemin du répertoire des plans                        |
| `--no-duplicate-check`          | Ignorer la détection des doublons parmi les plans actifs existants |

#### plan list

```terminal
>tendril plan list [options]
```

Liste les plans avec des filtres facultatifs.

| Option                     | Effet                                                                 |
| -------------------------- | --------------------------------------------------------------------- |
| `--status` / `--state <s>` | Filtrer par état (ex. `Draft`, `Executing`, `Failed`)                 |
| `-p, --project <name>`     | Filtrer par nom de projet (validé par rapport aux projets configurés) |
| `--level <level>`          | Filtrer par niveau (ex. `Bug`, `Feature`, `Epic`)                     |
| `--has-pr`                 | Uniquement les plans ayant des PR associées                           |
| `--has-worktree`           | Uniquement les plans ayant des worktrees                              |
| `-q, --search <query>`     | Filtrer par sous-chaîne de recherche dans le titre ou l'ID            |
| `--limit <n>`              | Nombre maximal de résultats                                           |
| `--format <fmt>`           | Format de sortie : `table` (par défaut), `ids`, `folders`, `json`     |
| `--plans-dir <path>`       | Remplacer le chemin du répertoire des plans                           |

```terminal
>tendril plan list --state Draft
>tendril plan list --project Tendril --level Critical
>tendril plan list --state Failed --format ids
>tendril plan list --format json --limit 10
```

> [!NOTE]
> `plan list` affiche les plans (depuis les fichiers `plan.yaml`), et non les tâches (jobs). Pour l'historique des tâches et leur état d'exécution, utilisez plutôt `job list` (voir [Autres commandes](05_Other.md#job-list)).

#### plan get

```terminal
>tendril plan get <plan-id> [field]
```

Affiche le YAML complet ou la valeur d'un seul champ si `[field]` est fourni.

**Champs scalaires :** `id`, `title`, `state`, `project`, `level`, `created`, `updated`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`, `partialDelivery`

**Champs de liste :** `repos`, `prs`, `commits`, `verifications`, `dependsOn`, `relatedPlans`, `recommendations` (chaque élément sur sa propre ligne)

#### plan set

```terminal
>tendril plan set <plan-id> <field> <value> [options]
>tendril plan set <plan-id> state Completed --allow-failed-verifications
```

Met à jour un seul champ et actualise automatiquement l'horodatage `updated`.

Champs pris en charge : `state`, `title`, `level`, `project`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`.

Le passage de `state` à `Completed` est refusé tant qu'une vérification est à l'état `Fail` : un plan indiqué comme terminé alors qu'un contrôle a rejeté le travail masquerait un livrable manquant lors de la détection de doublons. Réexécutez la vérification ou définissez-la sur `Skipped` avec une raison explicite. Passer `--allow-failed-verifications` enregistre la transition malgré tout et active `partialDelivery: true`.

| Option                         | Effet                                                                  |
| ------------------------------ | ---------------------------------------------------------------------- |
| `--allow-failed-verifications` | Autoriser le passage à `Completed` même en cas de vérification échouée |
| `--reason <text>`              | Expliquer la modification (notifié aux sessions de chat à l'écoute)    |
| `--chat-session <id>`          | Session de chat d'origine (exclue de l'auto-notification)              |

#### plan update

```terminal
>cat revised.yaml | tendril plan update <plan-id> --stdin
>tendril plan update <plan-id> --file revised.yaml
```

Remplace l'intégralité du contenu de `plan.yaml` depuis `--file` ou `--stdin` (obligatoire — `--stdin` n'est pas implicite).

#### plan check-wireframes

```terminal
>tendril plan check-wireframes <plan-id>
```

Vérifie l'absence de fuite de code de maquette (wireframe) dans les fichiers modifiés d'un plan. Quitte avec le code 0 si tout est propre, ou avec le code 1 et un rapport de diagnostic si des marqueurs de maquette sont trouvés.

#### plan validate

```terminal
>tendril plan validate <plan-id>
```

Vérifie que le plan possède tous les champs obligatoires et qu'il est cohérent en interne. Quitte avec le code `1` en cas d'erreur structurelle.

## Repos

```terminal
>tendril plan add-repo <plan-id> <repo-path> [--reason <text>] [--chat-session <id>]
>tendril plan remove-repo <plan-id> <repo-path> [--reason <text>] [--chat-session <id>]
```

Gère la liste des dépôts associés à un plan. L'ajout d'un dépôt déjà présent est une opération idempotente sans effet.

## Liens

```terminal
>tendril plan add-pr <plan-id> <pr-url> [--reason <text>] [--chat-session <id>]
>tendril plan remove-pr <plan-id> <pr-url> [--reason <text>] [--chat-session <id>]
>tendril plan add-commit <plan-id> <sha> [--reason <text>] [--chat-session <id>]
>tendril plan add-related-plan <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
>tendril plan remove-related-plan <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
>tendril plan add-depends-on <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
>tendril plan remove-depends-on <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
```

Gère les URL de PR, les SHA de commit, les plans associés et les dépendances bloquantes. `add-depends-on` oblige `ExecutePlan` à attendre que la dépendance atteigne l'état `Completed` et fusionne ses PR avant de s'exécuter. Tous les noms sont insensibles à la casse.

## Vérifications

```terminal
>tendril plan set-verification <plan-id> <name> <status> [--reason <text>] [--chat-session <id>]
>tendril plan verification list <plan-id> [--status <status>] [--json]
>tendril plan verification add <plan-id> <name> [--status <status>] [--reason <text>] [--chat-session <id>]
>tendril plan verification remove <plan-id> <name> [--reason <text>] [--chat-session <id>]
```

Gère les vérifications sur un plan. États valides : `Pending`, `Pass`, `Fail`, `Skipped`. L'état par défaut pour `add` est `Pending`.

## Worktrees

#### plan cleanup

```terminal
>tendril plan cleanup <plan-id> [--force]
```

Supprime tous les worktrees git associés à un plan. Par défaut, s'exécute uniquement sur les plans dans un état terminal (`Completed`, `Failed`, `Skipped`, `Icebox`). Utilisez `--force` pour supprimer les worktrees des plans qui ne sont pas dans un état terminal.

#### plan add-worktree

```terminal
>tendril plan add-worktree <plan-id> <repo> [--base <branch>]
```

Crée un worktree git pour le plan donné sous `<plan-folder>/Worktrees/<repo-name>`, en créant une branche depuis `origin/<base>` (par défaut : branche par défaut détectée automatiquement). La branche est nommée `tendril/<plan-folder-name>`.

#### plan remove-worktree

```terminal
>tendril plan remove-worktree <plan-id> <repo-name> [--branch <branch>]
```

Supprime un seul worktree de `Worktrees/<repo-name>`. Tente d'abord `git worktree remove --force` ; revient à une suppression forcée en cas d'échec. Supprime également la branche associée (`tendril/<plan-folder>` par défaut).

## Révisions

```terminal
>cat revision.md | tendril plan write-revision <plan-id> --stdin
>tendril plan write-revision <plan-id> --file revision.md
```

Écrit un fichier de révision numéroté dans `Revisions/` (par exemple `002.md`) depuis stdin ou `--file`. Prend en charge `--no-question-check` pour contourner la validation, et `--reason` / `--chat-session` pour l'attribution d'audit.

```terminal
>tendril plan get-revision <plan-id> [--number <n>]
```

Affiche le contenu de la révision sur stdout — la dernière révision par défaut, ou une révision numérotée spécifique si `--number` est fourni.

## Questions

Une révision peut comporter des questions pour l'utilisateur dans des blocs de code `questions` :

````markdown
```questions
questions:                    # 1 à 4 éléments
  - id:          string       # obligatoire, stable, unique sur l'ensemble de la révision
    title:       string       # obligatoire, la question
    header:      string       # facultatif, étiquette <= 12 caractères
    description: markdown     # facultatif, contexte affiché sous la question
    multiple:    bool         # facultatif, false par défaut ; true = sélection multiple
    options:                  # 2 à 4 éléments ; omettre entièrement pour une question texte libre
      - title:       string   # obligatoire, 1 à 5 mots
        description: markdown # facultatif
        value:       slug     # obligatoire, ^[a-z0-9][a-z0-9-]*$, référencé par `answer`
        recommended: bool     # facultatif, au maximum un par question
    answer:      value | [values] | string   # rempli lors de la réponse
```
````

`write-revision` valide chaque bloc de questions par rapport à ce schéma et rejette la révision si un bloc est mal formé. Utilisez `--no-question-check` uniquement dans les tests automatisés.

## Recommandations

```terminal
>tendril plan rec list <plan-id> [--state <state>]
>tendril plan rec all [--project <project>] [--state <state>]
>tendril plan rec rebuild
>tendril plan rec add <plan-id> <title> [-d <description>] [--impact <level>]
>tendril plan rec set <plan-id> <title> <field> <value>
>tendril plan rec accept <plan-id> <title> [--notes <text>]
>tendril plan rec decline <plan-id> <title> [--reason <text>] [--edit-reason <text>]
>tendril plan rec remove <plan-id> <title>
```

Gère les recommandations stockées dans le fichier YAML d'un plan :

- **list** — liste les recommandations pour un plan ; filtre par état : `Pending`, `Accepted`, `AcceptedWithNotes`, `Declined`
- **all** — liste les recommandations sur tous les plans
- **rebuild** — reconstruit la projection dénormalisée des recommandations à partir du disque
- **add** — niveaux d'impact : `Small`, `Medium`, `High`
- **set** — champs pris en charge : `title`, `description`, `state`, `impact`, `declineReason`, `notes`
- **accept** — définit l'état sur `Accepted`, ou `AcceptedWithNotes` si `--notes` est fourni
- **decline** — définit l'état sur `Declined`. `--reason` enregistre la raison du refus dans `plan.yaml` ; `--edit-reason` spécifie la raison de notification pour les sessions de chat
- **remove** — supprime définitivement une recommandation

## Environnement

```terminal
>tendril plan env materialize <plan-id> [--repo <repo>] [--force] [--json]
>tendril plan env get <plan-id> [--repo <repo>] [--json]
```

Inspecte et génère les allocations de ports et les fichiers d'environnement du plan :

- **materialize** — alloue des ports de service sans conflit et écrit les fichiers d'environnement dans les worktrees du plan. Utilisez `--force` pour écraser les fichiers existants.
- **get** — affiche les ports alloués et les variables d'environnement résolues pour un worktree.

## Doctor

```terminal
>tendril plan doctor [options]
```

Analyse chaque dossier dans le répertoire des plans et signale les anomalies.

| Option          | Effet                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------ |
| `--fix`         | Migre automatiquement les schémas de plan vers la dernière version                         |
| `--prs`         | Vérifie chaque pull request enregistrée auprès de GitHub via `gh`                          |
| `--prune-husks` | Supprime les dossiers de plans vides qui ne contiennent ni révision ni artefact de travail |
| `--dry-run`     | Avec `--prune-husks`, signale ce qui serait supprimé sans supprimer                        |

```terminal
>tendril plan doctor
>tendril plan doctor --fix
>tendril plan doctor --prs
>tendril plan doctor --prune-husks --dry-run
```

### Rétroportage de livraison partielle

Le rapport énumère les plans marqués `Completed` avec une vérification à l'état `Fail` et sans drapeau `partialDelivery`. Ceux-ci sont antérieurs à la vérification d'achèvement. Pour valider la livraison partielle :

```terminal
>tendril plan set <id> state Completed --allow-failed-verifications
```
