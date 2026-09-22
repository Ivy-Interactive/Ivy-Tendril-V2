---
title: Codex
description: Codex est un agent de codage alternatif propulsé par les modèles GPT d'OpenAI.
icon: Terminal
searchHints:
  - codex
  - openai
  - gpt
  - agent de codage
---

# Codex

## Configuration

Définissez Codex comme agent de codage dans `config.yaml` :

```yaml
codingAgent: codex
```

Ou sélectionnez-le dans **Settings > Coding Agent**.

Pour plus de détails sur la structure et les paramètres de `config.yaml`, consultez [Installation et paramètres](../03_Configuration/01_Setup.md).

## Prérequis

- La CLI [Codex](https://chatgpt.com/codex) doit être installée et accessible sous le nom `codex` dans votre PATH. Installez-la via le script officiel ou le cask [Homebrew](https://brew.sh) :
  ```bash
  curl -fsSL https://chatgpt.com/codex/install.sh | sh
  # ou : brew install --cask codex
  ```
- Authentifiez-vous avant d'utiliser Tendril en exécutant :
  ```bash
  codex login
  ```
  Pour les environnements sans interface graphique (headless) ou sans surveillance, transmettez une [clé d'API de la plateforme OpenAI](https://platform.openai.com/api-keys) via stdin :
  ```bash
  printenv OPENAI_API_KEY | codex login --with-api-key
  ```

## Profils

Tendril associe les niveaux d'effort aux modèles Codex :

| Profil     | Modèle        | Effort | Cas d'usage                                  |
| ---------- | ------------- | ------ | -------------------------------------------- |
| `deep`     | gpt-5.6-sol   | high   | Modifications multi-fichiers complexes       |
| `balanced` | gpt-5.6-terra | medium | Exécution standard de plans                  |
| `quick`    | gpt-5.6-luna  | low    | Corrections simples et petites modifications |

Le profil est sélectionné automatiquement en fonction du [niveau de complexité du plan](../02_Concepts/01_Plans.md), ou peut être configuré par [promptware](../02_Concepts/02_Promptwares.md) dans `config.yaml`.

Le modèle par défaut pour Codex dans Tendril est `gpt-5.6-terra`.

### Modèles pris en charge et effort de raisonnement

Le catalogue Codex prend en charge les modèles [OpenAI](https://openai.com) suivants :

- `gpt-6-astra`
- `gpt-5.6-sol`
- `gpt-5.6-terra` (par défaut)
- `gpt-5.6-luna`
- `gpt-5.5`
- `gpt-5.4` / `gpt-5.4-mini`
- `gpt-5.3-codex`
- `o3` / `o4-mini`
- `gpt-4.1`
- `codex-mini`

Codex prend en charge cinq niveaux d'effort de raisonnement : `none`, `low`, `medium`, `high` et `xhigh`. Le niveau `none` permet d'exécuter Codex sans surcoût de raisonnement pour des modifications rapides.

## Exécution et bac à sable (sandboxing)

Tendril lance Codex via `codex exec` en mode non interactif :

- Le bac à sable (sandbox) utilise par défaut `--sandbox workspace-write` avec l'accès réseau activé. Lorsque le mode sandbox est désactivé dans les paramètres de sécurité du projet, Tendril transmet `danger-full-access`.
- Les chemins autorisés supplémentaires définis dans les règles de sécurité sont fournis via `--add-dir`.
- Les serveurs [MCP (Model Context Protocol)](https://modelcontextprotocol.io) configurés sont écrits dans une configuration JSON temporaire et fournis via `--mcp-config`.
