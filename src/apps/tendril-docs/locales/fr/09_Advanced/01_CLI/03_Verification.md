---
title: verification
description: Gérez les définitions de vérification globales stockées dans config.yaml. Celles-ci peuvent être référencées par les projets et les plans.
icon: ClipboardCheck
searchHints:
  - verification
  - verify
  - check
  - prompt
  - definition
  - gates
---

# verification

Gérez les définitions globales de vérification stockées dans `config.yaml`. Les portes de vérification définissent des contrôles automatisés de qualité, de compilation et de test que les agents de codage doivent satisfaire avant qu'un [plan](01_Plan.md) ne puisse passer à l'état `Completed`. Elles sont assignées aux projets via [`tendril project add-verification`](02_Project.md#verifications).

## Commandes

```terminal
>tendril verification list [--json]
>tendril verification get <name>
>tendril verification add <name> [--prompt <text>]
>tendril verification set <name> [--new-name <name>] [--prompt <text>]
>tendril verification remove <name> [--force]
```

- **list** — affiche toutes les vérifications globales enregistrées. Passez `--json` pour générer une sortie au format JSON structuré.
- **get** — affiche le nom de la vérification et le texte complet de l'invite d'évaluation sur stdout.
- **add** — enregistre un nouveau contrôle de vérification avec une description d'invite facultative.
- **set** — met à jour l'invite d'une définition de vérification ou la renomme. Renommer une vérification met à jour automatiquement toutes les références de projet, les enregistrements YAML de plan et les lignes de la base de données.
- **remove** — supprime une définition de vérification. Si un projet actif fait référence au contrôle, Tendril refuse la suppression sauf si `--force` (ou `-f`) est fourni, ce qui nettoie les références sur tous les projets.

## Exemples

```terminal
># Ajouter une nouvelle porte de vérification avec des instructions d'invite
>tendril verification add CargoTest --prompt "Run cargo test --workspace and ensure all test suites pass with exit code 0."

># Inspecter les détails complets de l'invite
>tendril verification get CargoTest

># Mettre à jour l'invite d'évaluation
>tendril verification set CargoTest --prompt "Run cargo test --workspace --all-targets and verify zero test failures."

># Renommer une définition de vérification dans l'ensemble des projets et des plans
>tendril verification set CargoTest --new-name RustWorkspaceTests

># Lister toutes les définitions au format JSON
>tendril verification list --json

># Supprimer une vérification en nettoyant les références de projet
>tendril verification remove RustWorkspaceTests --force
```

## Liens associés

- [vérifications de projet](02_Project.md#verifications) — configurer quels contrôles sont requis pour un projet
- [vérifications de plan](01_Plan.md#verifications) — inspecter ou remplacer les états des portes de vérification sur un plan
- [Référence de configuration](../../03_Configuration/01_Setup.md) — gérer les paramètres globaux dans `config.yaml`
