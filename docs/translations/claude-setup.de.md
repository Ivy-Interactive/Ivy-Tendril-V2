# Claude Code Einrichtungsleitfaden für Tendril Skills

Dieser Leitfaden beschreibt die Installation, Konfiguration und das Testen von Tendril Agent Skills in Claude Code.

## 1. Installation über den Plugin-Marktplatz

Tendril stellt offizielle Plugin-Manifeste unter `.claude-plugin/marketplace.json` und `.claude-plugin/plugin.json` bereit.

Fügen Sie in Claude Code das Ivy-Tendril-V2-Repository als Marktplatzquelle hinzu:

```
/plugin marketplace add ivy-interactive/ivy-tendril-v2
```

Installieren Sie anschließend das `tendril-skills`-Plugin:

```
/plugin install tendril-skills@ivy-tendril-v2
```

## 2. Lokale Entwicklung und Tests

Wenn Sie Skills lokal entwickeln oder Änderungen vor dem Push testen möchten:

Starten Sie Claude Code mit dem Plugin-Verzeichnis, das auf Ihren lokalen Repository-Checkout verweist:

```bash
claude --plugin-dir /pfad/zu/ivy-tendril-v2
```

Claude Code liest `.claude-plugin/plugin.json` und bindet automatisch alle in `skills/` definierten Skills ein.

## 3. Abwärtskompatibilität mit .claude/skills

Für lokale Repository-Workflows innerhalb von Ivy-Tendril-V2:
- Symlinks in `.claude/skills/<skill-name>` verweisen auf `../../skills/<skill-name>`.
- Jede bestehende lokale Claude Code-Konfiguration, die auf `.claude/skills/` verweist, funktioniert nahtlos ohne manuelle Rekonfiguration weiter.

## 4. Skills in Claude Code aufrufen

Nach der Installation können Sie Slash-Befehle direkt in Ihrer Claude Code-Sitzung verwenden:

- `/tendril-debug-plan <plan-id>`: Fehlgeschlagene oder langsame Pläne untersuchen.
- `/tendril-debug-job <job-id>`: Job-Artefakte und Agent-Entscheidungsprotokolle prüfen.
- `/tendril-review`: Codequalität und Regressionsprüfungen für aktuelle Diffs durchführen.
- `/tendrillable <url>`: Backlog-Issues anhand autonomer Agent-Kriterien klassifizieren.
- `/tendril-release`: Versionssprünge, Abhängigkeits-Updates und Release-Workflows automatisieren.

## Lizenz

Tendril Skills und Plugins sind unter der im Repository-Stammverzeichnis befindlichen [Functional Source License (FSL-1.1-ALv2)](../LICENSE) lizenziert.
