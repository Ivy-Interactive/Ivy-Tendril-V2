---
title: Willkommen bei Ivy Tendril
description: >-
  Tendril ist eine Open-Source-, Local-First-Desktopanwendung, die als Betriebssystem für
  die KI-gestützte Softwareentwicklung dient – sie orchestriert Coding-Agenten wie Claude Code, Codex, Copilot,
  Gemini, OpenCode, Antigravity, Cursor und Apple Foundation Models über einen strukturierten Lebenszyklus von
  der Idee bis zum gemergten Pull Request.
icon: Rocket
searchHints:
  - übersicht
  - was ist tendril
  - agenten orchestrierung
  - architektur
  - tauri
  - daemon
---

# Willkommen bei Ivy Tendril

[![Ivy Tendril in zwei Minuten: auf YouTube ansehen](../assets/yt-thumbnail-in-two-minutes-2.png)](https://youtu.be/_KVG1NnAj-8)

## Das Konzept

In Tendril wird Arbeit in [**Plänen**](../02_Concepts/01_Plans.md) organisiert – strukturierte, überprüfbare Arbeitseinheiten.
Anstelle einer undurchsichtigen Blackbox, die unkontrollierten Code ausgibt, führt Tendril Ihren Plan durch einen definierten
[Lebenszyklus](../02_Concepts/03_Lifecycle.md) unter Verwendung von [**Promptwares**](../02_Concepts/02_Promptwares.md):
isolierte, zweckgebundene Workflow-Agenten, die sich auf eine Phase spezialisieren. Ob es sich um den Entwurf des Plans handelt,
die Implementierung von Änderungen in parallelen Worktrees, das Ausführen von Verifikations-Gates oder das Öffnen von Pull Requests – Sie behalten
die vollständige Kontrolle und Transparenz. Tendril vervollständigt nicht einfach nur Codezeilen in Ihrem Editor; es orchestriert Ihren autonomen
Entwicklungs-Workflow.

## Hauptfunktionen

- **Parallele Worktrees** — Jeder Agent arbeitet in einem isolierten [Git worktree](https://git-scm.com/docs/git-worktree),
  sodass mehrere Pläne gleichzeitig ausgeführt werden können, ohne Branch-Kontamination oder Dateikonflikte im Arbeitsverzeichnis.
- **Tunneling für Remote- und mobile Arbeit** — Den lokalen Daemon sicher über
  [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)
  freigeben, um Fortschritte zu überprüfen und laufende Agenten von Ihrem Smartphone oder Remote-Browser aus zu steuern.
- **Sprach- und Rich-Eingabe** — Diktieren Sie Anforderungen mit integrierter [OpenAI Whisper](https://github.com/openai/whisper)
  Transkription, oder fügen Sie Terminal-Protokolle, Markdown-Spezifikationen und Designdateien als Kontext hinzu.
- **Plan-Annotationen** — Versehen Sie einen Planentwurf direkt mit Notizen; Tendril speist Ihre Anmerkungen direkt in
  [UpdatePlan](../02_Concepts/02_Promptwares.md) ein, um die Spezifikation zu überarbeiten.
- **Code-Reviews mit Verifikations-Gates** — Prüfen Sie Git-Diffs, begutachten Sie automatisierte Testergebnisse (`Cargo`,
  `pnpm`, Linting, Formatierung) und genehmigen Sie nur verifizierte Änderungen.
- **GitHub- und Posteingangs-Erfassung** — Eingehende [GitHub](https://github.com)-Issues und
  [Jam.dev](https://jam.dev)-Fehlerberichte automatisch über Webhooks in Pläne umwandeln.

## Architektur

Tendril besteht aus drei Kernkomponenten, die lokal auf Ihrem Rechner laufen:

- Einer **Desktop-App**, entwickelt mit [Tauri 2](https://tauri.app) – einer leistungsstarken nativen Desktop-Hülle
  mit einem [React](https://react.dev)-Frontend.
- Einem **Server-Daemon**, geschrieben in [Rust](https://www.rust-lang.org) (`tendril run` / `tendril serve`),
  der eine REST- und WebSocket-API bereitstellt. Die Desktop-App startet und überwacht den Daemon automatisch im
  Hintergrund.
- Einer **CLI** (`tendril`), die sich mit demselben Daemon verbindet und denselben Datenspeicher teilt. Alles,
  was über die Desktop-App steuerbar ist, kann auch über die Befehlszeile ausgeführt werden.

Der Zustand wird vollständig lokal gehalten:

- Die Metadaten von Plänen, Jobs und Projekten werden in SQLite (`tendril.db`) gespeichert.
- Die Ausführung erfolgt in echten Git-Worktrees auf Ihrem lokalen Dateisystem.
- Secrets und API-Schlüssel verbleiben in Ihrem lokalen Schlüsselbund oder in einer verschlüsselten Vault-Datei.
