# Política de clasificación de datos de telemetría

## Propósito

Este documento define qué datos puede y no puede enviar Tendril a servicios de telemetría de terceros (PostHog). El objetivo es recopilar análisis útiles respetando al mismo tiempo la privacidad del usuario.

La política acompaña al código: ha sido adaptada desde el archivo `TELEMETRY.md` de la aplicación Tendril original y ajustada a los eventos realmente implementados en V2.

## Opt-in, no opt-out

**La telemetría está desactivada a menos que la actives expresamente.** Solo un valor explícito `telemetry: true` en `config.yaml` la habilita; una clave ausente o `telemetry: false` se comportan de manera idéntica: no se construye ningún cliente, no se encola ningún evento y nunca se intenta realizar ninguna llamada de red. La clave se lee en un único lugar: `TendrilSettings::telemetry_enabled` en [config.rs](../../src/crates/tendril-core/src/config.rs), y V2 nunca *introduce* la clave por su cuenta: guardar un `config.yaml` que no la contiene la deja ausente en lugar de añadir `telemetry: false`, por lo que compartir un archivo con la aplicación original —que interpreta una clave ausente como "activada"— no desactiva la telemetría de dicha aplicación. Un valor explícito se conserva sin cambios.

**Esta es una divergencia deliberada.** La aplicación original es opt-out: define `Telemetry` como `true` por defecto y su propio documento indica "La telemetría es opt-out: está activada por defecto". V2 tiene como valor por defecto desactivado porque activar la recopilación de datos no es una decisión que una adaptación deba tomar en silencio en nombre del usuario. La divergencia es segura en una única dirección: V2 reporta menos respecto al original, nunca de más. Para revertirlo, restaura el valor por defecto del campo y la implementación de `Default` en [config.rs](../../src/crates/tendril-core/src/config.rs) a `Some(true)`.

Los usuarios se identifican únicamente mediante un UUID aleatorio que se almacena de forma persistente en `<TendrilHome>/.anonymous-id`. Nunca se deriva de un nombre de usuario, nombre de máquina o repositorio. (La versión original prefiere `<LocalAppData>/Tendril/.anonymous-id`; por lo tanto, una máquina que ejecute ambas aplicaciones cuenta como dos instalaciones).

## Reglas de clasificación

### PERMITIDO — Datos agregados y no identificables

- **Conteos**: número de proyectos, repositorios, planes, trabajos (solo totales agregados)
- **Duraciones**: tiempo requerido para completar operaciones, en segundos
- **Estados/Tipos**: valores de enum, nombres de estado, tipos de trabajo (p. ej., `CreatePlan`, `ExecutePlan`)
- **Niveles**: niveles de plan (p. ej., `Bug`, `Feature`, `Epic`)
- **Versiones**: cadenas de versión de la aplicación, cadenas de nombre y versión del sistema operativo
- **Proveedores de agentes**: nombre del agente de programación (p. ej., `claude`, `codex`, `copilot`, `gemini`, `opencode`, `antigravity`, `apple`, `ivy`)
- **Booleanos**: flags de funcionalidades, estados de configuración (p. ej., `llm_configured: true`)
- **Descriptores tecnológicos**: el hash del stack del proyecto (ver más abajo)
- **Hashes unidireccionales con salado por instalación** de identificadores que de otro modo estarían prohibidos (ver más abajo)

#### Hash del stack (`stack_hash`)

El hash del descriptor del stack es una firma canónica que preserva la similitud del stack tecnológico de un proyecto, p. ej., `fe.ts:react+next+tailwind/be.rs:axum/db:sqlite/test:vitest`. Está compuesto exclusivamente por un vocabulario cerrado de términos de lenguajes, frameworks, bases de datos y frameworks de prueba; por diseño no incluye nombres, rutas, versiones, conteos ni texto libre. Indica en qué stacks se utiliza Tendril sin revelar a quién pertenece el proyecto.

#### Identidad del plan con salado por instalación (`plan_uuid`)

Los IDs de plan sin procesar permanecen prohibidos, pero los eventos aún necesitan agruparse por plan. `telemetry::derive_plan_uuid` emite `SHA256("tendril-plan:" + anonymous_id + ":" + plan_id)` truncado a 16 bytes y formateado como un UUID RFC 9562 v8, en lugar del ID en sí:

- El ID anónimo actúa como sal por instalación, de modo que el plan `00042` genera un valor diferente en cada instalación y no permite correlacionar usuarios no relacionados.
- El hash es unidireccional, por lo que el contador secuencial nunca abandona la máquina.
- Está limitado a un único usuario anónimo, por lo que agrupa eventos sin ampliar la identidad.

Los IDs se normalizan primero a cinco dígitos, por lo que el formato entero de la base de datos (`42`) y el formato de carpeta (`00042`) producen el mismo valor.

Cualquier necesidad futura de correlacionar un identificador prohibido debe utilizar este mismo patrón de hash con sal, nunca el valor sin procesar.

### PROHIBIDO — Información identificable

Nunca registrar:

