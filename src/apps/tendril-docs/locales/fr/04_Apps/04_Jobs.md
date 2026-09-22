---
title: Jobs
description: "Exécutions de promptware en cours et passées : état, coût, durée et sortie en direct."
icon: Activity
searchHints:
  - jobs
  - en cours
  - exécution
  - agents
  - état
---

# Jobs

L'application Jobs est le moniteur d'exécution en temps réel et le journal d'audit historique de Tendril. Chaque appel de [Promptware](../02_Concepts/02_Promptwares.md) (`CreatePlan`, `ExecutePlan`, `UpdatePlan`, `CreatePr`, `SplitPlan`, etc.) s'exécute sous forme d'un job asynchrone suivi ici.

## Vue d'ensemble et progression de l'état

En haut de la vue Jobs, une **Barre de progression empilée** (`StackedProgress`) affiche la répartition en temps réel des états des jobs :

- **Running** (bleu) — Processus d'agents en cours d'exécution active.
- **Completed** (vert) — Exécutions terminées avec succès.
- **Failed** (rouge) — Exécutions terminées avec des erreurs ou des vérifications échouées.
- **Blocked** (ambre) — Jobs en attente de dépendances, de limites de simultanéité ou d'une confirmation de l'opérateur.
- **Pending** (estompé) — Jobs en file d'attente attendant des créneaux d'agents disponibles.

Les commandes d'exécution groupée dans l'en-tête permettent aux opérateurs de lancer **Stop All Queued** ou **Stop All** si nécessaire, ou d'effacer par lot les lignes historiques via le menu déroulant **Clear** (`Clear Completed`, `Clear Failed` ou `Clear All`).

## Le tableau des Jobs

Le tableau utilise le défilement infini avec un tri et un filtrage évalués côté démon :

| Colonne     | Description                                              | Interaction                                                                                                       |
| ----------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Id**      | Identifiant numérique du job (ex. `00042`).              | Cliquez sur l'en-tête pour trier du plus récent au plus ancien.                                                   |
| **Plan Id** | L'identifiant du plan cible.                             | Cliquez pour naviguer directement vers le plan dans [Plans](03_Plans.md).                                         |
| **Status**  | Badge de statut actuel du job.                           | Code couleur selon l'état.                                                                                        |
| **Type**    | Identifiant du promptware (ex. `ExecutePlan`).           | Permet le tri par type de promptware.                                                                             |
| **Project** | Badge du projet.                                         | Stylisé avec la couleur du projet définie dans la [Configuration de projets](../03_Configuration/02_Projects.md). |
| **Output**  | État d'exécution de l'agent (`running`, `done`, `idle`). | **Cliquez pour ouvrir le volet de sortie en direct** (`JobSessionView`) avec terminal en continu.                 |
| **Tokens**  | Nombre total de tokens consommés.                        | **Cliquez pour ouvrir le volet Coûts & Tokens** (`JobCostSheet`).                                                 |
| **Cost**    | Coût d'exécution calculé en USD.                         | **Cliquez pour ouvrir le volet Coûts & Tokens**.                                                                  |
| **Timer**   | Minuteur écoulé en direct ou durée enregistrée.          | Affiche la durée en temps réel.                                                                                   |
| **Date**    | Horodatage du lancement du job.                          | Tri chronologique.                                                                                                |

## Feuilles et volets latéraux

Cliquer sur les cellules ou sur les actions de ligne ouvre des volets latéraux directement par-dessus le tableau sans perdre votre position :

### Volet de sortie en direct (`JobSessionView`)

Cliquer sur la cellule **Output** ouvre la visionneuse d'agent en diffusion continue. Vous visualisez la sortie terminal `stdout`/`stderr` en temps réel de l'agent (journaux de compilation, sorties de tests, appels d'outils et raisonnement de l'agent), et non un simple indicateur de chargement.

### Volet Coûts & Tokens (`JobCostSheet`)

Cliquer sur la cellule **Tokens** ou **Cost** dévoile une ventilation comptable détaillée :

- **Tokens d'entrée (Input Tokens)** — Tokens de prompt et de contexte envoyés au modèle.
- **Tokens de sortie (Output Tokens)** — Tokens générés par le modèle.
- **Tokens de lecture du cache (Cache Read Tokens)** — Tokens servis depuis le cache de prompts (économisant coûts et latence).
- **Tokens d'écriture dans le cache (Cache Write Tokens)** — Tokens inscrits dans le cache de prompts du fournisseur.
- **Tokens de raisonnement (Reasoning Tokens)** — Tokens consacrés aux modèles de raisonnement interne (ex. OpenAI o1/o3 ou réflexion prolongée d'Anthropic).
- **Calcul des coûts** — Coût monétaire rapproché des spécifications tarifaires de [models.dev](https://models.dev).

### Volet du prompt complet

Cliquer sur le texte **Prompt** ouvre le prompt complet non tronqué envoyé à l'agent avec une coloration syntaxique intégrale.

## Menu d'actions de ligne

Chaque ligne de job dispose d'un menu d'actions (`...`) :

| Action          | Disponibilité      | Effet                                                                                                                                                                                           |
| --------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stop**        | Jobs actifs        | Interrompt immédiatement le processus de l'agent. Le worktree [Git](https://git-scm.com) est préservé pour que vous puissiez reprendre ou inspecter le travail partiel.                         |
| **Force Start** | Jobs bloqués       | Contourne les limites de concurrence ou les verrous de dépendance pour lancer le job immédiatement.                                                                                             |
| **Debug**       | Tous les jobs      | Ouvre le **Volet de débogage du job** (`JobDebugSheet`) donnant accès par onglets au Journal du job, au Prompt, à la Sortie brute et au Journal Eventwire, avec des boutons « Open in Editor ». |
| **Delete**      | Terminés / Échoués | Supprime définitivement l'enregistrement du job de l'historique après confirmation.                                                                                                             |
