<p align="right">
  <a href="../../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.es.md">Español</a> | <strong>Deutsch</strong> | <a href="README.fr.md">Français</a>
</p>

<h1>
  <a href="https://tendril.ivy.app"><img src="../../src/logo.png" alt="Tendril Logo" width="64" valign="middle" /></a> Ivy Tendril
</h1>

<p>
  <a href="https://github.com/Ivy-Interactive/Ivy-Tendril/stargazers"><img src="https://img.shields.io/github/stars/Ivy-Interactive/Ivy-Tendril?style=flat&label=%E2%98%85" alt="GitHub stars" /></a>
  <a href="https://github.com/Ivy-Interactive/Ivy-Tendril/releases/latest"><img src="https://img.shields.io/github/v/release/Ivy-Interactive/Ivy-Tendril?style=flat&label=release" alt="Latest Release" /></a>
  <a href="https://github.com/Ivy-Interactive/Ivy-Tendril/actions/workflows/repo-health.yml"><img src="https://img.shields.io/github/actions/workflow/status/Ivy-Interactive/Ivy-Tendril/repo-health.yml?branch=development&style=flat&label=CI" alt="CI Status" /></a>
  <a href="https://tendril.ivy.app"><img src="https://img.shields.io/badge/docs-tendril.ivy.app-blue?style=flat" alt="Dokumentation" /></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-4493F8?style=flat-square" alt="Unterstützte Plattformen: macOS, Windows und Linux" />
</p>

<h2>Die agentische Softwarefabrik für 10x-Entwickler</h2>

<p>
KI-Agenten können mittlerweile 99 % des Codes schreiben. Dies verändert grundlegend, was es bedeutet, Entwickler zu sein. Unsere Rolle verlagert sich darauf zu wissen, <strong>wie exzellenter Code aussieht</strong>. Dafür benötigen wir völlig neue Entwicklertools. Tendril ist dieses Werkzeug und ersetzt Ihre IDE im Zeitalter der Software-Agenten.
</p>

<p>
<a href="https://youtu.be/_KVG1NnAj-8">
  <img src="../yt-thumbnail-in-two-minutes-2.png" alt="Ivy Tendril in zwei Minuten: auf YouTube ansehen" width="720">
</a>
</p>

<p>https://youtu.be/_KVG1NnAj-8</p>

## Funktionen

<table>
<tr>
<td width="50%" valign="middle">

### Parallele Worktrees (Parallel Worktrees)

Führen Sie Agenten in isolierten Git-Worktrees aus. Halten Sie Ihren Hauptzweig (Main Branch) sauber, bis Sie Änderungen überprüfen, freigeben und mergen.

