---
title: Agentes de código
description: Los agentes de código son los entornos de ejecución impulsados por IA que ejecutan los planes de Tendril. Elija un agente, configure perfiles, instale skills de agente y deje que Tendril orqueste el trabajo.
icon: Bot
groupExpanded: true
searchHints:
  - agentes de código
  - agente
  - claude
  - codex
  - copilot
  - opencode
  - gemini
  - skills
---

# Agentes de código

Los agentes de código son los entornos de ejecución impulsados por IA que ejecutan los [planes](../02_Concepts/01_Plans.md) de Tendril. Elija un agente, configure perfiles, instale skills de agente y deje que Tendril orqueste el trabajo.

- [Skills de agente](00_Skills.md) — flujos de trabajo empaquetados de ingeniería, depuración y revisión para agentes de código de IA autónomos.
- [Claude Code](01_ClaudeCode.md) — agente de código predeterminado en Tendril, impulsado por los modelos [Anthropic Claude](https://code.claude.com/docs).
- [Codex](02_Codex.md) — agente de código alternativo impulsado por los modelos GPT de [OpenAI](https://openai.com).
- [Copilot](03_Copilot.md) — agente de código impulsado por la [CLI de Copilot](https://github.com/features/copilot) de GitHub.
- [OpenCode](04_OpenCode.md) — agente de código multiproveedor compatible con diversos backends de inferencia.
- [Gemini CLI](05_Gemini.md) — agente de código impulsado por los modelos [Gemini](https://ai.google.dev) de Google.

## Variables de entorno

Puede inyectar variables de entorno en el proceso del agente de código mediante `config.yaml`. Estas se aplican tanto a la ejecución de trabajos ([planes](../02_Concepts/01_Plans.md)) como a la pestaña interactiva del Agente (PTY). Para conocer todas las opciones de configuración, consulte [Instalación y ajustes](../03_Configuration/01_Setup.md).

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

Cualquier par clave/valor bajo `environmentVariables` se establece en el entorno del proceso del agente antes de que se inicie. Utilice esto para la configuración del proveedor (por ejemplo, [AWS Bedrock](https://aws.amazon.com/bedrock/), endpoints de API personalizados) o cualquier indicador (flag) en tiempo de ejecución que admita la CLI del agente.
