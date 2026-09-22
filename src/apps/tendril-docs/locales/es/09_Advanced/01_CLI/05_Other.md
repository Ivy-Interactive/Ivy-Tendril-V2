---
title: Otros comandos
description: Ejecución de promptwares, orquestación de trabajos en segundo plano, sesiones de chat, registro de servicios en segundo plano y utilidades.
icon: Wrench
searchHints:
  - promptware
  - memory
  - tool
  - job
  - chat
  - servicio
  - autostart
  - launchd
  - systemd
  - status
  - models
  - hash-password
  - generate-certs
  - agent-instructions
---

# Otros comandos

Referencia para la ejecución de promptwares, seguimiento de trabajos en segundo plano, sesiones interactivas de chat, administración de servicios en segundo plano del sistema operativo y comandos de utilidades de Tendril CLI.

## promptware

Tendril utiliza [promptwares](../../02_Concepts/02_Promptwares.md) para estructurar los flujos de trabajo de ejecución de los agentes. Para más información, consulte [Concepto de Promptwares](../../02_Concepts/02_Promptwares.md).

#### promptware run

```terminal
>tendril promptware run <name> [args...] [options]
```

Ejecuta un promptware directamente en la máquina host, omitiendo la cola de trabajos del servidor.

| Opción                 | Efecto                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `--profile <profile>`  | Anula el perfil de razonamiento del agente (`deep`, `balanced`, `quick`)                |
| `--working-dir <path>` | Directorio de trabajo para el proceso de ejecución del agente                           |
| `--value <key=value>`  | Valores adicionales de encabezado de firmware (repetible)                               |
| `--plan <id>`          | ID de plan de destino o ruta de carpeta                                                 |
| `--agent <provider>`   | Anula el proveedor del agente (`claude`, `antigravity`, `codex`, `copilot`, `opencode`) |
| `--dry-run`            | Imprime el firmware compilado en stdout y sale sin iniciar un agente                    |

#### Memoria y Herramientas

```terminal
>tendril promptware list-memory <name>
>tendril promptware read-memory <name> [files...]
>tendril promptware write-memory <name> <filename> [--file <path>] [--stdin]
>tendril promptware delete-memory <name> <filename>
>tendril promptware write-tool <name> <tool_name> [--file <path>] [--stdin]
```

Los agentes utilizan estos comandos para persistir los patrones aprendidos en el directorio `Memory/` de un promptware y crear herramientas personalizadas en `Tools/`.

#### Despliegue y Capas

```terminal
>tendril promptware deploy
>tendril promptware layers [name]
```

- **deploy** — compila e instala promptwares estándar en `<TendrilHome>/Promptwares/`.
- **layers** — inspecciona qué capa (predeterminada distribuida o superposición de equipo) proporcionó cada archivo de promptware.

## job

Gestione trabajos asíncronos en segundo plano de los agentes. Los trabajos se ejecutan a través de la cola del demonio y reportan el estado en vivo. Para su inspección en la interfaz de usuario, consulte la [App de Trabajos](../../04_Apps/04_Jobs.md).

#### job list

```terminal
>tendril job list
>tendril job list --status Running
>tendril job list --limit 50
>tendril job list --json
```

Lista los trabajos recientes en segundo plano del servidor del demonio Tendril.

| Opción              | Efecto                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `--status <status>` | Filtrar por estado (`Pending`, `Queued`, `Running`, `Completed`, `Failed`, `Timeout`, `Stopped`, `Blocked`) |
| `--limit <n>`       | Número máximo de resultados (por defecto: 20)                                                               |
| `--json`            | Emitir los trabajos como JSON estructurado                                                                  |

#### job start

```terminal
>tendril job start <job-type> [plan-id] [options]
```

Inicia un trabajo asíncrono en segundo plano en el demonio Tendril en ejecución. Tipos de trabajo admitidos: `CreatePlan`, `ExecutePlan`, `RetryPlan`, `UpdatePlan`, `ExpandPlan`, `SplitPlan`, `CreatePr`, `CreateIssue`, `SetupProject`, `AddProject`, `SyncRepo`.

| Opción                    | Efecto                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `--priority <number>`     | Clasificación de prioridad para el despacho en cola (mayor se ejecuta primero)          |
| `--chat-session <id>`     | Asocia el trabajo a una sesión de chat (por defecto `$TENDRIL_CHAT_SESSION_ID`)         |
| `--wait-for <job-id>`     | ID de trabajo que debe completarse antes de encolar este trabajo (repetible)            |
| `--idempotency-key <key>` | Token de idempotencia: los reenvíos devuelven el trabajo existente en vez de crear otro |
| `--force`                 | Reenviar incluso si ya hay un trabajo idéntico en curso                                 |
| `--description <text>`    | Descripción de la tarea (usado con `CreatePlan`)                                        |
| `--project <name>`        | Proyecto de destino (usado con `CreatePlan`)                                            |
| `--note <text>`           | Nota de ejecución (usado con `ExecutePlan`)                                             |
| `--instructions <text>`   | Prompt de refinamiento (usado con `UpdatePlan`)                                         |
| `--change-request <text>` | Comentarios del revisor (usado con `RetryPlan`)                                         |
| `--repo <name>`           | Repositorio (usado con `CreateIssue`)                                                   |
| `--assignee <user>`       | Nombre de usuario asignado en GitHub (usado con `CreateIssue` / `CreatePr`)             |
| `--reviewer <user>`       | Nombre de usuario revisor en GitHub (usado con `CreatePr`, repetible)                   |
| `--draft`                 | Crear como borrador de PR (usado con `CreatePr`)                                        |

