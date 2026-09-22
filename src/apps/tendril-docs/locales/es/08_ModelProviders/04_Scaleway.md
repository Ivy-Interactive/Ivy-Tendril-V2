---
title: Scaleway
description: Proveedor de nube europeo que ofrece APIs generativas compatibles con OpenAI para programación, razonamiento y modelos de pesos abiertos.
icon: Server
searchHints:
  - scaleway
  - ue
  - europeo
  - generative apis
  - soberano
  - qwen
---

# Scaleway

[Scaleway](https://www.scaleway.com) es un destacado proveedor europeo de servicios en la nube que ofrece infraestructura de IA soberana alojada en centros de datos energéticamente eficientes ubicados en Francia, Países Bajos y Polonia. A través de su plataforma Generative APIs, Scaleway proporciona endpoints administrados y totalmente compatibles con [OpenAI](https://openai.com) para los mejores modelos abiertos.

## Configuración

1. Cree una cuenta en [scaleway.com](https://www.scaleway.com).
2. Genere una clave de API de IAM (Secret Key) en la consola de Scaleway en **Identity and Access Management (IAM)**.
3. Conéctese en [OpenCode](https://opencode.ai) utilizando el sidecar integrado o la terminal:
   ```bash
   opencode
   ```
   Escriba `/connect`, seleccione **Scaleway** y pegue su IAM Secret Key.
4. Seleccione un modelo usando `/models`.

## Modelos recomendados

Scaleway aloja varios modelos optimizados para la compleción de código y la ingeniería de software:

| Modelo                     | ID de modelo                      | Creador                              | Nivel recomendado   |
| :------------------------- | :-------------------------------- | :----------------------------------- | :------------------ |
| **Qwen 2.5 Coder 32B**     | `qwen2.5-coder-32b-instruct`      | [Qwen](https://github.com/QwenLM)    | Deep                |
| **Llama 3.3 70B Instruct** | `llama-3.3-70b-instruct`          | [Meta AI](https://llama.meta.com)    | Balanced            |
| **Mistral Small 24B**      | `mistral-small-24b-instruct-2501` | [Mistral AI](https://mistral.ai)     | Quick               |
| **DeepSeek R1 Distill**    | `deepseek-r1-distill-llama-70b`   | [DeepSeek](https://www.deepseek.com) | Deep (Razonamiento) |

## Uso con Tendril

### Opción A: A través de OpenCode integrado

1. En la aplicación de escritorio Tendril, vaya a **Settings > Coding Agent**.
2. Seleccione **OpenCode** como su agente activo (consulte [Agente OpenCode](../06_CodingAgents/04_OpenCode.md)).
3. OpenCode utilizará sus credenciales configuradas de Scaleway para todas las tareas de ejecución de planes.

### Opción B: Endpoint personalizado de OpenAI en `config.yaml`

Dado que las Generative APIs de Scaleway siguen la especificación de OpenAI en `https://api.scaleway.ai/v1`, puede configurarlo directamente en `~/.tendril/config.yaml` (consulte [Instalación de la configuración](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-scaleway-secret-key"
      OPENAI_BASE_URL: "https://api.scaleway.ai/v1"
    profiles:
      - name: deep
        model: "qwen2.5-coder-32b-instruct"
        effort: high
      - name: balanced
        model: "llama-3.3-70b-instruct"
        effort: medium
      - name: quick
        model: "mistral-small-24b-instruct-2501"
        effort: low
```

> [!NOTE]
> Scaleway aplica la autenticación estándar de token Bearer por HTTP. Su IAM Secret Key actúa directamente como el `OPENAI_API_KEY`.

## Enlaces

- [Proveedores de modelos](_Index.md)
- [Agentes de programación](../06_CodingAgents/_Index.md)
- [Plataforma Scaleway](https://www.scaleway.com)
- [Consola de Scaleway](https://console.scaleway.com)
- [Documentación de Generative APIs de Scaleway](https://www.scaleway.com/en/docs/generative-apis/reference-content/integrate-with-opencode/)
