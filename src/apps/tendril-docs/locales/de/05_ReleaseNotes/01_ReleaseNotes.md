---
title: Release-Hinweise
description: Versionshistorie, neue Funktionen, Verbesserungen und Fehlerbehebungen für jedes Tendril-Release.
icon: ScrollText
searchHints:
  - release notes
  - changelog
  - versionshistorie
  - updates
  - was ist neu
---

# Release-Hinweise

## 2.0.0 (2026-09-21)

Tendril v2 ist eine grundlegende architektonische Neugestaltung der Tendril-Plattform. Der Daemon und die Kern-Engine wurden in [Rust](https://www.rust-lang.org) neu geschrieben, die Desktop-App nutzt nun [Tauri v2](https://tauri.app), das Frontend basiert auf [Vite+](https://viteplus.dev) und [React 19](https://react.dev), und es wurden native Multi-Agent-Worktree-Parallelität, Live-Terminal-Interaktionen sowie erweiterte [Modell-Provider](../08_ModelProviders/_Index.md) eingeführt.

### Wichtige Architektur-Änderungen

- **Hochperformanter Rust-Daemon (`tendril-server` & `tendril-core`)**: Ersetzt das bisherige .NET-Backend durch einen asynchronen Rust-Daemon auf Basis von Tokio und Axum. Sub-Millisekunden-Routing, robustes SQLite-Verbindungs-Pooling und atomare Konfigurations-Schreibvorgänge.
- **Tauri v2 Desktop-Anwendung**: Schlanke, ressourcenschonende Desktop-Distribution für macOS, Linux und Windows auf Basis nativer System-Webviews.
- **Vite+ React-Frontend**: Vollständig überarbeitete Benutzeroberfläche mit React 19 und gemeinsam genutzten Design-Tokens aus `@ivy-interactive/components`.
- **Parallele Worktree-Ausführung**: Automatische Bereitstellung von [Git worktrees](https://git-scm.com/docs/git-worktree) für die gleichzeitige Ausführung mehrerer Pläne auf isolierten Branches.
- **Eingebettetes PTY-Terminal & interaktiver Chat**: Integrierte Xterm.js-Terminalemulation direkt in der Anwendung für Echtzeit-Interaktion mit Coding-Agenten.
- **Erweiterte Modell-Integrationen**: Integriertes OpenCode-Sidecar (`binaries/opencode`), Bring Your Own LLM (OpenAI, Anthropic, Berget AI) und Apple Foundation Models auf macOS.

### Neue Funktionen

- **Eingebettetes Terminal für Review-Aktionen & Agenten**: Führen Sie Aktionen in vollwertigen ANSI-fähigen Terminal-Tabs aus.
- **Multi-Repo Git-Worktree-Verwaltung**: Strukturierte Arbeitsbereiche unter `Worktrees/<owner>/<repo>`.
- **Zentralisierte Team-Vault-Synchronisation**: Teilen von Projekten, MCP-Servern und Skills über Git-basierte Vaults.
- **Cloudflare Quick Tunnels**: Teilen von Leseansichten für Plan-Reviews über sichere Cloudflare-Tunnel mit QR-Codes und Passwortschutz.

### Verbesserungen

- **Sub-Millisekunden-CLI-Aufrufe**: Das in Rust geschriebene `tendril` CLI startet nahezu verzögerungsfrei.
- **Token- & Kostenbuchhaltung**: Echtzeit-Aufschlüsselung von Token-Verbrauch und LLM-Kosten.
- **Automatisierte Verifikations-Runner**: Automatisierte Ausführung von Test-, Formatierungs- und Linter-Suiten.

## 1.2.0 (2026-09-01)

### Funktionen

- **Neugestaltete App-Hülle (Figma)**: Modernisiertes Desktop-Layout mit einklappbarer Navigation und persistenten Tabs (`#2173`).
- **Neues Tendril Dashboard**: React-Widget mit Live-Zählern, Aktivitätstrends und Cloudflare Quick Tunnel QR-Codes (`#2201`).
- **Umbenennung Drafts zu Plans**: Vereinheitlichung der Begriffe im gesamten System (`#2258`).
- **HTTP Multipart-Uploads für Chat-Anhänge**: Zuverlässige Dateiübertragung großer Anhänge (`#2255`, `#2224`).
- **Persistente Warteschlangen-Nachrichten**: Eingegebene Prompts bleiben über Sitzungswechsel hinweg erhalten (`#2253`).
