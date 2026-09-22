---
title: Ciclo de vida y trabajos
description: >-
  Un trabajo (job) es una ejecución de un promptware. Esto es lo que ocurre mientras se ejecuta — estado, salidas,
  verificaciones y costes.
icon: RefreshCw
searchHints:
  - trabajo
  - job
  - ciclo de vida
  - estado
  - verificación
  - worktree
  - concurrencia
  - coste
  - tokens
  - cola
  - stop-all
---

# Ciclo de vida y trabajos

Cada vez que Tendril realiza una acción en tu nombre crea un **trabajo (job)**: una ejecución de un único
[agente de flujo de trabajo (promptware)](02_Promptwares.md) sobre un [plan](01_Plans.md). Los trabajos son el mecanismo
mediante el cual un plan avanza por su ciclo de vida, y son lo que observas en tiempo real en la aplicación de escritorio y en la CLI.

## Estados de un trabajo

| Estado        | Significado                                                                      |
| ------------- | -------------------------------------------------------------------------------- |
| **Pending**   | Creado, aún no admitido en la cola.                                              |
| **Queued**    | Esperando un espacio de concurrencia disponible.                                 |
| **Running**   | El proceso del agente de programación se encuentra en ejecución activa.          |
| **Completed** | Finalizado con éxito y habiendo superado todas las verificaciones obligatorias.  |
| **Failed**    | El agente produjo un error o fallaron comprobaciones de verificación requeridas. |
| **Timeout**   | Excedió el límite de tiempo de ejecución configurado y fue terminado.            |
| **Stopped**   | Detenido por acción del usuario.                                                 |
| **Blocked**   | No puede continuar — esperando un trabajo dependiente, credenciales o decisión.  |

## El ciclo de ejecución

