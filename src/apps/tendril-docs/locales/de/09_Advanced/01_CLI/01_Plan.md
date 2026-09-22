---
title: plan Befehle
description: Pläne, Worktrees, Revisionen und Verifikationen im Tendril CLI erstellen, auflisten, aktualisieren und validieren.
icon: FileText
searchHints:
  - tendril plan
  - plan create
  - plan execute
  - plan list
  - plan review
---

# plan Befehle

Die Unterbefehle unter `tendril plan` steuern den gesamten Lebenszyklus eines Plans.

## Befehle

- `tendril plan list`: Listet alle Pläne mit Status und Projekt auf.
- `tendril plan create <TITEL>`: Erstellt einen neuen Planentwurf.
- `tendril plan execute <ID>`: Führt den Plan mit dem konfigurierten Agenten aus.
- `tendril plan review <ID>`: Öffnet die Review-Ansicht für einen fertigen Plan.
- `tendril plan ship <ID>`: Wandelt den Plan in einen GitHub Pull Request um.
- `tendril plan cleanup <ID>`: Bereinigt verbliebene temporäre Worktrees.
