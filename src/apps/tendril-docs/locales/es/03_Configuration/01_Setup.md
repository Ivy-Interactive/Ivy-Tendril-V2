---
title: Configuración y ajustes
description: Configure Tendril en la interfaz de Ajustes de la aplicación o editando TENDRIL_HOME/config.yaml (proyectos, agentes, niveles, verificaciones, preferencias).
icon: Construction
searchHints:
  - config
  - yaml
  - configuración
  - ajustes
  - proyectos
  - gui
  - despliegue
  - docker
  - secretos
  - BasicAuth
  - contraseña
  - alojado
---

# Configuración y ajustes

## Ajustes en la aplicación

Tendril incluye una aplicación de Ajustes dedicada para configurar el entorno visualmente sin necesidad de editar [YAML](https://yaml.org) a mano. La barra lateral de ajustes proporciona las siguientes secciones:

- **Coding Agent** — Elija el entorno de ejecución del agente de codificación principal ([Claude Code](../06_CodingAgents/01_ClaudeCode.md), [Copilot](../06_CodingAgents/03_Copilot.md), [Codex](../06_CodingAgents/02_Codex.md), [Gemini](../06_CodingAgents/05_Gemini.md), Antigravity, [OpenCode](../06_CodingAgents/04_OpenCode.md), Cursor, Apple o proxies compatibles con OpenAI personalizados), configure las claves de API del proveedor y las URL base personalizadas, adapte los perfiles de agentes y los niveles de razonamiento, pruebe la conectividad del agente y explore las especificaciones del modelo en el Catálogo de modelos. Para la instalación y configuración de agentes, consulte [Agentes de codificación](../06_CodingAgents/_Index.md).
- **Planes** — Edite la plantilla de plan en Markdown por defecto (`planTemplate`) que se utiliza cada vez que se crea un nuevo plan en [Planes](../04_Apps/03_Plans.md).
- **Apariencia** — Seleccione el modo de tema (**Claro**, **Oscuro** o **Sistema**), elija entre los temas predeterminados integrados con muestras de vista previa, configure el estado predeterminado de la barra lateral (expandida o contraída) y elija el destino del botón de chat (**Vista de chat** o **Terminal**).
- **Proyectos** — Gestione los proyectos registrados, configure repositorios por proyecto, verificaciones, puertos, variables de entorno, skills personalizadas, servidores [MCP](../09_Advanced/03_MCP.md) y acceda a la Zona de peligro. Consulte [Configuración de proyectos](02_Projects.md).
- **Team Vault** _(Beta)_ — Sincronice proyectos, skills personalizadas, servidores MCP y reglas de seguridad entre los miembros del equipo a través de un repositorio [Git](https://git-scm.com) compartido.
- **Agentes de flujo de trabajo** — Configure perfiles de agentes de [Promptware](../02_Concepts/02_Promptwares.md) y permisos detallados de herramientas (`allowedTools`, `deniedTools`) en flujos de trabajo estándar (`CreatePlan`, `ExecutePlan`, `UpdatePlan`, etc.) o de forma global utilizando la clave `_default`.
- **Niveles** — Defina niveles de complejidad (como L1, L2, L3) con ponderaciones de ejecución relativas, descripciones y colores de distintivo personalizados.
- **Notificaciones** — Active o desactive las notificaciones del sistema de escritorio para finalizaciones y fallos de trabajos.
- **Seguridad y túneles** — Configure la protección con contraseña para sesiones web, inicie o detenga túneles de [Cloudflare](https://www.cloudflare.com) de acceso total para acceso remoto y cree túneles de solo lectura con tokens de capacidad.
- **Avanzado** — Establezca tiempos de espera de ejecución (`jobTimeout`, `staleOutputTimeout`), configure `maxConcurrentJobs`, active o desactive el acceso a funciones beta e inspeccione los **Diagnósticos del daemon** en directo (estado de conexión, PID, ping de latencia, ruta de `$TENDRIL_HOME` y capacidades reportadas).
- **Boletín informativo** — Suscríbase a las actualizaciones de producto y notas de la versión de Ivy y Tendril.
- **Abrir config.yaml** — Abra el editor YAML sin procesar integrado con resaltado de sintaxis en vivo y enlace directo a planes.

## `config.yaml`

Los ajustes modificados en la interfaz se guardan inmediatamente en `$TENDRIL_HOME/config.yaml` (por defecto `~/.tendril/config.yaml`). También puede editar este archivo directamente o especificar una ruta personalizada mediante la variable de entorno `TENDRIL_CONFIG`.

> [!NOTE]
> El archivo de configuración siempre debe llamarse `config.yaml`. El daemon de Tendril recarga los cambios de configuración automáticamente cuando se actualiza en el disco.

### Ejemplo

```yaml
codingAgent: claude
maxConcurrentJobs: 5
jobTimeout: 45
staleOutputTimeout: 10
theme: default
themeMode: system
chatMode: chat
desktopNotifications: true

projects:
  - name: Global Engine
    color: Emerald
    repos:
      - path: ~/repos/global-engine
    verifications:
      - name: Build
        required: true
      - name: Test
        required: true
      - name: CheckResult
        required: true

auth:
  username: admin
  password: "$argon2id$v=19$m=65536,t=3,p=4$..." # Managed via Settings
  hashSecret: "base64-secret-pepper"

api:
  apiKey: "your-api-secret-key"
```

### Campos comunes

| Campo                  | Tipo          | Por defecto | Propósito                                                                                                               |
| ---------------------- | ------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `codingAgent`          | string        | `"claude"`  | Ejecutable del agente de codificación predeterminado. Consulte [Agentes de codificación](../06_CodingAgents/_Index.md). |
| `maxConcurrentJobs`    | integer       | `20`        | Número máximo de [Jobs](../04_Apps/04_Jobs.md) (worktrees) de ejecución simultánea de agentes.                          |
| `jobTimeout`           | integer (min) | `30`        | Tiempo de espera de ejecución en minutos antes de cancelar un trabajo activo.                                           |
| `staleOutputTimeout`   | integer (min) | `10`        | Tiempo de espera en minutos si el proceso del agente no genera salida stdout/stderr.                                    |
| `daemonRequestTimeout` | integer (sec) | `30`        | Tiempo de espera de solicitudes de clientes en segundos al comunicarse con el daemon local.                             |
| `planTemplate`         | string        | `""`        | Plantilla Markdown utilizada al crear nuevos planes en [Planes](../04_Apps/03_Plans.md).                                |
| `theme`                | string        | `"default"` | Identificador del tema predeterminado (por ejemplo, `default`, `dracula`).                                              |
| `themeMode`            | string        | `"system"`  | Modo de tema: `light`, `dark` o `system`.                                                                               |
| `chatMode`             | string        | `"chat"`    | Qué abre el botón de Chat: `chat` (vista de chat) o `terminal` (terminal del agente).                                   |
| `desktopNotifications` | boolean       | `true`      | Si las notificaciones del sistema de escritorio están habilitadas para eventos de trabajos.                             |
| `projects`             | list          | `[]`        | Lista de proyectos registrados y sus configuraciones. Consulte [Configuración de proyectos](02_Projects.md).            |
| `levels`               | list          | standard    | Niveles de complejidad y ponderaciones configurados para los planes.                                                    |
| `auth`                 | object        | `null`      | Configuración de protección con contraseña de sesión usando [Argon2](https://en.wikipedia.org/wiki/Argon2).             |
| `api.apiKey`           | string        | `null`      | Secreto compartido que protege los endpoints de la API REST. Consulte la [API REST](../09_Advanced/02_REST.md).         |
| `telemetry`            | boolean       | `null`      | Consentimiento para telemetría de uso anónima (`false` o ausente significa desactivada).                                |

## Autenticación y acceso remoto

### Protección de sesión (UI web)

Al alojar Tendril en un servidor remoto o exponerlo a través de una red, habilite la protección de sesión en **Ajustes > Seguridad y túneles** o configure las credenciales mediante variables de entorno:

- `TENDRIL_AUTH_USERNAME` — Nombre de usuario para iniciar sesión (por defecto: `admin`).
- `TENDRIL_AUTH_PASSWORD` — Contraseña en texto plano para calcular el hash al iniciar.
- `TENDRIL_AUTH_HASH_SECRET` — Cadena en base64 de 32 bytes (`openssl rand -base64 32` mediante [OpenSSL](https://www.openssl.org)) utilizada como secreto de salado (pepper) para [Argon2](https://en.wikipedia.org/wiki/Argon2).

En `config.yaml`, las contraseñas se almacenan como hashes Argon2 PHC bajo el bloque `auth:` con limitación de tasa opcional:

```yaml
auth:
  username: admin
  password: "$argon2id$v=19$m=65536,t=3,p=4$..."
  hashSecret: "base64-encoded-pepper"
  rateLimit:
    threshold: 3
    baseDelaySeconds: 1.0
    maxDelaySeconds: 60.0
```

### Túneles de Cloudflare

Tendril se integra con túneles de [Cloudflare](https://www.cloudflare.com) (`cloudflared`) para exponer la aplicación de forma segura sin necesidad de abrir puertos entrantes en el firewall:

- **Túnel de acceso total**: Publica el daemon de Tendril al completo. Por motivos de seguridad, Tendril exige que la protección de sesión esté activa con una contraseña configurada antes de iniciar un túnel de acceso total.
- **Túnel de uso compartido**: Crea un túnel de solo lectura protegido por tokens de capacidad, lo que permite compartir de forma segura el [Dashboard](../04_Apps/01_Dashboard.md) y el progreso de los planes con las partes interesadas sin exponer permisos de escritura.

### Protección de la API REST

La API REST utiliza autenticación basada en tokens mediante el ajuste `api.apiKey` en `config.yaml` o la variable de entorno `TENDRIL_API_KEY`. Cuando está configurado, las solicitudes deben incluir el encabezado `X-Api-Key`. Consulte la [API REST](../09_Advanced/02_REST.md) y la [Configuración de CLI](../09_Advanced/01_CLI/06_Config.md).

## Verificaciones

Tendril incluye definiciones de puertas de verificación integradas que los proyectos pueden incorporar en sus flujos:

| Verificación  | Descripción                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------- |
| `Build`       | Ejecuta el comando de compilación del proyecto y verifica que no haya errores de compilación.   |
| `Format`      | Verifica las reglas de formato de código o formatea los archivos modificados.                   |
| `Test`        | Ejecuta pruebas unitarias o de integración delimitadas a los cambios del plan.                  |
| `Lint`        | Ejecuta análisis estático / linters y notifica cualquier infracción.                            |
| `Screenshots` | Captura capturas de pantalla de la interfaz de usuario en el directorio de artefactos del plan. |
| `CheckResult` | Verifica que la implementación final coincida con la especificación del plan.                   |

Los comandos de verificación personalizados (como `cargo test`, `pnpm test` o `pytest`) se pueden definir globalmente en `config.yaml` o directamente dentro de [Configuración de proyectos](02_Projects.md#verification-pipelines). Para los comandos de verificación mediante CLI, consulte [Verificación de CLI](../09_Advanced/01_CLI/03_Verification.md).
