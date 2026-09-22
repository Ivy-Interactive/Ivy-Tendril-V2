---
title: Datenbank Befehle
description: Verwalten Sie die SQLite-Datenbank von Tendril, führen Sie Migrationen aus und prüfen Sie die Datenintegrität.
icon: Database
searchHints:
  - tendril db
  - database
  - migrations
  - sqlite
  - vacuum
---

# Datenbank Befehle

Verwalten Sie die lokale SQLite-Datenbank (`tendril.db`):

- `tendril db status`: Zeigt angewendete und ausstehende Migrationen an.
- `tendril db migrate`: Führt anstehende Datenbankschemata-Updates aus.
- `tendril db doctor`: Überprüft Integrität und Indizes.
