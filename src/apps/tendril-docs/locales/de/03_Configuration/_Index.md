---
title: Konfiguration
description: Konfigurieren Sie Tendril-Einstellungen, Umgebungsvariablen, Daemon-Optionen und Projektprofile.
icon: Settings
groupExpanded: true
searchHints:
  - konfiguration
  - einstellungen
  - optionen
  - präferenzen
  - umgebung
---

# Konfiguration

Tendril speichert seine Einstellungen, Projekte und Ausführungspräferenzen in einer zentralen [YAML](https://yaml.org)-Konfigurationsdatei unter `$TENDRIL_HOME/config.yaml`.

Dieser Abschnitt behandelt die Konfiguration der globalen Tendril-Umgebung, das [Projekt-Setup](02_Projects.md), Daemon-Einstellungen und [Coding-Agent-Profile](../06_CodingAgents/_Index.md):

- [Einrichtung & Einstellungen](01_Setup.md) — Globale Optionen in der Einstellungs-UI oder in `$TENDRIL_HOME/config.yaml` verwalten, [Coding-Agenten](../06_CodingAgents/_Index.md), Sitzungsauthentifizierung, [Cloudflare](https://www.cloudflare.com)-Tunnel und integrierte [Verifikationen](01_Setup.md#verifications) einrichten.
- [Projekt-Setup](02_Projects.md) — [Git](https://git-scm.com)-Repositories registrieren, Farbkennzeichnungen, Verifikations-Pipelines, Review-Aktionen, Port-Zuweisungen, [Docker](https://www.docker.com)-Sandboxing, [MCP](../09_Advanced/03_MCP.md)-Server und [Git worktree](02_Projects.md#repositories--git-worktrees)-Isolation konfigurieren.

Konzeptionelle Hintergründe finden Sie unter [Pläne](../02_Concepts/01_Plans.md), [Promptwares](../02_Concepts/02_Promptwares.md) und [Lebenszyklus](../02_Concepts/03_Lifecycle.md).
