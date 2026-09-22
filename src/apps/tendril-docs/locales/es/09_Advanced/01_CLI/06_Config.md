---
title: config
description: Obtenga y establezca configuraciones de nivel superior de Tendril almacenadas en config.yaml directamente desde la línea de comandos.
icon: Settings
searchHints:
  - config
  - configuración
  - ajustes
  - jobTimeout
  - codingAgent
  - planTemplate
  - gitTimeout
  - daemonRequestTimeout
  - llm
---

# config

Obtenga y establezca configuraciones de nivel superior de Tendril almacenadas en formato [YAML](https://yaml.org) dentro de `config.yaml` — los mismos valores globales administrados en Ajustes en las interfaces de escritorio y web. Consulte la [Guía de configuración](../../03_Configuration/01_Setup.md) para más detalles sobre el entorno y la estructura de directorios.

## Comandos

```terminal
>tendril config get <key>
>tendril config set <key> <value>
```

- **`get`** — Imprime el valor sin procesar en la salida estándar sin formato decorativo, lo que lo hace ideal para scripts de shell y redirección directa a archivos u otras herramientas.
- **`set`** — Valida y actualiza el valor en `config.yaml`. Las claves no distinguen entre mayúsculas y minúsculas.

## Claves primitivas

Tendril modela varias claves de configuración primitivas con validación tipada:

| Clave                          | Tipo                                | Valor por defecto  | Descripción                                                                                                                                            |
| ------------------------------ | ----------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `codingAgent`                  | string                              | `claude`           | Ejecutable o alias del agente de programación por defecto (p. ej., `claude`, `aider`, `codestory`).                                                    |
| `jobTimeout`                   | integer (minutos)                   | `120`              | Tiempo de espera máximo de ejecución para un trabajo de plan en curso.                                                                                 |
| `staleOutputTimeout`           | integer (minutos)                   | `10`               | Duración de inactividad antes de que un trabajo sin salida se marque como estancado.                                                                   |
| `gitTimeout`                   | integer (minutos)                   | `5`                | Tiempo de espera de comandos para operaciones de [Git](https://git-scm.com).                                                                           |
| `daemonRequestTimeout`         | integer (segundos)                  | `30`               | Tiempo de espera en segundos para solicitudes HTTP al demonio local de Tendril (`0` o negativo lo desactiva).                                          |
| `maxConcurrentJobs`            | integer                             | `2`                | Número máximo permitido de trabajos de ejecución simultáneos.                                                                                          |
| `planTemplate`                 | string                              | `""`               | Plantilla de [Markdown](https://daringfireball.net/projects/markdown/) que se antepone al crear nuevos planes.                                         |
| `planFolder`                   | string (opcional)                   | `None`             | Directorio personalizado del sistema de archivos donde se almacenan los archivos markdown de planes. Pase `""` para desasignar.                        |
| `promptwareOverlay`            | string (opcional)                   | `None`             | Ruta a un directorio de superposición con promptwares personalizados. Pase `""` para desasignar.                                                       |
| `telemetry`                    | boolean (opcional)                  | `None`             | Opción de telemetría anónima (`true` o `false`). Pase `""` para restablecer.                                                                           |
| `beta`                         | boolean                             | `false`            | Habilita funciones preliminares experimentales (`true` o `false`).                                                                                     |
| `desktopNotifications`         | boolean                             | `true`             | Habilita notificaciones del sistema de escritorio para el estado de planes y finalizaciones de agentes (`true` o `false`).                             |
| `theme`                        | string                              | `default`          | ID de ajuste preestablecido de color de la interfaz (p. ej., `default`, `dracula`).                                                                    |
| `worktreeReaperInterval`       | integer (minutos)                   | `60`               | Frecuencia de los pasos automáticos de recolección de worktrees de [Git](https://git-scm.com) (`0` o negativo lo desactiva).                           |
| `worktreeReaperGrace`          | integer (minutos)                   | `1440`             | Período de gracia de inactividad en minutos antes de que un worktree inactivo se considere apto para recolección.                                      |
| `worktreeBranchDeleteMode`     | string                              | `PreserveUnpushed` | Modo de seguridad para la eliminación de ramas al recolectar worktrees (`PreserveUnpushed` o `Force`).                                                 |
| `coAuthor`                     | string (opcional)                   | `None`             | Identidad de atribución en tráiler de [Git](https://git-scm.com) en formato `Nombre <email>` añadido a commits automáticos. Pase `""` para desasignar. |
| `enrichModels`                 | boolean                             | `true`             | Habilita el descubrimiento y enriquecimiento automático de modelos en segundo plano (`true` o `false`).                                                |
| `modelEnrichmentIntervalHours` | integer (horas)                     | `24`               | Intervalo de actualización en segundo plano para metadatos de modelos.                                                                                 |
| `modelCacheWarnAgeDays`        | integer (días)                      | `7`                | Umbral flexible de antigüedad antes de que la caché obsoleta de modelos genere advertencias.                                                           |
| `modelCacheMaxAgeDays`         | integer (días)                      | `30`               | Umbral estricto de antigüedad después del cual expiran los metadatos de modelos en caché.                                                              |
| `llm`                          | objeto [JSON](https://www.json.org) | `None`             | Configuración de endpoint, clave API y modelo para el servicio auxiliar LLM. Se combina con los campos existentes.                                     |

> [!NOTE]
> Las claves escalares no modeladas también se pueden almacenar y recuperar; se guardan en una tabla de atributos adicionales en `config.yaml`.

## Claves estructuradas

Los ajustes de Tendril también contienen listas y mapas estructurados que no se pueden consultar ni modificar mediante `tendril config`:

- `projects` — Definiciones de proyectos configurados (gestione con [`tendril project`](02_Project.md)).
- `verifications` — Definiciones de suites de verificación globales (gestione con [`tendril verification`](03_Verification.md)).
- `levels` — Niveles de complejidad de planes y asignaciones de verificación.
- `onboarding` — Estados de finalización del asistente de primera ejecución.
- `codingAgents` — Rutas de binarios, argumentos, variables de entorno y perfiles por agente.
- `promptwares` — Instrucciones, perfiles y reglas de herramientas por promptware.
- `inbox` — Reglas de notificaciones entrantes e integraciones de entrega.

Intentar ejecutar `tendril config get` o `tendril config set` en cualquier clave estructurada muestra un error que le indicará utilizar el comando CLI dedicado o editar `config.yaml` directamente.

## Ejemplos

```terminal
># Leer un valor de configuración
>tendril config get jobTimeout

># Actualizar un ajuste numérico o de texto
>tendril config set jobTimeout 60
>tendril config set codingAgent claude

># Alternar opciones booleanas
>tendril config set desktopNotifications false
>tendril config set beta true

># Combinar configuración de LLM auxiliar
>tendril config set llm '{"model":"gpt-4o"}'

># Borrar un ajuste opcional pasando una cadena vacía
>tendril config set coAuthor ""
>tendril config set planFolder ""

># Establecer una plantilla de plan de varias líneas usando sustitución de comandos de shell
>tendril config set planTemplate "$(cat template.md)"

># Exportar la plantilla de plan de vuelta a un archivo
>tendril config get planTemplate > template.md
```

> [!TIP]
> Al asignar texto de varias líneas como `planTemplate` u objetos [JSON](https://www.json.org) como `llm`, utilice comillas de shell o sustitución de comandos (`"$(cat file.md)"`) para asegurarse de que los valores se pasen de forma limpia como un solo argumento.
