---
title: plan
description: Cree, lea, actualice y valide planes desde la terminal. Todos los subcomandos resuelven la carpeta de planes a partir de TENDRIL_PLANS, TENDRIL_HOME/Plans o ~/.tendril/Plans cuando las variables de entorno no están configuradas.
icon: ListChecks
searchHints:
  - plan
  - create
  - list
  - get
  - set
  - update
  - validate
  - repo
  - pr
  - commit
  - verificación
  - recomendación
  - rec
  - log
  - revisión
  - doctor
  - depends
  - related
  - env
  - wireframes
---

# plan

Cree, lea, actualice y valide planes desde la terminal. Todos los subcomandos resuelven la carpeta de planes a partir de `TENDRIL_PLANS`, `TENDRIL_HOME/Plans` o `~/.tendril/Plans` cuando las variables de entorno no están configuradas.

## CRUD

#### plan create

```terminal
>tendril plan create <title> <project> [options]
```

Crea una nueva carpeta de plan y la estructura inicial de `plan.yaml` con estado `Draft`. El ID del plan se asigna automáticamente desde el archivo `.counter`. Los repositorios y las verificaciones predeterminadas se derivan de la configuración del proyecto.

| Opción                          | Descripción                                                  |
| ------------------------------- | ------------------------------------------------------------ |
| `--level <level>`               | Nivel de prioridad (por defecto: Feature)                    |
| `--initial-prompt <text>`       | Texto de la instrucción inicial                              |
| `--source-url <url>`            | URL de origen (incidencia o PR de GitHub)                    |
| `--execution-profile <profile>` | Perfil de ejecución (`deep` o `balanced`)                    |
| `--priority <number>`           | Número de prioridad (por defecto: 0)                         |
| `--verification <Name=Status>`  | Entrada de verificación (repetible)                          |
| `--related-plan <folder>`       | Nombre de carpeta de plan relacionado (repetible)            |
| `--depends-on <folder>`         | Nombre de carpeta de plan de dependencia (repetible)         |
| `--chat-session <id>`           | Asociar a una sesión de chat                                 |
| `--plans-dir <path>`            | Anular la ruta del directorio de planes                      |
| `--no-duplicate-check`          | Omitir detección de duplicados con planes activos existentes |

#### plan list

```terminal
>tendril plan list [options]
```

Lista planes con filtros opcionales.

| Opción                     | Efecto                                                                |
| -------------------------- | --------------------------------------------------------------------- |
| `--status` / `--state <s>` | Filtrar por estado (p. ej., `Draft`, `Executing`, `Failed`)           |
| `-p, --project <name>`     | Filtrar por nombre de proyecto (validado con proyectos configurados)  |
| `--level <level>`          | Filtrar por nivel (p. ej., `Bug`, `Feature`, `Epic`)                  |
| `--has-pr`                 | Solo planes con PRs asociadas                                         |
| `--has-worktree`           | Solo planes que tienen worktrees                                      |
| `-q, --search <query>`     | Filtrar por subcadena de búsqueda de texto en título o ID             |
| `--limit <n>`              | Número máximo de resultados                                           |
| `--format <fmt>`           | Formato de salida: `table` (predeterminado), `ids`, `folders`, `json` |
| `--plans-dir <path>`       | Anular la ruta del directorio de planes                               |

```terminal
>tendril plan list --state Draft
>tendril plan list --project Tendril --level Critical
>tendril plan list --state Failed --format ids
>tendril plan list --format json --limit 10
```

