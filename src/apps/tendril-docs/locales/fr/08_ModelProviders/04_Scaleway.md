---
title: Scaleway
description: Fournisseur de cloud européen proposant des API génératives compatibles avec OpenAI pour le codage, le raisonnement et les modèles à poids ouverts.
icon: Server
searchHints:
  - scaleway
  - ue
  - européen
  - generative apis
  - souverain
  - qwen
---

# Scaleway

[Scaleway](https://www.scaleway.com) est un important fournisseur européen de services cloud proposant une infrastructure IA souveraine hébergée dans des centres de données écoénergétiques situés en France, aux Pays-Bas et en Pologne. Grâce à sa plateforme Generative APIs, Scaleway fournit des points de terminaison gérés et entièrement compatibles avec [OpenAI](https://openai.com) pour les meilleurs modèles ouverts.

## Configuration

1. Créez un compte sur [scaleway.com](https://www.scaleway.com).
2. Générez une clé d'API IAM (Secret Key) dans la console Scaleway sous **Identity and Access Management (IAM)**.
3. Connectez-vous dans [OpenCode](https://opencode.ai) à l'aide du sidecar inclus ou du terminal :
   ```bash
   opencode
   ```
   Tapez `/connect`, sélectionnez **Scaleway** et collez votre clé secrète IAM.
4. Sélectionnez un modèle à l'aide de `/models`.

## Modèles recommandés

Scaleway héberge plusieurs modèles optimisés pour la complétion de code et l'ingénierie logicielle :

| Modèle                     | ID de modèle                      | Créateur                             | Niveau recommandé   |
| :------------------------- | :-------------------------------- | :----------------------------------- | :------------------ |
| **Qwen 2.5 Coder 32B**     | `qwen2.5-coder-32b-instruct`      | [Qwen](https://github.com/QwenLM)    | Deep                |
| **Llama 3.3 70B Instruct** | `llama-3.3-70b-instruct`          | [Meta AI](https://llama.meta.com)    | Balanced            |
| **Mistral Small 24B**      | `mistral-small-24b-instruct-2501` | [Mistral AI](https://mistral.ai)     | Quick               |
| **DeepSeek R1 Distill**    | `deepseek-r1-distill-llama-70b`   | [DeepSeek](https://www.deepseek.com) | Deep (Raisonnement) |

## Utilisation avec Tendril

### Option A : Via OpenCode inclus

1. Dans l'application de bureau Tendril, accédez à **Settings > Coding Agent**.
2. Sélectionnez **OpenCode** comme agent actif (voir [Agent OpenCode](../06_CodingAgents/04_OpenCode.md)).
3. OpenCode utilisera vos identifiants Scaleway configurés pour toutes les tâches d'exécution de plan.

### Option B : Point de terminaison OpenAI personnalisé dans `config.yaml`

Puisque les API génératives de Scaleway suivent la spécification OpenAI à l'adresse `https://api.scaleway.ai/v1`, vous pouvez le configurer directement dans `~/.tendril/config.yaml` (voir [Configuration de base](../03_Configuration/01_Setup.md)) :

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-scaleway-secret-key"
      OPENAI_BASE_URL: "https://api.scaleway.ai/v1"
    profiles:
      - name: deep
        model: "qwen2.5-coder-32b-instruct"
        effort: high
      - name: balanced
        model: "llama-3.3-70b-instruct"
        effort: medium
      - name: quick
        model: "mistral-small-24b-instruct-2501"
        effort: low
```

> [!NOTE]
> Scaleway applique l'authentification standard par jeton HTTP Bearer. Votre clé secrète IAM fait directement office de `OPENAI_API_KEY`.

## Liens

- [Fournisseurs de modèles](_Index.md)
- [Agents de codage](../06_CodingAgents/_Index.md)
- [Plateforme Scaleway](https://www.scaleway.com)
- [Console Scaleway](https://console.scaleway.com)
- [Documentation Generative APIs de Scaleway](https://www.scaleway.com/en/docs/generative-apis/reference-content/integrate-with-opencode/)
