---
title: Tutorial
description: >-
  Una guía completa de principio a fin: compila Tendril, registra un repositorio local, crea tu primer
  plan, ejecútalo con un agente, revisa el resultado y abre un pull request.
icon: GraduationCap
searchHints:
  - tutorial
  - guía paso a paso
  - inicio rápido
  - primer plan
  - de principio a fin
  - ejemplo
---

# Tutorial

Este es el flujo de trabajo completo de principio a fin en un repositorio de tu elección. Abarca el registro de un proyecto,
la generación de un plan, la ejecución de cambios en worktrees aislados, la revisión de diffs y el envío de un pull request.

## Paso 1: Compilar y verificar

Sigue las instrucciones de [Instalación](02_Installation.md) para instalar o compilar Tendril y colocar `tendril` en tu `PATH`.
Verifica tu entorno:

```bash
tendril doctor
```

`tendril doctor` audita `$TENDRIL_HOME`, `config.yaml`, la base de datos [SQLite](https://www.sqlite.org), el
directorio de planes, [Git](https://git-scm.com/) y la [CLI de GitHub](https://cli.github.com/) (`gh`). Resuelve cualquier
elemento con `[FAIL]` antes de continuar.

## Paso 2: Iniciar Tendril

Inicia la aplicación de escritorio:

```bash
pnpm dev:desktop
```

La aplicación de escritorio se abre y supervisa automáticamente el daemon `tendril run` en segundo plano. El
daemon expone la API REST y WebSocket a través de la cual se comunican la interfaz gráfica y la CLI.

Si prefieres ejecutar el daemon sin interfaz (headless):

```bash
# Comprueba el puerto y aplica migraciones pendientes
tendril run

# O escucha directa con opciones personalizadas:
tendril serve --host 127.0.0.1 --port 5010
```

## Paso 3: Registrar tu repositorio

Tendril necesita un repositorio git local sobre el que operar:

```bash
git clone https://github.com/your-org/your-repo.git
```

Registra el proyecto desde **Settings → Projects** en la aplicación de escritorio, o mediante la CLI:

```bash
tendril project add MyProject
tendril project add-repo MyProject /Users/you/Repos/MyProject
tendril project add-verification MyProject CheckResult
```

Ambos métodos actualizan `$TENDRIL_HOME/config.yaml`, que también puedes editar manualmente:

```yaml
codingAgent: claude

projects:
  - name: MyProject
    repos:
      - path: /Users/you/Repos/MyProject
    verifications:
      - name: NpmBuild
        required: true
      - name: CheckResult
        required: true
```

Configura `codingAgent` con el agente que tengas instalado:

- [Claude Code](https://code.claude.com/docs) (`claude`)
- [OpenAI Codex](https://openai.com) (`codex`)
- [GitHub Copilot](https://github.com/features/copilot) (`copilot`)
- [Google Gemini](https://ai.google.dev) (`gemini`)
- [OpenCode](https://opencode.ai) (`opencode`)
- Antigravity (`antigravity` / `agy`)
- [Cursor](https://www.cursor.com) (`cursor`)
- Apple Foundation Models (`apple` mediante `fm` en el dispositivo)

> [!TIP]
> Añade un archivo `AGENTS.md` en la raíz de tu repositorio con las convenciones arquitectónicas y los comandos de compilación.
> Tendril lo inyecta en el contexto del sistema del agente en cada ejecución. Consulta
> [Incorporación de una base de código](03_Onboarding.md) para más recomendaciones.

## Paso 4: Crear un plan

Haz clic en **New Plan** en la aplicación de escritorio e introduce una descripción de la tarea. Tendril envía el agente
de flujo de trabajo [CreatePlan](../02_Concepts/02_Promptwares.md), que redacta un
plan estructurado con la exposición del problema, soluciones por fases y objetivos de verificación.

También puedes crear planes desde la CLI:

```bash
tendril plan create "Add a health-check endpoint" MyProject
```

El plan entra en el estado **Draft** (Borrador). Abre el borrador para inspeccionar la especificación propuesta. Puedes añadir notas
en línea directamente en la interfaz para corregir el alcance o añadir restricciones, lo que indica a
[UpdatePlan](../02_Concepts/02_Promptwares.md) que sintetice tus comentarios en una
nueva revisión.

## Paso 5: Ejecutar el plan

Cuando el borrador cumpla con tus requisitos, haz clic en **Execute** (o ejecuta `tendril plan execute <plan-id>`).
El agente [ExecutePlan](../02_Concepts/02_Promptwares.md):

1. crea un [Git worktree](https://git-scm.com/docs/git-worktree) aislado bajo `Worktrees/{repo-name}/`,
   dejando intacta tu rama principal;
2. carga la especificación del plan, el contexto del repositorio y las notas de memoria;
3. implementa las modificaciones de código fase a fase con commits incrementales de git;
4. ejecuta cada filtro de verificación configurado (compilación, linting, pruebas, capturas de pantalla).

Supervisa la ejecución en tiempo real en la vista **Jobs** del escritorio o mediante la CLI:

```bash
tendril job list          # ver estados de los trabajos
tendril job queue         # inspeccionar el orden de la cola
```

Cuando todas las fases concluyen y las verificaciones requeridas se superan, el plan pasa a **Review** (Revisión).

> [!NOTE]
> Si una verificación falla, el plan pasa a **Failed** (Fallido) y el worktree se conserva en disco. Inspecciona
> el informe de errores en `Verification/` o ejecuta
> [RetryPlan](../02_Concepts/02_Promptwares.md) para que el agente intente corregir el problema.

## Paso 6: Revisar el resultado

Accede a la pantalla **Review** del plan para examinar el trabajo realizado:

- **Git Diff** — navega por los diffs con resaltado de sintaxis en todos los archivos modificados;
- **Informes de verificación** — consulta los resultados automatizados de compilación y pruebas;
- **Transcripciones de ejecución** — lee el seguimiento de llamadas a herramientas, la salida estándar (stdout/stderr) y los costes en tokens;
- **Recomendaciones de seguimiento** — revisa la deuda técnica o las mejoras sugeridas por el agente.

Aprueba el plan cuando estés satisfecho. Tendril activa
[CreatePr](../02_Concepts/02_Promptwares.md) para abrir un pull request mediante
la [CLI de GitHub](https://cli.github.com/) (`gh`), pasando el plan al estado **Completed** (Completado).

## Qué acaba de ocurrir

Has completado el ciclo de desarrollo habitual en Tendril:

```
Draft → Creating → Executing → Review → Completed
```

El agente autónomo operó en un worktree aislado (sandbox), satisfizo tus filtros de verificación y generó un
pull request auditado mientras registraba todos los prompts, diffs y costes bajo `$TENDRIL_HOME/Plans/`.

## Próximos pasos

- [Planes](../02_Concepts/01_Plans.md) — profundiza en la estructura de los planes, sus estados y anotaciones.
- [Promptwares](../02_Concepts/02_Promptwares.md) — personaliza los prompts, herramientas y memoria de los agentes de flujo de trabajo.
- [Ciclo de vida y trabajos](../02_Concepts/03_Lifecycle.md) — comprende la concurrencia, la gestión de colas y la telemetría.
