---
title: Z.AI
description: Z.AI offre un accès à haut débit aux modèles de pointe GLM avec des options de forfaits dédiés au codage.
icon: Server
searchHints:
  - z.ai
  - zai
  - glm
  - zhipu
  - bigmodel
---

# Z.AI

[Z.AI](https://z.ai) (développé par [Zhipu AI](https://open.bigmodel.cn)) offre un accès d'entreprise à la famille de modèles GLM, incluant des forfaits de codage spécialisés optimisés pour les agents de programmation autonomes, les [plans](../02_Concepts/01_Plans.md) et les flux de développement logiciel automatisés.

## Configuration

1. Récupérez une clé d'API sur la [console d'API Z.AI](https://z.ai/manage-apikey/apikey-list).
2. Authentifiez-vous dans [OpenCode](https://opencode.ai) via le terminal ou le PTY intégré de Tendril :
   ```bash
   opencode auth login
   ```
   Sélectionnez **Z.AI** (ou **Z.AI Coding Plan** si vous avez souscrit un forfait dédié au codage), puis collez votre clé d'API lorsque vous y êtes invité.
3. Lancez OpenCode et explorez les modèles disponibles :
   ```bash
   opencode
   ```
   Tapez `/models` pour changer de modèle actif.

## Modèles recommandés

| Modèle                | ID                         | Niveau de profil | Idéal pour                                                          |
| :-------------------- | :------------------------- | :--------------- | :------------------------------------------------------------------ |
| **GLM 4.7**           | `glm-4.7`                  | Deep             | Génération de code complexe, planification architecturale, débogage |
| **GLM 4 Plus**        | `glm-4-plus`               | Balanced         | Ajouts de fonctionnalités, refactorisation, revue de code           |
| **GLM 4 Air / Flash** | `glm-4-air`, `glm-4-flash` | Quick            | Linting rapide, génération de tests unitaires, résumés de commits   |

## Utilisation avec Tendril

1. Ouvrez l'application de bureau Tendril et accédez à **Settings > Coding Agent**.
2. Sélectionnez **OpenCode** comme agent de codage actif (voir [Agent OpenCode](../06_CodingAgents/04_OpenCode.md)).
3. Tendril appelle le sidecar [OpenCode](https://opencode.ai) inclus (`binaries/opencode`), acheminant les tâches des agents directement via le backend de Z.AI.

Vous pouvez également spécifier des modèles GLM par niveau d'exécution dans `~/.tendril/config.yaml` (voir [Configuration de base](../03_Configuration/01_Setup.md)) :

```yaml
codingAgent: opencode

codingAgents:
  - name: opencode
    profiles:
      - name: deep
        model: "glm-4.7"
        effort: high
      - name: balanced
        model: "glm-4-plus"
        effort: medium
      - name: quick
        model: "glm-4-air"
        effort: low
```

> [!NOTE]
> Le plan de codage de Z.AI (Coding Plan) fournit des limites de débit plus élevées et des créneaux de requêtes simultanées spécialement conçus pour les exécutions continues d'agents et les constructions complexes de [plans](../02_Concepts/01_Plans.md).

## Liens

- [Fournisseurs de modèles](_Index.md)
- [Agents de codage](../06_CodingAgents/_Index.md)
- [Plateforme Z.AI](https://z.ai)
- [Console Z.AI](https://z.ai/manage-apikey/apikey-list)
- [Documentation Z.AI + OpenCode](https://docs.z.ai/scenario-example/develop-tools/opencode)
