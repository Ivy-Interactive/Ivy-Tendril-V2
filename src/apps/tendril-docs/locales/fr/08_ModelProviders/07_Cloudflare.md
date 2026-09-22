---
title: Cloudflare
description: Utilisez Cloudflare Workers AI comme fournisseur de modèles et connectez-vous aux serveurs MCP de Cloudflare pour créer et déployer des Workers.
icon: Globe
searchHints:
  - cloudflare
  - workers ai
  - cf
  - edge
  - cloudflared
  - tunnels
---

# Cloudflare

[Cloudflare](https://www.cloudflare.com) propose du calcul en périphérie (edge compute) mondial et de l'inférence IA sans serveur via [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/). Les développeurs peuvent exécuter des modèles à poids ouverts rapides et économiques (comme [Llama de Meta](https://llama.meta.com)) en périphérie tout en les associant aux compétences officielles [Model Context Protocol (MCP)](../09_Advanced/03_MCP.md) de Cloudflare pour un développement complet de [Cloudflare Workers](https://workers.cloudflare.com).

## Configuration via OpenCode

1. Lancez [OpenCode](https://opencode.ai) via le terminal ou le PTY intégré de Tendril :
   ```bash
   opencode
   ```
   Tapez `/connect` et sélectionnez **Cloudflare**.
2. Effectuez l'autorisation dans le navigateur lorsque vous y êtes invité.
3. Sélectionnez un modèle actif avec `/models`.

## Compétences MCP Cloudflare (Facultatif)

Vous pouvez ajouter des serveurs MCP Cloudflare pour doter votre [agent de codage](../06_CodingAgents/_Index.md) d'un contrôle direct sur Cloudflare Workers, KV, les bases de données D1 et les déploiements (voir [Compétences](../06_CodingAgents/00_Skills.md)) :

```bash
npx skills add https://github.com/cloudflare/skills
```

Une fois installés, les agents de codage exécutant des plans Tendril peuvent créer des liaisons (bindings), déployer des scripts de workers et inspecter les journaux de périphérie en temps réel de manière autonome.

## Utilisation avec Tendril

1. Ouvrez Tendril et accédez à **Settings > Coding Agent**.
2. Définissez votre agent de codage sur **OpenCode** (voir [Agent OpenCode](../06_CodingAgents/04_OpenCode.md)).
3. Tendril achemine les tâches de plan vers OpenCode, qui appelle Cloudflare Workers AI.

Vous pouvez également cibler Cloudflare Workers AI via son point de terminaison compatible avec [OpenAI](https://openai.com) dans `~/.tendril/config.yaml` (voir [Configuration de base](../03_Configuration/01_Setup.md)) :

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-cloudflare-api-token"
      OPENAI_BASE_URL: "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1"
    profiles:
      - name: deep
        model: "@cf/meta/llama-3.3-70b-instruct"
        effort: high
      - name: balanced
        model: "@cf/meta/llama-3.1-8b-instruct"
        effort: medium
      - name: quick
        model: "@cf/meta/llama-3.1-8b-instruct"
        effort: low
```

> [!NOTE]
> En plus de l'inférence de modèles Workers AI, Tendril v2 intègre nativement Cloudflare Quick Tunnels (`cloudflared`) pour un partage de plans sécurisé et en lecture seule avec les membres de votre équipe. Le partage de tunnels se configure séparément sous **Settings > Security & Tunneling**.

## Liens

- [Fournisseurs de modèles](_Index.md)
- [Agents de codage](../06_CodingAgents/_Index.md)
- [Documentation Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
- [Guide Cloudflare + OpenCode](https://developers.cloudflare.com/agent-setup/opencode/)
