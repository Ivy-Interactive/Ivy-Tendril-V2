---
title: Dashboard
description: "Vue d'accueil : nombre de plans, dépenses et tokens, et activité récente sur tous les projets."
icon: ChartBar
searchHints:
  - dashboard
  - statistiques
  - vue d'ensemble
  - graphiques
  - coûts
---

# Dashboard

Le Dashboard est la vue opérationnelle principale de Tendril, offrant une visibilité en temps réel sur le pipeline de développement, les dépenses des agents, la rapidité de livraison et les jobs actifs sur l'ensemble des projets.

## En-tête et aperçu du pipeline

Le haut du Dashboard affiche la date actuelle, un message d'accueil basé sur l'heure et le **Visionneur de processus** (`TendrilProcessViewer`) :

- **Drafts** — Nombre total de plans actuellement à l'état `Draft` en attente d'ajustement ou d'exécution.
- **In-Flight Jobs** — Nombre en direct des jobs d'agents actifs classés par phase de promptware (**Creating**, **Updating**, **Executing**, **Retrying** et **Creating PR**).
- **Review** — Plans dont l'exécution est terminée, en attente d'évaluation et d'approbation par les développeurs.
- **Completed & Failed** — Nombre cumulé de jobs terminés.

Cliquer sur n'importe quelle étape dans le Visionneur de processus redirige directement vers cette vue ([Plans](03_Plans.md), [Jobs](04_Jobs.md) ou [Review](02_Review.md)). L'action **+ New Plan** est également accessible directement depuis le visionneur.

## Indicateurs clés de performance (KPI)

Quatre cartes de KPI principales résument la vélocité et la rentabilité :

| Métrique                 | Signification                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| **Features Shipped**     | Nombre total de plans terminés et de pull requests fusionnées livrés sur tous les projets.        |
| **Avg cost per Feature** | Dépense moyenne en dollars nécessaire pour livrer une fonctionnalité terminée.                    |
| **Forecast This Month**  | Dépense mensuelle projetée calculée à partir du taux de consommation des 30 derniers jours.       |
| **Avg Cost/Plan**        | Coût moyen sur tous les plans exécutés, tenant compte des tokens d'entrée, de sortie et de cache. |

### Volets d'analyse détaillée

Cliquer sur n'importe quelle carte de KPI fait glisser un **Volet d'analyse** approfondie (`BladeContainer`) :

- **Ventilation par projet et par agent** — Identifiez les projets ou agents de codage représentant la plus grande part de consommation de tokens et de coûts.
- **Tableau de ventilation des plans** — Tableau d'audit détaillé par plan indiquant le titre du plan, la durée d'exécution, le nombre de tokens (entrée, sortie, lecture de cache, raisonnement) et le coût total.
- **Navigation directe** — Cliquez sur n'importe quel plan dans le volet d'analyse pour ouvrir sa spécification complète.

## Tendance quotidienne sur 28 jours

La carte **Daily Trend** représente l'activité d'exécution quotidienne et les dépenses en tokens sur une période de 28 jours :

- **Graphique à barres** — Totaux quotidiens de coût et d'activité.
- **Moyenne mobile sur 7 jours** — Courbe de moyenne mobile superposée au graphique pour lisser les variations quotidiennes et mettre en évidence la trajectoire de livraison.

## Pull Requests

La carte **Pull Requests** fournit :

- **Cadence hebdomadaire des PR** — Graphique à barres illustrant les pull requests fusionnées sur une période glissante de 6 semaines.
- **Fusions récentes** — Liste rapide des pull requests [GitHub](https://github.com) récemment fusionnées avec les badges de projet et des liens pour les ouvrir dans [Pull Requests](06_PullRequests.md).

## Jobs actifs

La carte **Active Jobs** affiche jusqu'à huit jobs d'agents en cours d'exécution en temps réel :

- **État en direct** — Affiche le badge d'état (`Running`, `Pending` ou `Blocked`).
- **Plan cible et Promptware** — Identifie le titre du plan ou le type de [Promptware](../02_Concepts/02_Promptwares.md) spécifique (`CreatePlan`, `ExecutePlan`, `UpdatePlan`, etc.).
- **Inspection directe** — Cliquer sur un job ouvre son terminal de sortie en direct dans l'application [Jobs](04_Jobs.md).

## Comptabilité des coûts et des tokens

Chaque exécution de promptware ajoute une ligne au fichier persistant `costs.csv` du plan situé à `$TENDRIL_HOME/plans/<planId>/costs.csv`.

Tendril rapproche ces enregistrements CSV dans sa base de données [SQLite](https://www.sqlite.org) pour calculer les coûts à l'aide des spécifications tarifaires en direct de [models.dev](https://models.dev) (par ex. tokens de prompt, tokens de complétion, lectures/écritures de cache de prompt et tokens de raisonnement). Tous les graphiques reflètent ces chiffres rapprochés avec les couleurs de projet configurées dans la [Configuration de projets](../03_Configuration/02_Projects.md).
