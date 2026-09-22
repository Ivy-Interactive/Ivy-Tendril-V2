---
title: Configuración de proyectos
description: Cada proyecto es un repositorio git con sus propias verificaciones y contexto de agente. Tendril ejecuta varios proyectos en paralelo.
icon: FolderGit
searchHints:
  - proyecto
  - repo
  - repositorio
  - multiproyecto
  - aislamiento
  - worktree
  - danger zone
  - mcp
  - sandboxing
---

# Configuración de proyectos

Tendril permite gestionar múltiples proyectos en paralelo. Cada proyecto define sus propios repositorios de [Git](https://git-scm.com), puertas de verificación, asignaciones de puertos, variables de entorno, entornos aislados de seguridad y skills personalizadas.

## Agregar y gestionar proyectos

Los proyectos se pueden configurar visualmente a través de **Ajustes > Proyectos** o declarándolos en `$TENDRIL_HOME/config.yaml` (consulte [Configuración y ajustes](01_Setup.md)):

- **Asistente para añadir proyectos** — Haga clic en **Add Project** en la barra lateral de Ajustes para registrar un proyecto con la ruta de su repositorio, color inicial y puertas de verificación predeterminadas.
- **Cambio de nombre en línea** — Haga clic en el icono del lápiz de edición junto al nombre del proyecto en el encabezado para cambiarle el nombre. Tendril valida que no haya nombres duplicados entre hermanos y actualiza los registros de planes asociados automáticamente.
- **Selector de muestras de color** — Seleccione un color de contraste de la cuadrícula de 32 muestras de la paleta de colores de Ivy (`ColorSwatchField`). Este color distingue el proyecto en el [Dashboard](../04_Apps/01_Dashboard.md), la cola de [Planes](../04_Apps/03_Plans.md), la cola de [Review](../04_Apps/02_Review.md) y el rastreador de [Pull Requests](../04_Apps/06_PullRequests.md).
- **Contexto** — Instrucciones en Markdown que describen la terminología del dominio, las restricciones arquitectónicas y los estándares de codificación. Este contexto se antepone a las instrucciones del promptware para todas las ejecuciones de agentes en el proyecto.

### Ejemplo de `config.yaml`

```yaml
projects:
  - name: Global Engine
    color: Emerald
    context: |
      Core engine services written in Rust with a TypeScript CLI.
      Follow standard Ivy design tokens and ensure all tests pass.
    repos:
      - path: ~/repos/global-engine
    verifications:
      - name: Build
        required: true
      - name: Test
        required: true
      - name: Lint
        required: true
      - name: CheckResult
        required: true
    reviewActions:
      - name: Run E2E
        command: pnpm test:e2e
        condition: "${hasChanges}"
    ports:
      backend:
        defaultPort: 8080
        description: API gateway service
    envFiles:
      - path: .env
        template: .env.example
        overrides:
          PORT: "${ports.backend}"
          DATABASE_URL: "sqlite://${env.TENDRIL_HOME}/dev.db"
    wireframes: true
    wireframeGuard: true
    sandboxMode: Off
    securityPreset: Standard
```

## Repositorios y worktrees de Git

Los proyectos de Tendril vinculan uno o más repositorios de [Git](https://git-scm.com) (`repos:`).

Cuando un agente ejecuta un plan mediante `ExecutePlan`, aísla la generación de código de su entorno de desarrollo local:

- **Worktrees de Git dedicados** — Tendril crea una rama aislada en un worktree de Git (`tendril/<planId>-<slug>`) ramificada a partir de su rama de destino. Su árbol de trabajo, rama e IDE permanecen intactos.
- **Ejecución simultánea** — Se pueden ejecutar múltiples planes simultáneamente en diferentes repositorios sin conflictos de bloqueo de Git.
- **Fallo y descarte seguros** — Las ejecuciones fallidas o rechazadas se pueden descartar de forma limpia sin limpiezas manuales de Git.
- **Worktree Reaper** — La limpieza automática en segundo plano elimina los worktrees inactivos o completados según los ajustes `worktreeReaperInterval` y `worktreeReaperGrace` en [Configuración y ajustes](01_Setup.md).

## Flujos de verificación

Los proyectos definen una secuencia ordenada de puertas de verificación que los agentes deben superar antes de que el trabajo llegue a [Review](../04_Apps/02_Review.md):

- **Orden ordenable** — Arrastre y suelte los pasos de verificación en la secuencia de ejecución deseada (`SortableVerificationList`).
- **Puertas obligatorias** — Marque las verificaciones como obligatorias. Un plan solo se muestra como `Verified` en [Review](../04_Apps/02_Review.md) si todas las verificaciones obligatorias tienen éxito.
- **Verificaciones personalizadas** — Añada comandos específicos del proyecto y prompts de verificación personalizados (por ejemplo, `cargo clippy`, `pnpm check`, `pytest`). Consulte [Verificación de CLI](../09_Advanced/01_CLI/03_Verification.md) para la gestión mediante la línea de comandos.

## Acciones de revisión

Defina botones de acción de un solo clic que se muestran en la barra de herramientas de la aplicación [Review](../04_Apps/02_Review.md) (`reviewActions:`):

- `name` — Etiqueta de acción mostrada en el botón de la barra de herramientas.
- `command` — Comando de shell ejecutado en el worktree del plan.
- `condition` — Condición de ejecución opcional (como `${hasChanges}`).

## Puertos y archivos de entorno

Los proyectos complejos suelen requerir configuraciones de puertos y de entorno aisladas:

- **Asignaciones de puertos (`ports:`)** — Declare puertos con nombre (por ejemplo, `backend`, `frontend`). Si el puerto predeterminado ya está en uso, Tendril asigna un puerto libre y lo expone mediante marcadores de posición `${ports.<name>}`.
- **Archivos de entorno (`envFiles:`)** — Recrea automáticamente archivos `.env` dentro de los worktrees de los agentes a partir de una plantilla base (por ejemplo, `.env.example`) y sustituciones clave/valor línea por línea compatibles con las variables `${ports.<name>}`, `${env.<VAR>}` y `%VAR%`.

## Seguridad y aislamiento de agentes

Tendril proporciona controles de seguridad granulares a nivel de proyecto:

- **Preajustes de seguridad** — Seleccione `Strict`, `Standard`, `Permissive` o `Custom`. Los preajustes configuran el aislamiento en sandbox predeterminado y las reglas de acceso a archivos.
- **Modo sandbox** — Seleccione el aislamiento en tiempo de ejecución: `Off`, [Docker](https://www.docker.com) o [Bubblewrap](https://github.com/containers/bubblewrap).
- **Acceso a archivos externos** — Controle si los agentes pueden leer archivos fuera del árbol del repositorio (`Deny`, `ReadOnly`, `Full`).
- **Autoejecución en terminal** — Elija si los agentes ejecutan comandos de shell automáticamente (`AllowAll`), solicitan confirmación (`RequireConfirmation`) o deniegan la ejecución de comandos (`DenyAll`).
- **Permisos de archivos** — Configure reglas de ruta detalladas: `Allow <path>`, `Ask <path>` o `Deny <path>`.
- **Wireframes y Wireframe Guard** — Active `wireframes` para habilitar la generación de prototipos de interfaz de usuario en los planes y active `wireframeGuard` para verificar que el código temporal de wireframe se revise antes de incorporarse a pull requests de producción.

## Servidores MCP y skills del proyecto

Amplíe las capacidades de los agentes para un proyecto específico:

- **Servidores MCP (`mcpServers:`)** — Registre servidores del [Model Context Protocol](https://modelcontextprotocol.io) específicos del proyecto con ejecutables, argumentos y variables de entorno personalizados. Consulte la [Integración con MCP](../09_Advanced/03_MCP.md).
- **Skills (`skills:`)** — Equipe a los agentes con procedimientos específicos del proyecto e instrucciones en Markdown. Consulte la [Guía de skills](../06_CodingAgents/00_Skills.md).

## Contexto local del repositorio

Tendril detecta y antepone automáticamente la documentación desde la raíz del repositorio al contexto del promptware:

- **`CLAUDE.md`** — Instrucciones y convenciones para Claude Code. Consulte la [Guía de Claude Code](../06_CodingAgents/01_ClaudeCode.md).
- **`AGENTS.md` / `DEVELOPER.md`** — Estándares de desarrollo del equipo, requisitos de pruebas y convenciones del código base.

## Zona de peligro: Eliminar frente a Borrar

La configuración del proyecto concluye con dos opciones de destrucción distintas en la Zona de peligro:

```
[ Remove Project ]  (Outline)
Removes the project from config.yaml. Cloned repositories, plan folders and history
are left on disk, so adding the project back by name restores it.

[ Delete Project ]  (Destructive)
Permanently deletes the project's plans, its cloned repositories under
<TENDRIL_HOME>/Projects/, its database rows and its config entry. This cannot be
undone, and asks you to type the project name first.
```

> [!WARNING]
> **Remove Project** solo anula el registro del proyecto en la configuración, manteniendo intactos los archivos en el disco. **Delete Project** borra permanentemente los repositorios, planes y registros de la base de datos, requiriendo escribir el nombre exacto del proyecto para confirmar.
