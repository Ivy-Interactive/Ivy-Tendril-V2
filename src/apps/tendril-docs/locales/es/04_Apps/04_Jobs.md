---
title: Jobs
description: "Ejecuciones de promptware activas y pasadas: estado, coste, duración y salida en vivo."
icon: Activity
searchHints:
  - jobs
  - trabajos
  - en ejecución
  - ejecución
  - agentes
  - estado
---

# Jobs

La aplicación Jobs es el monitor de ejecución en tiempo real y el registro histórico de auditoría de Tendril. Cada invocación de [Promptware](../02_Concepts/02_Promptwares.md) (`CreatePlan`, `ExecutePlan`, `UpdatePlan`, `CreatePr`, `SplitPlan`, etc.) se ejecuta como un trabajo asíncrono supervisado aquí.

## Resumen y progreso del estado

En la parte superior de la vista de Jobs, una **Barra de progreso apilada** (`StackedProgress`) muestra la distribución en tiempo real de los estados de los trabajos:

- **Running** (azul) — Procesos de agentes en ejecución activa.
- **Completed** (verde) — Ejecuciones finalizadas con éxito.
- **Failed** (rojo) — Ejecuciones que finalizaron con errores o verificaciones fallidas.
- **Blocked** (ámbar) — Trabajos en espera de dependencias, límites de simultaneidad o confirmación del operador.
- **Pending** (atenuado) — Trabajos en cola en espera de ranuras de agente disponibles.

Los controles de ejecución masiva en el encabezado permiten a los operadores ejecutar **Stop All Queued** o **Stop All** cuando sea necesario, o limpiar por lotes filas históricas a través del menú desplegable **Clear** (`Clear Completed`, `Clear Failed` o `Clear All`).

## La tabla de Jobs

La tabla utiliza desplazamiento infinito con ordenación y filtrado evaluados en el lado del daemon:

| Columna     | Descripción                                                 | Interacción                                                                                       |
| ----------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Id**      | Identificador numérico del trabajo (ej. `00042`).           | Haga clic en el encabezado para ordenar por más reciente/más antiguo.                             |
| **Plan Id** | El identificador del plan de destino.                       | Haga clic para navegar directamente al plan en [Planes](03_Plans.md).                             |
| **Status**  | Distintivo de estado actual del trabajo.                    | Codificado por colores según el estado.                                                           |
| **Type**    | Identificador del promptware (ej. `ExecutePlan`).           | Permite ordenar por promptware.                                                                   |
| **Project** | Distintivo del proyecto.                                    | Con el color del proyecto desde [Configuración de proyectos](../03_Configuration/02_Projects.md). |
| **Output**  | Estado de ejecución del agente (`running`, `done`, `idle`). | **Haga clic para abrir la Hoja de salida en vivo** (`JobSessionView`) con terminal en streaming.  |
| **Tokens**  | Recuento total de consumo de tokens.                        | **Haga clic para abrir la Hoja de costes y tokens** (`JobCostSheet`).                             |
| **Cost**    | Coste de ejecución calculado en USD.                        | **Haga clic para abrir la Hoja de costes y tokens**.                                              |
| **Timer**   | Temporizador transcurrido en vivo o duración registrada.    | Muestra la duración en tiempo real.                                                               |
| **Date**    | Marca de tiempo de cuándo se inició el trabajo.             | Ordenación cronológica.                                                                           |

## Hojas y paneles desplegables

Al hacer clic en las celdas o en las acciones de fila se abren hojas deslizables superpuestas directamente sobre la tabla sin perder su posición:

### Hoja de salida en vivo (`JobSessionView`)

Al hacer clic en la celda **Output** se abre el visor del agente con transmisión en vivo. Podrá ver la salida de terminal en tiempo real `stdout`/`stderr` del agente (registros de compilación, salida de pruebas, invocaciones de herramientas y razonamiento del agente), no solo un indicador de carga genérico.

### Hoja de costes y tokens (`JobCostSheet`)

Al hacer clic en la celda **Tokens** o **Cost** se revela un desglose contable detallado:

- **Tokens de entrada (Input Tokens)** — Tokens de prompt y contexto enviados al modelo.
- **Tokens de salida (Output Tokens)** — Tokens generados por el modelo.
- **Tokens de lectura de caché (Cache Read Tokens)** — Tokens servidos desde la caché de prompts (ahorrando costes y latencia).
- **Tokens de escritura en caché (Cache Write Tokens)** — Tokens escritos en la caché de prompts del proveedor.
- **Tokens de razonamiento (Reasoning Tokens)** — Tokens dedicados a modelos de razonamiento interno (por ejemplo, OpenAI o1/o3 o razonamiento extendido de Anthropic).
- **Cálculo de costes** — Coste monetario conciliado con las especificaciones de precios de [models.dev](https://models.dev).

### Hoja de prompt completo

Al hacer clic en el texto del **Prompt** se abre el prompt completo y sin truncar enviado al agente, con resaltado de sintaxis completo.

## Menú de acciones de fila

Cada fila de trabajo proporciona un menú de acciones (`...`):

| Acción          | Disponibilidad         | Efecto                                                                                                                                                                                                            |
| --------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stop**        | Trabajos activos       | Termina el proceso del agente en ejecución de inmediato. El worktree de [Git](https://git-scm.com) se conserva para que pueda reanudar o inspeccionar el progreso parcial.                                        |
| **Force Start** | Trabajos bloqueados    | Omite los límites de simultaneidad o bloqueos de dependencias para iniciar el trabajo de inmediato.                                                                                                               |
| **Debug**       | Todos los trabajos     | Abre la **Hoja de depuración del trabajo** (`JobDebugSheet`) que proporciona acceso por pestañas al registro del trabajo, prompt, salida sin procesar y registro de Eventwire, con botones para "Open in Editor". |
| **Delete**      | Completados / Fallidos | Elimina permanentemente el registro del trabajo del historial con confirmación previa.                                                                                                                            |
