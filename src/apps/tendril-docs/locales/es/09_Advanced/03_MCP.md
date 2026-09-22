---
title: Servidor MCP
description: Tendril incluye un servidor de Model Context Protocol (MCP) que expone herramientas de gestión de planes a agentes de programación con IA como Claude Code.
icon: Bot
searchHints:
  - mcp
  - model context protocol
  - claude
  - herramientas
  - tendril_get_plan
  - tendril_list_plans
  - tendril_start_job
  - tendril_inbox
  - tendril_get_config
---

# Servidor MCP

Tendril incluye un servidor de Model Context Protocol (MCP) que expone herramientas de gestión de planes, orquestación de trabajos y descubrimiento de proyectos a agentes de programación con IA como Claude Code.

## Iniciar el servidor MCP

```bash
tendril mcp
```

Esto inicia el servidor MCP a través del transporte stdio, adecuado para su uso en la configuración de MCP de Claude Code. La entrada y salida estándar están reservadas estrictamente para mensajes JSON-RPC; los registros de diagnóstico se dirigen a stderr.

## Autenticación

Configure la variable de entorno `TENDRIL_MCP_TOKEN` para requerir autenticación por token en las sesiones MCP:

- **Variables de entorno**: Los clientes que se conectan a través de stdio pueden proporcionar el token correspondiente mediante `TENDRIL_MCP_CLIENT_TOKEN` (o `TENDRIL_MCP_TOKEN`).
- **Metadatos de solicitud**: Los clientes también pueden pasar el token por solicitud en los parámetros de `initialize` bajo `_meta["io.tendril/token"]`.

Cuando `TENDRIL_MCP_TOKEN` no está configurado o está en blanco, la autenticación se deshabilita y se permiten las solicitudes locales.

## Herramientas disponibles

Todas las herramientas tienen el prefijo `tendril_` y operan directamente contra el demonio o el almacenamiento local de Tendril.

### Inspección y Consulta de planes

