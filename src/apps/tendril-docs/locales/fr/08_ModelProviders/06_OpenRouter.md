---
title: OpenRouter
description: Passerelle d'API unifiée offrant un accès aux modèles d'Anthropic, OpenAI, Google, xAI, Meta, DeepSeek et bien d'autres.
icon: Globe
searchHints:
  - openrouter
  - routeur
  - multi-fournisseur
  - passerelle
---

# OpenRouter

[OpenRouter](https://openrouter.ai) fournit une passerelle d'API unifiée et compatible avec [OpenAI](https://openai.com) donnant accès à des centaines de modèles de pointe d'[Anthropic](https://www.anthropic.com), d'[OpenAI](https://openai.com), de [Google DeepMind](https://deepmind.google), de [Meta AI](https://ai.meta.com), de [Mistral AI](https://mistral.ai), de [DeepSeek](https://www.deepseek.com) et de [xAI](https://x.ai). OpenRouter propose une tarification compétitive par jeton, un basculement automatique entre fournisseurs et des métriques d'utilisation complètes.

## Configuration via OpenCode

1. Créez une clé d'API sur [openrouter.ai/keys](https://openrouter.ai/keys) (les clés commencent par `sk-or-`).
2. Lancez [OpenCode](https://opencode.ai) via le terminal ou le terminal intégré de Tendril :
   ```bash
   opencode
   ```
   Tapez `/connect`, sélectionnez **OpenRouter** et collez votre clé d'API.
3. Changez de modèle actif avec `/models`.

### Configuration de projet (`opencode.json`)

Vous pouvez définir des modèles par défaut au niveau du projet dans `opencode.json` :

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "openrouter": {
      "models": {
        "~anthropic/claude-sonnet-5": {},
        "~google/gemini-3.8-flash": {},
        "~deepseek/deepseek-r1": {}
      }
    }
  }
}
```

## Utilisation avec Tendril

Vous pouvez connecter directement Tendril v2 à OpenRouter via l'interface de bureau ou le fichier `config.yaml`.

### Option A : Paramètres de bureau (Bring Your Own LLM)

1. Accédez à **Settings > Coding Agent** dans l'application Tendril.
2. Sous **Bring Your Own LLM**, cliquez sur la carte **OpenAI**.
3. Définissez la **Base URL** sur `https://openrouter.ai/api/v1`.
4. Saisissez votre clé OpenRouter (`sk-or-...`) dans **API Key** et cliquez sur **Save**.

### Option B : Configuration manuelle dans `config.yaml`

Configurez OpenRouter sous `codingAgents` dans `~/.tendril/config.yaml` (voir [Configuration de base](../03_Configuration/01_Setup.md)) :

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "sk-or-..."
      OPENAI_BASE_URL: "https://openrouter.ai/api/v1"
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

> [!TIP]
> Les identifiants de modèles OpenRouter incluent des préfixes de fournisseur (par exemple, `anthropic/claude-opus-5` ou `deepseek/deepseek-r1`). Ces préfixes doivent être inclus textuellement dans les champs `model` de votre profil.

## Liens

- [Fournisseurs de modèles](_Index.md)
- [Agents de codage](../06_CodingAgents/_Index.md)
- [Plateforme OpenRouter](https://openrouter.ai)
- [Guide d'intégration OpenRouter + OpenCode](https://openrouter.ai/docs/cookbook/coding-agents/opencode-integration)
