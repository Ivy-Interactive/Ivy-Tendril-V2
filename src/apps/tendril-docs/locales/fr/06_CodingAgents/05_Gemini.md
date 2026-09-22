---
title: Gemini CLI
description: Gemini CLI est un agent de codage propulsé par les modèles Gemini de Google.
icon: Sparkles
searchHints:
  - gemini
  - google
  - agent de codage
---

# Gemini CLI

## Configuration

Définissez Gemini comme agent de codage dans `config.yaml` :

```yaml
codingAgent: gemini
```

Ou sélectionnez-le dans **Settings > Coding Agent**.

Pour plus de détails sur la structure et les paramètres de `config.yaml`, consultez [Installation et paramètres](../03_Configuration/01_Setup.md).

## Prérequis

- Installez le binaire `gemini` via [Homebrew](https://brew.sh) ou [MacPorts](https://www.macports.org) :
  ```bash
  brew install gemini-cli
  # ou : sudo port install gemini-cli
  ```
- **Authentification** : Notez qu'il n'existe pas de sous-commande CLI `gemini auth`. Pour vous authentifier :
  - Lors de la première exécution, `gemini` vous invite à vous connecter avec **Sign in with Google** via OAuth dans votre navigateur.
  - Dans une session CLI active, utilisez la commande slash `/auth` (ou `/auth login`) pour vous ré-authentifier ou changer de compte.
  - Pour les environnements sans interface graphique (headless) ou d'intégration continue (CI), définissez la variable d'environnement `GEMINI_API_KEY` (générée via [Google AI Studio](https://aistudio.google.com/apikey)).

## Profils

Tendril associe les profils Gemini aux valeurs par défaut suivantes :

| Profil     | Modèle           | Cas d'usage                                  |
| ---------- | ---------------- | -------------------------------------------- |
| `deep`     | gemini-3.8-flash | Modifications multi-fichiers complexes       |
| `balanced` | gemini-3.8-flash | Exécution standard de plans                  |
| `quick`    | gemini-3.8-flash | Corrections simples et petites modifications |

Le profil est sélectionné automatiquement en fonction du [niveau de complexité du plan](../02_Concepts/01_Plans.md), ou peut être configuré par [promptware](../02_Concepts/02_Promptwares.md) dans `config.yaml`. La CLI Gemini n'utilise pas de flags d'effort de raisonnement.

Le modèle par défaut pour Gemini dans Tendril est `gemini-3.8-flash`.

## Modèles disponibles

Le catalogue Gemini dans Tendril comprend :

- `gemini-3.8-flash` (par défaut) : Raisonnement rapide et hautement performant de nouvelle génération, fenêtre de contexte de 1M
- `gemini-3.7-flash` : Raisonnement rapide et performant, fenêtre de contexte de 1M
- `gemini-3.6-flash` : Raisonnement multimodal, fenêtre de contexte de 1M
- `gemini-3.1-pro` : Raisonnement avancé pour architecture complexe, fenêtre de contexte de 1M
- `gemini-3-pro-preview` : Aperçu du raisonnement de nouvelle génération
- `gemini-3-flash-preview` : Aperçu rapide de nouvelle génération

Remplacez le modèle dans `config.yaml` :

```yaml
codingAgents:
  - name: gemini
    profiles:
      - name: deep
        model: gemini-3.1-pro
```

## Exécution et flags

Tendril lance la CLI Gemini avec :

- Mode non interactif : `--output-format stream-json --skip-trust --approval-mode <mode>` (où `FullAuto` transmet `yolo`, `AcceptEdits` transmet `auto_edit`, et `Plan` transmet `plan`), et `--sandbox` lorsque le mode sandbox est activé.
- Terminal interactif de l'Agent : `gemini --yolo --skip-trust -i "<prompt>"`.
