---
title: Recommandations
description: Suggestions de suivi (refactorisations, propreté, tests) déduites de vos dépôts, sans ticket manuel requis.
icon: Lightbulb
searchHints:
  - recommandations
  - suggestions
  - auto
---

# Recommandations

L'application Recommandations est le centre d'arbitrage de Tendril pour les améliorations du code source suggérées par IA, l'ajout de couverture de tests, les nettoyages architecturaux et la gestion de la dette technique identifiée lors de l'exécution des plans.

## Origine et éligibilité

À mesure que les [Agents de codage](../06_CodingAgents/_Index.md) analysent, exécutent et vérifient les plans, ils mettent en lumière des améliorations connexes (par exemple, cas limites non testés, dépendances obsolètes, opportunités de refactorisation ou goulots d'étranglement de performances).

Pour que les recommandations restent actionnables et pour éviter le travail prématuré :

- Seules les recommandations issues de plans terminés (**Completed**) apparaissent dans l'application Recommandations (voir [Cycle de vie d'un plan](../02_Concepts/03_Lifecycle.md)).
- Les recommandations issues de plans échoués ou en cours d'exécution restent rattachées à leur plan d'origine jusqu'à ce que celui-ci aboutisse.

## La file d'attente Recommandations

La barre latérale présente toutes les recommandations en attente :

- **Étiquette du plan d'origine** — Affiche le numéro du plan source (ex. `#14`).
- **Titre** — Description concise de l'amélioration suggérée.
- **Badge du projet** — Identifie le dépôt de projet ciblé par la recommandation (configuré dans la [Configuration de projets](../03_Configuration/02_Projects.md)).
- **Badge d'impact** — Évaluation de l'urgence et de la valeur avec code couleur :
  - `High` (vert) — Corrections critiques, refactorisations majeures ou manques essentiels de tests.
  - `Medium` (ambre) — Nettoyages, améliorations de maintenabilité ou optimisations non bloquantes.
  - `Low` (neutre) — Finitions mineures ou retouches cosmétiques.

## Vue détaillée et actions d'arbitrage

Sélectionner une recommandation affiche son argumentation technique complète, l'évaluation de son impact et un lien pour ouvrir le **Plan d'origine** dans [Plans](03_Plans.md).

Les développeurs peuvent traiter les recommandations via quatre actions principales :

| Action                  | Contrôle              | Effet                                                                                                                                                                                                                                                      |
| ----------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Accept**              | Bouton CircleCheck    | Marque la recommandation comme `Accepted` et lance immédiatement un [Job](04_Jobs.md) `CreatePlan` en arrière-plan (voir [Promptwares](../02_Concepts/02_Promptwares.md)) pour échafauder un nouveau brouillon d'implémentation dans [Plans](03_Plans.md). |
| **Accept with Notes**   | Bouton Check          | Ouvre `RecommendationNoteDialog` permettant au développeur d'ajouter des contraintes ou des exigences spécifiques. L'agent reçoit à la fois la recommandation d'origine et les notes de l'opérateur.                                                       |
| **Decline**             | Bouton X              | Marque la recommandation comme `Declined` avec des notes de refus facultatives, la retirant de la file d'attente des éléments en cours.                                                                                                                    |
| **Create GitHub Issue** | Bouton d'icône GitHub | Ouvre `CreateIssueDialog` pour déclarer directement la recommandation sous forme d'issue [GitHub](https://github.com) via la [CLI GitHub](https://cli.github.com) (`gh`) dans le dépôt du projet. Laisse la recommandation à l'état `Pending`.             |

Dès qu'une action est terminée, Tendril passe automatiquement à la recommandation suivante dans la file d'attente, permettant une revue rapide des améliorations proposées.
