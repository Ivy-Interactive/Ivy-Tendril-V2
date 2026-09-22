---
title: Concepts
description: Les trois principes fondamentaux sur lesquels repose Tendril — les plans, les promptwares et les jobs.
icon: Layers
groupExpanded: true
searchHints:
  - concepts
  - modèle
  - architecture
  - plan
  - promptware
  - job
---

# Concepts

Tendril repose sur un modèle conceptuel concis, et chaque élément de l'application de bureau comme de la CLI se rattache à
l'une de ces trois primitives fondamentales :

- [Plans](01_Plans.md) — l'unité de travail élémentaire. Un plan est un dossier transparent sur le disque, une machine
  à états, une suite immuable de révisions, des annotations contextuelles et des vérifications automatisées.
- [Promptwares](02_Promptwares.md) — des agents de flux de travail à tâche unique qui font progresser un plan d'un état
  au suivant, chacun doté de son propre prompt système, d'un accès restreint aux outils et d'une mémoire pérenne.
- [Cycle de vie et jobs](03_Lifecycle.md) — une exécution d'un promptware sur un plan constitue un job :
  statut, télémétrie, worktrees git isolés, suivi des coûts et barrières de qualité déterminant si le travail
  peut être soumis à révision.

Si vous n'avez pas encore expérimenté ce flux, le [Tutoriel](../01_GettingStarted/04_Tutorial.md) illustre ces
primitives en situation réelle. Vous pouvez également consulter [Intégration d'une base de code](../01_GettingStarted/03_Onboarding.md)
pour adapter vos dépôts aux worktrees parallèles.
