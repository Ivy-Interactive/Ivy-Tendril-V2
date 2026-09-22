---
title: Fehlerbehebung
description: >-
  Häufige Symptome und deren Behebung. Wenn Sie immer noch nicht weiterkommen, führen Sie `tendril doctor` aus und wenden Sie sich an die Community auf Discord.
icon: Wrench
searchHints:
  - fehlerbehebung
  - fehler
  - problem
  - symptom
  - debug
  - diagnose
  - veralteter worktree
  - datenbank
  - doctor
  - db
---

# Fehlerbehebung

Diagnostizieren und beheben Sie häufige Probleme mit Konfiguration, Agenten, Plänen und der Datenbank.

## Installation & Umgebung

| Symptom                            | Lösung                                                                                                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TENDRIL_HOME` nicht gefunden      | Setzen Sie die Umgebungsvariable und starten Sie das Terminal neu, oder tragen Sie den Pfad in `~/.tendril_location` ein. Ohne beides nutzt Tendril standardmäßig `~/.tendril`.               |
| `config.yaml` nicht gefunden       | Die Datei muss unter `$TENDRIL_HOME/config.yaml` existieren und exakt so heißen – nicht `tendril-config.yaml`. `tendril doctor` zeigt den erwarteten Pfad an.                                 |
| `gh` nicht authentifiziert         | Führen Sie die Authentifizierung der [GitHub CLI](https://cli.github.com/) durch: `gh auth login`, danach `gh auth status` zur Bestätigung.                                                   |
| `git` nicht gefunden               | Installieren Sie [Git](https://git-scm.com/) und stellen Sie sicher, dass es in Ihrem `PATH` liegt.                                                                                           |
| `tendril` nach Build nicht erkannt | `cargo build --release` legt das Binary unter `target/release/tendril` ab. Fügen Sie dieses Verzeichnis zu `PATH` hinzu oder führen Sie `cargo install --path src/crates/tendril-cli` aus.    |
| Die App startet, aber nichts lädt  | Die Desktop-App überwacht den Daemon `tendril run`. Wenn Sidecar-Binärdateien in einem Build fehlen, gibt es keinen Daemon. Siehe [Installation](02_Installation.md) für Verpackungsschritte. |

## Pläne

| Symptom                                        | Lösung                                                                                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan hängt im Status `Draft` fest              | Prüfen Sie mit `tendril plan get <id>`, ob ein Repository verknüpft ist, und verifizieren Sie die Projektdefinition in `config.yaml`.                               |
| Plan-Ordner unvollständig oder lädt nicht      | Führen Sie `tendril plan validate <id>` aus, um Probleme zu untersuchen – ungültiges `plan.yaml`, fehlendes `Revisions/`, leerer Titel oder Schema-Mismatches.      |
| Plan hat veraltetes Schema                     | Führen Sie `tendril plan doctor --fix` aus, um Planordner auf das aktuelle Schema zu migrieren. Leere Planhüllen entfernen mit `tendril plan doctor --prune-husks`. |
| Plan hat keine Repos konfiguriert              | Führen Sie `tendril plan add-repo <id> <pfad>` aus.                                                                                                                 |
| Veralteter Worktree nach fehlgeschlagenem Lauf | Führen Sie `tendril plan cleanup <id>` aus, um Worktrees beendeter Pläne zu entfernen. Bei nicht-terminalen Plänen `--force` übergeben.                             |

## Ausführung & Agenten

| Symptom                        | Lösung                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent nicht erreichbar         | Prüfen Sie `codingAgent` in `config.yaml` und führen Sie das CLI des Agenten direkt in einer sauberen Shell aus. Wenn `claude`, `codex`, `copilot`, `gemini`, `opencode`, `antigravity` oder `cursor` nicht unbeaufsichtigt laufen können, stocken Hintergrund-Jobs. Für `apple` prüfen Sie `fm available` und stellen Sie sicher, dass `fm serve` aktiv ist. |
| Ausführung schlägt sofort fehl | Lesen Sie das Job-Log unter `$TENDRIL_HOME/Jobs/{jobId}-{planId}-{promptware}/`. Häufige Ursachen sind fehlender Repository-Kontext oder fehlende Tool-Berechtigungen in [Promptwares](../02_Concepts/02_Promptwares.md).                                                                                                                                     |
| Verifikationen schlagen fehl   | Führen Sie den Verifikationsbefehl manuell im isolierten Worktree des Plans aus (`$TENDRIL_HOME/Plans/{id}-{name}/Worktrees/{repo}`). Meist fehlt dem Worktree ein Setup-Schritt – siehe [Codebase-Onboarding](03_Onboarding.md).                                                                                                                             |
| Job startet nicht              | Führen Sie `tendril job queue` aus, um die Verteilungsreihenfolge und Parallelitätsgrenzen (`maxConcurrentJobs` in `config.yaml`) zu prüfen. Siehe [Lebenszyklus & Jobs](../02_Concepts/03_Lifecycle.md).                                                                                                                                                     |
| Spracheingabe nicht verfügbar  | Unter macOS erteilen Sie Mikrofonberechtigungen unter Systemeinstellungen → Datenschutz & Sicherheit → Mikrofon und starten Sie die App neu.                                                                                                                                                                                                                  |

## Datenbank

Tendril verwaltet seine [SQLite](https://www.sqlite.org)-Datenbank unter `$TENDRIL_HOME/tendril.db`. Während Migrationen
beim Daemon-Start automatisch ausgeführt werden, bietet Tendril eigene Datenbankbefehle:

```bash
# Status der Migrationen prüfen
tendril db status

# Datenbankintegrität überprüfen
tendril db doctor
```
