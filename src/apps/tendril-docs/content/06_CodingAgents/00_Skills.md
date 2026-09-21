---
title: Agent Skills
description: Tendril Agent Skills package engineering, debugging, and review workflows for autonomous AI coding agents across Visual Studio Code, Claude Code, Antigravity, Cursor, OpenAI Codex, and Gemini CLI.
icon: Sparkles
searchHints:
  - skills
  - agent skills
  - plugins
  - copilot
  - claude
  - antigravity
  - cursor
  - codex
  - gemini
---

# Agent Skills

## Overview

Agent skills adhere to the open agent skills specification. Each skill provides structured instructions, reference checklists, and automation scripts that guide coding agents through complex tasks:

- `tendril-debug-plan`: Deep-dives into [plan logs](../02_Concepts/01_Plans.md), JSONL sessions, verification runs, and failure modes.
- `tendril-debug-job`: Analyzes raw agent execution artifacts and [promptware](../02_Concepts/02_Promptwares.md) logs in the [Jobs view](../04_Apps/04_Jobs.md).
- `tendril-review`: Performs thorough post-implementation code reviews, test gap analysis, and cleanup checks.
- `tendrillable`: Classifies [GitHub](../07_Integrations/01_Github.md) issues for autonomous agent execution readiness.
- `tendril-release`: Automates package updates, versioning, pull requests, and deployment releases.
- `tendril-extension`: Builds, tests, packages, and links the Ivy Tendril extension into [VS Code](https://code.visualstudio.com) and Antigravity IDE.

## Universal Installation

Install skills for any supported agent using the universal skills CLI:

```bash
# Install all skills
npx skills add ivy-interactive/ivy-tendril-v2

# Install an individual skill
npx skills add ivy-interactive/ivy-tendril-v2 --skill tendril-debug-plan
```

## Agent Integrations

### Visual Studio Code ([GitHub Copilot](03_Copilot.md) & AI Extensions)

Install skills directly targeting [GitHub Copilot](https://github.com/features/copilot) in [VS Code](https://code.visualstudio.com):

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot
```

Or install globally across all workspaces:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot -g
```

Skills are stored in `.agents/skills/` (or `~/.copilot/skills/`) and appear in Copilot Chat under the `/skills` menu. You can also target companion extensions:

- [Cline](https://github.com/cline/cline): `npx skills add ivy-interactive/ivy-tendril-v2 --agent cline`
- [Continue](https://continue.dev): `npx skills add ivy-interactive/ivy-tendril-v2 --agent continue`
- [Roo Code](https://github.com/RooVetGit/Roo-Code): `npx skills add ivy-interactive/ivy-tendril-v2 --agent roo`

For companion guide details, see [VS Code Setup](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/vscode-setup.md).

### [Claude Code](01_ClaudeCode.md)

Install via the [Claude Code](https://code.claude.com/docs) plugin marketplace:

```
/plugin marketplace add ivy-interactive/ivy-tendril-v2
/plugin install tendril-skills@ivy-tendril-v2
```

For local testing, start Claude Code pointing to your checkout:

```bash
claude --plugin-dir /path/to/ivy-tendril-v2
```

For companion guide details, see [Claude Code Setup](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/claude-setup.md).

### Google Antigravity

Install using the [Antigravity](https://antigravity.google) CLI (`agy`):

```bash
agy plugin install https://github.com/ivy-interactive/ivy-tendril-v2.git
```

Or from a local checkout:

```bash
agy plugin install ./
```

For companion guide details, see [Antigravity Setup](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/antigravity-setup.md).

### [Cursor](https://cursor.com)

Install targeting [Cursor](https://cursor.com):

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent cursor
```

Or place skills into `.cursor/skills/`. For companion guide details, see [Cursor Setup](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/cursor-setup.md).

### [OpenAI Codex](02_Codex.md)

Add the marketplace and install the plugin in [Codex](https://chatgpt.com/codex):

```bash
codex plugin marketplace add ivy-interactive/ivy-tendril-v2
codex plugin add tendril-skills@tendril-skills
```

### [Gemini CLI](05_Gemini.md)

Install skills directly using the [Gemini CLI](https://github.com/google-gemini/gemini-cli):

```bash
gemini skills install https://github.com/ivy-interactive/ivy-tendril-v2.git --path src/skills
```
