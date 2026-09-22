---
title: Vercel AI Gateway
description: Acheminez les requêtes via AI Gateway de Vercel pour un accès unifié aux modèles OpenAI, Anthropic, Google et à poids ouverts avec observabilité intégrée.
icon: Zap
searchHints:
  - vercel
  - ai gateway
  - unifié
  - observabilité
---

# Vercel AI Gateway

[Vercel AI Gateway](https://vercel.com/docs/ai-gateway) fournit un proxy unifié pour acheminer les requêtes d'inférence entre les principaux fournisseurs de modèles, notamment [Anthropic](https://www.anthropic.com), [OpenAI](https://openai.com), [Google AI](https://ai.google.dev) et [xAI](https://x.ai). Il propose une gestion centralisée des clés d'API, une mise en cache en périphérie (edge), une télémétrie en temps réel et des garde-fous de limitation de débit.

## Configuration via OpenCode

1. Créez une clé d'API dans le [tableau de bord Vercel](https://vercel.com) sous **AI Gateway > API keys** de votre équipe.
2. Connectez-vous dans [OpenCode](https://opencode.ai) à l'aide du terminal ou du PTY intégré de Tendril :
   ```bash
   opencode
   ```
   Tapez `/connect`, recherchez **Vercel AI Gateway** et saisissez votre clé d'API.
3. Changez de modèle actif avec `/models`.

### Règles de routage (`opencode.json`)

Vous pouvez définir l'ordre de basculement (failover) et les préférences de routage directement dans `opencode.json` :

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "vercel": {
      "models": {
        "anthropic/claude-sonnet-5": {
          "options": {
            "order": ["anthropic", "vertex"]
          }
        }
      }
    }
  }
}
```

## Utilisation avec Tendril

### Option A : Via OpenCode inclus

1. Dans l'application de bureau Tendril, accédez à **Settings > Coding Agent**.
2. Sélectionnez **OpenCode** comme agent actif (voir [Agent OpenCode](../06_CodingAgents/04_OpenCode.md)).
3. Tendril achemine l'ensemble de l'exécution des plans via le sidecar [OpenCode](https://opencode.ai) inclus connecté à Vercel AI Gateway.

### Option B : Passerelle directe dans `config.yaml`

Vercel AI Gateway fournit un point de terminaison d'API compatible avec [OpenAI](https://openai.com) à l'adresse `https://ai-gateway.vercel.sh/v1`. Vous pouvez configurer Tendril pour qu'il s'y achemine directement dans `~/.tendril/config.yaml` (voir [Configuration de base](../03_Configuration/01_Setup.md)) :

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-vercel-ai-key"
      OPENAI_BASE_URL: "https://ai-gateway.vercel.sh/v1"
    profiles:
      - name: deep
        model: "anthropic/claude-opus-5"
        effort: max
      - name: balanced
        model: "anthropic/claude-sonnet-5"
        effort: high
      - name: quick
        model: "google/gemini-3.8-flash"
        effort: low
```

## Surveillance et télémétrie

Les métriques d'utilisation, la consommation de jetons et la répartition de la latence sont automatiquement enregistrées dans le tableau de bord Vercel sous **AI Gateway > Analytics**, complétant le registre de jetons local de Tendril.

## Liens

- [Fournisseurs de modèles](_Index.md)
- [Agents de codage](../06_CodingAgents/_Index.md)
- [Documentation Vercel AI Gateway](https://vercel.com/docs/ai-gateway)
- [Guide Vercel + OpenCode](https://vercel.com/docs/ai-gateway/coding-agents/opencode)
