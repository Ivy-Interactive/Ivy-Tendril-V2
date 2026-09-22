---
title: Review
description: "File d'attente du travail terminé : plans en Review ou Failed. Rien n'est fusionné sans votre accord."
icon: ThumbsUp
searchHints:
  - review
  - révision
  - approuver
  - rejeter
  - diff
  - vérifier
---

# Review

L'application Review constitue le point de contrôle qualité de Tendril. Lorsqu'un agent termine l'exécution d'un plan via `ExecutePlan` (voir [Promptwares](../02_Concepts/02_Promptwares.md)), le worktree [Git](https://git-scm.com) isolé est conservé et présenté ici pour l'inspection, la vérification et l'évaluation par le développeur. Rien n'est fusionné ni intégré à votre branche par défaut sans l'approbation explicite de l'opérateur.

## La file d'attente Review

La barre latérale liste tous les plans nécessitant l'attention du développeur (plans avec le statut `Review` ou `Failed`) :

- **Badges** — Chaque ligne affiche le `#ID` du plan, le badge du projet et l'état de [Vérification](../03_Configuration/01_Setup.md#verifications) :
  - `Verified` (vert) — Toutes les barrières de vérification obligatoires ont été validées.
  - `Unverified` (avertissement) — Une ou plusieurs barrières de vérification ont échoué, ou n'ont pas encore été exécutées.
  - Indicateur d'état (ex. `Failed`) pour repérer facilement les exécutions nécessitant un dépannage.
- **Raccourcis clavier** — Utilisez `Flèche gauche` et `Flèche droite` (`ArrowLeft` et `ArrowRight`) pour parcourir rapidement les plans dans la file de révision.

## Espace de travail Review

L'espace de travail principal présente l'implémentation du plan ainsi que les outils d'inspection :

- **Aperçu du plan et commentaires** — Lisez la spécification du plan et laissez des commentaires en ligne (`DraftComment`) pour apporter des retours précis ligne par ligne.
- **Barre d'actions de révision** — Les actions de révision configurées pour le projet (définies sous `reviewActions` dans la [Configuration de projets](../03_Configuration/02_Projects.md)) s'affichent sous forme de boutons en un clic dans la barre d'outils (ex. `Run E2E`, `Smoke Test`).
- **Ouvrir la spécification complète et le diff** — Accessible depuis le menu de l'espace de travail, cette option ouvre la page de détails complète du plan dans [Plans](03_Plans.md) afin d'inspecter les diffs multi-révisions, l'accessibilité des commits du worktree git et les artefacts générés.
- **Chat de plan intégré** — Utilisez le panneau intégré `PlanChatPanel` pour poser des questions à l'agent, examiner la logique d'exécution ou clarifier les détails d'implémentation avant d'approuver.

## Actions d'évaluation (Triage)

| Action                      | Contrôle                        | Effet                                                                                                                                                                                               |
| --------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Create Pull Request**     | CTA principal                   | Crée une pull request [GitHub](https://github.com) via la [CLI GitHub](https://cli.github.com) (`gh`), la lie au plan dans [Pull Requests](06_PullRequests.md) et marque le plan comme `Completed`. |
| **Push to PR**              | CTA principal (si PR existante) | Pousse de nouveaux commits de worktree vers la branche d'une pull request existante.                                                                                                                |
| **Request Changes**         | Bouton d'icône (avec badge)     | Ouvre `SuggestChangesDialog` pour soumettre des commentaires et retours, lançant un [Job](04_Jobs.md) `UpdatePlan` dans le worktree existant.                                                       |
| **Accept Partial Delivery** | Bouton secondaire               | Ouvre `PartialDeliveryDialog` pour accepter les parties fonctionnelles d'un livrable tout en conservant les éléments restants en attente.                                                           |
| **Reset to Draft**          | Menu déroulant                  | Ouvre `ResetToDraftDialog` pour replacer le plan à l'état `Draft` dans [Plans](03_Plans.md) afin de redéfinir son périmètre.                                                                        |
| **Delete Plan**             | Menu déroulant (destructif)     | Ouvre `DeletePlanDialog` pour supprimer définitivement le plan et éliminer son worktree isolé.                                                                                                      |
