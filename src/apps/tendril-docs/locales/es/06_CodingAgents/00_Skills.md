---
title: Skills de agente
description: Las Skills de Agente de Tendril empaquetan flujos de trabajo de ingeniería, depuración y revisión para agentes de código de IA autónomos en Visual Studio Code, Claude Code, Antigravity, Cursor, OpenAI Codex y Gemini CLI.
icon: Sparkles
searchHints:
  - skills
  - skills de agente
  - plugins
  - copilot
  - claude
  - antigravity
  - cursor
  - codex
  - gemini
---

# Skills de agente

## Descripción general

Las skills de agente cumplen con la especificación abierta de agent skills. Cada skill proporciona instrucciones estructuradas, listas de comprobación de referencia y scripts de automatización que guían a los agentes de código a través de tareas complejas:

- `tendril-debug-plan`: Profundiza en los [registros de planes](../02_Concepts/01_Plans.md), sesiones JSONL, ejecuciones de verificación y modos de fallo.
- `tendril-debug-job`: Analiza artefactos sin procesar de ejecución de agentes y registros de [promptware](../02_Concepts/02_Promptwares.md) en la [vista de Jobs](../04_Apps/04_Jobs.md).
- `tendril-review`: Realiza revisiones de código exhaustivas posteriores a la implementación, análisis de brechas de pruebas y comprobaciones de limpieza.
- `tendrillable`: Clasifica issues de [GitHub](../07_Integrations/01_Github.md) según su preparación para la ejecución autónoma por parte de agentes.
- `tendril-release`: Automatiza actualizaciones de paquetes, control de versiones, pull requests y lanzamientos de despliegue.
- `tendril-extension`: Compila, prueba, empaqueta y vincula la extensión Ivy Tendril en [VS Code](https://code.visualstudio.com) y Antigravity IDE.

## Instalación universal

Instale skills para cualquier agente compatible mediante la CLI universal de skills:

```bash
# Instalar todas las skills
npx skills add ivy-interactive/ivy-tendril-v2

# Instalar una skill individual
npx skills add ivy-interactive/ivy-tendril-v2 --skill tendril-debug-plan
```

## Integraciones con agentes

### Visual Studio Code ([GitHub Copilot](03_Copilot.md) y extensiones de IA)

Instale skills dirigidas directamente a [GitHub Copilot](https://github.com/features/copilot) en [VS Code](https://code.visualstudio.com):

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot
```

O instale globalmente en todos los espacios de trabajo:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot -g
```

Las skills se almacenan en `.agents/skills/` (o `~/.copilot/skills/`) y aparecen en Copilot Chat bajo el menú `/skills`. También puede apuntar a extensiones complementarias:

- [Cline](https://github.com/cline/cline): `npx skills add ivy-interactive/ivy-tendril-v2 --agent cline`
- [Continue](https://continue.dev): `npx skills add ivy-interactive/ivy-tendril-v2 --agent continue`
- [Roo Code](https://github.com/RooVetGit/Roo-Code): `npx skills add ivy-interactive/ivy-tendril-v2 --agent roo`

Para más detalles sobre la guía complementaria, consulte [Configuración de VS Code](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/vscode-setup.md).

### [Claude Code](01_ClaudeCode.md)

Instale a través del marketplace de plugins de [Claude Code](https://code.claude.com/docs):

```
/plugin marketplace add ivy-interactive/ivy-tendril-v2
/plugin install tendril-skills@ivy-tendril-v2
```

Para pruebas locales, inicie Claude Code apuntando a su copia local:

```bash
claude --plugin-dir /path/to/ivy-tendril-v2
```

Para más detalles sobre la guía complementaria, consulte [Configuración de Claude Code](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/claude-setup.md).

### Google Antigravity

Instale utilizando la CLI de [Antigravity](https://antigravity.google) (`agy`):

```bash
agy plugin install https://github.com/ivy-interactive/ivy-tendril-v2.git
```

O desde una copia local:

```bash
agy plugin install ./
```

Para más detalles sobre la guía complementaria, consulte [Configuración de Antigravity](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/antigravity-setup.md).

### [Cursor](https://cursor.com)

Instale apuntando a [Cursor](https://cursor.com):

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent cursor
```

O coloque las skills en `.cursor/skills/`. Para más detalles sobre la guía complementaria, consulte [Configuración de Cursor](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/cursor-setup.md).

### [OpenAI Codex](02_Codex.md)

Añada el marketplace e instale el plugin en [Codex](https://chatgpt.com/codex):

```bash
codex plugin marketplace add ivy-interactive/ivy-tendril-v2
codex plugin add tendril-skills@tendril-skills
```

### [Gemini CLI](05_Gemini.md)

Instale skills directamente utilizando la [CLI de Gemini](https://github.com/google-gemini/gemini-cli):

```bash
gemini skills install https://github.com/ivy-interactive/ivy-tendril-v2.git --path src/skills
```
