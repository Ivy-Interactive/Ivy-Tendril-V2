---
title: Hilfe erhalten
description: Kommen Sie an einer Stelle nicht weiter? So erhalten Sie Unterstützung und treten mit der Tendril-Community in Kontakt.
icon: LifeBuoy
searchHints:
  - hilfe
  - support
  - discord
  - github issues
  - community
  - fehlerbericht
  - report-bug
  - doctor
---

# Hilfe erhalten

Wenn Sie auf Probleme stoßen oder Fragen zur Konfiguration von Tendril haben, stehen Ihnen verschiedene Support-Ressourcen und
Diagnose-Tools zur Verfügung.

## Zuerst die Diagnose ausführen

Bevor Sie ein Issue erstellen oder um Hilfe bitten, führen Sie die integrierte Umgebungsprüfung von Tendril aus:

```bash
tendril doctor
```

`tendril doctor` überprüft das Verzeichnis `$TENDRIL_HOME`, die Syntax von `config.yaml`, die Erreichbarkeit der
[SQLite](https://www.sqlite.org)-Datenbank, das Verzeichnis der [Pläne](../02_Concepts/01_Plans.md), [Git](https://git-scm.com/) und
die Authentifizierung der [GitHub CLI](https://cli.github.com/).

Wenn ein bestimmter Plan oder Job fehlgeschlagen ist, können Sie mit `tendril report-bug` eine vollständige Diagnose bündeln:

```bash
# Plan-Status, Verifikationsberichte und Job-Logs in eine ZIP-Datei packen
tendril report-bug <plan-id>
```

Dadurch wird ein Diagnosearchiv erstellt, das das Plan-YAML, die Revisionshistorie, Verifikationsausgaben und
unbearbeitete Agententranskripte bündelt, ohne sensible Zugangsdaten offenzulegen.

## Fehlerbehebung

Häufige Fehlermeldungen, Datenbankmigrationen und Schritte zur Wiederherstellung von Worktrees finden Sie unter
[Fehlerbehebung](06_Troubleshooting.md).

## Discord-Community

Der schnellste Weg, das Entwicklungsteam und andere Entwickler zu erreichen, ist unser
[Discord-Server](https://discord.gg/FHgxkDga3y). Treten Sie bei, um Fragen zu stellen, Feedback zu teilen und eigene
Promptware-Workflows zu diskutieren.

## GitHub-Issues

Haben Sie einen Fehler gefunden oder möchten Sie eine Funktion vorschlagen? Eröffnen Sie ein Issue in unserem
[GitHub-Repository](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/issues).

> [!TIP]
> Fügen Sie Ihrer Issue-Beschreibung immer die Ausgabe von `tendril doctor` und `tendril version` bei. Wenn Sie
> eine fehlgeschlagene Planausführung melden, hängen Sie die mit `tendril report-bug <plan-id>` erstellte ZIP-Datei
> oder das Job-Log aus `$TENDRIL_HOME/Jobs/` an.

## Nächste Schritte

- [Fehlerbehebung](06_Troubleshooting.md) — Häufige Fehlermuster und Lösungen.
- [Lebenszyklus & Jobs](../02_Concepts/03_Lifecycle.md) — Job-Status und Fehlerbehandlung verstehen.
