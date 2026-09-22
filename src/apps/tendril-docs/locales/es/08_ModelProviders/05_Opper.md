---
title: Opper.ai
description: Gateway de IA que proporciona acceso a más de 300 modelos de Anthropic, OpenAI, Google y proveedores de código abierto con opciones de residencia de datos en la UE.
icon: Server
searchHints:
  - opper
  - gateway
  - ue
  - multiproveedor
  - router
---

# Opper.ai

[Opper.ai](https://opper.ai) es un gateway de IA empresarial con sede en Europa que proporciona acceso unificado a más de 300 modelos fundacionales de [Anthropic](https://www.anthropic.com), [OpenAI](https://openai.com), [Google AI](https://ai.google.dev), [Mistral AI](https://mistral.ai) y ecosistemas de código abierto. Opper cuenta con enrutamiento automático de respaldo (fallback), optimización de latencia y estrictos controles de residencia de datos en la UE.

## Configuración a través de la CLI de Opper

1. Instale la CLI de Opper (requiere [Node.js](https://nodejs.org)):
   ```bash
   npm i -g @opperai/cli
   ```
2. Inicie sesión mediante OAuth en el navegador:
   ```bash
   opper login
   ```
3. Inicie [OpenCode](https://opencode.ai) a través de Opper:
   ```bash
   opper launch opencode
   ```

La autenticación es administrada por la sesión de la CLI de Opper; no se requieren claves de API individuales de cada proveedor.

## Cambio de modelos

Puede especificar un modelo al momento del lanzamiento mediante el indicador `--model`:

```bash
opper launch opencode --model anthropic/claude-sonnet-5
```

O cambiar de modelo interactivamente durante una sesión activa de OpenCode utilizando `/models`.

## Uso con Tendril

### Opción A: A través de OpenCode integrado

1. En la aplicación de escritorio Tendril, vaya a **Settings > Coding Agent**.
2. Establezca **OpenCode** como su agente de programación activo (consulte [Agente OpenCode](../06_CodingAgents/04_OpenCode.md)).
3. Tendril envía la ejecución a través de OpenCode, enrutada mediante Opper.

### Opción B: Gateway directo en `config.yaml`

Opper también expone un gateway compatible con OpenAI en `https://api.opper.ai/v1`. Puede configurar Tendril para que se conecte directamente suministrando su clave de API de Opper en `~/.tendril/config.yaml` (consulte [Instalación de la configuración](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "opp_..."
      OPENAI_BASE_URL: "https://api.opper.ai/v1"
    profiles:
      - name: deep
        model: "anthropic/claude-opus-5"
        effort: max
      - name: balanced
        model: "anthropic/claude-sonnet-5"
        effort: high
      - name: quick
        model: "google/gemini-3.8-flash"
        effort: medium
```

> [!TIP]
> Opper almacena automáticamente en caché los prefijos de prompts y enruta las consultas a regiones de datos europeas cuando las políticas de residencia en la UE están habilitadas en su panel de control de Opper.

## Enlaces

- [Proveedores de modelos](_Index.md)
- [Agentes de programación](../06_CodingAgents/_Index.md)
- [Plataforma Opper](https://opper.ai)
- [Documentación de la CLI de agente de Opper](https://opper.ai/agent-cli)