```terminal
>tendril job start ExecutePlan 00042
>tendril job start RetryPlan 00042 --change-request "Fix failing unit tests"
>tendril job start CreatePlan --description "Add dark mode toggle" --project MyProject
```

#### job status y fail

```terminal
>tendril job status <job-id> --message <text> [--plan-id <id>] [--plan-title <title>]
>tendril job fail <job-id> --message <text>
```

Informa telemetría de progreso o fallo del trabajo directamente al demonio. Se utiliza internamente por los scripts de promptware durante la ejecución.

#### job cancel y delete

```terminal
>tendril job cancel <job-id> [--message <reason>]
>tendril job delete <job-id>
```

- **cancel** — indica a un trabajo en ejecución que se aborte.
- **delete** — elimina un registro de trabajo de la base de datos (los archivos de registro en disco se conservan).

#### job add-log

```terminal
>tendril job add-log <job-id> <action> [--summary <text>]
```

Agrega una entrada narrativa `## Agent Log` directamente en el archivo de registro del trabajo en `<TendrilHome>/Jobs/`. Opera directamente sobre el sistema de archivos y no requiere que el demonio del servidor esté accesible.

#### Cola y Mantenimiento

```terminal
>tendril job queue [--json]
>tendril job force-start <job-id>
>tendril job stop-all
>tendril job clear [--completed] [--failed] [--all] [-y/--yes]
>tendril job maintenance
```

- **queue** — imprime los trabajos pendientes en orden de despacho
- **force-start** — omite los controles de concurrencia y dependencias para despachar un trabajo de inmediato
- **stop-all** — cancela todos los trabajos activos y en cola
- **clear** — elimina de forma masiva los trabajos completados o fallidos
- **maintenance** — ejecuta un paso de limpieza y conciliación de trabajos inmediatamente

## chat

Dirija sesiones interactivas de programación con agentes desde su terminal:

```terminal
>tendril chat list [--json]
>tendril chat get <session-id> [--json]
>tendril chat create [--agent <agent>] [--model <model>] [--title <title>] [--effort <level>] [--plan <folder>] [--json]
>tendril chat send <session-id> "<message>" [--agent <agent>] [--model <model>] [--effort <effort>]
>tendril chat delete <session-id>
```

`tendril chat send` se conecta al demonio, envía el turno de prompt y transmite respuestas de tokens en tiempo real y eventos de llamadas a herramientas directamente a stdout.

## service

Gestione el servicio de inicio automático del demonio de Tendril en segundo plano en todas las plataformas:

- **macOS** — registra un agente de [launchd](https://en.wikipedia.org/wiki/Launchd) en `~/Library/LaunchAgents/io.tendril.daemon.plist`
- **Linux** — registra una unidad de servicio de usuario de [systemd](https://systemd.io)
- **Windows** — registra una tarea programada con el [Programador de tareas](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-start-page)

```terminal
>tendril service install [--no-start] [--force]
>tendril service status [--json]
>tendril service uninstall [--purge-binaries] [--force]
```

- **install** — registra el ejecutable en ejecución como servicio en segundo plano. Utilice `--no-start` para registrarlo para el próximo inicio de sesión sin iniciarlo de inmediato.
- **status** — informa si el servicio está registrado, cargado y sirviendo (incluyendo URL y PID).
- **uninstall** — anula el registro de la configuración de inicio automático. Utilice `--purge-binaries` para eliminar los sidecars instalados en `<home>/bin`.

## Utilidades

#### models

```terminal
>tendril models
>tendril models --refresh
```

Enumera los modelos de LLM compatibles, sus proveedores asociados, los límites de ventana de contexto y los precios actuales. Utilice `--refresh` para obtener tarifas actualizadas desde el registro de modelos.

#### generate-certs

```terminal
>tendril generate-certs <output-directory>
```

Genera un par PEM autofirmado de `localhost.crt` y `localhost.key` para servir HTTPS con `tendril serve --tls-cert <path> --tls-key <path>`.

#### hash-password

```terminal
>tendril hash-password <password> [secret]
```

Calcula el hash de una contraseña con [Argon2](https://en.wikipedia.org/wiki/Argon2) para su uso en la sección `auth:` de `config.yaml`. Imprime la cadena de hash codificada y el secreto pepper.

#### project-analyzer

```terminal
>tendril project-analyzer <folder-path>
```

Inspecciona un directorio e imprime un análisis recortado del stack en YAML identificando entornos de ejecución de lenguajes, administradores de paquetes y frameworks de prueba.

#### agent-instructions

```terminal
>tendril agent-instructions
```

Compila e imprime la plantilla completa de instrucciones del sistema del agente con las rutas de instalación sustituidas, formateada para redirigirse al prompt de un agente autónomo.

#### wireframe

```terminal
>tendril wireframe setup [path] [--tailwind superset|jit] [--force] [--quiet]
>tendril wireframe serve [path] [--port <port>] [--host <host>] [--no-open]
>tendril wireframe screenshot [path] [--out <path>] [--width <w>] [--height <h>]
>tendril wireframe agent-readme [path]
```

Prepara la estructura, sirve, previsualiza con recarga en caliente y toma capturas de pantalla de wireframes de React diseñados durante la redacción del plan.
