# Cursor Einrichtungsleitfaden für Tendril Skills

Dieser Leitfaden erklärt, wie Sie Tendril Agent Skills in Cursor installieren und konfigurieren.

## 1. Schnelle Installation (Skills CLI)

Installieren Sie Tendril Skills in Ihr Cursor-Projekt mithilfe der Skills-CLI:

```bash
# Projektweite Installation (installiert nach .cursor/skills/)
npx skills add ivy-interactive/ivy-tendril-v2 --agent cursor

# Globale Installation (über alle Cursor-Arbeitsbereiche hinweg)
npx skills add ivy-interactive/ivy-tendril-v2 --agent cursor -g
```

## 2. Verzeichnisstruktur in Cursor

Cursor sucht an folgenden Orten nach Skill-Definitionen:

- **Projektebene**: `.cursor/skills/<skill-name>/SKILL.md`
- **Global / Benutzerebene**: `~/.cursor/skills/<skill-name>/SKILL.md` (macOS/Linux) oder `%USERPROFILE%\.cursor\skills\<skill-name>\SKILL.md` (Windows)

Jeder Ordner enthält:
- `SKILL.md`: Hauptanweisungen mit YAML-Frontmatter
- Unterstützende Referenzdokumentation und Skripte

## 3. Zusammenspiel mit Cursor Rules (.cursorrules)

Sie können in den `.cursorrules`- oder `.cursor/rules/*.mdc`-Dateien Ihres Projekts auf Tendril Skills verweisen:

```markdown
Beim Debuggen fehlgeschlagener Pläne oder Überprüfen von Änderungen:
- Verwenden Sie src/skills/tendril-debug-plan zur Diagnose der Planausführung.
- Führen Sie src/skills/tendril-review-Prozeduren aus, bevor Pull Requests finalisiert werden.
```

## 4. Verwendung im Cursor Agent Chat

Im Chat-Fenster des Cursor-Agenten:
- Tippen Sie `@tendril-debug-plan` oder fordern Sie den Agenten auf, einen Plan anhand seiner Anweisungen zu untersuchen.
- Bitten Sie Cursor, `/tendril-review` für den aktiven Git-Diff auszuführen.
- Führen Sie `/tendrillable` aus, um Issues nach Agenten-Eignung einzustufen.

## Lizenz

Tendril Skills und Plugins sind unter der im Repository-Stammverzeichnis befindlichen [Functional Source License (FSL-1.1-ALv2)](../../LICENSE) lizenziert.