[Dokumentation &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/worktrees.gif" alt="Parallele Worktrees" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Tunneling (Tunneling) (Remote- und mobiles Programmieren)

Geben Sie Ihren Server sicher über Cloudflare Quick Tunnels frei, um Agentenläufe von überall aus zu überwachen und zu steuern.

[Dokumentation &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/tunneling.gif" alt="Tunneling" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Sprach- und Rich-Input (Voice & Rich Input)

Diktieren Sie Prompts mit der integrierten Whisper-Spracheingabe und fügen Sie Textdateien, Protokolle oder Dokumente bequem per Drag-and-Drop hinzu.

[Dokumentation &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/voice.gif" alt="Sprach- und Rich-Input" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Plan-Annotationen (Plan Annotations)

Kommentieren Sie Entwürfe direkt inline, um Pläne automatisch mit überarbeiteten Zielen für Agenten zu aktualisieren.

[Dokumentation &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/annotation.gif" alt="Plan-Annotationen" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Leistungsstarke Code-Reviews (Code Reviews)

Überprüfen Sie Agenten-Änderungen, inspizieren Sie Diffs und geben Sie Code mithilfe automatisierter Verifikations-Gates frei.

[Dokumentation &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/review.gif" alt="Leistungsstarke Code-Reviews" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### GitHub-Integration und automatische Inbox (GitHub Integration & Automated Inbox)

Erfassen Sie GitHub Issues oder jam.dev-Fehlerberichte per Webhook, um Markdown-Pläne automatisch in aktive Jobs umzuwandeln.

[Dokumentation &rarr;](https://tendril.ivy.app/docs/integrations/jamdev)

</td>
<td width="50%">
  <img src="../../src/github.gif" alt="GitHub-Integration und automatische Inbox" width="100%" />
</td>
</tr>
</table>

---

## Unterstützte Agenten

Funktioniert mit **jedem CLI-Agenten**: Wenn er im Terminal läuft, läuft er in Tendril.

<p>
  <a href="https://docs.anthropic.com/claude/docs/claude-code"><kbd><img src="https://www.google.com/s2/favicons?domain=anthropic.com&sz=64" alt="Claude Code Logo" width="16" valign="middle" /> Claude Code</kbd></a> &nbsp;
  <a href="https://github.com/openai/codex"><kbd><img src="https://www.google.com/s2/favicons?domain=openai.com&sz=64" alt="Codex Logo" width="16" valign="middle" /> Codex</kbd></a> &nbsp;
  <a href="https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli"><kbd><img src="https://www.google.com/s2/favicons?domain=github.com&sz=64" alt="GitHub Copilot Logo" width="16" valign="middle" /> GitHub Copilot</kbd></a> &nbsp;
  <a href="https://gemini.google.com/cli"><kbd><img src="https://www.google.com/s2/favicons?domain=google.com&sz=64" alt="Gemini Logo" width="16" valign="middle" /> Gemini</kbd></a> &nbsp;
  <a href="https://opencode.ai/docs/cli/"><kbd><img src="https://www.google.com/s2/favicons?domain=opencode.ai&sz=64" alt="OpenCode Logo" width="16" valign="middle" /> OpenCode</kbd></a> &nbsp;
  <kbd>+ jeder CLI-Agent</kbd>
</p>

## Agent Skills

Erweitern Sie Ihre bevorzugten KI-Coding-Agenten mit offiziellen Tendril-Engineering- und Debugging-Skills.

### Schnellstart

Installieren Sie Tendril-Skills für jeden unterstützten Agenten mit dem universellen Skills-Installer:

```bash
npx skills add ivy-interactive/ivy-tendril
```

Oder installieren Sie einen bestimmten Skill:

```bash
npx skills add ivy-interactive/ivy-tendril --skill tendril-debug-plan
```

### Unterstützte Tools und Umgebungen

<details>
<summary><strong>Visual Studio Code (GitHub Copilot und Erweiterungen)</strong></summary>

Installieren Sie Skills für GitHub Copilot in VS Code:

```bash
npx skills add ivy-interactive/ivy-tendril --agent github-copilot
```

Globale Installation (für alle Workspaces):

```bash
npx skills add ivy-interactive/ivy-tendril --agent github-copilot -g
```

Oder kopieren Sie die Skills direkt nach `.agents/skills/` oder `.github/skills/` (projekteigen) oder nach `~/.copilot/skills/` (global).

Nach der Installation erscheinen die Skills im GitHub Copilot Chat unter dem Menü `/skills` und können direkt als Slash-Befehle aufgerufen werden (z. B. `/tendril-debug-plan`, `/tendril-debug-job`, `/tendril-review`, `/tendrillable`).

Drittanbieter-Erweiterungen für VS Code:
- Cline: `npx skills add ivy-interactive/ivy-tendril --agent cline`
- Continue: `npx skills add ivy-interactive/ivy-tendril --agent continue`
- Roo Code: `npx skills add ivy-interactive/ivy-tendril --agent roo`

Für eine vollständige Editor-Integration installieren Sie die offizielle [Ivy Tendril VS Code Erweiterung](https://marketplace.visualstudio.com/items?itemName=ivy-interactive.ivy-tendril) für integrierte Plan-Dashboards, Worktree-Navigation und Live-Überwachung von Ausführungen.

Weitere Konfigurationsoptionen finden Sie im [VS Code Setup-Guide](../vscode-setup.md).
</details>

<details>
<summary><strong>Claude Code</strong></summary>

Installation über den Claude Code Plugin Marketplace:

```
/plugin marketplace add ivy-interactive/ivy-tendril
/plugin install tendril-skills@ivy-tendril
```

Lokale Entwicklung:

```bash
claude --plugin-dir /path/to/ivy-tendril
```

Weitere Konfigurationsoptionen finden Sie im [Claude Code Setup-Guide](../claude-setup.md).
</details>

<details>
<summary><strong>Antigravity CLI (agy)</strong></summary>

Plugin über Git-URL installieren:

```bash
agy plugin install https://github.com/ivy-interactive/ivy-tendril.git
```

Lokale Installation:

```bash
agy plugin install ./
```

Weitere Konfigurationsoptionen finden Sie im [Antigravity Setup-Guide](../antigravity-setup.md).
</details>

<details>
<summary><strong>Cursor</strong></summary>

Installation für Cursor:

```bash
npx skills add ivy-interactive/ivy-tendril --agent cursor
```

Oder kopieren Sie die Skills nach `.cursor/skills/` (projekteigen) oder `~/.cursor/skills/` (global).

Weitere Konfigurationsoptionen finden Sie im [Cursor Setup-Guide](../cursor-setup.md).
</details>

<details>
<summary><strong>OpenAI Codex</strong></summary>

Installation über den Codex Plugin Marketplace:

```bash
codex plugin marketplace add ivy-interactive/ivy-tendril
codex plugin add tendril-skills@tendril-skills
```
</details>

<details>
<summary><strong>Gemini CLI</strong></summary>

Installation mit der Gemini CLI:

```bash
gemini skills install https://github.com/ivy-interactive/ivy-tendril.git --path skills
```
</details>

---

## Installation

Laden Sie eigenständige Desktop-Installer (`.pkg`, `.AppImage`, `.exe`) direkt von [GitHub Releases](https://github.com/Ivy-Interactive/Ivy-Tendril/releases/latest) herunter oder führen Sie einen der folgenden Schnellinstallationsbefehle aus:

**macOS / Linux:**
```bash
curl -sSf https://cdn.ivy.app/install-tendril.sh | sh
```

**Windows:**
```powershell
irm https://cdn.ivy.app/install-tendril.ps1 | iex
```

### Ausführung

Tendril ist eine Desktop-Anwendung, kann jedoch auch über die CLI gestartet und gesteuert werden:

Desktop-Anwendung starten:
```bash
tendril
```

Im Headless-Modus starten (Webserver ohne Desktop-Benutzeroberfläche):
```bash
tendril --web
```

---

## 🏛 Verzeichnisstruktur

```
Ivy-Tendril-V2/
├── src/
│   ├── apps/
│   │   └── tendril-app/            # Tauri Desktop-App + React Frontend
│   ├── packages/
│   │   └── components/             # @ivy-interactive/components + Storybook
│   ├── crates/
│   │   ├── tendril-core/           # Kern-Domänenmodelle, SQLite-Datenbank, Worktree-Engine
│   │   ├── tendril-server/         # Axum REST & WebSocket HTTP-Server-Daemon
│   │   └── tendril-cli/            # Befehlszeilenschnittstelle ("tendril")
│   └── promptwares/                # Promptware-Agentendefinitionen & Firmware
├── Cargo.toml                      # Einheitlicher Cargo-Workspace
├── pnpm-workspace.yaml             # Einheitlicher pnpm-Workspace
└── package.json                    # Workspace-Root-Skripte
```

---

## 🚀 Erste Schritte

### Voraussetzungen
- [Rust](https://rustup.rs/) (Edition 2021)
- [Node.js](https://nodejs.org/) (v22+) & [pnpm](https://pnpm.io/) (v11+)
- [Vite+](https://viteplus.dev/) (`vp`)
- GitHub CLI (`gh`)

### Schnellstart

1. **Abhängigkeiten installieren**:
   ```bash
   pnpm install
   ```

2. **Komponenten & UI-Bibliothek erstellen**:
   ```bash
   pnpm --filter @ivy-interactive/components build
   ```

3. **Storybook starten**:
   ```bash
   pnpm dev:storybook
   ```

4. **Desktop-App erstellen & ausführen**:
   ```bash
   pnpm dev:app
   ```

5. **Backend-Crates kompilieren**:
   ```bash
   cargo build --workspace
   ```

6. **Tests ausführen**:
   ```bash
   # Web- & Komponententests
   pnpm test

   # Rust-Tests
   cargo test --workspace
   ```

---

## Community & Support

- **Discord:** Treten Sie der Community auf **[Discord](https://discord.gg/FHgxkDga3y)** bei.
- **Feedback & Ideen:** Einen Fehler gefunden oder eine Idee? [Öffnen Sie ein Issue](https://github.com/Ivy-Interactive/Ivy-Tendril/issues).
- **Unterstützen Sie uns:** Vergeben Sie einen [Star](https://github.com/Ivy-Interactive/Ivy-Tendril) für dieses Repository, um unsere Entwicklung zu begleiten.

---

## Lizenz

Apache-2.0 © Ivy Interactive
