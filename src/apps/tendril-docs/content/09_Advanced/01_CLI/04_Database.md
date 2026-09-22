---
title: Database
description: Manage the local SQLite database that stores plan sync data, recommendations, job history, and cost tracking.
icon: Database
searchHints:
  - database
  - db
  - migrate
  - migration
  - schema
  - version
  - reset
  - sqlite
  - integrity
  - vacuum
---

# Database

Manage the local [SQLite](https://www.sqlite.org) database (`<TendrilHome>/tendril.db`) that stores [plan sync data](../../02_Concepts/01_Plans.md), [job history](../../04_Apps/04_Jobs.md), recommendations, and cost tracking. In Tendril v2, all database management is accessed via the `tendril db` subcommand tree.

## Commands

#### db version

```terminal
>tendril db version
```

Inspects the database schema without applying migrations. Prints the current database version, the latest version expected by the installed binary, and the migration status (`Up to date`, `Needs migration`, or `Newer than application`).

```terminal
Database version: 12
Latest version:   12
Status:           Up to date
```

#### db migrate

```terminal
>tendril db migrate
```

Applies all pending migrations to bring the database schema up to date. Safe to run repeatedly — already-applied migrations are skipped idempotently.

> [!NOTE]
> `tendril run` automatically applies pending migrations before starting the daemon server, so manual migration is rarely required.

#### db reset

```terminal
>tendril db reset
>tendril db reset --force
```

Drops every table in `tendril.db` and recreates the schema from scratch. Prompts for confirmation unless `--force` is supplied. Refuses to run if the daemon is currently active unless `--force` is given.

> [!WARNING]
> Resetting deletes all database records (cached job history, telemetry, recommendations). Your authored [plan YAML files](01_Plan.md) and revision markdown files on disk are completely untouched.

#### db integrity

```terminal
>tendril db integrity
```

Executes a SQLite [PRAGMA integrity_check](https://www.sqlite.org/pragma.html#pragma_integrity_check) across all tables, indices, and pages. Prints each verification result and exits with code 1 if any corruption or structural anomaly is found.

#### db vacuum

```terminal
>tendril db vacuum
>tendril db vacuum --force
```

Executes SQLite [VACUUM](https://www.sqlite.org/lang_vacuum.html) to defragment the database, rebuild indices, and reclaim unused disk space. Reports the database size before and after execution, along with the total bytes reclaimed.

## Related

- [CLI Overview](00_Overview.md) — global options, data directory paths, and installation health checks
- [plan commands](01_Plan.md) — create, list, and validate plans stored on disk
