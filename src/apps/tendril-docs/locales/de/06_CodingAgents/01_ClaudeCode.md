---
title: Claude Code
description: Claude Code ist der Standard-Coding-Agent in Tendril und nutzt modernste Anthropic Claude Modelle für autonome Planausführungen.
icon: Bot
searchHints:
  - claude code
  - anthropic
  - claude
  - sonnet
  - opus
  - haiku
---

# Claude Code

Claude Code von Anthropic ist der empfohlene und am tiefsten integrierte Coding-Agent in Tendril.

## Einrichtung

1. Installieren Sie das Claude Code CLI:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```
2. Authentifizieren Sie sich:
   ```bash
   claude login
   ```
3. Konfigurieren Sie Claude als primären Agenten in `$TENDRIL_HOME/config.yaml`:
   ```yaml
   codingAgent: claude
   ```

## Profile

Tendril unterstützt die Definition spezifischer Modellprofile (z. B. `sonnet`, `opus`, `haiku`) und Denkzeit-Stufen (Effort Levels) für komplexe Aufgaben.
