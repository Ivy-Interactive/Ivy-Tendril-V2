---
title: Cycle de vie et jobs
description: >-
  Un job correspond à une exécution d'un promptware. Voici ce qui se produit pendant son exécution — statut, sorties,
  vérifications et coûts.
icon: RefreshCw
searchHints:
  - job
  - cycle de vie
  - statut
  - vérification
  - worktree
  - concurrence
  - coût
  - jetons
  - file d'attente
  - stop-all
---

# Cycle de vie et jobs

Chaque fois que Tendril accomplit une tâche pour votre compte, il génère un **job** : une exécution d'un
[agent de flux de travail (promptware)](02_Promptwares.md) unique sur un [plan](01_Plans.md) donné. Les jobs constituent le moyen
par lequel un plan progresse dans son cycle de vie, et sont ce que vous observez en temps réel dans l'application de bureau et la CLI.

## Statuts d'un job

| Statut        | Signification                                                                        |
| ------------- | ------------------------------------------------------------------------------------ |
| **Pending**   | Créé, pas encore admis dans la file d'attente.                                       |
| **Queued**    | En attente d'un créneau de concurrence libre.                                        |
| **Running**   | Le processus de l'agent de programmation est en cours d'exécution active.            |
| **Completed** | Terminé avec succès et validé par l'ensemble des barrières requises.                 |
| **Failed**    | L'agent a rencontré une erreur ou des contrôles de vérification requis ont échoué.   |
| **Timeout**   | A dépassé la limite de durée d'exécution impartie et a été interrompu.               |
| **Stopped**   | Interrompu suite à une action utilisateur.                                           |
| **Blocked**   | Ne peut continuer — en attente d'un job dépendant, d'identifiants ou d'un arbitrage. |

## La boucle d'exécution

