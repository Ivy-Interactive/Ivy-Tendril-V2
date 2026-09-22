---
title: Skills d'agent
description: Les Skills d'Agent de Tendril packagent les flux de travail d'ingénierie, de débogage et de revue pour les agents de codage d'IA autonomes sur Visual Studio Code, Claude Code, Antigravity, Cursor, OpenAI Codex et Gemini CLI.
icon: Sparkles
searchHints:
  - skills
  - skills d'agent
  - plugins
  - copilot
  - claude
  - antigravity
  - cursor
  - codex
  - gemini
---

# Skills d'agent

## Vue d'ensemble

Les skills d'agent respectent la spécification ouverte des skills d'agent. Chaque skill fournit des instructions structurées, des listes de contrôle de référence et des scripts d'automatisation qui guident les agents de codage à travers des tâches complexes :

- `tendril-debug-plan` : Analyse en profondeur les [journaux de plans](../02_Concepts/01_Plans.md), les sessions JSONL, les exécutions de vérification et les modes de défaillance.
- `tendril-debug-job` : Analyse les artefacts bruts d'exécution de l'agent et les journaux de [promptware](../02_Concepts/02_Promptwares.md) dans la [vue Jobs](../04_Apps/04_Jobs.md).
- `tendril-review` : Effectue des revues de code complètes post-implémentation, des analyses d'écarts de tests et des vérifications de nettoyage.
- `tendrillable` : Qualifie les issues [GitHub](../07_Integrations/01_Github.md) pour évaluer si elles sont prêtes pour une exécution autonome par un agent.
- `tendril-release` : Automatise les mises à jour de paquets, la gestion des versions, les pull requests et les publications de déploiement.
- `tendril-extension` : Compile, teste, empaquète et lie l'extension Ivy Tendril dans [VS Code](https://code.visualstudio.com) et Antigravity IDE.

## Installation universelle

Installez des skills pour n'importe quel agent pris en charge à l'aide de la CLI universelle de skills :

```bash
# Installer toutes les skills
npx skills add ivy-interactive/ivy-tendril-v2

# Installer une skill individuelle
npx skills add ivy-interactive/ivy-tendril-v2 --skill tendril-debug-plan
```

## Intégrations avec les agents

### Visual Studio Code ([GitHub Copilot](03_Copilot.md) et extensions d'IA)

Installez des skills ciblant directement [GitHub Copilot](https://github.com/features/copilot) dans [VS Code](https://code.visualstudio.com) :

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot
```

Ou installez-les globalement sur tous les espaces de travail :

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot -g
```

Les skills sont stockées dans `.agents/skills/` (ou `~/.copilot/skills/`) et apparaissent dans Copilot Chat sous le menu `/skills`. Vous pouvez également cibler des extensions associées :

- [Cline](https://github.com/cline/cline) : `npx skills add ivy-interactive/ivy-tendril-v2 --agent cline`
- [Continue](https://continue.dev) : `npx skills add ivy-interactive/ivy-tendril-v2 --agent continue`
- [Roo Code](https://github.com/RooVetGit/Roo-Code) : `npx skills add ivy-interactive/ivy-tendril-v2 --agent roo`

Pour plus de détails sur le guide associé, consultez [Configuration de VS Code](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/vscode-setup.md).

### [Claude Code](01_ClaudeCode.md)

Installez via la marketplace de plugins de [Claude Code](https://code.claude.com/docs) :

```
/plugin marketplace add ivy-interactive/ivy-tendril-v2
/plugin install tendril-skills@ivy-tendril-v2
```

Pour les tests locaux, lancez Claude Code en pointant vers votre copie locale :

```bash
claude --plugin-dir /chemin/vers/ivy-tendril-v2
```

Pour plus de détails sur le guide associé, consultez [Configuration de Claude Code](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/claude-setup.md).

### Google Antigravity

Installez à l'aide de la CLI d'[Antigravity](https://antigravity.google) (`agy`) :

```bash
agy plugin install https://github.com/ivy-interactive/ivy-tendril-v2.git
```

Ou depuis une copie locale :

```bash
agy plugin install ./
```

Pour plus de détails sur le guide associé, consultez [Configuration d'Antigravity](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/antigravity-setup.md).

### [Cursor](https://cursor.com)

Installez en ciblant [Cursor](https://cursor.com) :

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent cursor
```

Ou placez les skills dans `.cursor/skills/`. Pour plus de détails sur le guide associé, consultez [Configuration de Cursor](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/cursor-setup.md).

### [OpenAI Codex](02_Codex.md)

Ajoutez la marketplace et installez le plugin dans [Codex](https://chatgpt.com/codex) :

```bash
codex plugin marketplace add ivy-interactive/ivy-tendril-v2
codex plugin add tendril-skills@tendril-skills
```

### [Gemini CLI](05_Gemini.md)

Installez les skills directement à l'aide de la [CLI Gemini](https://github.com/google-gemini/gemini-cli) :

```bash
gemini skills install https://github.com/ivy-interactive/ivy-tendril-v2.git --path src/skills
```
