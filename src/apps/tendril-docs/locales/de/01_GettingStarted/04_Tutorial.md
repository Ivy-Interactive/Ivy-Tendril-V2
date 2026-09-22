---
title: Tutorial
description: >-
  Ein vollständiger End-to-End-Leitfaden: Erstellen Sie Tendril, registrieren Sie ein lokales Repository,
  erstellen Sie Ihren ersten Plan, führen Sie ihn mit einem Agenten aus, überprüfen Sie das Ergebnis und eröffnen Sie einen Pull Request.
icon: GraduationCap
searchHints:
  - tutorial
  - leitfaden
  - schnellstart
  - erster plan
  - end to end
  - beispiel
---

# Tutorial

Dies ist der vollständige End-to-End-Workflow auf einem Repository Ihrer Wahl. Er umfasst das Registrieren eines Projekts,
das Generieren eines Plans, das Ausführen von Änderungen in isolierten Worktrees, das Überprüfen von Diffs und das Erstellen eines Pull Requests.

## Schritt 1: Erstellen und Verifizieren

Folgen Sie der [Installation](02_Installation.md), um Tendril zu installieren oder zu bauen und `tendril` in Ihren `PATH` aufzunehmen.
Überprüfen Sie Ihre Umgebung:

```bash
tendril doctor
```

`tendril doctor` prüft `$TENDRIL_HOME`, `config.yaml`, die [SQLite](https://www.sqlite.org)-Datenbank, das
Pläneverzeichnis, [Git](https://git-scm.com/) und die [GitHub CLI](https://cli.github.com/) (`gh`). Beheben Sie alle
`[FAIL]`-Einträge, bevor Sie fortfahren.

## Schritt 2: Tendril starten

Starten Sie die Desktop-Anwendung:

```bash
pnpm dev:desktop
```

Die Desktop-App startet und überwacht automatisch den `tendril run`-Daemon im Hintergrund. Der
Daemon stellt die REST- und WebSocket-API bereit, über die Desktop-Benutzeroberfläche und CLI kommunizieren.

Wenn Sie den Daemon ohne Benutzeroberfläche (headless) ausführen möchten:

```bash
# Prüft Port und führt anstehende Migrationen aus
tendril run

# Oder direkter Server mit benutzerdefinierten Optionen:
tendril serve --host 127.0.0.1 --port 5010
```

## Schritt 3: Repository registrieren

Tendril benötigt ein lokales Git-Repository, mit dem es arbeiten kann:

```bash
tendril project add /pfad/zu/ihrem-repo
```

## Schritt 4: Ersten Plan erstellen

Erstellen Sie einen neuen Plan über die Desktop-App oder die CLI:

```bash
tendril plan create "Füge Gesundheitsprüfungsendpunkt /healthz hinzu"
```

## Schritt 5: Plan ausführen

Starten Sie die Ausführung des Plans:

```bash
tendril plan execute 00001
```

Der konfigurierte Coding-Agent wird in einem isolierten Git-Worktree gestartet, implementiert die Änderungen und führt die konfigurierten Verifikationsschritte aus.

## Schritt 6: Review und Pull Request

Nach Abschluss der Ausführung können Sie das Diff überprüfen und einen Pull Request erstellen:

```bash
tendril review 00001
tendril plan ship 00001
```

Glückwunsch! Sie haben Ihren ersten automatisierten Plan mit Tendril erfolgreich abgeschlossen.
