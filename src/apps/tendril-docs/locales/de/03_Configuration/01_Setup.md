---
title: Einrichtung & Einstellungen
description: Konfigurieren Sie Tendril in der Einstellungs-UI oder durch Bearbeiten von TENDRIL_HOME/config.yaml (Projekte, Agenten, Stufen, Verifikationen, Präferenzen).
icon: Construction
searchHints:
  - konfiguration
  - yaml
  - einstellungen
  - settings
  - projekte
  - gui
  - bereitstellung
  - docker
  - secrets
  - BasicAuth
  - passwort
  - hosted
---

# Einrichtung & Einstellungen

## In-App-Einstellungen

Tendril enthält eine eigene Einstellungs-App, um die Umgebung visuell zu konfigurieren, ohne [YAML](https://yaml.org) manuell bearbeiten zu müssen:

- **Coding Agent** — Wählen Sie die primäre Coding-Agent-Laufzeit ([Claude Code](../06_CodingAgents/01_ClaudeCode.md), [Copilot](../06_CodingAgents/03_Copilot.md), [Codex](../06_CodingAgents/02_Codex.md), [Gemini](../06_CodingAgents/05_Gemini.md), Antigravity, [OpenCode](../06_CodingAgents/04_OpenCode.md), Cursor, Apple oder eigene OpenAI-kompatible Proxys), konfigurieren Sie API-Schlüssel und benutzerdefinierte URLs. Siehe [Coding-Agenten](../06_CodingAgents/_Index.md).
- **Pläne** — Bearbeiten Sie die Standard-Markdown-Planvorlage (`planTemplate`), die beim Erstellen neuer Pläne in [Pläne](../04_Apps/03_Plans.md) verwendet wird.
- **Erscheinungsbild** — Wählen Sie das Design (**Hell**, **Dunkel** oder **System**), Farbpaletten und die Standardansicht der Seitenleiste.
- **Projekte** — Verwalten Sie registrierte Projekte, konfigurieren Sie Repositories, Verifikationen, Ports, Umgebungsvariablen und [MCP](../09_Advanced/03_MCP.md)-Server. Siehe [Projekt-Setup](02_Projects.md).
- **Team Vault** _(Beta)_ — Synchronisieren Sie Projekte, benutzerdefinierte Skills und Sicherheitsregeln über ein gemeinsames [Git](https://git-scm.com)-Repository.
- **Workflow-Agenten** — Konfigurieren Sie [Promptware](../02_Concepts/02_Promptwares.md)-Agentenprofile und granulare Tool-Berechtigungen (`allowedTools`, `deniedTools`).
- **Sicherheit & Tunneling** — Richten Sie Passwortschutz für Websitzungen ein und starten oder stoppen Sie [Cloudflare](https://www.cloudflare.com)-Tunnel für den Fernzugriff.
- **Erweitert** — Zeitlimits festlegen (`jobTimeout`, `staleOutputTimeout`), `maxConcurrentJobs` einstellen und Live-Daemon-Diagnose einsehen.

## `config.yaml`

Alle in der UI vorgenommenen Änderungen werden sofort in `$TENDRIL_HOME/config.yaml` (standardmäßig `~/.tendril/config.yaml`) gespeichert. Sie können die Datei auch direkt bearbeiten.

> [!NOTE]
> Die Konfigurationsdatei muss immer `config.yaml` heißen. Der Tendril-Daemon lädt Änderungen auf der Festplatte automatisch neu.

### Beispiel

```yaml
codingAgent: claude
maxConcurrentJobs: 5
jobTimeout: 45
staleOutputTimeout: 10
theme: default
themeMode: system
chatMode: chat
desktopNotifications: true

projects:
  - name: Hauptanwendung
    color: Emerald
    repos:
      - /pfad/zu/repo
```
