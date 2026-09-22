---
title: Dashboard
description: "Vista principal: recuentos de planes, gasto y tokens, y actividad reciente en todos los proyectos."
icon: ChartBar
searchHints:
  - dashboard
  - estadísticas
  - resumen
  - gráficos
  - costes
---

# Dashboard

El Dashboard es la vista operativa principal de Tendril, que proporciona visibilidad en tiempo real del flujo de desarrollo, el gasto de los agentes, la velocidad de entrega y los trabajos activos en todos los proyectos.

## Encabezado y resumen del flujo

La parte superior del Dashboard muestra la fecha actual, un saludo basado en la hora y el **Visor de procesos** (`TendrilProcessViewer`):

- **Drafts** — Total de planes actualmente en estado `Draft` pendientes de perfeccionamiento o ejecución.
- **In-Flight Jobs** — Recuento en tiempo real de trabajos activos de agentes categorizados por fase de promptware (**Creating**, **Updating**, **Executing**, **Retrying** y **Creating PR**).
- **Review** — Planes con ejecuciones finalizadas pendientes de triaje y aprobación por parte del desarrollador.
- **Completed & Failed** — Recuento acumulativo de trabajos terminados.

Al hacer clic en cualquier etapa en el Visor de procesos se navega directamente a esa vista ([Planes](03_Plans.md), [Jobs](04_Jobs.md) o [Review](02_Review.md)). La acción **+ New Plan** también es accesible directamente desde el visor.

## Indicadores clave de rendimiento (KPIs)

Cuatro tarjetas de KPI principales resumen la velocidad y la eficiencia de costes:

| Métrica                  | Significado                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| **Features Shipped**     | Número total de planes completados y pull requests fusionadas entregadas en todos los proyectos. |
| **Avg cost per Feature** | Gasto medio en dólares requerido para entregar una funcionalidad completada.                     |
| **Forecast This Month**  | Gasto mensual proyectado calculado a partir de la tasa de consumo de los últimos 30 días.        |
| **Avg Cost/Plan**        | Coste medio en todos los planes ejecutados, considerando tokens de entrada, salida y caché.      |

### Paneles de desglose detallado

Al hacer clic en cualquier tarjeta de KPI se desliza un **Panel de desglose** profundo (`BladeContainer`):

- **Desglose por proyecto y agente** — Vea qué proyectos o agentes de codificación representan la mayor parte del consumo de tokens y costes.
- **Tabla de desglose de planes** — Tabla de auditoría detallada por plan que enumera el título del plan, la duración de la ejecución, los recuentos de tokens (entrada, salida, lectura de caché, razonamiento) y el coste total.
- **Navegación directa** — Haga clic en cualquier plan en el panel de desglose para abrir su especificación completa.

## Tendencia diaria de 28 días

La tarjeta **Daily Trend** representa la actividad diaria de ejecución y el gasto de tokens a lo largo de un período de 28 días:

- **Gráfico de barras** — Totales de actividad y costes diarios.
- **Media móvil de 7 días** — Curva de media móvil superpuesta en el gráfico para suavizar la variación diaria y destacar la trayectoria de entrega.

## Pull Requests

La tarjeta **Pull Requests** proporciona:

- **Cadencia semanal de PRs** — Gráfico de barras que representa las pull requests fusionadas a lo largo de un período móvil de 6 semanas.
- **Fusiones recientes** — Lista rápida de pull requests de [GitHub](https://github.com) recientemente fusionadas con distintivos de proyecto y enlaces para abrirlas en [Pull Requests](06_PullRequests.md).

## Trabajos activos

La tarjeta **Active Jobs** muestra hasta ocho trabajos de agentes en ejecución en tiempo real:

- **Estado en directo** — Muestra el distintivo de estado (`Running`, `Pending` o `Blocked`).
- **Plan de destino y Promptware** — Identifica el título del plan o el tipo de [Promptware](../02_Concepts/02_Promptwares.md) específico (`CreatePlan`, `ExecutePlan`, `UpdatePlan`, etc.).
- **Inspección directa** — Al hacer clic en cualquier trabajo se abre su terminal de salida en directo en la aplicación [Jobs](04_Jobs.md).

## Contabilidad de costes y tokens

Cada ejecución de promptware añade una fila de solo adición al archivo duradero `costs.csv` del plan, ubicado en `$TENDRIL_HOME/plans/<planId>/costs.csv`.

Tendril concilia estos registros CSV en su base de datos [SQLite](https://www.sqlite.org) para calcular los costes utilizando las especificaciones de precios en tiempo real de [models.dev](https://models.dev) (por ejemplo, tokens de prompt, tokens de finalización, lecturas/escrituras de caché de prompt y tokens de razonamiento). Todos los gráficos reflejan estas cifras conciliadas con los colores de proyecto configurados en [Configuración de proyectos](../03_Configuration/02_Projects.md).
