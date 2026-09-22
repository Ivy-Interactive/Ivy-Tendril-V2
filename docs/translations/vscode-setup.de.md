# Visual Studio Code Einrichtungsleitfaden für Tendril Skills

Dieser Leitfaden erklärt, wie Sie Tendril Agent Skills mit GitHub Copilot und anderen KI-Agenten-Erweiterungen in Visual Studio Code installieren, konfigurieren und verwenden.

## 1. Schnelle Installation (Skills CLI)

Der einfachste Weg, Tendril Skills für GitHub Copilot in VS Code zu installieren, ist die Nutzung der offenen Agent Skills CLI:

```bash
# Projektweite Installation (installiert nach .agents/skills/ oder .github/skills/)
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot

# Globale Installation (verfügbar in allen VS Code Arbeitsbereichen)
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot -g
```

Um bestimmte einzelne Skills statt des gesamten Pakets zu installieren:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --skill tendril-debug-plan --agent github-copilot
```

## 2. Manuelle Installationspfade

Wenn Sie es vorziehen, Skill-Ordner ohne die CLI manuell zu platzieren:

- **Workspace-Repository (empfohlen für Teams)**:
  Kopieren Sie Skills in `.agents/skills/<skill-name>` oder `.github/skills/<skill-name>` im Stammverzeichnis Ihres Arbeitsbereichs.
- **Benutzerprofil (global für alle Projekte)**:
  Kopieren Sie Skills in `~/.copilot/skills/<skill-name>` (macOS/Linux) oder `%USERPROFILE%\.copilot\skills\<skill-name>` (Windows).

Stellen Sie sicher, dass jeder Skill-Ordner seine `SKILL.md`-Spezifikation und etwaige begleitende `references/`- oder `scripts/`-Verzeichnisse enthält.

## 3. Verwendung von Skills in GitHub Copilot Chat

Sobald installiert, erkennt GitHub Copilot die Skills automatisch:

1. Öffnen Sie Copilot Chat in VS Code (`Ctrl+Alt+I` / `Cmd+Ctrl+I`).
2. Geben Sie `/skills` ein, um geladene Skills und Beschreibungen anzuzeigen.
3. Rufen Sie jeden Tendril Skill direkt als Befehl auf:
   - `/tendril-debug-plan <plan-id>`: Ausführungsprotokolle, Zeitachse und Verifizierungen für einen Plan untersuchen.
   - `/tendril-debug-job <job-id>`: Job-Artefakte, Agenten-Logs und Rohereignisse analysieren.
   - `/tendril-review`: Führen Sie ein umfassendes Code- und Test-Review für geänderte Dateien durch.
   - `/tendrillable <url>`: GitHub Issues für die autonome Agentenausführung bewerten.

## 4. Integration mit anderen VS Code KI-Erweiterungen

Tendril Skills entsprechen dem offenen Agent-Skills-Standard und arbeiten nahtlos mit Erweiterungen von Drittanbietern zusammen:

### Cline
```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent cline
```
Skills werden nach `.cline/skills/` oder in das globale Cline-Konfigurationsverzeichnis geschrieben.

### Continue
```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent continue
```
Skills werden in Ihr `.continue/skills/`-Verzeichnis installiert und können im Prompt-Kontext referenziert werden.

### Roo Code (Roo Clinic)
```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent roo
```
Installiert nach `.roo/skills/` für benutzerdefinierte Systemmodi und Aufgabenausführung.

## 5. Kopplung mit der offiziellen Ivy Tendril VS Code Erweiterung

Für einen integrierten Entwicklungs-Workflow installieren Sie die offizielle [Ivy Tendril VS Code Extension](https://marketplace.visualstudio.com/items?itemName=ivy-interactive.ivy-tendril):

- **Plan-Dashboard**: Pläne direkt in der Seitenleiste durchsuchen, überprüfen und auslösen.
- **Worktree-Navigator**: Mit einem einzigen Klick in isolierte Ausführungs-Worktrees springen.
- **Server-Steuerung**: Tendril-Server-Hintergrundprozesse starten, stoppen und überwachen.

Die Kombination von Tendril Skills mit der VS Code Erweiterung bietet Ihnen eine vollständige Schaltzentrale für die Orchestrierung autonomer Coding-Agenten.

## Lizenz

Tendril Skills und Plugins sind unter der im Repository-Stammverzeichnis befindlichen [Functional Source License (FSL-1.1-ALv2)](../../LICENSE) lizenziert.
