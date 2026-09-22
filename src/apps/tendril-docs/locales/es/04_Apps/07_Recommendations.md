---
title: Recomendaciones
description: Sugerencias de seguimiento (refactorizaciones, limpieza, pruebas) deducidas de sus repositorios, sin necesidad de tickets manuales.
icon: Lightbulb
searchHints:
  - recomendaciones
  - sugerencias
  - auto
---

# Recomendaciones

La aplicación Recomendaciones es el centro de triaje de Tendril para mejoras del código base sugeridas por IA, adición de cobertura de pruebas, limpiezas arquitectónicas y elementos de deuda técnica descubiertos durante las ejecuciones de planes.

## Origen y elegibilidad

A medida que los [Agentes de codificación](../06_CodingAgents/_Index.md) analizan, ejecutan y verifican planes, detectan mejoras relacionadas (por ejemplo, casos extremos sin probar, dependencias obsoletas, oportunidades de refactorización o cuellos de botella en el rendimiento).

Para que las recomendaciones sigan siendo prácticas y evitar trabajo prematuro:

- Solo las recomendaciones que provienen de planes completados (**Completed**) aparecen en la aplicación Recomendaciones (consulte el [Ciclo de vida del plan](../02_Concepts/03_Lifecycle.md)).
- Las recomendaciones originadas a partir de planes fallidos o en ejecución permanecen asociadas a su plan de origen hasta que dicho plan finalice con éxito.

## La cola de Recomendaciones

La barra lateral presenta todas las recomendaciones pendientes:

- **Etiqueta del plan de origen** — Muestra el número del plan de origen (por ejemplo, `#14`).
- **Título** — Descripción concisa de la mejora sugerida.
- **Distintivo del proyecto** — Identifica a qué repositorio de proyecto se dirige la recomendación (configurado en [Configuración de proyectos](../03_Configuration/02_Projects.md)).
- **Distintivo de impacto** — Evaluación de urgencia y valor codificada por colores:
  - `High` (verde) — Correcciones críticas, refactorizaciones significativas o vacíos esenciales en las pruebas.
  - `Medium` (ámbar) — Limpiezas, mejoras de mantenibilidad o mejoras no bloqueantes.
  - `Low` (neutro) — Ajustes menores o mejoras cosméticas.

## Vista detallada y acciones de triaje

Al seleccionar una recomendación se muestra su justificación técnica completa, la evaluación del impacto y un enlace para abrir el **Plan de origen** en [Planes](03_Plans.md).

Los desarrolladores pueden clasificar las recomendaciones mediante cuatro acciones principales:

| Acción                  | Control                  | Efecto                                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Accept**              | Botón CircleCheck        | Marca la recomendación como `Accepted` e inicia inmediatamente un [Job](04_Jobs.md) en segundo plano de `CreatePlan` (consulte [Promptwares](../02_Concepts/02_Promptwares.md)) para estructurar un nuevo borrador de implementación en [Planes](03_Plans.md). |
| **Accept with Notes**   | Botón Check              | Abre `RecommendationNoteDialog` permitiendo al desarrollador agregar restricciones o requisitos específicos. El agente recibe tanto la recomendación original como las notas del operador.                                                                     |
| **Decline**             | Botón X                  | Marca la recomendación como `Declined` con notas de rechazo opcionales, eliminándola de la cola de pendientes.                                                                                                                                                 |
| **Create GitHub Issue** | Botón de icono de GitHub | Abre `CreateIssueDialog` para registrar la recomendación directamente como una issue de [GitHub](https://github.com) mediante la [CLI de GitHub](https://cli.github.com) (`gh`) en el repositorio del proyecto. Deja la recomendación en estado `Pending`.     |

Una vez completada una acción, Tendril avanza automáticamente a la siguiente recomendación de la cola, lo que permite una revisión ágil de las mejoras propuestas.
