---
title: Projekt-Setup
description: Jedes Projekt ist ein Git-Repo mit eigenen Verifikationen und Agenten-Kontext. Tendril betreibt viele Projekte parallel.
icon: FolderGit
searchHints:
  - projekt
  - repo
  - repository
  - multi-projekt
  - isolation
  - worktree
  - danger zone
  - mcp
  - sandboxing
---

# Projekt-Setup

Tendril unterstützt die parallele Verwaltung mehrerer Projekte. Jedes Projekt definiert eigene [Git](https://git-scm.com)-Repositories,
Verifikations-Gates, Port-Zuweisungen, Umgebungsvariablen, Sicherheits-Sandboxen und benutzerdefinierte Skills.

## Projekte hinzufügen & verwalten

Projekte können visuell über **Einstellungen > Projekte** konfiguriert oder in `$TENDRIL_HOME/config.yaml` deklariert werden (siehe [Einrichtung & Einstellungen](01_Setup.md)):

- **Assistent zum Hinzufügen von Projekten** — Klicken Sie in der Einstellungs-Seitenleiste auf **Projekt hinzufügen**, um ein Projekt mit Repository-Pfad, Akzentfarbe und Standard-Verifikations-Gates zu registrieren.
- **Inline-Umbenennung** — Klicken Sie auf das Stiftsymbol neben dem Projektnamen, um ein Projekt umzubenennen. Tendril prüft auf Namensduplikate und aktualisiert zugehörige Pläne automatisch.
- **Farbpalette** — Wählen Sie eine Akzentfarbe aus der Ivy-Farbpalette (`ColorSwatchField`). Diese Farbe hebt das Projekt im [Dashboard](../04_Apps/01_Dashboard.md), in der [Pläne](../04_Apps/03_Plans.md)-Warteschlange und in [Reviews](../04_Apps/02_Review.md) hervor.
- **Kontext** — Markdown-Anweisungen, die Domänenterminologie, Architekturbeschränkungen und Coding-Standards beschreiben. Dieser Kontext wird den Anweisungen für alle Agentenläufe im Projekt vorangestellt.

### `config.yaml`-Beispiel

```yaml
projects:
  - name: Global Engine
    color: Emerald
    context: |
      Zentrale Engine-Dienste in Rust mit einer TypeScript-CLI.
      Folgen Sie den Ivy-Designrichtlinien und stellen Sie sicher, dass alle Tests bestehen.
    repos:
      - path: ~/repos/global-engine
    verifications:
      - name: Build
        required: true
      - name: Test
        required: true
      - name: Lint
        required: true
      - name: CheckResult
        required: true
```
