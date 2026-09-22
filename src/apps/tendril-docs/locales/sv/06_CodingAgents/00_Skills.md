---
title: Agentfärdigheter
description: Tendril Agent Skills paketerar arbetsflöden för utveckling,
  felsökning och granskning för autonoma AI-kodningsagenter i Visual Studio
  Code, Claude Code, Antigravity, Cursor, OpenAI Codex och Gemini CLI.
icon: Sparkles
searchHints:
  - färdigheter
  - agentfärdigheter
  - insticksprogram
  - copilot
  - claude
  - antigravity
  - cursor
  - codex
  - gemini
---

# Agentfärdigheter

## Översikt

Agentfärdigheter följer den öppna specifikationen för agent skills. Varje färdighet tillhandahåller strukturerade instruktioner, referenschecklistor och automatiseringsskript som vägleder kodningsagenter genom komplexa uppgifter:

- `tendril-debug-plan`: Djupdyker i [planloggar](../02_Concepts/01_Plans.md), JSONL-sessioner, verifieringskörningar och fellägen.
- `tendril-debug-job`: Analyserar råa agentexekveringsartefakter och [promptware](../02_Concepts/02_Promptwares.md)-loggar i [jobbvyn](../04_Apps/04_Jobs.md).
- `tendril-review`: Utför noggranna kodgranskningar efter implementering, analys av testluckor och upprensningskontroller.
- `tendrillable`: Klassificerar [GitHub](../07_Integrations/01_Github.md)-ärenden för beredskap inför autonom agentexekvering.
- `tendril-release`: Automatiserar paketuppdateringar, versionshantering, pull requests och distributionsreleaser.
- `tendril-extension`: Bygger, testar, paketerar och länkar Ivy Tendril-tillägget till [VS Code](https://code.visualstudio.com) och Antigravity IDE.

## Universell installation

Installera färdigheter för valfri agent som stöds med hjälp av den universella CLI:n för färdigheter:

```bash
# Install all skills
npx skills add ivy-interactive/ivy-tendril-v2

# Install an individual skill
npx skills add ivy-interactive/ivy-tendril-v2 --skill tendril-debug-plan
```

## Agentintegrationer

### Visual Studio Code ([GitHub Copilot](03_Copilot.md) & AI-tillägg)

Installera färdigheter direkt riktade mot [GitHub Copilot](https://github.com/features/copilot) i [VS Code](https://code.visualstudio.com):

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot
```

Eller installera globalt över alla arbetsytor:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot -g
```

Färdigheter sparas i `.agents/skills/` (eller `~/.copilot/skills/`) och visas i Copilot Chat under menyn `/skills`. Du kan även rikta in dig på kompletterande tillägg:

- [Cline](https://github.com/cline/cline): `npx skills add ivy-interactive/ivy-tendril-v2 --agent cline`
- [Continue](https://continue.dev): `npx skills add ivy-interactive/ivy-tendril-v2 --agent continue`
- [Roo Code](https://github.com/RooVetGit/Roo-Code): `npx skills add ivy-interactive/ivy-tendril-v2 --agent roo`

För mer information om konfiguration, se [VS Code-konfiguration](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/vscode-setup.md).

### [Claude Code](01_ClaudeCode.md)

Installera via tilläggsmarknadsplatsen för [Claude Code](https://code.claude.com/docs):

```
/plugin marketplace add ivy-interactive/ivy-tendril-v2
/plugin install tendril-skills@ivy-tendril-v2
```

För lokal testning, starta Claude Code med pekning mot din utcheckning:

```bash
claude --plugin-dir /path/to/ivy-tendril-v2
```

För mer information om konfiguration, se [Claude Code-konfiguration](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/claude-setup.md).

### Google Antigravity

Installera med [Antigravity](https://antigravity.google) CLI (`agy`):

```bash
agy plugin install https://github.com/ivy-interactive/ivy-tendril-v2.git
```

Eller från en lokal utcheckning:

```bash
agy plugin install ./
```

För mer information om konfiguration, se [Antigravity-konfiguration](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/antigravity-setup.md).

### [Cursor](https://cursor.com)

Installera riktat mot [Cursor](https://cursor.com):

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent cursor
```

Eller placera färdigheter i `.cursor/skills/`. För mer information om konfiguration, se [Cursor-konfiguration](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/cursor-setup.md).

### [OpenAI Codex](02_Codex.md)

Lägg till marknadsplatsen och installera insticksprogrammet i [Codex](https://chatgpt.com/codex):

```bash
codex plugin marketplace add ivy-interactive/ivy-tendril-v2
codex plugin add tendril-skills@tendril-skills
```

### [Gemini CLI](05_Gemini.md)

Installera färdigheter direkt med hjälp av [Gemini CLI](https://github.com/google-gemini/gemini-cli):

```bash
gemini skills install https://github.com/ivy-interactive/ivy-tendril-v2.git --path src/skills
```
