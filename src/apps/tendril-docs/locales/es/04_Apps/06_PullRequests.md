---
title: Pull Requests
description: Supervise y abra PRs de GitHub desde Tendril después de que Review apruebe CreatePr.
icon: GitPullRequest
searchHints:
  - pull requests
  - pr
  - merge
  - github
---

# Pull Requests

La aplicación Pull Requests proporciona seguimiento multiproyecto de todas las pull requests de [GitHub](https://github.com) creadas a partir de planes de Tendril aprobados. Ofrece un único panel para supervisar qué PRs están abiertas, fusionadas o cerradas, junto con el gasto de tokens y el coste asociado con cada entrega.

## Ciclo de vida y flujo de trabajo de las PRs

1. **Aprobación** — Una vez que un plan termina su ejecución y se aprueba en [Review](02_Review.md), al hacer clic en **Create Pull Request** se inicia el promptware `CreatePr` (consulte [Promptwares](../02_Concepts/02_Promptwares.md)).
2. **Creación** — Tendril utiliza la [CLI de GitHub](https://cli.github.com) (`gh`) para enviar la rama del worktree aislado de [Git](https://git-scm.com) y abrir una pull request en [GitHub](https://github.com) con un resumen generado por IA (consulte [Integración con GitHub](../07_Integrations/01_Github.md)).
3. **Seguimiento** — La pull request se vincula al plan y se supervisa en esta vista hasta que se fusiona o se cierra.

## La tabla de Pull Requests

La tabla enumera cada pull request registrada en sus proyectos:

| Columna        | Descripción                                                    | Interacción                                                                                                          |
| -------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Plan**       | `#ID` y título del plan.                                       | Haga clic para abrir una hoja previa superpuesta con la especificación completa del plan.                            |
| **Project**    | Distintivo del proyecto.                                       | Muestra el color del proyecto definido en [Configuración de proyectos](../03_Configuration/02_Projects.md).          |
| **Status**     | Distintivo de estado (`Open`, `Merged`, `Closed` o `Unknown`). | La información sobre herramientas al pasar el cursor muestra la marca de tiempo de la última comprobación de GitHub. |
| **PR**         | Número de pull request de GitHub (por ejemplo, `#84`).         | Haga clic para abrir la pull request en [GitHub](https://github.com) en su navegador predeterminado.                 |
| **Tokens**     | Tokens acumulados consumidos por el plan.                      | Recuento compacto de tokens (por ejemplo, `450K`, `1.2M`).                                                           |
| **Cost**       | Coste total en USD para todos los trabajos en este plan.       | Gasto en divisa formateado.                                                                                          |
| **Repository** | Repositorio de GitHub de destino (`propietario/repo`).         | Ruta completa del repositorio de destino.                                                                            |
| **Branch**     | Nombre de la rama de Git.                                      | Rama de origen en el repositorio.                                                                                    |

## Filtrado y sincronización

- **Filtros de estado** — Utilice el selector de distintivos de estado encima de la tabla para filtrar por `Open`, `Merged`, `Closed` o `Unknown`.
- **Búsqueda** — Filtre filas en tiempo real por ID de plan, título, nombre del proyecto, repositorio o nombre de rama.
- **Resincronizar con GitHub** — Haga clic en el botón **Resync** para ejecutar una pasada de sincronización (`gh pr list`) en todos los repositorios configurados. Tendril notificará si hay repositorios inaccesibles, no autenticados o con límites de tasa excedidos.

> [!NOTE]
> Las pull requests fusionadas son terminales y no se vuelven a comprobar durante las pasadas de sincronización periódicas.

## Acciones de fila

Cada fila de pull request proporciona cuatro acciones rápidas:

- **View Plan** — Navega al espacio de trabajo de detalles del plan en la aplicación [Planes](03_Plans.md).
- **Follow Up** — Abre el cuadro de diálogo New Plan con el repositorio, el proyecto y la referencia de la rama precompletados para estructurar fácilmente tareas de seguimiento, correcciones de errores o mejoras en [Planes](03_Plans.md).
- **Open PR** — Abre la pull request en [GitHub](https://github.com) en su navegador web.
- **Resync** — Actualiza el estado desde GitHub para ese repositorio específico.
