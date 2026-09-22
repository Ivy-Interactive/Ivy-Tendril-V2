---
title: Evroc
description: Fournisseur de cloud souverain européen avec des modèles de codage open source incluant Kimi, Llama et Mistral.
icon: Server
searchHints:
  - evroc
  - ue
  - européen
  - souverain
  - kimi
  - mistral
  - llama
---

# Evroc

[Evroc](https://cloud.evroc.com) est un fournisseur de cloud souverain européen exploitant des centres de données sécurisés et écoresponsables à travers l'Europe. Grâce à sa plateforme d'IA "Think", Evroc propose une inférence compatible avec [OpenAI](https://openai.com) pour les principaux modèles open source tels que Kimi, Llama et Mistral, avec une conformité totale au [RGPD](https://gdpr.eu) et la souveraineté européenne des données.

## Configuration

1. Créez un compte sur [cloud.evroc.com](https://cloud.evroc.com).
2. Générez une clé d'API dans la console Evroc sous **Think > Models > + New**.
3. Connectez-vous dans [OpenCode](https://opencode.ai) via le sidecar inclus ou le terminal :
   ```bash
   opencode
   ```
   Tapez `/connect`, sélectionnez **evroc** et saisissez votre clé d'API.
4. Sélectionnez votre modèle actif avec `/models`.

## Modèles recommandés

Evroc héberge des poids ouverts à haute capacité optimisés pour le codage et le raisonnement technique :

| Modèle                    | ID                                                                          | Créateur                           | Points forts                                                              |
| :------------------------ | :-------------------------------------------------------------------------- | :--------------------------------- | :------------------------------------------------------------------------ |
| **Kimi K3 / K2.5**        | `moonshotai/Kimi-K3`, `moonshotai/Kimi-K2.5`                                | [Moonshot AI](https://moonshot.cn) | Raisonnement multifichier et codage à contexte long exceptionnels         |
| **Mistral Large / Small** | `mistralai/Mistral-Large-2411`, `mistralai/Mistral-Small-24B-Instruct-2501` | [Mistral AI](https://mistral.ai)   | Génération et vérification de code rapides et précises                    |
| **Llama 3.3 70B**         | `meta-llama/Llama-3.3-70B-Instruct`                                         | [Meta AI](https://llama.meta.com)  | Connaissances étendues en programmation, documentation et refactorisation |

> [!TIP]
> Recherchez les modèles portant le tag **Code** dans la console Evroc pour obtenir les meilleurs résultats lors des tâches de programmation.

## Utilisation avec Tendril

Vous pouvez acheminer l'exécution des plans Tendril v2 via Evroc de deux façons :

### Option A : Via OpenCode inclus

1. Dans l'application de bureau Tendril, accédez à **Settings > Coding Agent**.
2. Sélectionnez **OpenCode** comme agent de codage (voir [Agent OpenCode](../06_CodingAgents/04_OpenCode.md)).
3. Tendril appelle le sidecar [OpenCode](https://opencode.ai) inclus (`binaries/opencode`), qui achemine les requêtes via votre fournisseur Evroc authentifié.

### Option B : Point de terminaison OpenAI personnalisé dans `config.yaml`

Puisqu'Evroc propose une interface compatible avec OpenAI, vous pouvez le configurer directement sous `codingAgents` dans `~/.tendril/config.yaml` (voir [Configuration de base](../03_Configuration/01_Setup.md)) :

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-evroc-api-key"
      OPENAI_BASE_URL: "https://api.evroc.com/v1"
    profiles:
      - name: deep
        model: "moonshotai/Kimi-K3"
        effort: high
      - name: balanced
        model: "moonshotai/Kimi-K2.5"
        effort: medium
      - name: quick
        model: "mistralai/Mistral-Small-24B-Instruct-2501"
        effort: low
```

## Liens

- [Fournisseurs de modèles](_Index.md)
- [Agents de codage](../06_CodingAgents/_Index.md)
- [Console Cloud Evroc](https://cloud.evroc.com)
- [Documentation Evroc + OpenCode](https://docs.evroc.com/integrations/opencode.html)
