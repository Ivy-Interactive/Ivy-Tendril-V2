---
title: Descripción general de la CLI
description: Gestione planes, proyectos, bases de datos y agentes directamente desde su terminal. El binario tendril funciona tanto como un demonio de servidor como una herramienta de CLI con todas las funciones.
icon: Terminal
searchHints:
  - cli
  - comando
  - terminal
  - tendril
  - shell
  - reset
  - report-bug
  - run
  - serve
  - doctor
  - versión
  - config
---

# Descripción general de la CLI

Gestione planes, proyectos, bases de datos y agentes directamente desde su terminal. El binario `tendril` funciona tanto como un demonio de servidor como una herramienta de CLI con todas las funciones.

Tendril CLI le ofrece un control total sobre su flujo de trabajo sin necesidad de tocar la interfaz de usuario:

- **Planes** — cree, liste, actualice e inspeccione planes; gestione repositorios, worktrees, verificaciones y recomendaciones
- **Proyectos** — configure proyectos, sus repositorios, dependencias de compilación, acciones de revisión, servidores MCP y habilidades personalizadas
- **Verificaciones** — defina y gestione comprobaciones de verificación reutilizables
- **Configuración** — lea y actualice las configuraciones de nivel superior almacenadas en `config.yaml`
- **Vault** — conecte vaults de equipo, descubra repositorios remotos, sincronice recursos e importe o envíe proyectos
- **Base de datos** — ejecute migraciones, inspeccione versiones de esquema, restablezca tablas, verifique la integridad y ejecute vacuum
- **Agentes y Trabajos** — ejecute promptwares, gestione trabajos en segundo plano y dirija sesiones de chat interactivas

## Inicio rápido

**1. Verifique su instalación**

```terminal
>tendril doctor
```

**2. Inicie el servidor demonio**

```terminal
>tendril run
```

**3. Cree un nuevo plan**

```terminal
>tendril plan create "Fix login bug" MyProject
```

**4. Liste los planes activos**

```terminal
>tendril plan list --state Executing
```

**5. Restablezca todo y comience de nuevo**

```terminal
>tendril reset
```

> [!TIP]
> Cada comando admite `--help` para ver el uso detallado. Por ejemplo: `tendril plan create --help`.

## Opciones globales

| Opción          | Efecto                                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| `--home <path>` | Ruta al directorio principal de Tendril (también se puede configurar mediante la variable de entorno `TENDRIL_HOME`) |

## Variables de entorno

