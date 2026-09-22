---
title: project
description: Gestione los proyectos almacenados en config.yaml. Los proyectos agrupan repositorios, verificaciones, dependencias de compilación, acciones de revisión, servidores MCP y habilidades personalizadas.
icon: FolderGit
searchHints:
  - project
  - repo
  - verificación
  - build
  - dependencia
  - revisión
  - action
  - mcp
  - habilidades
  - sync
  - hooks
---

# project

Gestione los proyectos almacenados en `config.yaml`. Los proyectos agrupan repositorios [Git](https://git-scm.com), [verificaciones](03_Verification.md), dependencias de compilación, acciones de revisión, servidores de [Model Context Protocol (MCP)](https://modelcontextprotocol.io) y [habilidades de agentes](../../06_CodingAgents/00_Skills.md) personalizadas. Para flujos de trabajo más amplios en la interfaz de usuario, consulte [Configuración del proyecto](../../03_Configuration/02_Projects.md).

## CRUD

```terminal
>tendril project list
>tendril project get <name>
>tendril project add <name>
>tendril project rename <name> <new-name>
>tendril project remove <name>
>tendril project set <name> <field> <value>
```

- **list** — lista todos los proyectos configurados, mostrando el recuento de repositorios y verificaciones
- **get** — muestra los detalles completos de configuración en formato [YAML](https://yaml.org), incluidos repositorios, verificaciones, acciones de revisión, dependencias de compilación, servidores MCP y habilidades personalizadas
- **add** — crea una nueva entrada de proyecto en `config.yaml`
- **rename** — cambia el nombre de un proyecto existente y actualiza todas las referencias internas
- **remove** — elimina la configuración del proyecto de `config.yaml`
- **set** — actualiza un campo escalar del proyecto. Campos admitidos: `color` (cadena de color hexadecimal), `context` (instrucciones de prompt en markdown para agentes), `stackHash`

## Repositorios y Sincronización

```terminal
>tendril project add-repo <project-name> <repo-path>
>tendril project remove-repo <project-name> <repo-path>
>tendril project sync <project-name> [--repo <repo>]
```

- **add-repo** — asocia la ruta de un clon local de repositorio con el proyecto
- **remove-repo** — desvincula la ruta de un repositorio del proyecto
- **sync** — descarga ramas remotas y avanza (fast-forward) todos los repositorios del proyecto mediante [Git](https://git-scm.com). Los repositorios divergentes muestran instrucciones de corrección diagnóstica.

## Verificaciones

Los proyectos definen qué [comprobaciones de verificación](03_Verification.md) deben aprobarse antes de que un [plan](01_Plan.md) pueda completarse:

```terminal
>tendril project add-verification <project-name> <verification-name> [--required | --optional] [--after <target>]
>tendril project remove-verification <project-name> <verification-name>
>tendril project move-verification <project-name> <verification-name> [--before <target> | --after <target> | --position <pos>]
```

- **add-verification** — vincula una comprobación de verificación global a este proyecto. Requerida por defecto; pase `--optional` para marcarla como informativa, o `--after` para especificar la secuencia de ejecución.
- **remove-verification** — elimina una puerta de verificación del proyecto.
- **move-verification** — ajusta la posición del orden de ejecución respecto a otras verificaciones (`--before`, `--after`, o `--position` con base cero).

## Dependencias de compilación

```terminal
>tendril project add-build-dep <project-name> <dependency>
>tendril project remove-build-dep <project-name> <dependency>
```

Configura prerrequisitos externos de binarios y herramientas (p. ej., `cargo`, `dotnet`, `node`, [gh](https://cli.github.com)) verificados antes de ejecutar un plan.

## Acciones de revisión

```terminal
>tendril project add-review-action <project-name> <name> --command <cmd> [options]
>tendril project remove-review-action <project-name> <name>
>tendril project review-actions <project-name> [--changed-file <file>...] [--plan <plan>] [--format <table>]
```

Las acciones de revisión son comandos de shell que se ejecutan durante la revisión interactiva de código:

| Opción             | Efecto                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `--command <cmd>`  | Línea de comandos de shell ejecutada dentro de un terminal interactivo PTY               |
| `--condition <ex>` | Expresión opcional evaluada antes de ejecutar la acción                                  |
| `--paths <prefix>` | Filtro de ruta relativo al repositorio que activa esta acción al modificarse (repetible) |
| `--before <name>`  | Insertar antes de una acción existente                                                   |
| `--after <name>`   | Insertar después de una acción existente                                                 |

`tendril project review-actions` evalúa y clasifica las acciones de revisión respecto a los archivos modificados derivados del worktree de un plan.

## Servidores MCP y Habilidades personalizadas

Los proyectos pueden registrar servidores [MCP](https://modelcontextprotocol.io) de ámbito de proyecto y habilidades de agentes personalizadas:

```terminal
>tendril project list-mcp <project-name>
>tendril project add-mcp <project-name> <server-name> <command> [--arg <arg>...] [--env KEY=VALUE...]
>tendril project remove-mcp <project-name> <server-name>

>tendril project list-skills <project-name>
>tendril project add-skill <project-name> <skill-name> [--description <desc>] [--path <path>] [--instructions <text>]
>tendril project remove-skill <project-name> <skill-name>
```

Para importar servidores MCP o habilidades directamente desde un repositorio existente:

```terminal
>tendril project import <project-name> <repo-path> [--mcp-only] [--skills-only]
>tendril project import-mcp <project-name> <repo-path> [--name <server>]
>tendril project import-skills <project-name> <repo-path> [--name <skill>] [--no-copy]
```

## Ganchos de Promptware

Los ganchos (hooks) ejecutan acciones de shell personalizadas antes o después de la ejecución de un [promptware](../../02_Concepts/02_Promptwares.md):

```terminal
>tendril project add-hook <project-name> <name> --action <action> [options]
>tendril project remove-hook <project-name> <name>
```

| Opción                 | Efecto                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `--when <timing>`      | Disparador temporal: `before` (por defecto) o `after`                                                                  |
| `--promptwares <list>` | Lista separada por comas de promptwares para los que se activará (p. ej., `ExecutePlan,CreatePr`), o todos si se omite |
| `--action <cmd>`       | Comando de shell a ejecutar                                                                                            |
| `--condition <expr>`   | Expresión que debe evaluarse como verdadera para que se active el gancho                                               |

## Puertos y Archivos de entorno

Gestione puertos de servicio designados y plantillas de archivo `.env` generados en los worktrees del plan:

```terminal
>tendril project port list <project-name>
>tendril project port add <project-name> <port-name> --default-port <port> [--description <desc>]
>tendril project port remove <project-name> <port-name>

>tendril project env-file list <project-name>
>tendril project env-file add <project-name> <path> [--template <file>] [--override KEY=VALUE...]
>tendril project env-file remove <project-name> <path>
```