| Herramienta                      | Parámetros                                                           | Descripción                                                                                                                                                                                                                       |
| -------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tendril_get_plan`               | `plan_id` (obligatorio), `field` (opcional)                          | Obtiene los metadatos de un plan y su última revisión. Cuando se especifica `field`, devuelve solo ese campo (p. ej., `title`, `state`, `project`, `level`, `repos`, `commits`, `prs`, `verifications`, `dependsOn`, `revision`). |
| `tendril_list_plans`             | `state` (opcional), `project` (opcional), `search`, `since`, `limit` | Lista planes que coinciden con los filtros. `since` acepta una marca de tiempo RFC 3339; `search` filtra por título o ID.                                                                                                         |
| `tendril_get_revision`           | `plan_id` (obligatorio), `number` (opcional)                         | Obtiene el texto en markdown de una revisión de plan (la última por defecto o un número específico de revisión).                                                                                                                  |
| `tendril_plan_validate`          | `plan_id` (obligatorio)                                              | Comprueba el estado del plan y notifica cualquier problema estructural o de esquema.                                                                                                                                              |
| `tendril_plan_verification_list` | `plan_id` (obligatorio)                                              | Lista todas las verificaciones y sus estados actuales (`Pending`, `Pass`, `Fail`, `Skipped`) para un plan.                                                                                                                        |
| `tendril_plan_rec_list`          | `plan_id` (obligatorio), `state` (opcional)                          | Lista recomendaciones para un plan. Estados de filtro: `Pending`, `Accepted`, `AcceptedWithNotes`, `Declined`.                                                                                                                    |

### Redacción y Modificación de planes

| Herramienta                        | Parámetros                                                                                                                    | Descripción                                                                                                                                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tendril_plan_create`              | `title` (obligatorio), `project` (obligatorio), `level`, `initial_prompt`, `source_url`, `execution_profile`, `priority`, ... | Crea un nuevo plan. Las puertas de verificación se inicializan automáticamente a partir de la configuración del proyecto.                                                                                                               |
| `tendril_plan_write_revision`      | `plan_id` (obligatorio), `content` (obligatorio), `reason` (opcional)                                                         | Escribe una nueva revisión de markdown numerada. Los bloques de preguntas se validan contra el esquema.                                                                                                                                 |
| `tendril_plan_set`                 | `plan_id` (obligatorio), `field` (obligatorio), `value` (obligatorio)                                                         | Actualiza un campo escalar (`state`, `title`, `level`, `project`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`). Los cambios de estado exigen que se cumplan las puertas de verificación antes de permitir `Completed`. |
| `tendril_plan_set_verification`    | `plan_id` (obligatorio), `name` (obligatorio), `status` (obligatorio)                                                         | Establece el estado de una puerta de verificación (`Pending`, `Pass`, `Fail`, `Skipped`).                                                                                                                                               |
| `tendril_plan_verification_remove` | `plan_id` (obligatorio), `name` (obligatorio)                                                                                 | Elimina una puerta de verificación de un plan.                                                                                                                                                                                          |
| `tendril_plan_add_repo`            | `plan_id` (obligatorio), `path` (obligatorio)                                                                                 | Asocia la ruta de un repositorio a un plan.                                                                                                                                                                                             |
| `tendril_plan_remove_repo`         | `plan_id` (obligatorio), `path` (obligatorio)                                                                                 | Desvincula la ruta de un repositorio de un plan.                                                                                                                                                                                        |
| `tendril_plan_add_pr`              | `plan_id` (obligatorio), `url` (obligatorio)                                                                                  | Registra la URL de una pull request en un plan.                                                                                                                                                                                         |
| `tendril_plan_add_commit`          | `plan_id` (obligatorio), `sha` (obligatorio)                                                                                  | Registra el SHA de un commit en un plan.                                                                                                                                                                                                |
| `tendril_plan_add_depends_on`      | `plan_id` (obligatorio), `folder` (obligatorio)                                                                               | Añade una dependencia de plan bloqueante. El plan dependiente no se ejecutará hasta que el de destino alcance `Completed` y se fusionen sus PRs.                                                                                        |
| `tendril_plan_remove_depends_on`   | `plan_id` (obligatorio), `folder` (obligatorio)                                                                               | Elimina una dependencia de plan bloqueante.                                                                                                                                                                                             |
| `tendril_plan_add_related_plan`    | `plan_id` (obligatorio), `folder` (obligatorio)                                                                               | Vincula un plan relacionado para referencia contextual.                                                                                                                                                                                 |
| `tendril_plan_remove_related_plan` | `plan_id` (obligatorio), `folder` (obligatorio)                                                                               | Elimina el enlace a un plan relacionado.                                                                                                                                                                                                |

### Recomendaciones

| Herramienta                | Parámetros                                                                                       | Descripción                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `tendril_plan_rec_add`     | `plan_id` (obligatorio), `title` (obligatorio), `description` (obligatorio), `impact` (opcional) | Añade una nueva recomendación con nivel de impacto (`Small`, `Medium`, `High`). |
| `tendril_plan_rec_accept`  | `plan_id` (obligatorio), `title` (obligatorio)                                                   | Acepta una recomendación.                                                       |
| `tendril_plan_rec_decline` | `plan_id` (obligatorio), `title` (obligatorio), `reason` (opcional)                              | Rechaza una recomendación con una justificación opcional.                       |
| `tendril_plan_rec_remove`  | `plan_id` (obligatorio), `title` (obligatorio)                                                   | Elimina una recomendación del plan.                                             |

### Trabajos y Bandeja de entrada

| Herramienta           | Parámetros                                                                             | Descripción                                                                                                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tendril_inbox`       | `description` (obligatorio), `project` (opcional), `source_path` (opcional)            | Envía una nueva descripción de tarea a la bandeja de entrada de Tendril, iniciando automáticamente un trabajo `CreatePlan`.                                                                                             |
| `tendril_start_job`   | `job_type` (obligatorio), `plan_id`, `description`, `project`, `note`, `priority`, ... | Inicia un trabajo en segundo plano en el demonio en ejecución (`CreatePlan`, `ExecutePlan`, `RetryPlan`, `UpdatePlan`, `ExpandPlan`, `SplitPlan`, `CreatePr`, `CreateIssue`, `SetupProject`, `SyncRepo`, `AddProject`). |
| `tendril_list_jobs`   | `status` (opcional), `limit` (opcional)                                                | Lista trabajos recientes en segundo plano del demonio.                                                                                                                                                                  |
| `tendril_get_job`     | `job_id` (obligatorio)                                                                 | Recupera estado, tiempos, recuento de tokens y detalles de costes de un trabajo específico.                                                                                                                             |
| `tendril_cancel_job`  | `job_id` (obligatorio), `message` (opcional)                                           | Cancela un trabajo en segundo plano en ejecución.                                                                                                                                                                       |
| `tendril_job_add_log` | `job_id` (obligatorio), `action` (obligatorio), `summary` (opcional)                   | Agrega una entrada de registro narrativa a `<TendrilHome>/Jobs/`. Funciona sin conexión incluso si el demonio está detenido.                                                                                            |

### Configuración y Descubrimiento

| Herramienta                  | Parámetros        | Descripción                                                                                                                             |
| ---------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `tendril_get_config`         | `key` (opcional)  | Lee valores de configuración pública (p. ej., `codingAgent`, `jobTimeout`, `planTemplate`). Las credenciales confidenciales se ocultan. |
| `tendril_list_projects`      | —                 | Lista todos los proyectos configurados con sus rutas de repositorio, verificaciones y ajustes.                                          |
| `tendril_list_verifications` | `name` (opcional) | Lista las definiciones de comprobaciones de verificación globales o inspecciona una por nombre.                                         |

> [!NOTE]
> La configuración es de solo lectura a través de MCP: modificar configuraciones a nivel de máquina como `planFolder` o `codingAgent` requiere usar la CLI (`tendril config set`) o la interfaz de Tendril.

## Configuración de Claude Code

Añada el servidor MCP de Tendril a sus ajustes de Claude Code (`~/.claude/settings.json` o `.claude/settings.json` a nivel de proyecto):

```json
{
  "mcpServers": {
    "tendril": {
      "command": "tendril",
      "args": ["mcp"]
    }
  }
}
```

Con autenticación por token habilitada:

```json
{
  "mcpServers": {
    "tendril": {
      "command": "tendril",
      "args": ["mcp"],
      "env": {
        "TENDRIL_MCP_CLIENT_TOKEN": "your-secret-token"
      }
    }
  }
}
```
