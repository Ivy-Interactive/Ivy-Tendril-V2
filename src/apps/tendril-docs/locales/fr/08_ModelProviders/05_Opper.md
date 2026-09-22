---
title: Opper.ai
description: Passerelle IA donnant accès à plus de 300 modèles d'Anthropic, OpenAI, Google et de fournisseurs open source avec des options de résidence des données dans l'UE.
icon: Server
searchHints:
  - opper
  - passerelle
  - ue
  - multi-fournisseur
  - routeur
---

# Opper.ai

[Opper.ai](https://opper.ai) est une passerelle IA d'entreprise basée en Europe qui fournit un accès unifié à plus de 300 modèles fondateurs d'[Anthropic](https://www.anthropic.com), d'[OpenAI](https://openai.com), de [Google AI](https://ai.google.dev), de [Mistral AI](https://mistral.ai) et d'écosystèmes open source. Opper propose un routage automatique de secours (fallback), une optimisation de la latence et des contrôles stricts de résidence des données dans l'UE.

## Configuration via la CLI Opper

1. Installez la CLI Opper (nécessite [Node.js](https://nodejs.org)) :
   ```bash
   npm i -g @opperai/cli
   ```
2. Connectez-vous via OAuth dans le navigateur :
   ```bash
   opper login
   ```
3. Lancez [OpenCode](https://opencode.ai) via Opper :
   ```bash
   opper launch opencode
   ```

L'authentification est gérée par la session de la CLI Opper ; les clés d'API individuelles des fournisseurs ne sont pas requises.

## Changer de modèle

Vous pouvez spécifier un modèle au moment du lancement en utilisant l'option `--model` :

```bash
opper launch opencode --model anthropic/claude-sonnet-5
```

Ou changer de modèle de manière interactive pendant une session OpenCode active avec `/models`.

## Utilisation avec Tendril

### Option A : Via OpenCode inclus

1. Dans l'application de bureau Tendril, accédez à **Settings > Coding Agent**.
2. Définissez **OpenCode** comme agent de codage actif (voir [Agent OpenCode](../06_CodingAgents/04_OpenCode.md)).
3. Tendril délègue l'exécution via OpenCode, acheminée par Opper.

### Option B : Passerelle directe dans `config.yaml`

Opper expose également une passerelle compatible avec OpenAI à l'adresse `https://api.opper.ai/v1`. Vous pouvez configurer Tendril pour qu'il s'y connecte directement en fournissant votre clé d'API Opper dans `~/.tendril/config.yaml` (voir [Configuration de base](../03_Configuration/01_Setup.md)) :

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "opp_..."
      OPENAI_BASE_URL: "https://api.opper.ai/v1"
    profiles:
      - name: deep
        model: "anthropic/claude-opus-5"
        effort: max
      - name: balanced
        model: "anthropic/claude-sonnet-5"
        effort: high
      - name: quick
        model: "google/gemini-3.8-flash"
        effort: medium
```

> [!TIP]
> Opper met automatiquement en cache les préfixes de prompts et achemine les requêtes vers les régions de données européennes lorsque les politiques de résidence dans l'UE sont activées dans votre tableau de bord Opper.

## Liens

- [Fournisseurs de modèles](_Index.md)
- [Agents de codage](../06_CodingAgents/_Index.md)
- [Plateforme Opper](https://opper.ai)
- [Documentation de la CLI Agent d'Opper](https://opper.ai/agent-cli)
