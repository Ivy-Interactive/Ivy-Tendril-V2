---
title: Review
description: "Cola de trabajo finalizado: planes en Review o Failed. Nada se fusiona sin su aprobación."
icon: ThumbsUp
searchHints:
  - review
  - aprobación
  - rechazar
  - diff
  - verificar
---

# Review

La aplicación Review es la puerta de enlace de calidad de Tendril. Cuando un agente termina de ejecutar un plan a través de `ExecutePlan` (consulte [Promptwares](../02_Concepts/02_Promptwares.md)), el worktree aislado de [Git](https://git-scm.com) se conserva y se presenta aquí para la inspección, verificación y triaje por parte del desarrollador. Nada se fusiona ni llega a su rama predeterminada sin la aprobación explícita del operador.

## La cola de Review

La barra lateral muestra todos los planes que requieren la atención del desarrollador (planes en estado `Review` o `Failed`):

- **Distintivos** — Cada fila muestra el `#ID` del plan, el distintivo del proyecto y el estado de [Verificación](../03_Configuration/01_Setup.md#verifications):
  - `Verified` (verde) — Se superaron todas las puertas de verificación obligatorias.
  - `Unverified` (advertencia) — Una o más puertas de verificación fallaron, o las puertas aún no se han ejecutado.
  - Indicador de estado (por ejemplo, `Failed`) para detectar fácilmente las ejecuciones que requieren resolución de problemas.
- **Métodos abreviados de teclado** — Use `Flecha izquierda` y `Flecha derecha` (`ArrowLeft` y `ArrowRight`) para desplazarse rápidamente por los planes en la cola de revisión.

## Espacio de trabajo de Review

El espacio de trabajo principal presenta la implementación del plan y las herramientas de inspección:

- **Resumen del plan y comentarios** — Lea la especificación del plan y deje comentarios en línea (`DraftComment`) para proporcionar comentarios específicos línea por línea.
- **Barra de acciones de revisión** — Las acciones de revisión configuradas en el proyecto (definidas en `reviewActions` en [Configuración de proyectos](../03_Configuration/02_Projects.md)) se muestran como botones de un solo clic en la barra de herramientas (por ejemplo, `Run E2E`, `Smoke Test`).
- **Abrir especificación completa y Diff** — Accesible desde el menú del espacio de trabajo, abre la página de detalles completa del plan en [Planes](03_Plans.md) para inspeccionar diferencias multirrevisiones, alcanzabilidad de confirmaciones en el worktree de git y artefactos generados.
- **Chat de plan integrado** — Utilice el panel `PlanChatPanel` integrado para hacer preguntas al agente, inspeccionar la lógica de ejecución o aclarar detalles de implementación antes de aprobar.

## Acciones de triaje

| Acción                      | Control                         | Efecto                                                                                                                                                                                                        |
| --------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Create Pull Request**     | CTA principal                   | Crea una pull request de [GitHub](https://github.com) mediante la [CLI de GitHub](https://cli.github.com) (`gh`), la vincula al plan en [Pull Requests](06_PullRequests.md) y marca el plan como `Completed`. |
| **Push to PR**              | CTA principal (si existe PR)    | Envía nuevas confirmaciones del worktree a la rama de una pull request existente.                                                                                                                             |
| **Request Changes**         | Botón de icono (con distintivo) | Abre `SuggestChangesDialog` para enviar comentarios de borrador y opiniones, iniciando un [Job](04_Jobs.md) de `UpdatePlan` en el worktree existente.                                                         |
| **Accept Partial Delivery** | Botón secundario                | Abre `PartialDeliveryDialog` para aceptar partes funcionales de un entregable mientras se preparan los elementos restantes.                                                                                   |
| **Reset to Draft**          | Menú desplegable                | Abre `ResetToDraftDialog` para mover el plan nuevamente a `Draft` en [Planes](03_Plans.md) para redefinir el alcance.                                                                                         |
| **Delete Plan**             | Menú desplegable (destructivo)  | Abre `DeletePlanDialog` para eliminar permanentemente el plan y descartar su worktree aislado.                                                                                                                |
