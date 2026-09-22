---
title: Base de données
description: Gérez la base de données locale SQLite qui stocke les données de synchronisation des plans, les recommandations, l'historique des tâches et le suivi des coûts.
icon: Database
searchHints:
  - base de données
  - db
  - migrate
  - migration
  - schéma
  - version
  - reset
  - sqlite
  - intégrité
  - vacuum
---

# Base de données

Gérez la base de données locale [SQLite](https://www.sqlite.org) (`<TendrilHome>/tendril.db`) qui stocke les [données de synchronisation des plans](../../02_Concepts/01_Plans.md), [l'historique des tâches](../../04_Apps/04_Jobs.md), les recommandations et le suivi des coûts. Dans Tendril v2, toute la gestion de la base de données s'effectue via l'arborescence de sous-commandes `tendril db`.

## Commandes

#### db version

```terminal
>tendril db version
```

Inspecte le schéma de la base de données sans appliquer de migrations. Affiche la version actuelle de la base de données, la dernière version attendue par le binaire installé et l'état de la migration (`Up to date`, `Needs migration` ou `Newer than application`).

```terminal
Database version: 12
Latest version:   12
Status:           Up to date
```

#### db migrate

```terminal
>tendril db migrate
```

Applique toutes les migrations en attente pour mettre à jour le schéma de la base de données. Peut être exécuté plusieurs fois en toute sécurité : les migrations déjà appliquées sont ignorées de manière idempotente.

> [!NOTE]
> `tendril run` applique automatiquement les migrations en attente avant de démarrer le serveur démon, la migration manuelle est donc rarement requise.

#### db reset

```terminal
>tendril db reset
>tendril db reset --force
```

Supprime toutes les tables de `tendril.db` et recrée le schéma à partir de zéro. Demande confirmation sauf si `--force` est fourni. Refuse de s'exécuter si le démon est actuellement actif, sauf si `--force` est fourni.

> [!WARNING]
> La réinitialisation supprime tous les enregistrements de la base de données (historique des tâches mis en cache, télémétrie, recommandations). Vos [fichiers YAML de plan](01_Plan.md) et fichiers markdown de révision sur le disque restent totalement intacts.

#### db integrity

```terminal
>tendril db integrity
```

Exécute un [PRAGMA integrity_check](https://www.sqlite.org/pragma.html#pragma_integrity_check) SQLite sur l'ensemble des tables, index et pages. Affiche le résultat de chaque vérification et quitte avec le code 1 si une corruption ou une anomalie structurelle est détectée.

#### db vacuum

```terminal
>tendril db vacuum
>tendril db vacuum --force
```

Exécute le [VACUUM](https://www.sqlite.org/lang_vacuum.html) SQLite pour défragmenter la base de données, reconstruire les index et récupérer l'espace disque inutilisé. Indique la taille de la base de données avant et après l'exécution, ainsi que le total des octets récupérés.

## Liens associés

- [Vue d'ensemble de la CLI](00_Overview.md) — options globales, chemins des répertoires de données et vérifications d'état de l'installation
- [Commandes plan](01_Plan.md) — créer, lister et valider des plans stockés sur le disque
