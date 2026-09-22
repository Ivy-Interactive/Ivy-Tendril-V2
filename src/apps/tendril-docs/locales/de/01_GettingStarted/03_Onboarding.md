---
title: Codebase-Onboarding
description: >-
  Eine Checkliste zur Vorbereitung Ihres Entwicklungsrechners und Ihres Repositories, damit Tendril Änderungen
  unbeaufsichtigt planen, ausführen, verifizieren und ausliefern kann.
icon: ClipboardCheck
searchHints:
  - onboarding
  - checkliste
  - vorbereiten
  - entwicklungsrechner
  - umgebung
  - worktree
  - AGENTS.md
  - gh
  - mcp
---

# Codebase-Onboarding

Tendril führt einen Coding-Agenten in einem isolierten [Git worktree](https://git-scm.com/docs/git-worktree) auf Ihrem Repository aus,
baut und testet den Code und öffnet anschließend einen Pull Request.
Damit diese Schleife ohne menschliches Eingreifen gelingt, müssen Rechner und Repository im Voraus konfiguriert werden.
Gehen Sie die folgende Checkliste einmal pro Rechner und einmal pro Codebase durch.

> [!TIP]
> Wenn Sie fertig sind, führen Sie `tendril doctor` aus. Dieser Befehl prüft Tendril Home, `config.yaml`, die Datenbank,
> das Pläneverzeichnis, `git` und `gh`. Er testet **nicht** Ihren Coding-Agenten – verifizieren Sie diesen selbst mit Schritt 2 unten.

## Rechner-Checkliste

### 1. Erforderliche Build-Software ist installiert

Jedes Werkzeug, das zum Kompilieren des Projekts erforderlich ist, muss installiert und im `PATH` verfügbar sein. Der Agent kann
während der Ausführung keinen fehlenden Compiler oder ein SDK nachinstallieren. Für ein Rust- und pnpm-Repository wie das von Tendril selbst
bedeutet das [Rustup](https://rustup.rs/), [Node.js](https://nodejs.org/) und [pnpm](https://pnpm.io/); für Ihr eigenes Projekt
das jeweilige Build-Toolchain.

> [!NOTE]
> Das Zielkriterium: Ein frischer Klon lässt sich aus einem sauberen Terminal mit den dokumentierten Befehlen ohne interaktive Abfragen und ohne manuelle IDE-Schritte bauen.

### 2. Bevorzugtes Coding-Agent-CLI ist installiert und authentifiziert

Installieren Sie den Agenten, den Sie in `config.yaml` als `codingAgent` festgelegt haben, und melden Sie sich an:

```bash
# Beispiel: Claude Code
npm install -g @anthropic-ai/claude-code
claude login
```

Stellen Sie sicher, dass das CLI im `PATH` liegt und bei normaler Ausführung nicht nach Zugangsdaten fragt:

- [Claude Code](https://code.claude.com/docs) (`claude`)
- [OpenAI Codex](https://openai.com) (`codex`)
- [GitHub Copilot](https://github.com/features/copilot) (`copilot`)
- [Google Gemini](https://ai.google.dev) (`gemini`)
- [OpenCode](https://opencode.ai) (`opencode`)
- [Google Antigravity](https://github.com/google-deepmind) (`agy`)
- [Cursor](https://www.cursor.com) (`cursor`)

### 3. Git- und GitHub-CLI sind eingerichtet

Der Agent arbeitet in Git-Worktrees und eröffnet Pull Requests über die GitHub-CLI:

```bash
gh auth status
```

Wenn `gh` nicht authentifiziert ist, führen Sie `gh auth login` aus.

## Repository-Checkliste

1. **Dokumentierte Build- und Testbefehle**: Stellen Sie sicher, dass `test`, `build`, `lint` in `package.json` oder `Cargo.toml` definiert sind.
2. **AGENTS.md**: Fügen Sie Anweisungen und Richtlinien für autonome Agenten in einer `AGENTS.md`-Datei im Stammverzeichnis hinzu.
3. **Verifikations-Skripte**: Konfigurieren Sie die Test-Gates in Tendril, damit der Agent automatisch auf Regressionen prüft.

Nach Abschluss dieser Schritte können Sie mit dem [Tutorial](04_Tutorial.md) fortfahren.
