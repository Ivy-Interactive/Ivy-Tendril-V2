---
title: Solución de problemas
description: >-
  Síntomas habituales y cómo solucionarlos. Si sigues atascado, ejecuta `tendril doctor` y ponte en contacto
  a través de Discord.
icon: Wrench
searchHints:
  - solución de problemas
  - error
  - problema
  - síntoma
  - depuración
  - diagnóstico
  - worktree obsoleto
  - base de datos
  - doctor
  - db
---

# Solución de problemas

Diagnostica y resuelve problemas frecuentes de configuración, agentes, planes y bases de datos.

## Instalación y entorno

| Síntoma                                | Solución                                                                                                                                                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No se encuentra `TENDRIL_HOME`         | Define la variable de entorno y reinicia tu terminal, o escribe la ruta en `~/.tendril_location`. Sin ninguna de las dos opciones, Tendril usará por defecto `~/.tendril`.                                                                |
| No se encuentra `config.yaml`          | El archivo debe existir en `$TENDRIL_HOME/config.yaml` y llamarse exactamente así (no `tendril-config.yaml`). `tendril doctor` indica la ruta esperada.                                                                                   |
| `gh` no está autenticado               | Ejecuta la autenticación de la [CLI de GitHub](https://cli.github.com/): `gh auth login`, y después confirma con `gh auth status`.                                                                                                        |
| No se encuentra `git`                  | Instala [Git](https://git-scm.com/) y asegúrate de que esté accesible en tu `PATH`.                                                                                                                                                       |
| `tendril` no se reconoce tras compilar | `cargo build --release` deja el binario en `target/release/tendril`. Añádelo a tu `PATH` o ejecuta `cargo install --path src/crates/tendril-cli`.                                                                                         |
| La app inicia pero no carga nada       | La aplicación de escritorio supervisa el daemon `tendril run`; si faltan los binarios sidecar en una versión empaquetada, no hay daemon con el que comunicarse. Consulta [Instalación](02_Installation.md) para los pasos de empaquetado. |

## Planes

| Síntoma                                          | Solución                                                                                                                                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El plan se queda atascado en `Draft`             | Comprueba que haya un repositorio asociado mediante `tendril plan get <id>`, y verifica que la definición del proyecto exista en `config.yaml`.                                           |
| La carpeta del plan parece incompleta o no carga | Ejecuta `tendril plan validate <id>` para inspeccionar problemas: `plan.yaml` inválido, falta de carpeta `Revisions/`, título vacío o discrepancia en las versiones de esquema.           |
| El plan utiliza un esquema obsoleto              | Ejecuta `tendril plan doctor --fix` para migrar las carpetas de planes al esquema actual. Para eliminar restos huérfanos de planes vacíos, ejecuta `tendril plan doctor --prune-husks`.   |
| El plan no tiene repositorios configurados       | Ejecuta `tendril plan add-repo <id> <ruta>`.                                                                                                                                              |
| Worktree residual tras una ejecución fallida     | Ejecuta `tendril plan cleanup <id>` para eliminar los worktrees de planes finalizados. Para planes que no estén en estado terminal, añade `--force`: `tendril plan cleanup <id> --force`. |

## Ejecución y agentes

| Síntoma                                   | Solución                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| El agente no responde o no está accesible | Comprueba `codingAgent` en `config.yaml`, y luego ejecuta la CLI del agente directamente en una terminal limpia. Tendril lo ejecuta como subproceso; si `claude`, `codex`, `copilot`, `gemini`, `opencode`, `antigravity` o `cursor` no pueden funcionar desatendidos, los trabajos en segundo plano se detendrán. Para `apple`, comprueba `fm available` y activa `fm serve`. |
| La ejecución falla de inmediato           | Lee el registro del trabajo en `$TENDRIL_HOME/Jobs/{jobId}-{planId}-{promptware}/`. Entre las causas habituales se encuentran la falta de contexto del repositorio o permisos insuficientes de herramientas en [Promptwares](../02_Concepts/02_Promptwares.md).                                                                                                                |
| Las verificaciones siguen fallando        | Ejecuta el comando de verificación manualmente dentro del worktree aislado del plan (`$TENDRIL_HOME/Plans/{id}-{name}/Worktrees/{repo}`). El comando suele ser correcto pero al worktree le falta algún paso de configuración — consulta [Incorporación de una base de código](03_Onboarding.md).                                                                              |
| El trabajo nunca comienza                 | Ejecuta `tendril job queue` para comprobar el orden de despacho y los límites de concurrencia (`maxConcurrentJobs` en `config.yaml`). Puedes forzar el inicio de un trabajo en cola o bloqueado con `tendril job force-start <id>`, o detener trabajos colgados con `tendril job stop-all`. Consulta [Ciclo de vida y trabajos](../02_Concepts/03_Lifecycle.md).               |
| La entrada de voz aparece no disponible   | En macOS, concede permisos de micrófono en Ajustes del Sistema → Privacidad y seguridad → Micrófono, y reinicia la aplicación de escritorio.                                                                                                                                                                                                                                   |

## Base de datos

Tendril gestiona su base de datos [SQLite](https://www.sqlite.org) en `$TENDRIL_HOME/tendril.db`. Aunque las migraciones
se ejecutan automáticamente al arrancar el daemon, Tendril ofrece comandos específicos para la base de datos:

```bash
# Comprobar la versión actual del esquema de la base de datos
tendril db version

# Aplicar cualquier migración pendiente
tendril db migrate

# Verificar la integridad de la base de datos
tendril db integrity

# Recuperar espacio no utilizado en disco
tendril db vacuum

# Restablecer la base de datos (requiere confirmación)
tendril db reset
```

| Síntoma                                   | Solución                                                                                                                                                                                                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dudas sobre si la base de datos está sana | Ejecuta `tendril doctor` (comprueba conectividad) o `tendril db integrity` para verificar la consistencia interna de SQLite.                                                                                                                                |
| Base de datos bloqueada (database locked) | Otro proceso mantiene un bloqueo exclusivo. Solo debe haber un daemon ejecutándose al mismo tiempo; cierra la aplicación de escritorio antes de lanzar `tendril run` o `tendril serve` manualmente.                                                         |
| Base de datos dañada o corrupta           | Detén la aplicación y el daemon, y luego ejecuta `tendril db reset` (o elimina `$TENDRIL_HOME/tendril.db` junto a los archivos `-wal` y `-shm`). Los archivos Markdown de los planes en disco bajo `$TENDRIL_HOME/Plans/` permanecerán totalmente intactos. |

> [!TIP]
> Cuando solicites asistencia en [Discord](https://discord.gg/FHgxkDga3y) o GitHub, adjunta los registros
> diagnósticos completos mediante `tendril report-bug <plan-id>` — consulta [Obtener ayuda](05_GettingHelp.md).
