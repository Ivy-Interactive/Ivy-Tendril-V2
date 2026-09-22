---
title: NVIDIA
description: Accédez aux microservices d'inférence NVIDIA NIM et aux modèles ouverts accélérés pour les tâches de codage via NVIDIA Build.
icon: Cpu
searchHints:
  - nvidia
  - nim
  - spark
  - build
  - gpu
---

# NVIDIA

[NVIDIA Build](https://build.nvidia.com) donne accès aux points de terminaison NIM (Inference Microservice) de [NVIDIA](https://www.nvidia.com), offrant une inférence accélérée par GPU et optimisée pour l'entreprise pour les modèles ouverts de pointe, notamment [Llama de Meta](https://llama.meta.com), [DeepSeek](https://www.deepseek.com), [Mistral AI](https://mistral.ai) et [Qwen](https://github.com/QwenLM).

## Configuration via OpenCode

1. Générez une clé d'API (commençant par `nvapi-`) sur [build.nvidia.com](https://build.nvidia.com).
2. Connectez-vous dans [OpenCode](https://opencode.ai) à l'aide du terminal ou du PTY intégré de Tendril :
   ```bash
   opencode
   ```
   Tapez `/connect`, sélectionnez **NVIDIA** et collez votre clé d'API.
3. Changez de modèle actif avec `/models`.

## Modèles recommandés

NVIDIA NIM héberge des versions optimisées pour les meilleurs modèles de codage :

| Modèle                     | Identifiant NIM                   | Niveau d'exécution  | Créateur                             |
| :------------------------- | :-------------------------------- | :------------------ | :----------------------------------- |
| **Llama 3.3 70B Instruct** | `meta/llama-3.3-70b-instruct`     | Deep                | [Meta AI](https://llama.meta.com)    |
| **DeepSeek R1**            | `deepseek-ai/deepseek-r1`         | Deep (Raisonnement) | [DeepSeek](https://www.deepseek.com) |
| **Qwen 2.5 Coder 32B**     | `qwen/qwen2.5-coder-32b-instruct` | Balanced            | [Qwen](https://github.com/QwenLM)    |
| **Llama 3.1 8B Instruct**  | `meta/llama-3.1-8b-instruct`      | Quick               | [Meta AI](https://llama.meta.com)    |

## Utilisation avec Tendril

### Option A : Via OpenCode inclus

1. Dans l'application de bureau Tendril, ouvrez **Settings > Coding Agent**.
2. Sélectionnez **OpenCode** comme agent de codage actif (voir [Agent OpenCode](../06_CodingAgents/04_OpenCode.md)).
3. Tendril exécute les plans via le sidecar [OpenCode](https://opencode.ai) inclus en utilisant vos modèles NVIDIA NIM authentifiés.

### Option B : API NIM directe dans `config.yaml`

NVIDIA NIM fournit des points de terminaison entièrement compatibles avec [OpenAI](https://openai.com) à l'adresse `https://integrate.api.nvidia.com/v1`. Vous pouvez configurer Tendril pour qu'il s'y connecte directement dans `~/.tendril/config.yaml` (voir [Configuration de base](../03_Configuration/01_Setup.md)) :

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "nvapi-..."
      OPENAI_BASE_URL: "https://integrate.api.nvidia.com/v1"
    profiles:
      - name: deep
        model: "meta/llama-3.3-70b-instruct"
        effort: high
      - name: balanced
        model: "qwen/qwen2.5-coder-32b-instruct"
        effort: medium
      - name: quick
        model: "meta/llama-3.1-8b-instruct"
        effort: low
```

> [!TIP]
> Les points de terminaison NVIDIA NIM utilisent les schémas standard OpenAI Chat Completion avec diffusion de jetons (streaming) activée, ce qui les rend parfaitement compatibles avec les visualiseurs de sortie en direct de Tendril.

## Liens

- [Fournisseurs de modèles](_Index.md)
- [Agents de codage](../06_CodingAgents/_Index.md)
- [Catalogue NVIDIA Build](https://build.nvidia.com)
- [Documentation NVIDIA NIM](https://build.nvidia.com/spark/cli-coding-agent)