- **URLs**: URLs de repositorios, PRs o issues
- **Rutas**: rutas de archivos, rutas de directorios, rutas absolutas a repositorios
- **Nombres de usuario**: usuarios de GitHub, nombres de organizaciones, direcciones de correo electrónico
- **Nombres de repositorios** y **nombres de proyectos**: incluso los genéricos revelan contexto de trabajo
- **IDs secuenciales**: IDs de planes, números de issues, números de PRs (hashear por instalación en su lugar — ver `plan_uuid`)
- **Entrada del usuario**: descripciones de tareas, mensajes de commit, contenido del plan
- **Títulos**: títulos de planes, títulos de issues, asuntos de commits
- **Salida del agente**: transcripciones, llamadas a herramientas o mensajes de error que puedan contener información del usuario

## Marco de decisión

1. ¿Puede este campo identificar a una persona u organización? → Prohibido
2. ¿Puede revelar información privada de un repositorio? → Prohibido
3. ¿Puede revelar en qué está trabajando el usuario? → Prohibido
4. ¿Puede correlacionarse entre usuarios para desanonimizarlos? → Prohibido, a menos que esté salado con el ID anónimo y hasheado de forma unidireccional
5. ¿Aporta métricas agregadas útiles? → Permitido

**Ante la duda, déjalo fuera.**

## Adjunto a cada evento

Propiedades fijadas una sola vez por proceso en [client.rs](../../src/crates/tendril-core/src/telemetry/client.rs):

| Propiedad | Estado | Notas |
|---|---|---|
| `$session_id` | Cumple | UUID aleatorio, nuevo por proceso |
| `$geoip_disable: false` | Aceptado | PostHog resuelve la IP de la solicitud a un país; la IP no se almacena como propiedad del evento |
| `app_version` | Cumple | Versión del crate |
| `os` | Cumple | Nombre de la plataforma |
| `os_version` | Cumple | Salida de `uname` en unix, familia de plataforma en otros entornos |

`distinct_id` (el ID anónimo) se adjunta a cada evento. Las propiedades `distribution` / `source` del original se omiten: portaban un `AppBrand` de .NET sin equivalente en V2.

## Auditoría de eventos actuales

Todos los eventos cumplen con esta política. Los contextos son estructuras fuertemente tipadas en [events.rs](../../src/crates/tendril-core/src/telemetry/events.rs), por lo que un conjunto de propiedades es una decisión en tiempo de compilación y no un mapa abierto.

| Evento | Propiedades | Emitido desde |
|---|---|---|
| `app_started` | `version`, `project_count`, `llm_configured` | `run_server`, tras adquirir el bloqueo maestro |
| `job_created` | `job_type`, `agent`, `plan_uuid` | `JobManager::start_job_with` |
| `job_completed` | `job_type`, `status`, `duration_seconds`, `agent`, `plan_uuid` | `finish_job` |
| `plan_created` | `level`, `duration_seconds`, `agent`, `stack_hash`, `plan_uuid` | `finish_job`, `CreatePlan` con entregable |
| `pr_created` | `duration_seconds`, `agent`, `plan_uuid` | `finish_job`, `CreatePr` |
| `plan_state_transition` | `from_state`, `to_state`, `plan_uuid` | `apply_plan_state`, una vez escrita en disco |

`plan_uuid` es siempre el valor derivado y salado por instalación: los puntos de llamada pasan el ID de plan sin procesar al contexto tipado y el cliente lo hashea antes de enviarlo, por lo que el ID original no puede llegar a PostHog ni siquiera desde un punto de llamada que desconozca la regla.

### Definidos pero no conectados

`onboarding_completed` y `project_created` cuentan con estructuras de contexto en [events.rs](../../src/crates/tendril-core/src/telemetry/events.rs) sin puntos de invocación: V2 no tiene un flujo de onboarding interactivo y la creación de proyectos se realiza en el proceso de la CLI, donde no se instala ningún cliente. Existen para que planes posteriores puedan añadir puntos de llamada sin modificar el esquema.

El cliente reside únicamente en el proceso daemon. Una invocación de la CLI nunca llama a `telemetry::install`, por lo que `tendril plan ...` no envía nada.

## Implementación

- [events.rs](../../src/crates/tendril-core/src/telemetry/events.rs) — contextos tipados que imponen esta política en tiempo de compilación. Los nuevos eventos reciben una estructura aquí, nunca una bolsa de propiedades libre.
- [client.rs](../../src/crates/tendril-core/src/telemetry/client.rs) — cliente de PostHog, ID anónimo, derivación de UUID de planes. Cada método `track_*` gestiona sus propios errores y únicamente encola en una cola que un proceso en segundo plano vacía: la telemetría nunca debe fallar ni ralentizar un trabajo.
- [telemetry_test.rs](../../src/crates/tendril-core/tests/telemetry_test.rs) — comprueba que no existan llamadas de red cuando está deshabilitada, verifica el conjunto exacto de propiedades de cada evento conectado y la derivación del UUID del plan.
