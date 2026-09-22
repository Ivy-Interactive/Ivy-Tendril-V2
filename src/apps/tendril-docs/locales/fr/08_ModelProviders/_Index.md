---
title: Fournisseurs de modèles
description: Configurez les fournisseurs de modèles et les backends d'inférence pour les agents Tendril v2 à l'aide des cartes BYO intégrées ou du sidecar OpenCode fourni.
icon: Server
groupExpanded: true
searchHints:
  - fournisseurs de modèles
  - fournisseurs
  - api
  - inférence
  - passerelle
  - llm
  - opencode
  - bring your own llm
  - byo
---

# Fournisseurs de modèles

Tendril v2 prend en charge un routage flexible des fournisseurs de modèles, vous permettant d'exécuter des [agents de codage](../06_CodingAgents/_Index.md) sur des infrastructures souveraines européennes, des passerelles d'API unifiées, des hubs de modèles cloud ou des points de terminaison sur site (on-premises).

Dans Tendril v2, l'exécution des fournisseurs de modèles s'effectue via deux mécanismes principaux :

1. **Bring Your Own LLM (BYO LLM) natif** : Cartes de paramètres intégrées et [configuration](../03_Configuration/01_Setup.md) directe dans `config.yaml` pour [OpenAI](https://openai.com), [Anthropic](https://www.anthropic.com) et le fournisseur souverain européen [Berget AI](01_Berget.md).
2. **Sidecar OpenCode groupé** : Tendril v2 est livré avec le binaire [OpenCode](https://opencode.ai) préinstallé (`binaries/opencode`), offrant un accès direct aux passerelles multi-fournisseurs et aux backends d'inférence personnalisés sans nécessiter d'installation manuelle de CLI (voir [Agent OpenCode](../06_CodingAgents/04_OpenCode.md)).

## Fournisseurs pris en charge

- [Berget AI](01_Berget.md) ([console.berget.ai](https://console.berget.ai)) — Fournisseur d'infrastructure IA européen proposant les modèles Kimi et GLM avec une résidence complète des données dans l'UE et une intégration native par carte BYO dans Tendril.
- [Evroc](02_Evroc.md) ([cloud.evroc.com](https://cloud.evroc.com)) — Fournisseur de cloud souverain européen proposant des modèles de codage open source, notamment Kimi, Llama et Mistral.
- [Z.AI](03_Zai.md) ([z.ai](https://z.ai)) — Accès à haut débit aux modèles GLM avec des options de forfaits dédiés au codage.
- [Scaleway](04_Scaleway.md) ([scaleway.com](https://www.scaleway.com)) — Fournisseur de cloud européen proposant des API génératives compatibles avec OpenAI pour le codage et le raisonnement.
- [Opper.ai](05_Opper.md) ([opper.ai](https://opper.ai)) — Passerelle IA offrant un accès unifié à plus de 300 modèles avec des options de résidence des données dans l'UE.
- [OpenRouter](06_OpenRouter.md) ([openrouter.ai](https://openrouter.ai)) — Passerelle d'API unifiée donnant accès aux modèles d'Anthropic, OpenAI, Google, Meta et DeepSeek.
- [Cloudflare](07_Cloudflare.md) ([cloudflare.com](https://developers.cloudflare.com/workers-ai/)) — Inférence sans serveur via Cloudflare Workers AI combinée à l'intégration des outils MCP Workers.
- [NVIDIA](08_NVIDIA.md) ([build.nvidia.com](https://build.nvidia.com)) — Microservices [NVIDIA NIM](https://build.nvidia.com) de qualité professionnelle et modèles ouverts hébergés sur NVIDIA Build.
- [Vercel AI Gateway](09_Vercel.md) ([vercel.com](https://vercel.com/docs/ai-gateway)) — Routage multi-fournisseur unifié avec télémétrie intégrée, garde-fous de dépenses et mise en cache des requêtes.

## Fonctionnement de la configuration

### 1. Dans l'application de bureau Tendril

Accédez à **Settings > Coding Agent** :

- **Agents préconfigurés** : Choisissez parmi les agents intégrés, notamment [Claude Code](../06_CodingAgents/01_ClaudeCode.md), [Copilot](../06_CodingAgents/03_Copilot.md), [Codex](../06_CodingAgents/02_Codex.md), [Gemini](../06_CodingAgents/05_Gemini.md), [Antigravity](https://antigravity.google), [OpenCode](../06_CodingAgents/04_OpenCode.md), [Cursor](https://cursor.com) et les [modèles embarqués Apple](https://developer.apple.com).
- **Cartes Bring Your Own LLM** : Choisissez **OpenAI**, **Anthropic** ou **Berget AI**. Saisissez votre clé d'API et Tendril configurera automatiquement les URL de base appropriées, les répartira dans les variables d'environnement du SDK respectif et définira les profils par défaut par niveau.
- **Niveaux de profil** : Configurez les modèles par défaut et les niveaux d'effort de raisonnement sur trois niveaux d'exécution :
  - **Deep** : Raisonnement à effort élevé pour la planification architecturale, les refactorisations complexes et les ébauches initiales.
  - **Balanced** : Compromis entre capacité et vitesse pour l'implémentation de fonctionnalités au quotidien et les correctifs de révision.
  - **Quick** : Modèles rapides à faible latence pour la génération de messages de commit, la vérification des tests et les vérifications d'état.

### 2. Dans `config.yaml`

Tous les paramètres des fournisseurs et des agents sont conservés dans `~/.tendril/config.yaml` (voir [Configuration de base](../03_Configuration/01_Setup.md)) :

```yaml
codingAgent: openaiproxy # or opencode, claude, codex, gemini, etc.

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "sk-..."
      OPENAI_BASE_URL: "https://api.openai.com/v1"
      ANTHROPIC_API_KEY: "sk-..."
      ANTHROPIC_BASE_URL: "https://api.anthropic.com"
    profiles:
      - name: deep
        model: "gpt-5.6-sol"
        effort: high
      - name: balanced
        model: "gpt-5.6-terra"
        effort: medium
      - name: quick
        model: "gpt-5.6-luna"
        effort: low
```

> [!TIP]
> Lors de l'enregistrement des paramètres BYO, le démon de Tendril synchronise automatiquement les URL de base : le SDK [OpenAI](https://openai.com) attend `/v1` à la fin de l'URL, alors que le SDK [Anthropic](https://www.anthropic.com) attend l'hôte nu sans `/v1`.

### 3. Via le sidecar OpenCode groupé

Pour les fournisseurs de passerelles (tels qu'[OpenRouter](06_OpenRouter.md), [Evroc](02_Evroc.md), [Scaleway](04_Scaleway.md) ou [Opper](05_Opper.md)) :

1. Lancez OpenCode via le terminal ou via le terminal intégré de Tendril :
   ```bash
   opencode
   ```
2. Tapez `/connect` et sélectionnez votre fournisseur, ou exécutez `opencode auth login`.
3. Définissez votre agent de codage actif dans Tendril sur OpenCode sous **Settings > Coding Agent** (`codingAgent: opencode`).
4. Tendril transmet toutes les tâches d'exécution de plan via l'environnement d'exécution [OpenCode](../06_CodingAgents/04_OpenCode.md) configuré.

> [!NOTE]
> Tendril v2 enrichit automatiquement les métadonnées des modèles disponibles via [models.dev](https://models.dev). Le cache est stocké localement dans [SQLite](https://www.sqlite.org) et actualisé en arrière-plan ou à la demande via `POST /api/models/refresh`.
