# Richtlinie zur Klassifizierung von Telemetriedaten

## Zweck

Dieses Dokument definiert, welche Daten Tendril an Telemetriedienste von Drittanbietern (PostHog) senden darf und welche nicht. Ziel ist es, nützliche Analysen zu erfassen und gleichzeitig die Privatsphäre der Benutzer zu respektieren.

Die Richtlinie reist mit dem Code: Sie wurde aus der `TELEMETRY.md` der ursprünglichen Tendril-App portiert und auf die in V2 tatsächlich angebundenen Ereignisse reduziert.

## Opt-in, nicht Opt-out

**Telemetrie ist standardmäßig deaktiviert, es sei denn, Sie aktivieren sie explizit.** Nur ein ausdrückliches `telemetry: true` in `config.yaml` aktiviert die Erfassung; ein fehlender Schlüssel und `telemetry: false` verhalten sich identisch — es wird kein Client konstruiert, kein Ereignis in die Warteschlange gestellt und kein Netzwerkaufruf unternommen. Der Schlüssel wird an genau einer Stelle gelesen: `TendrilSettings::telemetry_enabled` in [config.rs](../../src/crates/tendril-core/src/config.rs), und V2 führt den Schlüssel niemals eigenständig ein: Das Speichern einer `config.yaml`, die ihn nicht enthält, lässt ihn weg, anstatt `telemetry: false` zu stempeln. Ein expliziter Wert bleibt unverändert erhalten.

**Dies ist eine bewusste Abweichung.** Die ursprüngliche App war Opt-out: Sie setzte `Telemetry` standardmäßig auf `true`. V2 setzt standardmäßig auf deaktiviert, da die Aktivierung der Datenerfassung keine Entscheidung ist, die ein Port stillschweigend für einen Benutzer treffen sollte.

Benutzer werden ausschließlich über eine zufällige UUID identifiziert, die in `<TendrilHome>/.anonymous-id` gespeichert wird. Sie wird niemals von einem Benutzernamen, Computernamen oder Repository abgeleitet.

## Klassifizierungsregeln

### ERLAUBT — Aggregierte und nicht identifizierende Daten

- **Zählwerte**: Anzahl der Projekte, Repositories, Pläne, Jobs (nur aggregierte Summen)
- **Dauern**: Für Operationen benötigte Zeit in Sekunden
- **Zustände/Typen**: Enum-Werte, Zustandsnamen, Job-Typen (z. B. `CreatePlan`, `ExecutePlan`)
- **Stufen**: Planstufen (z. B. `Bug`, `Feature`, `Epic`)
- **Versionen**: Anwendungsversions-Strings, Betriebssystemname und Versions-Strings
- **Agentenanbieter**: Name des Coding-Agenten (z. B. `claude`, `codex`, `copilot`, `gemini`, `opencode`, `antigravity`, `apple`, `ivy`)
- **Booleans**: Feature-Flags, Konfigurationszustände (z. B. `llm_configured: true`)
- **Technologie-Deskriptoren**: Der Stack-Hash des Projekts (siehe unten)
- **Installationsbezogene Einweg-Hashes** sonst verbotener Bezeichner (siehe unten)

#### Stack-Hash (`stack_hash`)

Der Stack-Deskriptor-Hash ist eine kanonische Signatur des Technologie-Stacks eines Projekts (z. B. `fe.ts:react+next+tailwind/be.rs:axum/db:sqlite/test:vitest`). Er besteht nur aus einem geschlossenen Vokabular aus Sprach-, Framework-, Datenbank- und Test-Framework-Slugs — per Konstruktion enthält er keine Namen, Pfade, Versionen oder Freitext. Er zeigt, auf welchen Stacks Tendril verwendet wird, ohne preiszugeben, um wessen Projekt es sich handelt.

#### Installationsbezogene Plan-Identität (`plan_uuid`)

Rohe Plan-IDs bleiben verboten, aber Ereignisse müssen weiterhin pro Plan gruppierbar sein.
`telemetry::derive_plan_uuid` erzeugt `SHA256("tendril-plan:" + anonymous_id + ":" + plan_id)` — ein Hash, der stabil bleibt, solange der Benutzer denselben Rechner verwendet, aber global unverknüpfbar ist.

### VERBOTEN — Sensible und identifizierende Daten

- **Keine Datei- oder Verzeichnispfade**
- **Keine Repository-URLs oder Remotes**
- **Keine Git-Branch- oder Commit-Namen**
- **Keine Plan-Titel, Beschreibungen oder Freitextinhalte**
- **Keine Modell-Prompts oder -Vervollständigungen**
- **Keine Fehlermeldungen mit Pfaden oder Codeausschnitten**
- **Keine IP-Adressen oder Standortdaten**