1. **Cola (Queue)** — el trabajo se crea y se encola tras las tareas que se encuentren en ejecución.
2. **Preparación (Prepare)** — para promptwares que modifican código ([ExecutePlan](02_Promptwares.md),
   [RetryPlan](02_Promptwares.md)), Tendril aprovisiona un
   [Git worktree](https://git-scm.com/docs/git-worktree) aislado por repositorio dentro de la carpeta
   `Worktrees/{repo-name}/` del plan. La ejecución nunca altera ni bloquea tu clon de trabajo principal.
3. **Implementación (Implement)** — el agente de flujo de trabajo avanza a través de las fases del plan, realizando commits incrementales.
4. **Verificación (Verify)** — cada filtro de verificación configurado se ejecuta dentro del worktree y registra su resultado.
5. **Informe (Report)** — los registros de salida, los costes de tokens y el estado actualizado del plan se guardan en disco y se comunican al
   daemon.

Detener un trabajo devuelve el plan al estado en que se encontraba antes de iniciarse, preservando al mismo tiempo el estado
del worktree para que puedas inspeccionar el avance parcial. Consulta [Planes](01_Plans.md) para ver la tabla completa de estados.

## Verificaciones

Una verificación es un filtro de calidad automatizado registrado en `plan.yaml`. Cada comprobación arroja un resultado —
`Pass`, `Fail` o `Skipped` — junto con un informe detallado en la carpeta `Verification/` del plan.
Las comprobaciones que se ejecutan dependen de qué archivos modifique el plan:

| Verificación    | Comprobaciones                                                                  |
| --------------- | ------------------------------------------------------------------------------- |
| **NpmBuild**    | El espacio de trabajo (workspace) de pnpm / npm compila limpiamente.            |
| **NpmLint**     | El análisis estático y formateo se superan en paquetes TypeScript / JavaScript. |
| **NpmTest**     | Las suites de pruebas automatizadas pasan (Vitest, Jest, etc.).                 |
| **RustBuild**   | Los paquetes de Cargo compilan sin errores.                                     |
| **RustClippy**  | El linter Clippy no reporta advertencias ni errores.                            |
| **RustFormat**  | `cargo fmt --check` reporta un formateo coherente.                              |
| **RustTest**    | Las suites de pruebas unitarias y de integración en Rust se superan.            |
| **Screenshots** | Se capturaron evidencias visuales para modificaciones de interfaz.              |
| **CheckResult** | Confirmación propia de extremo a extremo del agente de que los criterios valen. |

Una verificación que no resulte aplicable a un plan se marca como `Skipped` en lugar de omitirse en silencio,
garantizando una pista de auditoría explícita. Un plan alcanza el estado **Review** únicamente cuando se superan sus verificaciones obligatorias.
Si una verificación falla, el plan pasa a **Failed**, y
[RetryPlan](02_Promptwares.md) puede realizar otra pasada tomando la salida de error exacta
y el diff actual como contexto.

> [!TIP]
> Cuando una verificación falle, examina el informe en `Verification/` y prueba el comando directamente en
> el worktree del plan. La comprobación suele ser acertada y es probable que al worktree simplemente le falte una dependencia
> o recurso compilado — consulta [Incorporación de una base de código](../01_GettingStarted/03_Onboarding.md).

## Concurrencia y worktrees

Pueden ejecutarse varios trabajos de forma simultánea, regulados por `maxConcurrentJobs` en
[~/.tendril/config.yaml](../03_Configuration/01_Setup.md) (por defecto `20`):

```yaml
maxConcurrentJobs: 4
```

Dado que cada plan en ejecución opera dentro de [git worktrees](https://git-scm.com/docs/git-worktree) dedicados,
los trabajos paralelos sobre el mismo repositorio no colisionan. Sin embargo, las ejecuciones simultáneas comparten CPU, memoria y
los límites de tasa de API de los agentes, por lo que es recomendable ajustar `maxConcurrentJobs` según la capacidad de tu estación de trabajo.

## Seguimiento de costes

Cada ejecución registra los tokens consumidos y los costes monetarios estimados. El registro de auditoría duradero es el archivo
`costs.csv` del plan, al que se añade una fila por ejecución:

```csv
Promptware,Tokens,Cost,Model,CostSource,Agent
ExecutePlan,148213,1.9042,claude-opus-5,api,claude
```

Cuando un agente opera bajo una suscripción no tasada (o con modelos locales como Apple Foundation Models), el
campo `Cost` permanece vacío en lugar de registrar cero, conservando las métricas de tokens sin falsear importes
económicos.

## Gestión e inspección de trabajos

La aplicación de escritorio muestra el estado de los trabajos en vivo y transmite la salida de terminal en tiempo real a través del
flujo WebSocket del daemon. La CLI ofrece una paridad completa:

```bash
# Listar todos los trabajos activos y recientes
tendril job list

# Filtrar trabajos por estado
tendril job list --status Running
tendril job list --status Failed

# Inspeccionar el orden de la cola de despacho y los puestos disponibles
tendril job queue

# Promocionar un trabajo en cola o bloqueado para ejecutarlo de inmediato
tendril job force-start <job-id>

# Cancelar un trabajo en ejecución
tendril job cancel <job-id> -m "Stopping for review"

# Detener todos los trabajos en ejecución, en cola o bloqueados
tendril job stop-all

# Limpiar de la base de datos trabajos completados o fallidos
tendril job clear --completed
tendril job clear --failed
```

Los registros completos y las transcripciones de cada ejecución se guardan de forma permanente en disco en
`$TENDRIL_HOME/Jobs/{jobId}-{planId}-{promptware}/`, incluyendo el prompt de sistema sin procesar, las trazas de ejecución
de herramientas y las transcripciones del agente.

## Próximos pasos

- [Planes](01_Plans.md) — los estados entre los cuales los trabajos trasladan un plan.
- [Promptwares](02_Promptwares.md) — lo que realmente se ejecuta en el interior de un trabajo.
- [Solución de problemas](../01_GettingStarted/06_Troubleshooting.md) — diagnóstico de trabajos atascados o fallidos.
