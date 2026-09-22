---
title: OpenCode
description: OpenCode es un agente de código alternativo que admite múltiples proveedores de modelos a través de una CLI unificada.
icon: Cpu
searchHints:
  - opencode
  - open code
  - agente de código
---

# OpenCode

## Configuración

Establezca OpenCode como su agente de código en `config.yaml`:

```yaml
codingAgent: opencode
```

O selecciónelo en **Settings > Coding Agent**.

Para más detalles sobre la estructura y los ajustes de `config.yaml`, consulte [Instalación y ajustes](../03_Configuration/01_Setup.md).

## Requisitos

- **Sidecar integrado**: Tendril distribuye [OpenCode](https://opencode.ai) como un sidecar integrado junto con la aplicación de escritorio y lo prefiere automáticamente frente a cualquier versión en el PATH. No se requiere instalación manual en instalaciones nuevas.
- **Instalación independiente** (opcional): Si desea instalar o ejecutar una copia independiente:
  ```bash
  curl -fsSL https://opencode.ai/install | bash
  ```
- **Autenticación**: Ejecute `opencode providers login` (o `opencode auth login`) para autenticarse con su proveedor seleccionado (por ejemplo, [Anthropic](https://www.anthropic.com), [OpenAI](https://openai.com), [Google AI](https://ai.google.dev), [Groq](https://groq.com)).

## Perfiles

Tendril asigna los niveles de esfuerzo a los modelos de OpenCode:

| Perfil     | Modelo  | Esfuerzo | Caso de uso                               |
| ---------- | ------- | -------- | ----------------------------------------- |
| `deep`     | default | high     | Cambios complejos en varios archivos      |
| `balanced` | default | medium   | Ejecución estándar de planes              |
| `quick`    | default | low      | Correcciones simples y pequeñas ediciones |

Los niveles de esfuerzo se corresponden directamente con el flag `--variant` de OpenCode (`low`, `medium`, `high`, `max`).

El modelo predeterminado del catálogo es `moonshotai/Kimi-K3`. OpenCode también admite modelos fijados de Anthropic y OpenAI como `claude-fable-5-1`, `claude-opus-5`, `claude-opus-4-7`, `claude-sonnet-5`, `claude-sonnet-4-6` y `gpt-5.5`.

## Traiga su propio LLM (BYO LLM) y proveedores

OpenCode impulsa las tarjetas **Bring-Your-Own LLM** de Tendril en **Settings > Coding Agent**:

- **[OpenAI](https://openai.com)**: Dirige OpenCode a `https://api.openai.com` con su `OPENAI_API_KEY`.
- **[Anthropic](https://www.anthropic.com)**: Dirige OpenCode a `https://api.anthropic.com/v1` con su `ANTHROPIC_API_KEY`.
- **[Berget AI](../08_ModelProviders/01_Berget.md)**: Dirige OpenCode a `https://api.berget.ai/v1` con su clave de API de [Berget AI](https://berget.ai).
- **Endpoints personalizados**: Configure claves y URL base personalizadas para cualquier proxy inverso compatible con OpenAI o Anthropic. Para conocer más proveedores, consulte [Proveedores de modelos](../08_ModelProviders/_Index.md).

Tendril configura estos proveedores de forma no destructiva utilizando `OPENCODE_CONFIG_CONTENT`, por lo que su configuración global de `opencode.json` nunca se sobrescribe.

## Configuración local con [Ollama](https://ollama.com)

Al ejecutar OpenCode con modelos locales de [Ollama](https://ollama.com), especifique la URL del servidor directamente en `config.yaml`:

```yaml
codingAgents:
  - name: opencode
    environmentVariables:
      OLLAMA_HOST: "http://localhost:11434"
      OLLAMA_BASE_URL: "http://localhost:11434"
```
