---
title: Planes
description: "Planes en borrador (Draft) o bloqueados (Blocked): defina el trabajo antes de la ejecución (PlansApp)."
icon: Feather
searchHints:
  - borrador
  - plan
  - ideación
  - bloqueado
  - makeplan
---

# Planes

La aplicación Planes es el espacio de trabajo de Tendril para estructurar, perfeccionar y preparar el trabajo de ingeniería antes de ejecutar cambios de código. Trabajar en los planes en primer lugar garantiza que los requisitos, la arquitectura y los pasos de verificación sean claros antes de iniciar las ejecuciones de agentes.

## Gestión de borradores

- **Creación de planes** — Presione `Ctrl+Alt+N` (`Cmd+Option+N` en macOS) o haga clic en **+ New Plan** en el encabezado del shell para abrir el diálogo de creación.
- **La cola de borradores** — La barra lateral enumera todos los planes en estado `Draft` o `Blocked`. Los planes que se están ejecutando actualmente en trabajos de ejecución se excluyen de forma segura de la cola de borradores para evitar modificaciones simultáneas.
- **Distintivos** — Cada borrador muestra su etiqueta `#ID`, título, distintivo de proyecto y distintivo de nivel de complejidad (por ejemplo, L1, L2, L3) con la paleta de colores de nivel configurada para el proyecto.
- **Fondo de proceso** — Cuando la cola está vacía, Tendril muestra el fondo interactivo del ciclo de vida del proceso con navegación a Planes, [Review](02_Review.md) y [Jobs](04_Jobs.md).

## Espacio de trabajo del plan (`PlanWorkspace`)

Al seleccionar un plan se abre la completa interfaz del espacio de trabajo:

### Pestañas

- **Plan** — Muestra la última revisión de especificación del plan en [Markdown](https://www.markdownguide.org) con listas de verificación de tareas en vivo, descripción del problema, enfoque propuesto y criterios de verificación.
- **Details** — Metadatos del plan, contexto del proyecto asignado (desde [Configuración de proyectos](../03_Configuration/02_Projects.md)), marcas de tiempo de creación/actualización e historial de revisiones.
- **Diff View** — Aparece siempre que un plan tiene múltiples revisiones (`revisionCount > 1`), ofreciendo una comparación diff lado a lado o unificada entre revisiones.
- **Recommendations** — Muestra las [Recomendaciones](07_Recommendations.md) proactivas generadas para este plan con controles de triaje integrados para Aceptar y Rechazar.
- **Git** — Aparece una vez que existen artefactos de ejecución. Realiza un seguimiento de los worktrees de [Git](https://git-scm.com) activos, confirmaciones registradas, referencias de PR (consulte [Pull Requests](06_PullRequests.md)) y advierte si las confirmaciones no fusionadas están en riesgo, con un botón para sincronizar los worktrees con los remotos.

### Paneles y chat

- **Panel de verificaciones** — Accesible desde el menú desplegable de la esquina superior derecha, este panel muestra las puertas de [Verificación](../03_Configuration/01_Setup.md#verifications) configuradas (`Build`, `Test`, `Lint`, etc.) con su estado de superado/fallido en tiempo real y registros de salida.
- **Chat del plan** — Panel de chat interactivo integrado (`PlanChatPanel`) para generar ideas, refinar el enfoque o hacer preguntas al agente sobre el plan antes de iniciar los cambios de código.

## Acciones de Promptware

Consulte [Promptwares](../02_Concepts/02_Promptwares.md) para obtener información sobre cómo se ejecutan estos flujos de trabajo:

| Acción               | Propósito                                                                                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ExecutePlan**      | Bloquea la última revisión del plan, crea una rama de worktree de [Git](https://git-scm.com) aislada e inicia el [Agente de codificación](../06_CodingAgents/_Index.md) para implementar los cambios. |
| **ExpandPlan**       | Solicita a un agente que desarrolle un resumen breve en un plan estructurado con pasos detallados, archivos objetivo y planes de prueba.                                                              |
| **SplitPlan**        | Divide un plan grande o complejo en subplanes más pequeños y específicos que pueden ejecutarse de forma independiente.                                                                                |
| **Shelve to Icebox** | Mueve el plan al [Icebox](05_Icebox.md) para despejar la cola activa conservando todo el contexto.                                                                                                    |
| **Delete Plan**      | Solicita confirmación para eliminar de forma permanente la carpeta y los registros del plan.                                                                                                          |

## Archivos en disco y sincronización en tiempo real

Cada plan está respaldado por un directorio bajo `$TENDRIL_HOME/plans/<planId>/`:

- `plan.yaml` — Metadatos del plan en [YAML](https://yaml.org), estado, asociación de proyecto y registros de verificación. Consulte [Plan de CLI](../09_Advanced/01_CLI/01_Plan.md).
- `revisions/` — Archivos markdown versionados (`001.md`, `002.md`, etc.) que representan cada iteración de la especificación.
- `costs.csv` — Registro de tokens y costes de solo adición.

Tendril utiliza observadores del sistema de archivos para detectar ediciones realizadas en editores de texto externos o IDEs, actualizando la interfaz de usuario al instante sin necesidad de actualizar manualmente.
