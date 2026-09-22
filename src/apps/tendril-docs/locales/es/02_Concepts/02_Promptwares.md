---
title: Promptwares
description: >-
  Los promptwares son los agentes de flujo de trabajo especializados detrás de cada fase del plan, cada uno con su propio prompt,
  herramientas y memoria a largo plazo.
icon: Terminal
searchHints:
  - promptware
  - agente
  - prompt
  - herramientas
  - memoria
  - allowedTools
  - perfil
  - customInstructions
  - capas
---

# Promptwares

Un promptware es un directorio que contiene las instrucciones, herramientas y memoria que definen a un agente
de flujo de trabajo especializado. Las copias desplegadas se ubican bajo `$TENDRIL_HOME/Promptwares/`, una por cada promptware:

- **Program.md** — el prompt de sistema: el objetivo del agente, el procedimiento paso a paso y las reglas de ejecución.
- **Tools/** — scripts y utilidades ejecutables a los que el agente puede recurrir durante su ejecución.
- **Memory/** — notas persistentes en Markdown que se conservan entre ejecuciones. Este ciclo de retroalimentación permite
  a los promptwares aprender las particularidades de la base de código y mejorar en lugar de repetir errores.

Tendril despacha los promptwares a través del agente de programación configurado (como
[Claude Code](../06_CodingAgents/01_ClaudeCode.md), [Codex](../06_CodingAgents/02_Codex.md),
[Copilot](../06_CodingAgents/03_Copilot.md), [Gemini](../06_CodingAgents/05_Gemini.md),
[OpenCode](../06_CodingAgents/04_OpenCode.md), Antigravity o [Cursor](https://www.cursor.com)), ejecutando
un trabajo a la vez con permisos de herramientas basados en el principio de mínimo privilegio.

## Despliegue y capas

Tendril incluye un conjunto estándar de promptwares integrados en la plataforma. Los equipos también pueden configurar un directorio
de superposición (overlay) en [config.yaml](../03_Configuration/01_Setup.md) para sobrescribir los prompts de sistema o proporcionar herramientas
personalizadas para su equipo.

Desplegar o actualizar los promptwares:

```bash
tendril promptware deploy
```

Para comprobar si un promptware se está ejecutando desde la versión base o desde una capa de equipo:

```bash
tendril promptware layers
# o comprobar un promptware específico:
tendril promptware layers ExecutePlan
```

## Agentes de flujo de trabajo fundamentales

| Promptware       | Rol                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **CreatePlan**   | Redacta un plan a partir de un informe breve, un elemento del buzón o una incidencia de [GitHub](https://github.com).          |
| **ExpandPlan**   | Desarrolla un plan esquemático hasta convertirlo en una especificación implementable por fases.                                |
| **UpdatePlan**   | Revisa un plan existente a partir de los comentarios de revisión, el chat y anotaciones en línea.                              |
| **SplitPlan**    | Divide un plan voluminoso en subplanes independientes más manejables.                                                          |
| **ExecutePlan**  | Crea [git worktrees](https://git-scm.com/docs/git-worktree) aislados, implementa las fases del plan y ejecuta las pruebas.     |
| **RetryPlan**    | Realiza otra pasada sobre un plan que no superó la verificación, utilizando registros y diffs.                                 |
| **CreatePr**     | Abre un pull request en GitHub a partir de los diffs del worktree mediante la [CLI de GitHub](https://cli.github.com/) (`gh`). |
| **CreateIssue**  | Publica un fallo de plan, estado o solicitud de clasificación (triage) en incidencias de GitHub.                               |
| **AddProject**   | Registra un nuevo proyecto y configura las rutas de sus repositorios.                                                          |
| **SetupProject** | Determina y registra cómo se compila, ejecuta y verifica un proyecto.                                                          |
| **SyncRepo**     | Pone al día los repositorios de un proyecto respecto a sus ramas ascendentes (upstream).                                       |

## Configuración

Cada promptware se configura en [~/.tendril/config.yaml](../03_Configuration/01_Setup.md) bajo la
clave `promptwares:`:

```yaml
promptwares:
  _default:
    profile: balanced

  CreatePlan:
    profile: deep
    allowedTools:
      - Read
      - Glob
      - Grep
      - Bash
      - Write(%PLANS_DIR%/**)
    deniedTools:
      - WebFetch
    customInstructions: |
      Always include acceptance criteria and verification gates in the plan.
```

| Campo                | Obligatorio | Descripción                                                                                                                                                                       |
| -------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profile`            | Sí          | Qué perfil de agente utilizar: `quick`, `balanced` o `deep`. Los perfiles se corresponden con un modelo y un nivel de esfuerzo por agente.                                        |
| `allowedTools`       | No          | Herramientas concedidas de forma adicional a las predeterminadas. Admite variables `%PROMPTWARE_DIR%`, `%PLAN_DIR%` y `%PLANS_DIR%` para restringir permisos a rutas específicas. |
| `deniedTools`        | No          | Herramientas expresamente denegadas, incluso si otra regla las hubiera concedido.                                                                                                 |
| `customInstructions` | No          | Texto libre inyectado en el prompt del agente con indicadores de prioridad.                                                                                                       |

La entrada `_default` es una base aplicada a todos los promptwares; una entrada nombrada la sobrescribe.

### Instrucciones personalizadas (Custom instructions)

Cuando se define `customInstructions`, Tendril lo añade al prompt de firmware compilado con una indicación
explícita de prioridad. Se indica al agente que dé prioridad a estas instrucciones tanto sobre la plantilla de firmware como sobre el propio
`Program.md` del promptware. Úsalo para ajustar el comportamiento de un promptware determinado sin modificar los archivos
compartidos.

## Flujo de ejecución

1. **Contexto** — compilar `Program.md`, adjuntar el plan, las anotaciones en línea, la configuración del proyecto y
   cualquier `customInstructions` de `config.yaml`.
2. **Herramientas y permisos** — exponer `Tools/` y los permisos configurados, expandiendo las variables `%...%` a
   rutas absolutas. Los directorios con permisos de escritura quedan rigurosamente delimitados a la carpeta del plan, la
   `Memory/` del promptware y los worktrees de git del repositorio.
3. **Ejecución** — lanzar el agente de programación como un proceso de trabajo en segundo plano dentro de su worktree aislado.
4. **Captura y telemetría** — transmitir la salida en tiempo real a `$TENDRIL_HOME/Jobs/{jobId}-{planId}-{promptware}/`,
   notificar el avance al daemon y registrar el consumo de tokens y costes en el archivo `costs.csv` del plan.

## Memoria y aprendizaje

La memoria constituye el bucle de retroalimentación: un promptware anota lo que aprendió sobre un proyecto o un modo de fallo
y lo vuelve a leer en ejecuciones posteriores. La CLI expone la gestión de la memoria directamente:

```bash
# Listar las notas de memoria almacenadas para un promptware
tendril promptware list-memory ExecutePlan

# Leer una nota de memoria específica
tendril promptware read-memory ExecutePlan worktree-hygiene.md

# Escribir o actualizar una nota de memoria desde un archivo (o stdin)
tendril promptware write-memory ExecutePlan worktree-hygiene.md --file notes.md

# Eliminar una nota de memoria obsoleta o incorrecta
tendril promptware delete-memory ExecutePlan worktree-hygiene.md
```

> [!TIP]
> La memoria debe podarse al igual que expandirse: cualquier suposición o regla que quede desfasada debe
> eliminarse con `delete-memory`, en vez de quedar oculta bajo notas contradictorias.

## Ejecución directa

Para probar o ejecutar un promptware directamente en primer plano, saltándote el servicio de trabajos del daemon:

```bash
# Ejecutar CreatePlan directamente con un prompt de tarea
tendril promptware run CreatePlan "Add a health-check endpoint" --profile deep

# Imprimir el prompt compilado sin iniciar el agente
tendril promptware run CreatePlan "Add a health-check endpoint" --dry-run
```

## Próximos pasos

- [Ciclo de vida y trabajos](03_Lifecycle.md) — cómo se desarrolla la ejecución de un promptware en tiempo real.
- [Planes](01_Plans.md) — el artefacto que cada promptware lee y actualiza.
