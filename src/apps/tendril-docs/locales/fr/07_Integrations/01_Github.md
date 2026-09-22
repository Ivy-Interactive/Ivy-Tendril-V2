---
title: GitHub
description: Tendril s'intègre à GitHub pour l'importation d'issues, la création automatique de PR et le suivi de l'état des PR.
icon: GitBranch
searchHints:
  - github
  - issues
  - pull requests
  - prs
  - importation
---

# GitHub

## Authentification

Tendril utilise la [CLI GitHub](https://cli.github.com) (`gh`) pour s'authentifier auprès de [GitHub](https://github.com). Exécutez `gh auth login` pour vous authentifier avant d'utiliser les fonctionnalités GitHub.

> [!NOTE]
> Assurez-vous que `gh` est installé et accessible dans votre PATH. Tendril vous invitera à l'installer lors de l'intégration (onboarding) s'il est manquant.

## Importer des issues via l'Inbox

Tendril fournit une vue dédiée **Inbox** dans la barre latérale pour parcourir les issues [GitHub](https://github.com) et les transformer en [plans](../02_Concepts/01_Plans.md) :

1. Ouvrez **Inbox** depuis la barre latérale de navigation.
2. Sélectionnez une catégorie :
   - **My Issues** : Issues qui vous sont assignées sur l'ensemble des dépôts de projets configurés.
   - **Review Requests** : Pull requests ouvertes sollicitant votre revue.
   - **Project Issues** : Toutes les issues ouvertes pour un dépôt de projet sélectionné.
3. Filtrez par termes de recherche, étiquettes (labels) ou jalons (milestones). Une seule requête récupère jusqu'à 1 000 issues ouvertes (le plafond de recherche de GitHub).
4. Sélectionnez une ou plusieurs issues et cliquez sur **Create Plan** pour lancer le [promptware](../02_Concepts/02_Promptwares.md) `CreatePlan`, ou personnalisez la description du plan dans la boîte de dialogue New Plan avant le déclenchement.

Chaque plan créé conserve l'URL source renvoyant directement à l'issue GitHub d'origine.

### Balayage automatique des issues et propositions

Tendril inclut un balayage automatique en arrière-plan pour les issues GitHub qui vous sont assignées :

- Configurez `inbox.checkIntervalMinutes` (ou cliquez sur l'engrenage des Paramètres dans la vue Inbox) pour définir la fréquence à laquelle Tendril interroge GitHub pour trouver de nouvelles issues assignées.
- **Mode Auto-Accept** : Lorsque `inbox.autoAcceptAssignedIssues` est activé, les issues nouvellement découvertes déclenchent immédiatement une tâche `CreatePlan`.
- **Mode Proposals** : Lorsqu'il est désactivé, les issues récupérées sont placées dans un état d'attente sous forme de **Inbox Proposals** dans la vue Inbox. Vous pouvez examiner la description de chaque proposition et choisir d'**Accepter** (déclenchant le plan) ou d'**Ignorer** (enregistrant un historique durable pour éviter toute réimportation de l'issue).
- Cliquez sur **Check Now** dans la barre d'outils de l'Inbox pour déclencher un balayage manuel immédiat sans attendre le minuteur programmé.

## Créer des pull requests

Lorsqu'un plan est terminé et que ses modifications ont été vérifiées, ouvrez la boîte de dialogue **Create PR** pour créer une pull request :

1. Vérifiez et modifiez le titre de la PR généré, sa description et les relecteurs.
2. Configurez les options de la PR :
   - **Solve Merge Conflicts** : Tente automatiquement de résoudre les conflits de fusion de branche avec la branche de base cible.
   - **Merge** : Fusionne la PR une fois les vérifications validées (décochez pour ouvrir la PR à la revue d'équipe sans fusionner).
   - **Delete Branch** : Supprime la branche du worktree une fois la fusion effectuée.
   - **Include Artifacts** : Joint les artefacts de vérification du plan, les captures d'écran et les journaux au corps de la PR.
   - **Create as Draft** : Ouvre la pull request avec le statut de brouillon (draft).
3. Tendril exécute le [promptware](../02_Concepts/02_Promptwares.md) `CreatePr` via `gh` pour pousser la branche, créer la pull request et associer l'URL de la PR au plan.

## Suivi de l'état des PR

La [vue Pull Requests](../04_Apps/06_PullRequests.md) dans la barre latérale permet de suivre l'ensemble des pull requests ouvertes, fusionnées et fermées sur tous vos projets. Tendril surveille les changements d'état des PR, synchronisant automatiquement votre [tableau de plans](../04_Apps/03_Plans.md) sans intervention manuelle.
