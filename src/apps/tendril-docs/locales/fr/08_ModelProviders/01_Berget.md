---
title: Berget AI
description: Fournisseur européen d'infrastructure IA proposant les modèles Kimi et GLM avec une résidence complète des données dans l'UE et une prise en charge native des cartes BYO Tendril v2.
icon: Server
searchHints:
  - berget
  - ue
  - européen
  - kimi
  - glm
  - moonshot
---

# Berget AI

[Berget AI](https://berget.ai) est un fournisseur d'infrastructure IA européen offrant une inférence LLM souveraine et haute performance avec une résidence garantie des données dans l'UE en Suède. Berget propose des points de terminaison compatibles avec [OpenAI](https://openai.com) hébergeant des modèles ouverts de pointe, notamment Kimi K3 de [Moonshot AI](https://moonshot.cn) et la famille GLM de [Zhipu AI](https://open.bigmodel.cn), en totale conformité avec le [RGPD](https://gdpr.eu).

Dans Tendril v2, Berget AI est pris en charge à la fois en tant que carte native **Bring Your Own LLM** dans l'application de bureau et via le sidecar [OpenCode](https://opencode.ai) inclus.

## Configuration via Tendril Desktop

La manière la plus simple d'utiliser Berget AI consiste à utiliser la carte BYO native dans les paramètres de bureau :

1. Créez un compte et générez une clé d'API sur [console.berget.ai](https://console.berget.ai).
2. Ouvrez Tendril et accédez à **Settings > Coding Agent**.
3. Sous **Bring Your Own LLM**, cliquez sur la carte **Berget AI**.
4. Collez votre clé d'API dans le champ **API Key** et cliquez sur **Save**.

> [!NOTE]
> Il n'y a pas de champ d'URL de base à configurer pour Berget dans l'interface. Tendril v2 fixe automatiquement le point de terminaison à `https://api.berget.ai/v1` et achemine les requêtes via le sidecar [OpenCode](../06_CodingAgents/04_OpenCode.md) inclus.

## Configuration manuelle dans `config.yaml`

Vous pouvez également configurer Berget AI directement dans `~/.tendril/config.yaml` (voir [Configuration de base](../03_Configuration/01_Setup.md)) :

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "sk-berget-..."
      OPENAI_BASE_URL: "https://api.berget.ai/v1"
      ANTHROPIC_API_KEY: "sk-berget-..."
      ANTHROPIC_BASE_URL: "https://api.berget.ai"
    profiles:
      - name: deep
        model: "moonshotai/Kimi-K3"
        effort: max
      - name: balanced
        model: "moonshotai/Kimi-K3"
        effort: high
      - name: quick
        model: "moonshotai/Kimi-K3"
        effort: low
```

## Modèles recommandés

Le résolveur de profils de Tendril v2 associe directement Berget AI à Kimi K3 sur tous les niveaux :

| Niveau       | ID de modèle         | Effort par défaut | Utilisation                                                                    |
| :----------- | :------------------- | :---------------- | :----------------------------------------------------------------------------- |
| **Deep**     | `moonshotai/Kimi-K3` | `max`             | Planification architecturale, raisonnement complexe, refactorisations majeures |
| **Balanced** | `moonshotai/Kimi-K3` | `high`            | Exécution standard de plans et génération de code                              |
| **Quick**    | `moonshotai/Kimi-K3` | `low`             | Vérification rapide, résumés de commits, rapports d'état                       |

Berget fournit également des modèles de la famille GLM (comme `GLM-4.7`). Vous pouvez définir n'importe quel ID de modèle Berget disponible dans votre configuration de profil ou le sélectionner avec `/models` dans [OpenCode](../06_CodingAgents/04_OpenCode.md).

## Configuration via la CLI OpenCode

Vous pouvez également configurer Berget via OpenCode :

1. Exécutez l'utilitaire de configuration Berget :
   ```bash
   npx berget code init
   ```
2. Lancez OpenCode :
   ```bash
   opencode
   ```
3. Définissez votre agent actif dans Tendril sur OpenCode sous **Settings > Coding Agent** (`codingAgent: opencode`).

> [!TIP]
> Tendril v2 intègre le binaire [OpenCode](https://opencode.ai) (`binaries/opencode`). Vous n'avez pas besoin d'installer Node.js ou OpenCode globalement sur votre système pour utiliser Berget avec Tendril. Pour en savoir plus, consultez le [Guide de l'agent OpenCode](../06_CodingAgents/04_OpenCode.md).

## Liens

- [Fournisseurs de modèles](_Index.md)
- [Agents de codage](../06_CodingAgents/_Index.md)
- [Page d'accueil de Berget AI](https://berget.ai)
- [Console Berget](https://console.berget.ai)
- [Documentation Berget + OpenCode](https://docs.berget.ai/integrations/opencode)
