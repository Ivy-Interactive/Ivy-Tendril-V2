---
title: Promptwares
description: >-
  Promptwares sind die zweckgebundenen Workflow-Agenten hinter jeder Plan-Phase – jeweils mit eigenem System-Prompt,
  Tools und Langzeitgedächtnis.
icon: Terminal
searchHints:
  - promptware
  - agent
  - prompt
  - tools
  - memory
  - allowedTools
  - profile
  - customInstructions
  - layers
---

# Promptwares

Eine Promptware ist ein Verzeichnis, das die Anweisungen, Tools und das Gedächtnis enthält, die einen zweckgebundenen
Workflow-Agenten definieren. Bereitgestellte Exemplare befinden sich unter `$TENDRIL_HOME/Promptwares/`, jeweils ein Verzeichnis pro Promptware:

- **Program.md** — Der System-Prompt: Das Ziel des Agenten, schrittweise Verfahren und Ausführungsregeln.
- **Tools/** — Ausführbare Skripte und Hilfsprogramme, die der Agent während seines Laufs aufrufen darf.
- **Memory/** — Persistente Markdown-Notizen, die über Läufe hinweg erhalten bleiben. Diese Feedback-Schleife ermöglicht es Promptwares,
  Besonderheiten der Codebase zu lernen und Fehler nicht zu wiederholen.

Tendril delegiert Promptwares an Ihren konfigurierten Coding-Agenten (wie
[Claude Code](../06_CodingAgents/01_ClaudeCode.md), [Codex](../06_CodingAgents/02_Codex.md),
[Copilot](../06_CodingAgents/03_Copilot.md), [Gemini](../06_CodingAgents/05_Gemini.md),
[OpenCode](../06_CodingAgents/04_OpenCode.md), Antigravity oder [Cursor](https://www.cursor.com)) und führt jeweils
einen Job nach dem Prinzip der geringsten Berechtigung aus.

## Bereitstellung & Schichten (Layers)

Tendril liefert standardmäßig eine Reihe integrierter Promptwares mit. Teams können in
[config.yaml](../03_Configuration/01_Setup.md) ein Overlay-Verzeichnis konfigurieren, um Prompts zu überschreiben oder
eigene Team-Tools bereitzustellen.

Promptwares bereitstellen oder aktualisieren:

```bash
tendril promptware deploy
```

Prüfen, aus welcher Schicht eine Promptware geladen wird:

```bash
tendril promptware layers
# oder für eine spezifische Promptware:
tendril promptware layers ExecutePlan
```

## Zentrale Workflow-Agenten

| Promptware      | Rolle                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------- |
| **CreatePlan**  | Entwirft einen Plan aus einem kurzen Briefing, einem Posteingangselement oder einem GitHub-Issue. |
| **ExpandPlan**  | Erweitert einen knappen Plan zu einer detaillierten, umsetzbaren Spezifikation mit Phasen.        |
| **UpdatePlan**  | Überarbeitet den Plan basierend auf Benutzeranmerkungen und Notizen.                              |
| **ExecutePlan** | Implementiert die Codeänderungen in einem isolierten Git-Worktree.                                |
| **ReviewPlan**  | Führt Code-Reviews und Qualitätsprüfungen für das entstandene Diff durch.                         |

Weitere Details zur Ausführung finden Sie unter [Lebenszyklus](../02_Concepts/03_Lifecycle.md).
