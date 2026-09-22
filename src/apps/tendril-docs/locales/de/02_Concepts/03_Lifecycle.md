---
title: Lebenszyklus & Jobs
description: >-
  Ein Job ist ein Durchlauf einer Promptware. Das passiert während der Ausführung – Status, Ausgabe,
  Verifikationen und Kosten.
icon: RefreshCw
searchHints:
  - job
  - lebenszyklus
  - status
  - verifikation
  - worktree
  - parallelität
  - kosten
  - tokens
  - queue
  - stop-all
---

# Lebenszyklus & Jobs

Jedes Mal, wenn Tendril in Ihrem Auftrag arbeitet, erstellt es einen **Job**: einen Durchlauf eines einzelnen
[Workflow-Agenten (Promptware)](02_Promptwares.md) auf einem [Plan](01_Plans.md). Über Jobs durchläuft ein Plan
seinen Lebenszyklus, und über Jobs verfolgen Sie den Fortschritt in Echtzeit in Desktop-App und CLI.

## Job-Status

| Status        | Bedeutung                                                                |
| ------------- | ------------------------------------------------------------------------ |
| **Pending**   | Erstellt, aber noch nicht in die Warteschlange aufgenommen.              |
| **Queued**    | Wartet auf einen freien Parallelitäts-Slot.                              |
| **Running**   | Der Prozess des Coding-Agenten wird aktiv ausgeführt.                    |
| **Completed** | Erfolgreich abgeschlossen und alle erforderlichen Gates bestanden.       |
| **Failed**    | Der Agent meldete einen Fehler oder erforderliche Tests schlugen fehl.   |
| **Timeout**   | Hat das Zeitlimit überschritten und wurde abgebrochen.                   |
| **Stopped**   | Durch Benutzeraktion angehalten.                                         |
| **Blocked**   | Blockiert – wartet auf abhängige Jobs, Zugangsdaten oder Entscheidungen. |

## Die Ausführungsschleife

1. **Queue** — Der Job wird erstellt und hinter derzeit laufenden Aufgaben eingereiht.
2. **Prepare** — Für codeändernde Promptwares ([ExecutePlan](02_Promptwares.md)) richtet Tendril einen isolierten
   [Git worktree](https://git-scm.com/docs/git-worktree) pro Repository unter dem Ordner `Worktrees/{repo-name}/` des Plans ein.
   Der Lauf berührt niemals Ihr primäres Arbeitsverzeichnis.
3. **Implement** — Der Workflow-Agent arbeitet die Plan-Phasen ab und erstellt inkrementelle Commits.
4. **Verify** — Jedes konfigurierte Verifikations-Gate wird im Worktree ausgeführt und protokolliert sein Ergebnis.
5. **Report** — Ausgabeprotokolle, Token-Kosten und der aktualisierte Plan-Status werden auf der Festplatte gespeichert und an den Daemon gemeldet.

Das Anhalten eines Jobs setzt den Plan auf den vorherigen Zustand zurück, behält jedoch den Zustand des Worktrees bei,
damit Sie unvollständige Änderungen prüfen können.
