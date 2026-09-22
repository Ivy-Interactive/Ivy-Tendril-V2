---
title: config
description: Obtenez et définissez les paramètres de configuration de premier niveau de Tendril stockés dans config.yaml directement depuis la ligne de commande.
icon: Settings
searchHints:
  - config
  - configuration
  - paramètres
  - jobTimeout
  - codingAgent
  - planTemplate
  - gitTimeout
  - daemonRequestTimeout
  - llm
---

# config

Obtenez et définissez les paramètres de configuration de premier niveau de Tendril stockés au format [YAML](https://yaml.org) dans `config.yaml` — les mêmes valeurs globales gérées sous Paramètres dans les interfaces bureau et web. Consultez le [Guide de configuration](../../03_Configuration/01_Setup.md) pour plus de détails sur l'environnement et l'organisation des répertoires.

## Commandes

```terminal
>tendril config get <key>
>tendril config set <key> <value>
```

- **`get`** — Affiche la valeur brute sur la sortie standard sans mise en forme décorative, ce qui la rend idéale pour les scripts shell et l'injection directe dans des fichiers ou d'autres outils.
- **`set`** — Valide et met à jour la valeur dans `config.yaml`. Les clés sont insensibles à la casse.

## Clés primitives

Tendril modélise plusieurs clés de configuration primitives avec validation typée :

| Clé                            | Type                               | Par défaut         | Description                                                                                                                                           |
| ------------------------------ | ---------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codingAgent`                  | string                             | `claude`           | Exécutable ou alias de l'agent de codage par défaut (ex. `claude`, `aider`, `codestory`).                                                             |
| `jobTimeout`                   | integer (minutes)                  | `120`              | Délai d'expiration maximal d'exécution pour une tâche de plan en cours.                                                                               |
| `staleOutputTimeout`           | integer (minutes)                  | `10`               | Durée d'inactivité avant qu'une tâche sans sortie ne soit signalée comme bloquée.                                                                     |
| `gitTimeout`                   | integer (minutes)                  | `5`                | Délai d'expiration des commandes pour les opérations [Git](https://git-scm.com).                                                                      |
| `daemonRequestTimeout`         | integer (secondes)                 | `30`               | Délai d'attente en secondes pour les requêtes HTTP vers le démon Tendril local (`0` ou négatif désactive).                                            |
| `maxConcurrentJobs`            | integer                            | `2`                | Nombre maximal autorisé de tâches d'exécution simultanées.                                                                                            |
| `planTemplate`                 | string                             | `""`               | Modèle [Markdown](https://daringfireball.net/projects/markdown/) inséré lors de la création de nouveaux plans.                                        |
| `planFolder`                   | string (facultatif)                | `None`             | Répertoire personnalisé du système de fichiers où sont stockés les fichiers markdown de plan. Passer `""` pour désactiver.                            |
| `promptwareOverlay`            | string (facultatif)                | `None`             | Chemin vers un répertoire de surcouche contenant des promptwares personnalisés. Passer `""` pour désactiver.                                          |
| `telemetry`                    | boolean (facultatif)               | `None`             | Option d'activation de la télémétrie anonyme (`true` ou `false`). Passer `""` pour réinitialiser.                                                     |
| `beta`                         | boolean                            | `false`            | Active les fonctionnalités d'aperçu expérimental (`true` ou `false`).                                                                                 |
| `desktopNotifications`         | boolean                            | `true`             | Active les notifications de bureau système pour l'état des plans et la fin d'activité des agents (`true` ou `false`).                                 |
| `theme`                        | string                             | `default`          | Identifiant de thème de couleurs de l'interface (ex. `default`, `dracula`).                                                                           |
| `worktreeReaperInterval`       | integer (minutes)                  | `60`               | Fréquence des passes de nettoyage automatique des worktrees [Git](https://git-scm.com) (`0` ou négatif désactive).                                    |
| `worktreeReaperGrace`          | integer (minutes)                  | `1440`             | Période de grâce d'inactivité en minutes avant qu'un worktree inactif ne soit considéré comme éligible au nettoyage.                                  |
| `worktreeBranchDeleteMode`     | string                             | `PreserveUnpushed` | Mode de sécurité pour la suppression de branches lors du nettoyage de worktree (`PreserveUnpushed` ou `Force`).                                       |
| `coAuthor`                     | string (facultatif)                | `None`             | Identité d'attribution de signature [Git](https://git-scm.com) au format `Nom <email>` ajoutée aux commits automatiques. Passer `""` pour désactiver. |
| `enrichModels`                 | boolean                            | `true`             | Active la découverte et l'enrichissement automatiques des modèles en arrière-plan (`true` ou `false`).                                                |
| `modelEnrichmentIntervalHours` | integer (heures)                   | `24`               | Intervalle d'actualisation en arrière-plan pour les métadonnées de modèles.                                                                           |
| `modelCacheWarnAgeDays`        | integer (jours)                    | `7`                | Seuil d'âge souple avant qu'un cache de modèles obsolète ne génère des avertissements.                                                                |
| `modelCacheMaxAgeDays`         | integer (jours)                    | `30`               | Seuil d'âge strict après lequel les métadonnées de modèles en cache expirent.                                                                         |
| `llm`                          | objet [JSON](https://www.json.org) | `None`             | Configuration du point de terminaison, de la clé API et du modèle pour le service LLM auxiliaire. Fusionné avec les champs existants.                 |

> [!NOTE]
> Les clés scalaires non modélisées peuvent également être stockées et récupérées ; elles sont conservées dans une table d'attributs supplémentaires dans `config.yaml`.

## Clés structurées

Les paramètres de Tendril contiennent également des listes et des tables de hachage structurées qui ne peuvent être consultées ou modifiées via `tendril config` :

- `projects` — Définitions des projets configurés (à gérer avec [`tendril project`](02_Project.md)).
- `verifications` — Définitions des suites de vérification globales (à gérer avec [`tendril verification`](03_Verification.md)).
- `levels` — Niveaux de complexité des plans et liaisons de vérification.
- `onboarding` — États d'achèvement de l'assistant de première exécution.
- `codingAgents` — Chemins d'accès aux binaires, arguments, variables d'environnement et profils par agent.
- `promptwares` — Instructions, profils et règles d'outils par promptware.
- `inbox` — Règles de notifications entrantes et intégrations de distribution.

Tenter d'exécuter `tendril config get` ou `tendril config set` sur une clé structurée génère une erreur vous invitant à utiliser la commande CLI dédiée ou à éditer directement `config.yaml`.

## Exemples

```terminal
># Lire une valeur de configuration
>tendril config get jobTimeout

># Mettre à jour un paramètre numérique ou textuel
>tendril config set jobTimeout 60
>tendril config set codingAgent claude

># Basculer des options booléennes
>tendril config set desktopNotifications false
>tendril config set beta true

># Fusionner la configuration du LLM auxiliaire
>tendril config set llm '{"model":"gpt-4o"}'

># Réinitialiser un paramètre facultatif en passant une chaîne vide
>tendril config set coAuthor ""
>tendril config set planFolder ""

># Définir un modèle de plan multiligne par substitution de commande shell
>tendril config set planTemplate "$(cat template.md)"

># Réexporter le modèle de plan vers un fichier
>tendril config get planTemplate > template.md
```

> [!TIP]
> Lorsque vous assignez du texte multiligne comme `planTemplate` ou des objets [JSON](https://www.json.org) comme `llm`, utilisez des guillemets shell ou la substitution de commandes (`"$(cat file.md)"`) pour vous assurer que les valeurs sont transmises correctement en tant qu'argument unique.
