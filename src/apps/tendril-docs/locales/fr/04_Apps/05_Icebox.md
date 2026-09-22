---
title: Icebox
description: Plans de faible priorité ou pour « plus tard » à l'état Icebox afin de garder les brouillons ciblés.
icon: Snowflake
searchHints:
  - icebox
  - mise de côté
  - réserve
  - backlog
---

# Icebox

L'Icebox est le backlog dédié et l'espace de stationnement de Tendril pour les plans d'ingénierie différés, de faible priorité ou futurs. Mettre des plans de côté permet de garder la file d'attente active des brouillons dans [Plans](03_Plans.md) concentrée sur les priorités du sprint actuel sans perdre les recherches, les discussions ou les spécifications rédigées (voir [Cycle de vie d'un plan](../02_Concepts/03_Lifecycle.md)).

## Mettre des plans de côté (Shelving)

Un plan peut être mis de côté à tout moment lorsqu'il est à l'état `Draft` ou `Blocked` :

- Dans l'application [Plans](03_Plans.md), sélectionnez **Shelve to Icebox** dans le menu d'actions.
- Tendril passe le statut du plan à `Icebox`.
- Le dossier du plan situé sous `$TENDRIL_HOME/plans/<planId>/`, ses révisions versionnées et ses enregistrements de coûts restent entièrement préservés sur le disque (voir [Gestion de plans via le CLI](../09_Advanced/01_CLI/01_Plan.md)).

## Exploration et filtrage

L'application Icebox propose une recherche et des filtres ciblés sur votre backlog :

- **Barre de recherche** — Filtrez les plans par mots-clés du titre ou par l'identifiant numérique `#ID` du plan.
- **Filtre de projet** — Restreignez les plans mis de côté à un projet spécifique configuré dans la [Configuration de projets](../03_Configuration/02_Projects.md).
- **Filtre de niveau** — Filtrez les plans par niveau de complexité (ex. L1, L2, L3 configurés dans [Configuration et paramètres](../03_Configuration/01_Setup.md#in-app-settings)).

## Cartes de plan et actions

Chaque plan mis de côté est affiché sous forme de carte présentant son étiquette `#ID`, son titre, le badge du projet, le badge de niveau de complexité et les indicateurs de vérification :

| Action           | Contrôle                      | Effet                                                                                                                                                                                                                                 |
| ---------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inspect Plan** | Clic sur le titre de la carte | Ouvre l'espace de travail du plan dans [Plans](03_Plans.md) pour examiner la spécification complète, les métadonnées ou les révisions antérieures.                                                                                    |
| **Thaw**         | Bouton d'icône de flamme      | Fait repasser le plan de `Icebox` à `Draft` de manière optimiste. Le plan quitte l'Icebox immédiatement et réintègre la file active de [Plans](03_Plans.md), prêt à être exécuté via [ExecutePlan](../02_Concepts/02_Promptwares.md). |
| **Delete**       | Bouton d'icône de poubelle    | Ouvre `DeletePlanDialog` pour supprimer définitivement le dossier du plan, ses révisions et ses enregistrements en base de données.                                                                                                   |
