# Google Antigravity Einrichtungsleitfaden für Tendril Skills

Dieser Leitfaden beschreibt die Installation und Verwendung von Tendril Skills mit dem Google Antigravity CLI (`agy`) und der Antigravity IDE.

## 1. Antigravity CLI Installation

Tendril stellt ein Antigravity-Plugin-Manifest unter `.agents/plugins/marketplace.json` bereit.

### Installation aus dem Remote-Git-Repository
```bash
agy plugin install https://github.com/ivy-interactive/ivy-tendril-v2.git
```

### Installation aus lokalem Repository-Checkout
Während der lokalen Entwicklung oder innerhalb eines Ivy-Tendril-V2-Checkouts:
```bash
agy plugin install ./
```

## 2. Plugin-Verifizierung und -Erkennung

Überprüfen Sie, ob das Plugin und die zugehörigen Skills geladen wurden:

```bash
# Installierte Plugins auflisten
agy plugin list

# Verfügbare Skills überprüfen
agy skill list
```

Sie sehen die gebündelten Tendril Skills:
- `tendril-debug-plan`
- `tendril-debug-job`
- `tendril-review`
- `tendrillable`
- `tendril-release`
- `tendril-extension`

## 3. Skill-Aufruf in Antigravity

In jeder interaktiven Antigravity-Agentensitzung oder in automatisierten Skripten:

- Antigravity auffordern, einen Plan zu debuggen:
  ```
  Verwende tendril-debug-plan, um Plan 00516 zu analysieren
  ```
- Ausstehende Worktree-Diffs überprüfen:
  ```
  Führe tendril-review für die aktuellen Änderungen aus
  ```
- Backlog-Kandidaten triagieren:
  ```
  Führe tendrillable für https://github.com/ivy-interactive/ivy-tendril-v2 5 aus
  ```

## 4. Antigravity IDE Integration

Beim Arbeiten in der Antigravity IDE:
1. Skills im Stammverzeichnis `.agents/skills/` Ihres Arbeitsbereichs werden automatisch indexiert.
2. Um die Ivy Tendril Erweiterung mit der Antigravity IDE zu verknüpfen:
   ```bash
   src/skills/tendril-extension/scripts/install-antigravity.sh
   ```
3. Laden Sie die Antigravity IDE neu (`Cmd+Shift+P` -> `Developer: Reload Window`).

## Lizenz

Tendril Skills und Plugins sind unter der im Repository-Stammverzeichnis befindlichen [Functional Source License (FSL-1.1-ALv2)](../../LICENSE) lizenziert.
