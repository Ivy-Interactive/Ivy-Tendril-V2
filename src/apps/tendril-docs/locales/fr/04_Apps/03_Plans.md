---
title: Plans
description: "Plans en brouillon (Draft) ou bloqués (Blocked) : structurez le travail avant l'exécution (PlansApp)."
icon: Feather
searchHints:
  - brouillon
  - plan
  - conception
  - bloqué
  - makeplan
---

# Plans

L'application Plans est l'espace de travail de Tendril pour concevoir, affiner et préparer les travaux d'ingénierie avant d'exécuter des modifications de code. Travailler d'abord sur les plans garantit que les exigences, l'architecture et les étapes de vérification sont claires avant de lancer les sessions d'exécution des agents.

## Gérer les brouillons

- **Créer des plans** — Appuyez sur `Ctrl+Alt+N` (`Cmd+Option+N` sur macOS) ou cliquez sur **+ New Plan** dans l'en-tête du shell pour ouvrir la boîte de dialogue de création.
- **La file d'attente des brouillons** — La barre latérale liste tous les plans à l'état `Draft` ou `Blocked`. Les plans actuellement en cours d'exécution dans des jobs sont temporairement écartés de la file d'attente des brouillons afin d'éviter les modifications concurrentes.
- **Badges** — Chaque brouillon affiche son étiquette `#ID`, son titre, le badge du projet et le badge de niveau de complexité (ex. L1, L2, L3) avec la palette de couleurs de niveau configurée pour le projet.
- **Fond de processus** — Lorsque la file d'attente est vide, Tendril affiche le fond d'écran interactif du cycle de vie des processus avec des raccourcis vers Plans, [Review](02_Review.md) et [Jobs](04_Jobs.md).

## Espace de travail de plan (`PlanWorkspace`)

Sélectionner un plan ouvre l'interface enrichie de l'espace de travail :

### Onglets

- **Plan** — Affiche la dernière révision de la spécification du plan au format [Markdown](https://www.markdownguide.org) avec des listes de contrôle de tâches interactives, la description du problème, l'approche proposée et les critères de vérification.
- **Details** — Métadonnées du plan, contexte du projet attribué (issu de la [Configuration de projets](../03_Configuration/02_Projects.md)), horodatages de création/mise à jour et historique des révisions.
- **Diff View** — Apparaît dès qu'un plan possède plusieurs révisions (`revisionCount > 1`), offrant une comparaison par diff côte à côte ou unifiée entre les révisions.
- **Recommendations** — Liste les [Recommandations](07_Recommendations.md) proactives générées pour ce plan avec des boutons d'arbitrage Accepter et Refuser intégrés.
- **Git** — Apparaît dès que des artefacts d'exécution existent. Suit les worktrees [Git](https://git-scm.com) actifs, les commits enregistrés, les références de PR (voir [Pull Requests](06_PullRequests.md)) et signale si des commits non fusionnés sont menacés, avec un bouton pour synchroniser les worktrees avec les dépôts distants.

### Panneaux et chat

- **Panneau des vérifications** — Accessible depuis le menu déroulant situé dans le coin supérieur droit, ce panneau affiche les barrières de [Vérification](../03_Configuration/01_Setup.md#verifications) configurées (`Build`, `Test`, `Lint`, etc.) avec leur état de réussite/échec en temps réel et leurs journaux de sortie.
- **Chat de plan** — Panneau de discussion interactif intégré (`PlanChatPanel`) pour échanger des idées, affiner l'approche ou poser des questions à l'agent sur le plan avant de lancer les modifications de code.

## Actions de Promptware

Consultez [Promptwares](../02_Concepts/02_Promptwares.md) pour en savoir plus sur l'exécution de ces flux de travail :

| Action               | Rôle                                                                                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ExecutePlan**      | Verrouille la dernière révision du plan, crée une branche de worktree [Git](https://git-scm.com) isolée et lance l'[Agent de codage](../06_CodingAgents/_Index.md) pour implémenter les changements. |
| **ExpandPlan**       | Demande à un agent d'étoffer un bref résumé en un plan structuré comportant des étapes détaillées, les fichiers ciblés et les plans de test.                                                         |
| **SplitPlan**        | Découpe un plan volumineux ou complexe en sous-plans plus ciblés pouvant s'exécuter de manière indépendante.                                                                                         |
| **Shelve to Icebox** | Déplace le plan vers l'[Icebox](05_Icebox.md) afin de désencombrer la file active tout en préservant l'intégralité de son contexte.                                                                  |
| **Delete Plan**      | Demande confirmation pour supprimer définitivement le dossier du plan ainsi que ses enregistrements.                                                                                                 |

## Fichiers sur le disque et synchronisation en temps réel

Chaque plan repose sur un dossier situé sous `$TENDRIL_HOME/plans/<planId>/` :

- `plan.yaml` — Métadonnées du plan au format [YAML](https://yaml.org), état, association de projet et enregistrements de vérification. Voir [Gestion de plans via le CLI](../09_Advanced/01_CLI/01_Plan.md).
- `revisions/` — Fichiers Markdown versionnés (`001.md`, `002.md`, etc.) représentant chaque itération de la spécification.
- `costs.csv` — Registre d'audit des tokens et des coûts en ajout seul.

Tendril s'appuie sur des observateurs du système de fichiers pour détecter les modifications effectuées dans des éditeurs de texte ou des IDE externes, actualisant l'interface utilisateur instantanément sans rafraîchissement manuel.
