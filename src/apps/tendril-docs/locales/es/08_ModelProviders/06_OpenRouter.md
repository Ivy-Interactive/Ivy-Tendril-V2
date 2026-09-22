---
title: OpenRouter
description: Gateway de API unificada que proporciona acceso a modelos de Anthropic, OpenAI, Google, xAI, Meta, DeepSeek y más.
icon: Globe
searchHints:
  - openrouter
  - router
  - multiproveedor
  - gateway
---

# OpenRouter

[OpenRouter](https://openrouter.ai) proporciona una puerta de enlace (gateway) de API unificada y compatible con [OpenAI](https://openai.com) que brinda acceso a cientos de modelos de frontera de [Anthropic](https://www.anthropic.com), [OpenAI](https://openai.com), [Google DeepMind](https://deepmind.google), [Meta AI](https://ai.meta.com), [Mistral AI](https://mistral.ai), [DeepSeek](https://www.deepseek.com) y [xAI](https://x.ai). OpenRouter ofrece precios competitivos por token, respaldos automáticos de proveedores y métricas de uso completas.

## Configuración a través de OpenCode

1. Cree una clave de API en [openrouter.ai/keys](https://openrouter.ai/keys) (las claves comienzan con `sk-or-`).
2. Inicie [OpenCode](https://opencode.ai) a través de la terminal o de la terminal integrada de Tendril:
   ```bash
   opencode
   ```
   Escriba `/connect`, seleccione **OpenRouter** y pegue su clave de API.
3. Cambie su modelo activo utilizando `/models`.

### Configuración del proyecto (`opencode.json`)

Puede definir modelos predeterminados a nivel de proyecto en `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "openrouter": {
      "models": {
        "~anthropic/claude-sonnet-5": {},
        "~google/gemini-3.8-flash": {},
        "~deepseek/deepseek-r1": {}
      }
    }
  }
}
```

## Uso con Tendril

Puede conectar Tendril v2 directamente a OpenRouter utilizando la interfaz de usuario de escritorio o `config.yaml`.

### Opción A: Ajustes de escritorio (Bring Your Own LLM)

1. Vaya a **Settings > Coding Agent** en la aplicación Tendril.
2. En **Bring Your Own LLM**, haga clic en la tarjeta **OpenAI**.
3. Establezca la **Base URL** en `https://openrouter.ai/api/v1`.
4. Ingrese su clave de OpenRouter (`sk-or-...`) en **API Key** y haga clic en **Save**.

### Opción B: Configuración manual en `config.yaml`

Configure OpenRouter bajo `codingAgents` en `~/.tendril/config.yaml` (consulte [Instalación de la configuración](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "sk-or-..."
      OPENAI_BASE_URL: "https://openrouter.ai/api/v1"
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

> [!TIP]
> Los identificadores de modelo de OpenRouter incluyen prefijos de proveedor (por ejemplo, `anthropic/claude-opus-5` o `deepseek/deepseek-r1`). Estos prefijos deben incluirse literalmente en los campos `model` de sus perfiles.

## Enlaces

- [Proveedores de modelos](_Index.md)
- [Agentes de programación](../06_CodingAgents/_Index.md)
- [Plataforma OpenRouter](https://openrouter.ai)
- [Guía de integración de OpenRouter + OpenCode](https://openrouter.ai/docs/cookbook/coding-agents/opencode-integration)
