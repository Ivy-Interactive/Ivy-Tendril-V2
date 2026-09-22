# Konfigurationsguide för Google Antigravity för Tendril Skills

Denna guide beskriver hur du installerar och använder Tendril skills med Google Antigravity CLI (`agy`) och Antigravity IDE.

## 1. Installation via Antigravity CLI

Tendril tillhandahåller ett Antigravity-pluginmanifest på `.agents/plugins/marketplace.json`.

### Installera från fjärranslutet Git-arkiv
```bash
agy plugin install https://github.com/ivy-interactive/ivy-tendril-v2.git
```

### Installera från lokal arkivutcheckning
Vid lokal utveckling eller inuti en Ivy-Tendril-V2-utcheckning:
```bash
agy plugin install ./
```

## 2. Pluginverifiering och upptäckt

Verifiera att tillägget och dess associerade skills har lästs in:

```bash
# Lista installerade plugins
agy plugin list

# Verifiera tillgängliga skills
agy skill list
```

Du ser de medföljande Tendril-skillsen:
- `tendril-debug-plan`
- `tendril-debug-job`
- `tendril-review`
- `tendrillable`
- `tendril-release`
- `tendril-extension`

## 3. Anropa skills i Antigravity

I en interaktiv Antigravity-agentsession eller ett automatiserat skript:

- Be Antigravity att felsöka en plan:
  ```
  Use tendril-debug-plan to investigate plan 00516
  ```
- Granska väntande worktree-differ:
  ```
  Run tendril-review on the current changes
  ```
- Bedöm potentiella backlogg-ärenden:
  ```
  Run tendrillable on https://github.com/ivy-interactive/ivy-tendril-v2 5
  ```

## 4. Integrering i Antigravity IDE

Vid arbete i Antigravity IDE:
1. Skills som placeras i arbetskatalogens rotkatalog `.agents/skills/` indexeras automatiskt.
2. För att länka Ivy Tendril-tillägget till Antigravity IDE:
   ```bash
   src/skills/tendril-extension/scripts/install-antigravity.sh
   ```
3. Ladda om fönstret i Antigravity IDE (`Cmd+Shift+P` -> `Developer: Reload Window`).

## Licens

Tendril skills och plugins licensieras under [Functional Source License (FSL-1.1-ALv2)](../../LICENSE) i arkivets rot.