> [!NOTE]
> `plan list` muestra planes (desde archivos `plan.yaml`), no trabajos. Para el historial de trabajos y estado de ejecución, use `job list` en su lugar (consulte [Otros comandos](05_Other.md#job-list)).

#### plan get

```terminal
>tendril plan get <plan-id> [field]
```

Muestra el YAML completo, o el valor de un solo campo cuando se proporciona `[field]`.

**Campos escalares:** `id`, `title`, `state`, `project`, `level`, `created`, `updated`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`, `partialDelivery`

**Campos de lista:** `repos`, `prs`, `commits`, `verifications`, `dependsOn`, `relatedPlans`, `recommendations` (cada elemento en su propia línea)

#### plan set

```terminal
>tendril plan set <plan-id> <field> <value> [options]
>tendril plan set <plan-id> state Completed --allow-failed-verifications
```

Actualiza un solo campo y avanza la marca de tiempo `updated` automáticamente.

Campos admitidos: `state`, `title`, `level`, `project`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`.

Se rechaza establecer `state` en `Completed` mientras cualquier verificación esté en estado `Fail`: un plan que aparece como completado cuando un control rechazó el trabajo oculta un entregable faltante ante la detección de duplicados. Vuelva a ejecutar la verificación o establézcala en `Skipped` con una razón explícita. Pasar `--allow-failed-verifications` registra la transición de todos modos y establece `partialDelivery: true`.

| Opción                         | Efecto                                                                |
| ------------------------------ | --------------------------------------------------------------------- |
| `--allow-failed-verifications` | Permitir pasar a `Completed` incluso con verificaciones fallidas      |
| `--reason <text>`              | Explica por qué se realizó la edición (notificado a sesiones de chat) |
| `--chat-session <id>`          | Sesión de chat de origen (excluida de la autonotificación)            |

#### plan update

```terminal
>cat revised.yaml | tendril plan update <plan-id> --stdin
>tendril plan update <plan-id> --file revised.yaml
```

Reemplaza todo el contenido de `plan.yaml` desde `--file` o `--stdin` (obligatorio: `--stdin` no es implícito).

#### plan check-wireframes

```terminal
>tendril plan check-wireframes <plan-id>
```

Comprueba si hay fugas de código de wireframes en los archivos modificados de un plan. Sale con código 0 si está limpio o sale con 1 con un informe de diagnóstico si se encuentran marcadores de wireframe.

#### plan validate

```terminal
>tendril plan validate <plan-id>
```

Comprueba que el plan tenga todos los campos requeridos y sea internamente consistente. Sale con código `1` si hay errores estructurales.

## Repositorios

```terminal
>tendril plan add-repo <plan-id> <repo-path> [--reason <text>] [--chat-session <id>]
>tendril plan remove-repo <plan-id> <repo-path> [--reason <text>] [--chat-session <id>]
```

Gestiona la lista de repositorios asociados con un plan. Agregar un repositorio ya existente es una operación idempotente sin efecto.

## Enlaces

```terminal
>tendril plan add-pr <plan-id> <pr-url> [--reason <text>] [--chat-session <id>]
>tendril plan remove-pr <plan-id> <pr-url> [--reason <text>] [--chat-session <id>]
>tendril plan add-commit <plan-id> <sha> [--reason <text>] [--chat-session <id>]
>tendril plan add-related-plan <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
>tendril plan remove-related-plan <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
>tendril plan add-depends-on <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
>tendril plan remove-depends-on <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
```

Gestiona URLs de PR, SHAs de commit, planes relacionados y dependencias bloqueantes. `add-depends-on` hace que `ExecutePlan` espere a que la dependencia alcance el estado `Completed` y fusione sus PRs antes de ejecutarse. Todos los nombres se comparan sin distinción entre mayúsculas y minúsculas.

## Verificaciones

```terminal
>tendril plan set-verification <plan-id> <name> <status> [--reason <text>] [--chat-session <id>]
>tendril plan verification list <plan-id> [--status <status>] [--json]
>tendril plan verification add <plan-id> <name> [--status <status>] [--reason <text>] [--chat-session <id>]
>tendril plan verification remove <plan-id> <name> [--reason <text>] [--chat-session <id>]
```

Gestiona las verificaciones de un plan. Estados válidos: `Pending`, `Pass`, `Fail`, `Skipped`. El estado predeterminado para `add` es `Pending`.

## Worktrees

#### plan cleanup

```terminal
>tendril plan cleanup <plan-id> [--force]
```

Elimina todos los git worktrees asociados a un plan. De forma predeterminada, solo se ejecuta en planes en un estado terminal (`Completed`, `Failed`, `Skipped`, `Icebox`). Utilice `--force` para eliminar worktrees de planes que no estén en estado terminal.

#### plan add-worktree

```terminal
>tendril plan add-worktree <plan-id> <repo> [--base <branch>]
```

Crea un git worktree para el plan indicado bajo `<plan-folder>/Worktrees/<repo-name>`, ramificando desde `origin/<base>` (por defecto: rama predeterminada detectada automáticamente). La rama se nombra `tendril/<plan-folder-name>`.

#### plan remove-worktree

```terminal
>tendril plan remove-worktree <plan-id> <repo-name> [--branch <branch>]
```

Elimina un único worktree de `Worktrees/<repo-name>`. Intenta primero `git worktree remove --force`; si falla, recurre a un borrado forzado. También elimina la rama asociada (`tendril/<plan-folder>` por defecto).

## Revisiones

```terminal
>cat revision.md | tendril plan write-revision <plan-id> --stdin
>tendril plan write-revision <plan-id> --file revision.md
```

Escribe un archivo de revisión numerado en `Revisions/` (p. ej., `002.md`) desde stdin o `--file`. Admite `--no-question-check` para omitir la validación, y `--reason` / `--chat-session` para atribución de auditoría.

```terminal
>tendril plan get-revision <plan-id> [--number <n>]
```

Muestra el contenido de la revisión en stdout — la última revisión de forma predeterminada, o una revisión numerada específica si se proporciona `--number`.

## Preguntas

Una revisión puede contener preguntas para el usuario en bloques de código delimitados con `questions`:

````markdown
```questions
questions:                    # 1-4 elementos
  - id:          string       # obligatorio, estable, único en toda la revisión
    title:       string       # obligatorio, la pregunta
    header:      string       # opcional, etiqueta corta <=12 caracteres
    description: markdown     # opcional, contexto que se muestra bajo la pregunta
    multiple:    bool         # opcional, por defecto false; true = selección múltiple
    options:                  # 2-4 elementos; omita por completo para pregunta de texto libre puro
      - title:       string   # obligatorio, 1-5 palabras
        description: markdown # opcional
        value:       slug     # obligatorio, ^[a-z0-9][a-z0-9-]*$, referenciado por `answer`
        recommended: bool     # opcional, máximo uno por pregunta
    answer:      value | [values] | string   # completado en la respuesta
```
````

`write-revision` valida cada bloque de preguntas contra este esquema y rechaza la revisión si algún bloque está malformado. Utilice `--no-question-check` solo en pruebas automatizadas.

## Recomendaciones

```terminal
>tendril plan rec list <plan-id> [--state <state>]
>tendril plan rec all [--project <project>] [--state <state>]
>tendril plan rec rebuild
>tendril plan rec add <plan-id> <title> [-d <description>] [--impact <level>]
>tendril plan rec set <plan-id> <title> <field> <value>
>tendril plan rec accept <plan-id> <title> [--notes <text>]
>tendril plan rec decline <plan-id> <title> [--reason <text>] [--edit-reason <text>]
>tendril plan rec remove <plan-id> <title>
```

Gestiona las recomendaciones almacenadas en el YAML de un plan:

- **list** — lista las recomendaciones de un plan; filtrar por estado: `Pending`, `Accepted`, `AcceptedWithNotes`, `Declined`
- **all** — lista las recomendaciones en todos los planes
- **rebuild** — reconstruye desde el disco la proyección desnormalizada de recomendaciones
- **add** — niveles de impacto: `Small`, `Medium`, `High`
- **set** — campos admitidos: `title`, `description`, `state`, `impact`, `declineReason`, `notes`
- **accept** — establece el estado en `Accepted`, o `AcceptedWithNotes` si se proporciona `--notes`
- **decline** — establece el estado en `Declined`. `--reason` registra el motivo del rechazo en `plan.yaml`; `--edit-reason` especifica el motivo de la notificación para las sesiones de chat
- **remove** — elimina permanentemente una recomendación

## Entorno

```terminal
>tendril plan env materialize <plan-id> [--repo <repo>] [--force] [--json]
>tendril plan env get <plan-id> [--repo <repo>] [--json]
```

Inspecciona y escribe las asignaciones de puertos y archivos de entorno del plan:

- **materialize** — asigna puertos de servicio sin conflictos y escribe archivos de entorno en los worktrees del plan. Utilice `--force` para sobrescribir archivos existentes.
- **get** — imprime los puertos asignados y las variables de entorno resueltas para un worktree.

## Doctor

```terminal
>tendril plan doctor [options]
```

Escanea cada carpeta en el directorio de planes e informa sobre problemas de salud.

| Opción          | Efecto                                                                             |
| --------------- | ---------------------------------------------------------------------------------- |
| `--fix`         | Migra automáticamente los esquemas de plan a la última versión                     |
| `--prs`         | Verifica cada pull request registrada contra GitHub mediante `gh`                  |
| `--prune-husks` | Elimina carpetas de plan vacías que no contienen revisión ni artefactos de trabajo |
| `--dry-run`     | Con `--prune-husks`, informa lo que se eliminaría sin borrar nada                  |

```terminal
>tendril plan doctor
>tendril plan doctor --fix
>tendril plan doctor --prs
>tendril plan doctor --prune-husks --dry-run
```

### Regularización de entrega parcial

El informe enumera los planes marcados como `Completed` con una verificación en estado `Fail` y sin la bandera `partialDelivery`. Estos son anteriores a la protección de finalización. Para confirmar la entrega parcial:

```terminal
>tendril plan set <id> state Completed --allow-failed-verifications
```
