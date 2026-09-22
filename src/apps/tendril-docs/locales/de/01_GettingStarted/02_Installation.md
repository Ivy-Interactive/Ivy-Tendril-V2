---
title: Installation
description: Installieren Sie Tendril über vorgefertigte Binärdateien oder erstellen Sie es aus dem Quellcode, starten Sie Desktop-App und CLI und konfigurieren Sie Ihre Umgebung.
icon: Download
searchHints:
  - installation
  - vorgefertigte binärdateien
  - aus quellcode erstellen
  - voraussetzungen
  - cargo
  - pnpm
  - tendril home
  - config.yaml
  - update
---

# Installation

Tendril kann über vorkompilierte Desktop-Pakete und CLI-Binärdateien installiert oder lokal aus dem Quellcode kompiliert werden.

## Schnellinstallation

Laden Sie eigenständige Desktop-Installationsprogramme (`.dmg`, `.pkg`, `.exe`, `.AppImage`, `.deb`) direkt von
[GitHub Releases](https://github.com/Ivy-Interactive/Ivy-Tendril/releases/latest) herunter oder führen Sie eines der
automatisierten Installationsskripte aus:

**macOS / Linux:**

```bash
curl -sSf https://cdn.ivy.app/install-tendril.sh | sh
```

**Windows (PowerShell):**

```powershell
irm https://cdn.ivy.app/install-tendril.ps1 | iex
```

Das Installationsprogramm platziert das CLI-Binary `tendril` in Ihrem `PATH` und registriert die Desktop-Anwendung in Ihrem
Systemmenü.

## Voraussetzungen (für die Erstellung aus dem Quellcode)

Wenn Sie aus dem Quellcode kompilieren, stellen Sie sicher, dass die folgenden Abhängigkeiten installiert und in Ihrem `PATH` verfügbar sind:

| Tool                                         | Version              | Rolle                                                                                   |
| -------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------- |
| [Rust](https://www.rust-lang.org/)           | 1.80+ (Edition 2021) | Kompiliert das native CLI, den Server-Daemon und den Core.                              |
| [Node.js](https://nodejs.org/)               | 22 oder neuer        | Steuert das Frontend-Tooling und die Build-Skripte.                                     |
| [pnpm](https://pnpm.io/)                     | 11 oder neuer        | Verwaltet Workspace-Pakete und Abhängigkeiten.                                          |
| [Vite+](https://viteplus.dev/) (`vp`)        | aktuell              | Orchestriert Build, Linting, Formatierung und Tests.                                    |
| [Git](https://git-scm.com/)                  | 2.30+                | Verwaltet [Git worktrees](https://git-scm.com/docs/git-worktree), Commits und Branches. |
| [GitHub CLI](https://cli.github.com/) (`gh`) | authentifiziert      | Öffnet automatisch Pull Requests und verwaltet Issues.                                  |

Sie benötigen außerdem mindestens ein authentifiziertes Coding-Agenten-CLI (z. B. [Claude Code](https://code.claude.com/docs),
[GitHub Copilot](https://github.com/features/copilot), [Gemini](https://ai.google.dev),
[OpenCode](https://opencode.ai), [Antigravity](https://github.com/google-deepmind) oder
[Cursor](https://www.cursor.com)). [Codebase-Onboarding](03_Onboarding.md) behandelt die Konfiguration von Agenten im Detail.

## Aus Quellcode erstellen

1. Klonen Sie das Repository:

```bash
git clone https://github.com/Ivy-Interactive/Ivy-Tendril.git
cd Ivy-Tendril
```

2. Installieren Sie die Frontend-Abhängigkeiten:

```bash
pnpm install
```

3. Kompilieren Sie das CLI und die Core-Crates:

```bash
cargo build --release --bin tendril
```

4. Starten Sie die Entwicklungs-Desktopanwendung:

```bash
pnpm dev
```

## Konfiguration und Verzeichnisse

Tendril speichert Zustand und Konfiguration im Benutzer-Home:

- **Konfigurationsdatei**: `~/.tendril/config.yaml`
- **Datenbank**: `~/.tendril/tendril.db`
- **Logs**: `~/.tendril/logs/`
- **Schlüsselbund / Vault**: `~/.tendril/vault.enc`

Weitere Konfigurationsoptionen finden Sie unter [Konfiguration](../03_Configuration/01_Setup.md).
