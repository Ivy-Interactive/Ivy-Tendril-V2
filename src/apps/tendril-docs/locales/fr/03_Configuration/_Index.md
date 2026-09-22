---
title: Configuration
description: Configurez les paramètres de Tendril, les variables d'environnement, les options du démon et les profils de projet.
icon: Settings
groupExpanded: true
searchHints:
  - configuration
  - paramètres
  - options
  - préférences
  - environnement
---

# Configuration

Tendril stocke ses paramètres, ses projets et ses préférences d'exécution dans un fichier de configuration centralisé au format [YAML](https://yaml.org) situé dans `$TENDRIL_HOME/config.yaml`.

Cette section traite de la configuration de l'environnement global de Tendril, de la gestion de la [Configuration de projets](02_Projects.md), de l'ajustement des paramètres du démon et de la configuration des profils d'[Agents de codage](../06_CodingAgents/_Index.md) :

- [Configuration et paramètres](01_Setup.md) — Configurez les options globales dans l'interface Paramètres ou dans `$TENDRIL_HOME/config.yaml`, gérez les [Agents de codage](../06_CodingAgents/_Index.md), l'authentification des sessions, les tunnels [Cloudflare](https://www.cloudflare.com) et les [Vérifications](01_Setup.md#verifications) intégrées.
- [Configuration de projets](02_Projects.md) — Enregistrez des dépôts [Git](https://git-scm.com), configurez des pastilles de couleur visuelles, des pipelines de vérification, des actions de révision, des allocations de ports, le sandboxing [Docker](https://www.docker.com), des serveurs [MCP](../09_Advanced/03_MCP.md) et l'isolation par [worktrees Git](02_Projects.md#repositories--git-worktrees).

Pour comprendre le fonctionnement conceptuel des plans et des promptwares, consultez [Plans](../02_Concepts/01_Plans.md), [Promptwares](../02_Concepts/02_Promptwares.md) et [Cycle de vie d'un plan](../02_Concepts/03_Lifecycle.md).
