---
title: GitHub
description: Tendril se integra con GitHub para la importación de issues, la creación automática de PRs y el seguimiento del estado de PRs.
icon: GitBranch
searchHints:
  - github
  - issues
  - pull requests
  - prs
  - importación
---

# GitHub

## Autenticación

Tendril utiliza la [CLI de GitHub](https://cli.github.com) (`gh`) para la autenticación con [GitHub](https://github.com). Ejecute `gh auth login` para autenticarse antes de utilizar las funciones de GitHub.

> [!NOTE]
> Asegúrese de que `gh` esté instalado y disponible en su PATH. Tendril se lo solicitará durante la incorporación (onboarding) si no se encuentra.

## Importación de issues a través de Inbox

Tendril proporciona una vista dedicada de **Inbox** en la barra lateral para explorar issues de [GitHub](https://github.com) y convertirlos en [planes](../02_Concepts/01_Plans.md):

1. Abra **Inbox** desde la barra lateral de navegación.
2. Seleccione una categoría:
   - **My Issues**: Issues asignados a usted en los repositorios de proyectos configurados.
   - **Review Requests**: Pull requests abiertas que solicitan su revisión.
   - **Project Issues**: Todos los issues abiertos para un repositorio de proyecto seleccionado.
3. Filtre por términos de búsqueda, etiquetas o hitos (milestones). Una sola consulta recupera hasta 1.000 issues abiertos (el límite de búsqueda de GitHub).
4. Seleccione uno o más issues y haga clic en **Create Plan** para iniciar la [promptware](../02_Concepts/02_Promptwares.md) `CreatePlan`, o personalice la descripción del plan en el diálogo New Plan antes de ejecutarlo.

Cada plan creado conserva la URL de origen que enlaza directamente con el issue original de GitHub.

### Rastreo automatizado de issues y propuestas

Tendril incluye un escaneo automatizado en segundo plano para los issues asignados de GitHub:

- Configure `inbox.checkIntervalMinutes` (o haga clic en el engranaje de Configuración en la vista de Inbox) para definir con qué frecuencia Tendril consulta a GitHub sobre nuevos issues asignados.
- **Modo Auto-Accept**: Cuando `inbox.autoAcceptAssignedIssues` está habilitado, los issues recién descubiertos inician inmediatamente un trabajo de `CreatePlan`.
- **Modo Proposals**: Cuando está deshabilitado, los issues escaneados se colocan como **Inbox Proposals** en la vista de Inbox. Puede revisar la descripción de cada propuesta y elegir **Accept** (iniciando el plan) o **Dismiss** (guardando un registro duradero para que el issue nunca se vuelva a importar).
- Haga clic en **Check Now** en la barra de herramientas de Inbox para activar un barrido manual inmediato sin esperar al temporizador programado.

## Creación de pull requests

Cuando un plan se ha completado y ha verificado sus cambios, abra el cuadro de diálogo **Create PR** para crear una pull request:

1. Revise y edite el título, la descripción y los revisores generados para la PR.
2. Configure las opciones de la PR:
   - **Solve Merge Conflicts**: Intenta resolver automáticamente los conflictos de fusión de ramas con respecto a la rama base de destino.
   - **Merge**: Fusiona la PR una vez que se superen las comprobaciones (desmárquelo para abrir la PR para revisión del equipo sin fusionar).
   - **Delete Branch**: Elimina la rama del worktree una vez fusionada.
   - **Include Artifacts**: Adjunta artefactos de verificación del plan, capturas de pantalla y registros al cuerpo de la PR.
   - **Create as Draft**: Abre la pull request en estado de borrador.
3. Tendril ejecuta la [promptware](../02_Concepts/02_Promptwares.md) `CreatePr` mediante `gh` para subir la rama (push), crear la pull request y vincular la URL de la PR al plan.

## Seguimiento del estado de PRs

La [vista de Pull Requests](../04_Apps/06_PullRequests.md) en la barra lateral rastrea todas las pull requests abiertas, fusionadas y cerradas en todos sus proyectos. Tendril supervisa los cambios de estado de las PR, manteniendo su [tablero de planes](../04_Apps/03_Plans.md) sincronizado sin intervención manual.
