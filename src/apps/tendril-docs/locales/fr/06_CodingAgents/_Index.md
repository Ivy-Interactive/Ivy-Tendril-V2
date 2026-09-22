---
title: Agents de codage
description: Les agents de codage sont les environnements d'exécution basés sur l'IA qui exécutent les plans de Tendril. Choisissez un agent, configurez des profils, installez des skills d'agent et laissez Tendril orchestrer le travail.
icon: Bot
groupExpanded: true
searchHints:
  - agents de codage
  - agent
  - claude
  - codex
  - copilot
  - opencode
  - gemini
  - skills
---

# Agents de codage

Les agents de codage sont les environnements d'exécution basés sur l'IA qui exécutent les [plans](../02_Concepts/01_Plans.md) de Tendril. Choisissez un agent, configurez des profils, installez des skills d'agent et laissez Tendril orchestrer le travail.

- [Skills d'agent](00_Skills.md) — flux de travail packagés d'ingénierie, de débogage et de revue pour agents de codage d'IA autonomes.
- [Claude Code](01_ClaudeCode.md) — agent de codage par défaut dans Tendril, propulsé par les modèles [Anthropic Claude](https://code.claude.com/docs).
- [Codex](02_Codex.md) — agent de codage alternatif propulsé par les modèles GPT d'[OpenAI](https://openai.com).
- [Copilot](03_Copilot.md) — agent de codage propulsé par la [CLI Copilot](https://github.com/features/copilot) de GitHub.
- [OpenCode](04_OpenCode.md) — agent de codage multi-fournisseur prenant en charge divers backends d'inférence.
- [Gemini CLI](05_Gemini.md) — agent de codage propulsé par les modèles [Gemini](https://ai.google.dev) de Google.

## Variables d'environnement

Vous pouvez injecter des variables d'environnement dans le processus de l'agent de codage via `config.yaml`. Celles-ci s'appliquent à la fois à l'exécution des tâches ([plans](../02_Concepts/01_Plans.md)) et à l'onglet interactif Agent (PTY). Pour connaître toutes les options de configuration, consultez [Installation et paramètres](../03_Configuration/01_Setup.md).

```yaml
codingAgents:
  - name: claude
    environmentVariables:
      CLAUDE_CODE_USE_BEDROCK: "1"
      ANTHROPIC_BASE_URL: "https://your-endpoint.example.com"
    profiles:
      - name: balanced
        model: sonnet
        effort: high
```

Toutes les paires clé/valeur sous `environmentVariables` sont définies dans l'environnement de processus de l'agent avant son démarrage. Utilisez cette option pour la configuration des fournisseurs (par exemple [AWS Bedrock](https://aws.amazon.com/bedrock/), points de terminaison d'API personnalisés) ou tout indicateur (flag) d'exécution pris en charge par la CLI de l'agent.
