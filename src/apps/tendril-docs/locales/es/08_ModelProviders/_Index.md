---
title: Proveedores de modelos
description: Configure proveedores de modelos y backends de inferencia para los agentes de Tendril v2 usando tarjetas BYO integradas o el sidecar empaquetado de OpenCode.
icon: Server
groupExpanded: true
searchHints:
  - proveedores de modelos
  - proveedores
  - api
  - inferencia
  - gateway
  - llm
  - opencode
  - traer tu propio llm
  - byo
---

# Proveedores de modelos

Tendril v2 admite un enrutamiento flexible de proveedores de modelos, lo que le permite ejecutar [agentes de programación](../06_CodingAgents/_Index.md) sobre infraestructura soberana europea, puertas de enlace (gateways) de API unificadas, centros de modelos en la nube o puntos de conexión locales (on-premises).

En Tendril v2, la ejecución de proveedores de modelos se canaliza a través de dos mecanismos principales:

1. **Bring Your Own LLM (BYO LLM) nativo**: Tarjetas de configuración integradas y [configuración](../03_Configuration/01_Setup.md) directa en `config.yaml` para [OpenAI](https://openai.com), [Anthropic](https://www.anthropic.com) y el proveedor soberano europeo [Berget AI](01_Berget.md).
2. **Sidecar integrado de OpenCode**: Tendril v2 incluye el binario de [OpenCode](https://opencode.ai) de forma predeterminada (`binaries/opencode`), lo que proporciona acceso directo a gateways multiproveedor y backends de inferencia personalizados sin necesidad de instalaciones manuales de CLI (consulte el [Agente OpenCode](../06_CodingAgents/04_OpenCode.md)).

## Proveedores compatibles

- [Berget AI](01_Berget.md) ([console.berget.ai](https://console.berget.ai)) — Proveedor de infraestructura de IA europeo que ofrece modelos Kimi y GLM con residencia completa de datos en la UE e integración nativa mediante tarjetas BYO en Tendril.
- [Evroc](02_Evroc.md) ([cloud.evroc.com](https://cloud.evroc.com)) — Proveedor de nube soberana europea que incluye modelos de código abierto como Kimi, Llama y Mistral.
- [Z.AI](03_Zai.md) ([z.ai](https://z.ai)) — Acceso de alto rendimiento a modelos GLM con opciones de planes dedicados para programación.
- [Scaleway](04_Scaleway.md) ([scaleway.com](https://www.scaleway.com)) — Proveedor de nube europeo que ofrece APIs generativas compatibles con OpenAI para programación y razonamiento.
- [Opper.ai](05_Opper.md) ([opper.ai](https://opper.ai)) — Gateway de IA que proporciona acceso unificado a más de 300 modelos con opciones de residencia de datos en la UE.
- [OpenRouter](06_OpenRouter.md) ([openrouter.ai](https://openrouter.ai)) — Gateway de API unificada que brinda acceso a modelos de Anthropic, OpenAI, Google, Meta y DeepSeek.
- [Cloudflare](07_Cloudflare.md) ([cloudflare.com](https://developers.cloudflare.com/workers-ai/)) — Inferencia sin servidor mediante Cloudflare Workers AI junto con la integración de herramientas Workers MCP.
- [NVIDIA](08_NVIDIA.md) ([build.nvidia.com](https://build.nvidia.com)) — Microservicios [NVIDIA NIM](https://build.nvidia.com) de nivel empresarial y modelos abiertos alojados en NVIDIA Build.
- [Vercel AI Gateway](09_Vercel.md) ([vercel.com](https://vercel.com/docs/ai-gateway)) — Enrutamiento unificado multiproveedor con telemetría integrada, límites de gasto y almacenamiento en caché de solicitudes.

## Cómo funciona la configuración

### 1. En la aplicación de escritorio de Tendril

Vaya a **Settings > Coding Agent**:

- **Agentes preconfigurados**: Seleccione entre los agentes integrados, incluidos [Claude Code](../06_CodingAgents/01_ClaudeCode.md), [Copilot](../06_CodingAgents/03_Copilot.md), [Codex](../06_CodingAgents/02_Codex.md), [Gemini](../06_CodingAgents/05_Gemini.md), [Antigravity](https://antigravity.google), [OpenCode](../06_CodingAgents/04_OpenCode.md), [Cursor](https://cursor.com) y los [modelos en el dispositivo de Apple](https://developer.apple.com).
- **Tarjetas Bring Your Own LLM**: Elija **OpenAI**, **Anthropic** o **Berget AI**. Introduzca su clave de API y Tendril configurará automáticamente las URLs base correspondientes, las dividirá en las variables de entorno del SDK respectivo y completará los valores predeterminados de los perfiles por niveles.
- **Niveles de perfil**: Configure modelos predeterminados y niveles de esfuerzo de razonamiento en tres niveles de ejecución:
  - **Deep**: Razonamiento de alto esfuerzo para planificación arquitectónica, refactorizaciones complejas y borradores iniciales.
  - **Balanced**: Equilibrio entre capacidad y velocidad para la implementación habitual de funciones y correcciones de revisiones.
  - **Quick**: Modelos rápidos y de baja latencia para generación de mensajes de commit, verificación de pruebas y comprobaciones de estado.

### 2. En `config.yaml`

Todos los ajustes de proveedores y agentes persisten en `~/.tendril/config.yaml` (consulte [Instalación de la configuración](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy # or opencode, claude, codex, gemini, etc.

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "sk-..."
      OPENAI_BASE_URL: "https://api.openai.com/v1"
      ANTHROPIC_API_KEY: "sk-..."
      ANTHROPIC_BASE_URL: "https://api.anthropic.com"
    profiles:
      - name: deep
        model: "gpt-5.6-sol"
        effort: high
      - name: balanced
        model: "gpt-5.6-terra"
        effort: medium
      - name: quick
        model: "gpt-5.6-luna"
        effort: low
```

> [!TIP]
> Al guardar los ajustes de BYO, el demonio de Tendril sincroniza automáticamente las URLs base: el SDK de [OpenAI](https://openai.com) espera `/v1` al final de la URL, mientras que el SDK de [Anthropic](https://www.anthropic.com) espera el host base sin `/v1`.

### 3. A través del sidecar integrado de OpenCode

Para proveedores de tipo gateway (como [OpenRouter](06_OpenRouter.md), [Evroc](02_Evroc.md), [Scaleway](04_Scaleway.md) u [Opper](05_Opper.md)):

1. Inicie OpenCode desde la terminal o a través de la terminal integrada de Tendril:
   ```bash
   opencode
   ```
2. Escriba `/connect` y seleccione su proveedor, o ejecute `opencode auth login`.
3. Configure su agente de programación activo en Tendril como OpenCode en **Settings > Coding Agent** (`codingAgent: opencode`).
4. Tendril despacha todas las tareas de ejecución de planes a través del entorno de ejecución configurado de [OpenCode](../06_CodingAgents/04_OpenCode.md).

> [!NOTE]
> Tendril v2 enriquece los metadatos de los modelos disponibles automáticamente a través de [models.dev](https://models.dev). La caché se almacena localmente en [SQLite](https://www.sqlite.org) y se actualiza en segundo plano o bajo demanda mediante `POST /api/models/refresh`.
