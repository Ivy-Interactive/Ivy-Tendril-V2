---
title: Vercel AI Gateway
description: Enrute solicitudes a través de AI Gateway de Vercel para un acceso unificado a modelos de OpenAI, Anthropic, Google y de pesos abiertos con observabilidad integrada.
icon: Zap
searchHints:
  - vercel
  - ai gateway
  - unificado
  - observabilidad
---

# Vercel AI Gateway

[Vercel AI Gateway](https://vercel.com/docs/ai-gateway) proporciona un proxy unificado para enrutar solicitudes de inferencia entre los principales proveedores de modelos, incluidos [Anthropic](https://www.anthropic.com), [OpenAI](https://openai.com), [Google AI](https://ai.google.dev) y [xAI](https://x.ai). Cuenta con administración centralizada de claves de API, almacenamiento en caché en el edge, telemetría en tiempo real y medidas de protección de límites de tasa.

## Configuración a través de OpenCode

1. Cree una clave de API en el [Panel de control de Vercel](https://vercel.com) en **AI Gateway > API keys** de su equipo.
2. Conéctese en [OpenCode](https://opencode.ai) utilizando la terminal o el PTY integrado de Tendril:
   ```bash
   opencode
   ```
   Escriba `/connect`, busque **Vercel AI Gateway** e ingrese su clave de API.
3. Cambie su modelo activo utilizando `/models`.

### Reglas de enrutamiento (`opencode.json`)

Puede definir el orden de conmutación por error (failover) y las preferencias de enrutamiento directamente en `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "vercel": {
      "models": {
        "anthropic/claude-sonnet-5": {
          "options": {
            "order": ["anthropic", "vertex"]
          }
        }
      }
    }
  }
}
```

## Uso con Tendril

### Opción A: A través de OpenCode integrado

1. En la aplicación de escritorio Tendril, vaya a **Settings > Coding Agent**.
2. Seleccione **OpenCode** como su agente activo (consulte [Agente OpenCode](../06_CodingAgents/04_OpenCode.md)).
3. Tendril enruta toda la ejecución de planes a través del sidecar integrado de [OpenCode](https://opencode.ai) conectado a Vercel AI Gateway.

### Opción B: Gateway directo en `config.yaml`

Vercel AI Gateway proporciona un endpoint de API compatible con [OpenAI](https://openai.com) en `https://ai-gateway.vercel.sh/v1`. Puede configurar Tendril para que se enrute directamente a través de él en `~/.tendril/config.yaml` (consulte [Instalación de la configuración](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-vercel-ai-key"
      OPENAI_BASE_URL: "https://ai-gateway.vercel.sh/v1"
    profiles:
      - name: deep
        model: "anthropic/claude-opus-5"
        effort: max
      - name: balanced
        model: "anthropic/claude-sonnet-5"
        effort: high
      - name: quick
        model: "google/gemini-3.8-flash"
        effort: low
```

## Monitoreo y telemetría

Las métricas de uso, el consumo de tokens y los desgloses de latencia se registran automáticamente en el panel de control de Vercel bajo **AI Gateway > Analytics**, complementando el libro de registro de tokens local de Tendril.

## Enlaces

- [Proveedores de modelos](_Index.md)
- [Agentes de programación](../06_CodingAgents/_Index.md)
- [Documentación de Vercel AI Gateway](https://vercel.com/docs/ai-gateway)
- [Guía de Vercel + OpenCode](https://vercel.com/docs/ai-gateway/coding-agents/opencode)
