---
title: verification
description: Gestione las definiciones globales de verificación almacenadas en config.yaml. Los proyectos y planes pueden hacer referencia a ellas.
icon: ClipboardCheck
searchHints:
  - verification
  - verify
  - check
  - prompt
  - definition
  - gates
---

# verification

Gestione las definiciones globales de verificación almacenadas en `config.yaml`. Las puertas de verificación definen comprobaciones automatizadas de calidad, compilación y pruebas que los agentes de programación deben cumplir antes de que un [plan](01_Plan.md) pueda pasar a `Completed`. Se asignan a proyectos mediante [`tendril project add-verification`](02_Project.md#verificaciones).

## Comandos

```terminal
>tendril verification list [--json]
>tendril verification get <name>
>tendril verification add <name> [--prompt <text>]
>tendril verification set <name> [--new-name <name>] [--prompt <text>]
>tendril verification remove <name> [--force]
```

- **list** — muestra todas las verificaciones globales registradas. Pase `--json` para emitir la salida en JSON estructurado.
- **get** — imprime el nombre de la verificación y el texto completo del prompt de evaluación en stdout.
- **add** — registra una nueva comprobación de verificación con una descripción de prompt opcional.
- **set** — actualiza el prompt de una definición de verificación o le cambia el nombre. Cambiar el nombre de una verificación actualiza automáticamente todas las referencias del proyecto, los registros YAML de los planes y las filas de la base de datos.
- **remove** — elimina una definición de verificación. Si algún proyecto activo hace referencia a la comprobación, Tendril rechaza la eliminación a menos que se suministre `--force` (o `-f`), lo que limpia las referencias en todos los proyectos.

## Ejemplos

```terminal
># Agregar una nueva puerta de verificación con instrucciones de prompt
>tendril verification add CargoTest --prompt "Run cargo test --workspace and ensure all test suites pass with exit code 0."

># Inspeccionar los detalles completos del prompt
>tendril verification get CargoTest

># Actualizar el prompt de evaluación
>tendril verification set CargoTest --prompt "Run cargo test --workspace --all-targets and verify zero test failures."

># Cambiar el nombre de una definición de verificación en todos los proyectos y planes
>tendril verification set CargoTest --new-name RustWorkspaceTests

># Listar todas las definiciones en formato JSON
>tendril verification list --json

># Eliminar una verificación, limpiando las referencias de proyecto
>tendril verification remove RustWorkspaceTests --force
```

## Relacionado

- [verificaciones de proyecto](02_Project.md#verificaciones) — configure qué comprobaciones son requeridas para un proyecto
- [verificaciones de plan](01_Plan.md#verificaciones) — inspeccione o anule los estados de las puertas de verificación en un plan
- [Referencia de configuración](../../03_Configuration/01_Setup.md) — gestione las opciones globales en `config.yaml`
