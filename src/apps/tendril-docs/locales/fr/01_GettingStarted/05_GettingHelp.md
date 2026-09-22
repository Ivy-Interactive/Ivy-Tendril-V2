---
title: Obtenir de l'aide
description: Vous rencontrez une difficulté ? Voici comment obtenir de l'assistance et échanger avec la communauté Tendril.
icon: LifeBuoy
searchHints:
  - aide
  - support
  - discord
  - tickets github
  - communauté
  - rapport de bogue
  - report-bug
  - doctor
---

# Obtenir de l'aide

Si vous rencontrez des dysfonctionnements ou des questions quant à la configuration de Tendril, de nombreuses ressources
d'aide et outils de diagnostic sont à votre disposition.

## Lancer d'abord le diagnostic

Avant de soumettre un ticket ou de solliciter de l'aide, lancez le vérificateur d'environnement intégré de Tendril :

```bash
tendril doctor
```

`tendril doctor` contrôle le dossier `$TENDRIL_HOME`, la syntaxe de `config.yaml`, l'accessibilité de la
base [SQLite](https://www.sqlite.org), le répertoire des [plans](../02_Concepts/01_Plans.md), [Git](https://git-scm.com/) et
l'authentification à la [CLI GitHub](https://cli.github.com/).

Si un plan ou un job particulier a échoué, vous pouvez regrouper l'ensemble des diagnostics à l'aide de `tendril report-bug` :

```bash
# Regroupe l'état du plan, les rapports de vérification et les journaux du job dans un fichier zip
tendril report-bug <plan-id>
```

Une archive de diagnostic est alors générée, contenant le fichier YAML du plan, l'historique des révisions, les rapports de vérification
et les transcriptions brutes de l'agent, le tout sans exposer d'identifiants sensibles.

## Dépannage

Pour connaître les messages d'erreur courants, les migrations de base de données et les procédures de restauration de worktrees, consultez
[Dépannage](06_Troubleshooting.md).

## Communauté Discord

Le moyen le plus rapide de joindre l'équipe de développement et d'autres utilisateurs est notre
[serveur Discord](https://discord.gg/FHgxkDga3y). Venez y poser vos questions, partager vos retours et échanger autour des flux
de travail personnalisés basés sur les promptwares.

## Tickets GitHub

Vous avez identifié un bogue ou souhaitez suggérer une fonctionnalité ? Ouvrez un ticket sur notre
[dépôt GitHub](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/issues).

> [!TIP]
> Joignez systématiquement la sortie de `tendril doctor` et de `tendril version` à la description de votre ticket. Si
> vous signalez l'échec de l'exécution d'un plan, joignez l'archive zip générée par `tendril report-bug <plan-id>`
> ou le journal du job présent dans `$TENDRIL_HOME/Jobs/`.

## Prochaines étapes

- [Dépannage](06_Troubleshooting.md) — erreurs fréquentes et solutions associées.
- [Cycle de vie et jobs](../02_Concepts/03_Lifecycle.md) — comprendre les statuts des jobs et la gestion des erreurs.
