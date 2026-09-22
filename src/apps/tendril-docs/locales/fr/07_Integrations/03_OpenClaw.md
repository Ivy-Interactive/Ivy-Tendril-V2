---
title: OpenClaw
description: Intégrez OpenClaw ou tout outil basé sur des fichiers à Tendril en déposant des fichiers markdown dans le dossier Inbox.
icon: Terminal
searchHints:
  - openclaw
  - inbox
  - dossier
  - observateur de fichiers
  - dossier de dépôt
---

# OpenClaw

## Vue d'ensemble

Tendril surveille un **dossier Inbox** pour détecter les nouveaux fichiers markdown et les convertir automatiquement en [plans](../02_Concepts/01_Plans.md). Cela offre un point d'intégration simple basé sur des fichiers pour des outils externes comme OpenClaw ou des scripts personnalisés qui écrivent des fichiers sur le disque.

## Emplacement du dossier Inbox

```
$TENDRIL_HOME/Inbox/
```

Pour plus de détails sur le répertoire personnel de Tendril et sa configuration, consultez [Installation et configuration](../03_Configuration/01_Setup.md). L'observateur de système de fichiers de Tendril surveille ce répertoire à la recherche de nouveaux fichiers `.md`.

## Format de fichier

Déposez un fichier markdown (`.md`) avec un frontmatter YAML facultatif :

```markdown
---
project: ProjectName
sourcePath: optional/path/to/code
---

Décrivez le plan ici. Ce texte devient la description du plan
et est transmis au [promptware CreatePlan](../02_Concepts/02_Promptwares.md).
```

| Champ        | Requis | Description                                            |
| ------------ | ------ | ------------------------------------------------------ |
| `project`    | Non    | Nom du projet cible (par défaut `Auto`)                |
| `sourcePath` | Non    | Indication de chemin pour le code source correspondant |

Le contenu situé après le frontmatter devient la description du plan.

> [!NOTE]
> Si vous omettez totalement le frontmatter, l'intégralité du contenu du fichier sera utilisée comme description du plan avec les paramètres par défaut.

## Cycle de vie du fichier

1. **Dépôt (Drop)** — Déposez un fichier `.md` dans le dossier Inbox
2. **Traitement** — Le fichier est renommé en `.md.processing` pendant son traitement
3. **Achèvement** — Le fichier est supprimé une fois le plan créé avec succès

## Récupération

Si Tendril redémarre pendant le traitement, tous les fichiers `.md.processing` sont automatiquement renommés en `.md` et traités à nouveau au démarrage.

## Configuration avec OpenClaw

Configurez OpenClaw pour écrire sa sortie sous forme de fichiers markdown dans le dossier Inbox de Tendril. Chaque fichier devient un plan distinct :

1. Définissez le répertoire de sortie sur `$TENDRIL_HOME/Inbox/`
2. Utilisez le format markdown avec un frontmatter YAML pour cibler le projet
3. Tendril détecte automatiquement les nouveaux fichiers — aucun sondage ni appel d'API n'est nécessaire
