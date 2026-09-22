---
title: Coding-Agenten
description: Coding-Agenten sind die KI-gestützten Laufzeiten, die Tendril-Pläne ausführen. Wählen Sie einen Agenten, konfigurieren Sie Profile, installieren Sie Agenten-Skills und lassen Sie Tendril die Arbeit orchestrieren.
icon: Bot
groupExpanded: true
searchHints:
  - coding-agenten
  - agent
  - claude
  - codex
  - copilot
  - opencode
  - gemini
  - skills
---

# Coding-Agenten

Coding-Agenten sind die KI-gestützten Laufzeiten, die Tendril-[Pläne](../02_Concepts/01_Plans.md) ausführen. Wählen Sie einen Agenten, konfigurieren Sie Profile, installieren Sie Agenten-Skills und überlassen Sie Tendril die Orchestrierung.

- [Agenten-Skills](00_Skills.md) — Strukturierte Engineering-, Debugging- und Review-Workflows für autonome KI-Coding-Agenten.
- [Claude Code](01_ClaudeCode.md) — Standard-Coding-Agent in Tendril, betrieben mit Modellen von Anthropic Claude.
- [Codex](02_Codex.md) — Alternativer Coding-Agent mit OpenAI GPT-Modellen.
- [Copilot](03_Copilot.md) — Coding-Agent über die GitHub Copilot CLI.
- [OpenCode](04_OpenCode.md) — Multi-Provider-Coding-Agent mit flexiblen Inferenz-Backends.
- [Gemini CLI](05_Gemini.md) — Coding-Agent mit Google Gemini Modellen.

## Umgebungsvariablen

Sie können Umgebungsvariablen für den Agentenprozess über `config.yaml` einbinden:

```yaml
codingAgents:
  - name: claude
    environmentVariables:
      CLAUDE_CODE_USE_BEDROCK: "1"
      ANTHROPIC_BASE_URL: "https://ihr-endpunkt.example.com"
    profiles:
      - name: balanced
        model: sonnet
        effort: high
```
