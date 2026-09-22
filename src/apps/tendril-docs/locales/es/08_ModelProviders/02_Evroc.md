---
title: Evroc
description: Proveedor de nube soberana europea con modelos de código abierto que incluyen Kimi, Llama y Mistral.
icon: Server
searchHints:
  - evroc
  - ue
  - europeo
  - soberano
  - kimi
  - mistral
  - llama
---

# Evroc

[Evroc](https://cloud.evroc.com) es un proveedor de nube soberana europea que opera centros de datos seguros y ecológicos en toda Europa. A través de su plataforma de IA "Think", Evroc proporciona inferencia compatible con [OpenAI](https://openai.com) para los modelos de código abierto más destacados, como Kimi, Llama y Mistral, con pleno cumplimiento del [RGPD](https://gdpr.eu) y soberanía europea de datos.

## Configuración

1. Cree una cuenta en [cloud.evroc.com](https://cloud.evroc.com).
2. Genere una clave de API en la Consola de Evroc en **Think > Models > + New**.
3. Conéctese en [OpenCode](https://opencode.ai) utilizando el sidecar incluido o la terminal:
   ```bash
   opencode
   ```
   Escriba `/connect`, seleccione **evroc** e ingrese su clave de API.
4. Seleccione su modelo activo con `/models`.

## Modelos recomendados

Evroc aloja modelos de pesos abiertos de alta capacidad optimizados para la programación y el razonamiento técnico:

| Modelo                    | ID                                                                          | Creador                            | Puntos fuertes                                                       |
| :------------------------ | :-------------------------------------------------------------------------- | :--------------------------------- | :------------------------------------------------------------------- |
| **Kimi K3 / K2.5**        | `moonshotai/Kimi-K3`, `moonshotai/Kimi-K2.5`                                | [Moonshot AI](https://moonshot.cn) | Razonamiento multifichero excepcional y código de contexto extenso   |
| **Mistral Large / Small** | `mistralai/Mistral-Large-2411`, `mistralai/Mistral-Small-24B-Instruct-2501` | [Mistral AI](https://mistral.ai)   | Generación y verificación de código rápida y precisa                 |
| **Llama 3.3 70B**         | `meta-llama/Llama-3.3-70B-Instruct`                                         | [Meta AI](https://llama.meta.com)  | Amplio conocimiento de programación, documentación y refactorización |

> [!TIP]
> Busque modelos con la etiqueta **Code** en la consola de Evroc para obtener los mejores resultados en tareas de programación.

## Uso con Tendril

Puede enrutar la ejecución de planes de Tendril v2 a través de Evroc de dos maneras:

### Opción A: A través de OpenCode integrado

1. En la aplicación de escritorio Tendril, vaya a **Settings > Coding Agent**.
2. Seleccione **OpenCode** como su agente de programación (consulte [Agente OpenCode](../06_CodingAgents/04_OpenCode.md)).
3. Tendril invoca el sidecar integrado de [OpenCode](https://opencode.ai) (`binaries/opencode`), que enruta las solicitudes a través de su proveedor Evroc autenticado.

### Opción B: Endpoint personalizado de OpenAI en `config.yaml`

Dado que Evroc ofrece una interfaz compatible con OpenAI, puede configurarlo directamente en `codingAgents` en `~/.tendril/config.yaml` (consulte [Instalación de la configuración](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-evroc-api-key"
      OPENAI_BASE_URL: "https://api.evroc.com/v1"
    profiles:
      - name: deep
        model: "moonshotai/Kimi-K3"
        effort: high
      - name: balanced
        model: "moonshotai/Kimi-K2.5"
        effort: medium
      - name: quick
        model: "mistralai/Mistral-Small-24B-Instruct-2501"
        effort: low
```

## Enlaces

- [Proveedores de modelos](_Index.md)
- [Agentes de programación](../06_CodingAgents/_Index.md)
- [Consola en la nube de Evroc](https://cloud.evroc.com)
- [Documentación de Evroc + OpenCode](https://docs.evroc.com/integrations/opencode.html)
