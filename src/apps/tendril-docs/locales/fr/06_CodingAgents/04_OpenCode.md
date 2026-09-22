---
title: OpenCode
description: OpenCode est un agent de codage alternatif qui prend en charge plusieurs fournisseurs de modèles via une CLI unifiée.
icon: Cpu
searchHints:
  - opencode
  - open code
  - agent de codage
---

# OpenCode

## Configuration

Définissez OpenCode comme agent de codage dans `config.yaml` :

```yaml
codingAgent: opencode
```

Ou sélectionnez-le dans **Settings > Coding Agent**.

Pour plus de détails sur la structure et les paramètres de `config.yaml`, consultez [Installation et paramètres](../03_Configuration/01_Setup.md).

## Prérequis

- **Sidecar intégré** : Tendril fournit [OpenCode](https://opencode.ai) en tant que sidecar intégré avec l'application de bureau et lui donne automatiquement la priorité sur toute version présente dans le PATH. Aucune installation manuelle n'est requise sur les nouvelles installations.
- **Installation autonome** (facultatif) : Si vous souhaitez installer ou exécuter une copie autonome :
  ```bash
  curl -fsSL https://opencode.ai/install | bash
  ```
- **Authentification** : Exécutez `opencode providers login` (ou `opencode auth login`) pour vous authentifier auprès de votre fournisseur sélectionné (par exemple [Anthropic](https://www.anthropic.com), [OpenAI](https://openai.com), [Google AI](https://ai.google.dev), [Groq](https://groq.com)).

## Profils

Tendril associe les niveaux d'effort aux modèles OpenCode :

| Profil     | Modèle  | Effort | Cas d'usage                                  |
| ---------- | ------- | ------ | -------------------------------------------- |
| `deep`     | default | high   | Modifications multi-fichiers complexes       |
| `balanced` | default | medium | Exécution standard de plans                  |
| `quick`    | default | low    | Corrections simples et petites modifications |

Les niveaux d'effort correspondent directement au flag `--variant` d'OpenCode (`low`, `medium`, `high`, `max`).

Le modèle par défaut du catalogue est `moonshotai/Kimi-K3`. OpenCode prend également en charge des modèles Anthropic et OpenAI figés tels que `claude-fable-5-1`, `claude-opus-5`, `claude-opus-4-7`, `claude-sonnet-5`, `claude-sonnet-4-6` et `gpt-5.5`.

## Apportez votre propre LLM (BYO LLM) et fournisseurs

OpenCode alimente les cartes **Bring-Your-Own LLM** de Tendril dans **Settings > Coding Agent** :

- **[OpenAI](https://openai.com)** : Oriente OpenCode vers `https://api.openai.com` avec votre clé `OPENAI_API_KEY`.
- **[Anthropic](https://www.anthropic.com)** : Oriente OpenCode vers `https://api.anthropic.com/v1` avec votre clé `ANTHROPIC_API_KEY`.
- **[Berget AI](../08_ModelProviders/01_Berget.md)** : Oriente OpenCode vers `https://api.berget.ai/v1` avec votre clé d'API [Berget AI](https://berget.ai).
- **Points de terminaison personnalisés** : Configurez des URL de base et des clés personnalisées pour tout reverse proxy compatible OpenAI ou Anthropic. Pour découvrir d'autres fournisseurs, consultez [Fournisseurs de modèles](../08_ModelProviders/_Index.md).

Tendril configure ces fournisseurs de manière non destructrice à l'aide de `OPENCODE_CONFIG_CONTENT`, de sorte que votre fichier de configuration global `opencode.json` n'est jamais écrasé.

## Configuration locale avec [Ollama](https://ollama.com)

Lors de l'exécution d'OpenCode avec des modèles locaux [Ollama](https://ollama.com), spécifiez l'URL du serveur directement dans `config.yaml` :

```yaml
codingAgents:
  - name: opencode
    environmentVariables:
      OLLAMA_HOST: "http://localhost:11434"
      OLLAMA_BASE_URL: "http://localhost:11434"
```