1. **File d'attente (Queue)** — le job est créé et mis en attente derrière les tâches en cours d'exécution.
2. **Préparation (Prepare)** — pour les promptwares qui modifient le code ([ExecutePlan](02_Promptwares.md),
   [RetryPlan](02_Promptwares.md)), Tendril alloue un
   [Git worktree](https://git-scm.com/docs/git-worktree) isolé par dépôt dans le dossier
   `Worktrees/{repo-name}/` du plan. L'exécution ne touche ni ne verrouille jamais votre clone de travail principal.
3. **Implémentation (Implement)** — l'agent de flux de travail parcourt les phases du plan, en créant des commits incrémentaux.
4. **Vérification (Verify)** — chaque barrière de vérification configurée s'exécute au sein du worktree et consigne son résultat.
5. **Rapport (Report)** — les journaux de sortie, les coûts en jetons et l'état révisé du plan sont sauvegardés sur le disque et transmis au
   démon.

L'interruption d'un job réinitialise le plan à l'état où il se trouvait avant son lancement, tout en préservant l'état du
worktree pour vous permettre d'analyser l'avancement partiel. Voir [Plans](01_Plans.md) pour la table exhaustive des états.

## Vérifications

Une vérification est une barrière de qualité automatisée enregistrée dans `plan.yaml`. Chaque contrôle génère un résultat —
`Pass`, `Fail` ou `Skipped` — accompagné d'un compte-rendu exhaustif dans le dossier `Verification/` du plan.
Les contrôles activés dépendent de la nature des fichiers modifiés par le plan :

| Vérification    | Contrôles                                                                          |
| --------------- | ---------------------------------------------------------------------------------- |
| **NpmBuild**    | L'espace de travail pnpm / npm compile sans aucune erreur.                         |
| **NpmLint**     | Le linting et le formatage passent sur les paquets TypeScript / JavaScript.        |
| **NpmTest**     | Les suites de tests automatisées réussissent (Vitest, Jest, etc.).                 |
| **RustBuild**   | Les paquets Cargo compilent sans avertissements ni erreurs du compilateur.         |
| **RustClippy**  | Le linter Clippy ne remonte aucun avertissement ni erreur.                         |
| **RustFormat**  | `cargo fmt --check` valide la cohérence du formatage.                              |
| **RustTest**    | Les suites de tests unitaires et d'intégration Rust réussissent.                   |
| **Screenshots** | Des captures visuelles probantes ont été saisies pour les changements d'interface. |
| **CheckResult** | La confirmation de bout en bout propre à l'agent quant au respect du plan.         |

Une vérification non applicable à un plan est signalée comme `Skipped` plutôt qu'omise silencieusement,
assurant ainsi une traçabilité rigoureuse. Un plan ne passe à l'état **Review** que lorsque ses vérifications obligatoires sont validées.
En cas d'échec d'une vérification, le plan bascule en **Failed**, et
[RetryPlan](02_Promptwares.md) peut effectuer une nouvelle tentative en s'appuyant sur le message d'erreur exact
et le diff en cours comme contexte.

> [!TIP]
> Si une vérification échoue, examinez le rapport sous `Verification/` et lancez la commande directement dans
> le worktree du plan. Le contrôle est généralement exact et il manque simplement au worktree une dépendance
> ou un artéfact de compilation — voir [Intégration d'une base de code](../01_GettingStarted/03_Onboarding.md).

## Concurrence et worktrees

Plusieurs jobs peuvent tourner en simultané, selon la valeur de `maxConcurrentJobs` définie dans
[~/.tendril/config.yaml](../03_Configuration/01_Setup.md) (valeur par défaut `20`) :

```yaml
maxConcurrentJobs: 4
```

Chaque plan en cours d'exécution évoluant dans des [git worktrees](https://git-scm.com/docs/git-worktree) dédiés,
les jobs parallèles sur un même dépôt n'entrent pas en collision. Toutefois, les exécutions concurrentes partagent votre processeur, votre mémoire vive et
les quotas d'API de vos agents ; pensez à calibrer `maxConcurrentJobs` selon la puissance de votre machine.

## Suivi des coûts

Chaque exécution enregistre les jetons consommés et l'estimation financière associée. Le journal d'audit pérenne correspond au fichier
`costs.csv` du plan, enrichi d'une ligne par exécution :

```csv
Promptware,Tokens,Cost,Model,CostSource,Agent
ExecutePlan,148213,1.9042,claude-opus-5,api,claude
```

Lorsqu'un agent fonctionne via un abonnement forfaitaire (ou un modèle local tel qu'Apple Foundation Models), le
champ `Cost` reste vide plutôt que d'afficher zéro, ce qui permet de tracer le volume de jetons sans inventer
de montants facturés.

## Pilotage et supervision des jobs

L'application de bureau affiche l'état des jobs en temps réel et diffuse la sortie du terminal via le flux
WebSocket du démon. La CLI offre une équivalence intégrale :

```bash
# Lister l'ensemble des jobs actifs et récents
tendril job list

# Filtrer les jobs par statut
tendril job list --status Running
tendril job list --status Failed

# Consulter l'ordre de la file d'attente et les créneaux disponibles
tendril job queue

# Forcer l'exécution immédiate d'un job en attente ou bloqué
tendril job force-start <job-id>

# Annuler un job en cours d'exécution
tendril job cancel <job-id> -m "Stopping for review"

# Interrompre l'ensemble des jobs en cours, en file d'attente ou bloqués
tendril job stop-all

# Purger de la base de données les jobs terminés ou en échec
tendril job clear --completed
tendril job clear --failed
```

Les journaux complets et les transcriptions de chaque exécution sont archivés définitivement sur le disque sous
`$TENDRIL_HOME/Jobs/{jobId}-{planId}-{promptware}/`, incluant le prompt système d'origine, les traces des outils
exécutés et les échanges bruts avec l'agent.

## Prochaines étapes

- [Plans](01_Plans.md) — les statuts entre lesquels les jobs font évoluer un plan.
- [Promptwares](02_Promptwares.md) — le contenu concret exécuté au sein d'un job.
- [Dépannage](../01_GettingStarted/06_Troubleshooting.md) — diagnostiquer les jobs bloqués ou défaillants.
