---
title: Pull Requests
description: Suivez et ouvrez les PR GitHub depuis Tendril après approbation de CreatePr dans Review.
icon: GitPullRequest
searchHints:
  - pull requests
  - pr
  - merge
  - fusion
  - github
---

# Pull Requests

L'application Pull Requests offre un suivi multi-projets pour toutes les pull requests [GitHub](https://github.com) créées à partir de plans Tendril approuvés. Elle propose un tableau de bord unique pour surveiller les PR ouvertes, fusionnées ou fermées, ainsi que les dépenses en tokens et le coût associé à chaque livraison.

## Cycle de vie et flux de travail des PR

1. **Approbation** — Dès qu'un plan a terminé son exécution et qu'il est approuvé dans [Review](02_Review.md), cliquer sur **Create Pull Request** déclenche le promptware `CreatePr` (voir [Promptwares](../02_Concepts/02_Promptwares.md)).
2. **Création** — Tendril utilise la [CLI GitHub](https://cli.github.com) (`gh`) pour pousser la branche du worktree [Git](https://git-scm.com) isolé et ouvrir une pull request sur [GitHub](https://github.com) avec un résumé généré par IA (voir [Intégration GitHub](../07_Integrations/01_Github.md)).
3. **Suivi** — La pull request est associée au plan et suivie dans cette vue jusqu'à sa fusion ou sa fermeture.

## Le tableau des Pull Requests

Le tableau répertorie chaque pull request enregistrée sur vos projets :

| Colonne        | Description                                                | Interaction                                                                                                  |
| -------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Plan**       | `#ID` et titre du plan.                                    | Cliquez pour ouvrir un volet d'aperçu latéral affichant la spécification complète du plan.                   |
| **Project**    | Badge du projet.                                           | Affiche la couleur du projet définie dans la [Configuration de projets](../03_Configuration/02_Projects.md). |
| **Status**     | Badge de statut (`Open`, `Merged`, `Closed` ou `Unknown`). | L'info-bulle au survol affiche l'horodatage de la dernière vérification GitHub.                              |
| **PR**         | Numéro de la pull request GitHub (ex. `#84`).              | Cliquez pour ouvrir la pull request sur [GitHub](https://github.com) dans votre navigateur.                  |
| **Tokens**     | Cumul des tokens consommés par le plan.                    | Nombre de tokens au format compact (ex. `450K`, `1.2M`).                                                     |
| **Cost**       | Coût total en USD de tous les jobs de ce plan.             | Montant formaté en devise.                                                                                   |
| **Repository** | Dépôt GitHub cible (`propriétaire/repo`).                  | Chemin complet du dépôt cible.                                                                               |
| **Branch**     | Nom de la branche Git.                                     | Branche source dans le dépôt.                                                                                |

## Filtrage et synchronisation

- **Filtres d'état** — Utilisez le sélecteur de badges de statut au-dessus du tableau pour filtrer par `Open`, `Merged`, `Closed` ou `Unknown`.
- **Recherche** — Filtrez les lignes en temps réel par identifiant de plan, titre, nom de projet, dépôt ou nom de branche.
- **Ressynchroniser avec GitHub** — Cliquez sur le bouton **Resync** pour exécuter une passe de synchronisation (`gh pr list`) sur tous les dépôts configurés. Tendril signale tout dépôt inaccessible, non authentifié ou soumis à une limitation de débit.

> [!NOTE]
> Les pull requests fusionnées sont considérées comme terminales et ne font pas l'objet d'une nouvelle vérification lors des passes de synchronisation périodiques.

## Actions de ligne

Chaque ligne de pull request propose quatre actions rapides :

- **View Plan** — Ouvre l'espace de travail détaillé du plan dans l'application [Plans](03_Plans.md).
- **Follow Up** — Ouvre la boîte de dialogue New Plan préremplie avec le dépôt, le projet et la référence de la branche afin d'échafauder facilement des tâches de suivi, des corrections de bugs ou des perfectionnements dans [Plans](03_Plans.md).
- **Open PR** — Ouvre la pull request sur [GitHub](https://github.com) dans votre navigateur web.
- **Resync** — Actualise l'état depuis GitHub pour ce dépôt en particulier.
