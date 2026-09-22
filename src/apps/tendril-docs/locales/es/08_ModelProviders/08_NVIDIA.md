---
title: NVIDIA
description: Acceda a microservicios de inferencia NVIDIA NIM y modelos abiertos acelerados para tareas de programación a través de NVIDIA Build.
icon: Cpu
searchHints:
  - nvidia
  - nim
  - spark
  - build
  - gpu
---

# NVIDIA

[NVIDIA Build](https://build.nvidia.com) proporciona acceso a los puntos de conexión de NIM (Microservicio de Inferencia) de [NVIDIA](https://www.nvidia.com), ofreciendo inferencia acelerada por GPU y optimizada para empresas de los principales modelos abiertos, incluidos [Llama de Meta](https://llama.meta.com), [DeepSeek](https://www.deepseek.com), [Mistral AI](https://mistral.ai) y [Qwen](https://github.com/QwenLM).

## Configuración a través de OpenCode

1. Genere una clave de API (que comienza con `nvapi-`) en [build.nvidia.com](https://build.nvidia.com).
2. Conéctese en [OpenCode](https://opencode.ai) utilizando la terminal o el PTY integrado de Tendril:
   ```bash
   opencode
   ```
   Escriba `/connect`, seleccione **NVIDIA** y pegue su clave de API.
3. Cambie su modelo activo utilizando `/models`.

## Modelos recomendados

NVIDIA NIM aloja versiones optimizadas para los mejores modelos de programación:

| Modelo                     | Identificador NIM                 | Nivel de ejecución  | Creador                              |
| :------------------------- | :-------------------------------- | :------------------ | :----------------------------------- |
| **Llama 3.3 70B Instruct** | `meta/llama-3.3-70b-instruct`     | Deep                | [Meta AI](https://llama.meta.com)    |
| **DeepSeek R1**            | `deepseek-ai/deepseek-r1`         | Deep (Razonamiento) | [DeepSeek](https://www.deepseek.com) |
| **Qwen 2.5 Coder 32B**     | `qwen/qwen2.5-coder-32b-instruct` | Balanced            | [Qwen](https://github.com/QwenLM)    |
| **Llama 3.1 8B Instruct**  | `meta/llama-3.1-8b-instruct`      | Quick               | [Meta AI](https://llama.meta.com)    |

## Uso con Tendril

### Opción A: A través de OpenCode integrado

1. En la aplicación de escritorio Tendril, abra **Settings > Coding Agent**.
2. Seleccione **OpenCode** como su agente de programación activo (consulte [Agente OpenCode](../06_CodingAgents/04_OpenCode.md)).
3. Tendril ejecuta los planes a través del sidecar integrado de [OpenCode](https://opencode.ai) utilizando sus modelos NVIDIA NIM autenticados.

### Opción B: API directa de NIM en `config.yaml`

NVIDIA NIM proporciona endpoints totalmente compatibles con [OpenAI](https://openai.com) en `https://integrate.api.nvidia.com/v1`. Puede configurar Tendril para que se conecte directamente en `~/.tendril/config.yaml` (consulte [Instalación de la configuración](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "nvapi-..."
      OPENAI_BASE_URL: "https://integrate.api.nvidia.com/v1"
    profiles:
      - name: deep
        model: "meta/llama-3.3-70b-instruct"
        effort: high
      - name: balanced
        model: "qwen/qwen2.5-coder-32b-instruct"
        effort: medium
      - name: quick
        model: "meta/llama-3.1-8b-instruct"
        effort: low
```

> [!TIP]
> Los endpoints de NVIDIA NIM utilizan esquemas estándar de OpenAI Chat Completion con transmisión continua de tokens (streaming) habilitada, lo que los hace totalmente compatibles con los visores de salida en vivo de Tendril.

## Enlaces

- [Proveedores de modelos](_Index.md)
- [Agentes de programación](../06_CodingAgents/_Index.md)
- [Catálogo de NVIDIA Build](https://build.nvidia.com)
- [Documentación de NVIDIA NIM](https://build.nvidia.com/spark/cli-coding-agent)