| Variable        | Propósito                                                                                                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TENDRIL_HOME`  | Directorio raíz para la configuración, base de datos, bandeja de entrada y planes (por defecto `~/.tendril` o `D:\.tendril`)                                                                               |
| `TENDRIL_PLANS` | Anula el directorio de planes (por defecto `TENDRIL_HOME/Plans`)                                                                                                                                           |
| `RUST_LOG`      | Directiva de filtrado para el registro del proceso en stderr (por defecto: `warn,tendril_cli=info,tendril_core=info,tendril_server=info`). Establezca en `debug` para registros de diagnóstico detallados. |

## Comandos comunes

#### doctor

```terminal
>tendril doctor
>tendril doctor --rebuild-search-index
```

Valida su instalación de Tendril: comprueba `TENDRIL_HOME`, `config.yaml`, las herramientas requeridas (`git`, `gh`), la conectividad de la base de datos y la disponibilidad de modelos de agentes. Utilice `--rebuild-search-index` para regenerar el índice de búsqueda de texto completo desde la base de datos.

#### plan doctor

```terminal
>tendril plan doctor
>tendril plan doctor --fix
>tendril plan doctor --prs
>tendril plan doctor --prune-husks --dry-run
```

Escanea cada carpeta de plan e informa sobre su estado de salud: `plan.yaml` faltante o malformado, worktrees obsoletos y planes que quedaron en estado `Completed` tras una verificación fallida. Consulte [Plan](01_Plan.md#doctor) para ver la referencia completa de opciones y códigos de salud.

#### serve y run

```terminal
>tendril serve --port 5010 --host 127.0.0.1
>tendril serve --tls-cert /path/localhost.crt --tls-key /path/localhost.key
>tendril run
```

`tendril serve` inicia el servidor de API HTTP y WebSocket (puerto predeterminado `5010`, host `127.0.0.1`). Las opciones opcionales `--tls-cert` y `--tls-key` sirven HTTPS.

`tendril run` verifica que el puerto de destino esté disponible, aplica automáticamente cualquier migración de base de datos pendiente y luego inicia el demonio.

#### reset

```terminal
>tendril reset
>tendril reset --force
```

Elimina todos los datos de Tendril de la máquina: borra `TENDRIL_HOME` y `TENDRIL_PLANS`. Solicita confirmación a menos que se proporcione `--force`.

> [!WARNING]
> Esto elimina permanentemente todos los planes, trabajos y datos de configuración en los directorios de destino.

#### report-bug

```terminal
>tendril report-bug --plan 00042
>tendril report-bug --job 00150 -d "Agent failed to create worktree"
>tendril report-bug --plan 00042 --out ~/Desktop/diagnostics.zip
>tendril report-bug --plan 00042 --submit --yes
```

Recopila los archivos del plan y todos los artefactos del trabajo — el registro del trabajo (Job Log), el prompt del trabajo (Job Prompt), el registro sin procesar (Job Raw Log) y el registro de eventos (Job Eventwire Log) de `<TendrilHome>/Jobs/` — en un archivo zip con configuración saneada y diagnósticos de salud. Cuando se proporcionan `--submit` y `--yes`, sube el archivo y abre una incidencia en GitHub.

| Opción                  | Efecto                                                                   |
| ----------------------- | ------------------------------------------------------------------------ |
| `--plan <id>`           | Incluye esta carpeta de plan y todos los trabajos ejecutados contra ella |
| `--job <id>`            | Incluye los cuatro artefactos de este trabajo más el contexto de su plan |
| `-d, --description <t>` | Descripción del error (se solicita de forma interactiva si se omite)     |
| `--out <path>`          | Ruta de destino para el archivo zip                                      |
| `--github-user <name>`  | Nombre de usuario de GitHub para el seguimiento de la incidencia         |
| `--submit`              | Sube el informe a GitHub (requiere `--yes`)                              |
| `-y, --yes`             | Omite la solicitud de confirmación                                       |

> [!WARNING]
> El envío de un informe adjunta el paquete zip a una incidencia **pública** de GitHub. Los secretos se eliminan de las configuraciones y los registros de trabajo, pero revise el contenido del plan antes de enviarlo.

#### version

```terminal
>tendril version
```

Muestra la versión instalada de Tendril (p. ej., `tendril v2.0.0`).

#### update-promptwares

```terminal
>tendril update-promptwares
>tendril update-promptwares --dry-run
>tendril update-promptwares --source /path/to/promptwares
```

Actualiza los promptwares desplegados en `<TendrilHome>/Promptwares/`, conservando sus directorios `Memory/` y `Tools/`.

## Pasos siguientes

- [Comandos de plan](01_Plan.md) — referencia completa para crear y gestionar planes
- [Comandos de proyecto](02_Project.md) — configure proyectos, repositorios, acciones de revisión, servidores MCP y habilidades
- [Comandos de verificación](03_Verification.md) — gestione definiciones de verificación globales
- [Comandos de base de datos](04_Database.md) — migraciones, versión de esquema, integridad y vacuum
- [Otros comandos](05_Other.md) — promptware, trabajo, chat, servicio y utilidades
- [Comandos de configuración](06_Config.md) — lea y actualice las configuraciones de nivel superior de `config.yaml`
- [Comandos de vault](07_Vault.md) — conecte vaults de equipo, sincronice recursos e importe o publique proyectos
