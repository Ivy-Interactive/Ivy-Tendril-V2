---
title: MCP-Server
description: Stellen Sie Tendril-Tools und -Ressourcen für KI-Coding-Agenten über das Model Context Protocol (MCP) bereit.
icon: Terminal
searchHints:
  - mcp
  - model context protocol
  - server
  - tools
  - agent
---

# MCP-Server

Tendril fungiert als Model Context Protocol (MCP) Server und macht Kernfunktionen für Coding-Agenten wie Claude Code, Cursor und Copilot zugänglich.

## Bereitgestellte Tools

- `tendril_get_plan`: Ruft Metadaten, Phasen und Verifikationen eines Plans ab.
- `tendril_update_plan`: Aktualisiert Ziele oder Phasen einer Spezifikation.
- `tendril_run_verification`: Führt definierte Verifikations-Gates in einem Worktree aus.
