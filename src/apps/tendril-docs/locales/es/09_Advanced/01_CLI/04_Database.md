---
title: Base de datos
description: Gestione la base de datos local SQLite que almacena datos de sincronización de planes, recomendaciones, historial de trabajos y seguimiento de costes.
icon: Database
searchHints:
  - base de datos
  - db
  - migrate
  - migración
  - esquema
  - version
  - reset
  - sqlite
  - integridad
  - vacuum
---

# Base de datos

Gestione la base de datos local [SQLite](https://www.sqlite.org) (`<TendrilHome>/tendril.db`) que almacena [datos de sincronización de planes](../../02_Concepts/01_Plans.md), [historial de trabajos](../../04_Apps/04_Jobs.md), recomendaciones y seguimiento de costes. En Tendril v2, todo el manejo de la base de datos se realiza a través del árbol de subcomandos `tendril db`.

## Comandos

#### db version

```terminal
>tendril db version
```

Inspecciona el esquema de la base de datos sin aplicar migraciones. Imprime la versión actual de la base de datos, la última versión esperada por el binario instalado y el estado de la migración (`Up to date`, `Needs migration`, o `Newer than application`).

```terminal
Database version: 12
Latest version:   12
Status:           Up to date
```

#### db migrate

```terminal
>tendril db migrate
```

Aplica todas las migraciones pendientes para actualizar el esquema de la base de datos. Es seguro ejecutarlo repetidamente; las migraciones ya aplicadas se omiten de forma idempotente.

> [!NOTE]
> `tendril run` aplica automáticamente las migraciones pendientes antes de iniciar el servidor del demonio, por lo que rara vez se requiere la migración manual.

#### db reset

```terminal
>tendril db reset
>tendril db reset --force
```

Elimina todas las tablas de `tendril.db` y recrea el esquema desde cero. Solicita confirmación a menos que se proporcione `--force`. Se niega a ejecutarse si el demonio está activo actualmente, a menos que se proporcione `--force`.

> [!WARNING]
> Restablecer la base de datos elimina todos sus registros (historial de trabajos en caché, telemetría, recomendaciones). Sus [archivos YAML de planes](01_Plan.md) y archivos markdown de revisiones redactados en el disco no se modifican en absoluto.

#### db integrity

```terminal
>tendril db integrity
```

Ejecuta un [PRAGMA integrity_check](https://www.sqlite.org/pragma.html#pragma_integrity_check) de SQLite en todas las tablas, índices y páginas. Imprime el resultado de cada verificación y sale con código 1 si se detecta alguna corrupción o anomalía estructural.

#### db vacuum

```terminal
>tendril db vacuum
>tendril db vacuum --force
```

Ejecuta [VACUUM](https://www.sqlite.org/lang_vacuum.html) de SQLite para desfragmentar la base de datos, reconstruir índices y recuperar espacio libre en disco. Informa del tamaño de la base de datos antes y después de la ejecución, junto con el total de bytes recuperados.

## Relacionado

- [Descripción general de la CLI](00_Overview.md) — opciones globales, rutas del directorio de datos y comprobaciones de estado de la instalación
- [Comandos de plan](01_Plan.md) — crear, listar y validar planes almacenados en disco
