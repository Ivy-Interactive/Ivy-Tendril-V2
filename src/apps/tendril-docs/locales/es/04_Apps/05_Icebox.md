---
title: Icebox
description: Planes de baja prioridad o para "más adelante" en estado Icebox para mantener los borradores enfocados.
icon: Snowflake
searchHints:
  - icebox
  - shelving
  - backlog
  - congelador
  - aparcar
---

# Icebox

El Icebox es el área de backlog y aparcamiento dedicada de Tendril para planes de ingeniería pospuestos, de baja prioridad o futuros. Aparcar planes mantiene la cola activa de borradores en [Planes](03_Plans.md) enfocada en las prioridades del sprint actual sin perder investigaciones, debates ni especificaciones redactadas (consulte el [Ciclo de vida del plan](../02_Concepts/03_Lifecycle.md)).

## Aparcar planes (Shelving)

Un plan se puede aparcar en cualquier momento mientras se encuentre en estado `Draft` o `Blocked`:

- En la aplicación [Planes](03_Plans.md), seleccione **Shelve to Icebox** en el menú de acciones.
- Tendril actualiza el estado del plan a `Icebox`.
- El directorio del plan en `$TENDRIL_HOME/plans/<planId>/`, sus revisiones versionadas y los registros de costes se conservan completamente en el disco (consulte [Gestión de planes en la CLI](../09_Advanced/01_CLI/01_Plan.md)).

## Exploración y filtrado

La aplicación Icebox ofrece funciones específicas de búsqueda y filtrado en su backlog:

- **Barra de búsqueda** — Filtre los planes por palabras clave en el título o por el `#ID` numérico del plan.
- **Filtro de proyecto** — Restrinja los planes aparcados a un proyecto específico configurado en [Configuración de proyectos](../03_Configuration/02_Projects.md).
- **Filtro de nivel** — Filtre los planes por nivel de complejidad (por ejemplo, L1, L2, L3 configurados en [Configuración y ajustes](../03_Configuration/01_Setup.md#in-app-settings)).

## Tarjetas de plan y acciones

Cada plan aparcado se muestra en una tarjeta con su etiqueta `#ID`, título, distintivo de proyecto, distintivo de nivel de complejidad e indicadores de verificación:

| Acción           | Control                         | Efecto                                                                                                                                                                                                                                      |
| ---------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inspect Plan** | Clic en el título de la tarjeta | Abre el espacio de trabajo del plan en [Planes](03_Plans.md) para revisar la especificación completa, los metadatos o las revisiones anteriores.                                                                                            |
| **Thaw**         | Botón con icono de llama        | Pasa el plan de `Icebox` nuevamente a `Draft` de forma optimista. El plan sale del Icebox de inmediato y vuelve a la cola activa de [Planes](03_Plans.md) listo para su ejecución mediante [ExecutePlan](../02_Concepts/02_Promptwares.md). |
| **Delete**       | Botón con icono de papelera     | Abre `DeletePlanDialog` para eliminar permanentemente la carpeta del plan, sus revisiones y los registros de la base de datos.                                                                                                              |
