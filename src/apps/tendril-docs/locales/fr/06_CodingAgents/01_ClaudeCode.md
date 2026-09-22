---
title: Claude Code
description: Claude Code est l'agent de codage par défaut dans Tendril, propulsé par les modèles Claude d'Anthropic.
icon: Bot
searchHints:
  - claude
  - claude code
  - anthropic
  - agent de codage
  - agent ia
---

# Claude Code

## Configuration

Définissez Claude Code comme agent de codage dans `config.yaml` :

```yaml
codingAgent: claude
```

Ou sélectionnez-le dans **Settings > Coding Agent**.

Pour plus de détails sur la structure et les paramètres de `config.yaml`, consultez [Installation et paramètres](../03_Configuration/01_Setup.md).

## Prérequis

- La CLI [Claude Code](https://code.claude.com/docs) doit être installée et accessible sous le nom `claude` dans votre PATH. Utilisez l'installateur natif ou le cask [Homebrew](https://brew.sh) :
  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  # ou : brew install --cask claude-code
  ```
- Authentifiez-vous avant d'utiliser Tendril en exécutant `claude auth login` (ou `claude login`). Claude Code requiert un forfait [Anthropic](https://www.anthropic.com) Pro, Max, Team, Enterprise ou [Console](https://console.anthropic.com) (l'offre gratuite de claude.ai n'inclut pas l'accès CLI).
- Pour les environnements sans interface graphique (headless) ou les backends alternatifs, définissez `ANTHROPIC_API_KEY`, ou configurez [AWS Bedrock](https://aws.amazon.com/bedrock/) (`CLAUDE_CODE_USE_BEDROCK=1`) ou [Google Cloud Vertex AI](https://cloud.google.com/vertex-ai) (`CLAUDE_CODE_USE_VERTEX=1`).

## Profils

Tendril associe les niveaux d'effort aux modèles Claude :

| Profil     | Modèle | Effort | Cas d'usage                                           |
| ---------- | ------ | ------ | ----------------------------------------------------- |
| `deep`     | opus   | max    | Modifications multi-fichiers complexes, architecture  |
| `balanced` | sonnet | high   | Exécution standard de plans, majorité des tâches      |
| `quick`    | haiku  | low    | Corrections simples, formatage, petites modifications |

Le profil est sélectionné automatiquement en fonction du [niveau de complexité du plan](../02_Concepts/01_Plans.md), ou peut être configuré par [promptware](../02_Concepts/02_Promptwares.md) dans `config.yaml`.

## Modèles disponibles

| Modèle           | ID                 | Fenêtre de contexte | Tarification (entrée / sortie par MTok) |
| ---------------- | ------------------ | ------------------- | --------------------------------------- |
| Claude Fable 5.1 | `claude-fable-5-1` | 1M                  | $10.00 / $50.00                         |
| Claude Opus 5    | `claude-opus-5`    | 1M                  | $5.00 / $25.00                          |
| Claude Opus      | `opus`             | 1M                  | $5.00 / $25.00                          |
| Claude Sonnet 5  | `claude-sonnet-5`  | 1M                  | $2.00 / $10.00                          |
| Claude Sonnet    | `sonnet`           | 1M                  | $2.00 / $10.00                          |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200k                | $1.00 / $5.00                           |
| Claude Haiku     | `haiku`            | 200k                | $1.00 / $5.00                           |

`opus`, `sonnet` et `haiku` sont des alias de Claude Code qui suivent le modèle actuel d'Anthropic pour ce niveau, tandis que `claude-opus-5` (la valeur par défaut du catalogue) et `claude-fable-5-1` sont des identifiants figés.

Le tarif de lancement de Claude Sonnet de $2.00 / $10.00 s'applique jusqu'au 2026-08-31 ; la tarification standard de $3.00 / $15.00 s'applique ensuite.

## Plugin de Skills Tendril

Vous pouvez installer les skills officielles d'ingénierie et de débogage de Tendril sous forme de plugin Claude Code :

```
/plugin marketplace add ivy-interactive/ivy-tendril-v2
/plugin install tendril-skills@ivy-tendril-v2
```

Lors du développement et des tests locaux, chargez les skills directement depuis votre copie locale :

```bash
claude --plugin-dir /chemin/vers/ivy-tendril-v2
```

Pour plus de détails, consultez [Skills d'agent](00_Skills.md).
