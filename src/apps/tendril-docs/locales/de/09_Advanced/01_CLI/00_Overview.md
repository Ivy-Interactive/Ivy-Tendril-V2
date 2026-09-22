---
title: CLI-Übersicht
description: Globale Optionen, Umgebungsvariablen und grundlegende Fehlerbehebungsbefehle für das Tendril CLI.
icon: Terminal
searchHints:
  - cli übersicht
  - tendril
  - flags
  - optionen
  - hilfe
---

# CLI-Übersicht

Das `tendril` CLI verbindet sich mit dem lokalen Daemon oder führt Befehle direkt auf der Datenbank und im Dateisystem aus.

## Grundlegende Syntax

```bash
tendril [OPTIONS] <COMMAND>
```

### Globale Optionen

- `-h, --help`: Zeigt Hilfetexte an.
- `-V, --version`: Gibt die Version von Tendril aus.
- `--verbose`: Aktiviert detaillierte Debug-Ausgaben.
- `--config <PATH>`: Überschreibt den Pfad zu `config.yaml`.
