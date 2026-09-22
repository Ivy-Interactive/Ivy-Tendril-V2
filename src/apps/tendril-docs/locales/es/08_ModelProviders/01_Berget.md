---
title: Berget AI
description: Proveedor europeo de infraestructura de IA que ofrece modelos Kimi y GLM con residencia completa de datos en la UE y soporte nativo de tarjeta BYO en Tendril v2.
icon: Server
searchHints:
  - berget
  - ue
  - europeo
  - kimi
  - glm
  - moonshot
---

# Berget AI

[Berget AI](https://berget.ai) es un proveedor europeo de infraestructura de IA que ofrece inferencia de LLM soberana y de alto rendimiento con residencia garantizada de datos en la UE (Suecia). Berget proporciona endpoints compatibles con [OpenAI](https://openai.com) que alojan modelos de pesos abiertos de última generación, incluidos Kimi K3 de [Moonshot AI](https://moonshot.cn) y la familia GLM de [Zhipu AI](https://open.bigmodel.cn), cumpliendo plenamente con el [RGPD](https://gdpr.eu).

En Tendril v2, Berget AI es compatible tanto mediante una tarjeta nativa **Bring Your Own LLM** en la aplicación de escritorio como a través del sidecar integrado de [OpenCode](https://opencode.ai).

## Configuración a través de Tendril Desktop

La forma más sencilla de utilizar Berget AI es mediante la tarjeta BYO nativa en los ajustes de escritorio:

1. Cree una cuenta y genere una clave de API en [console.berget.ai](https://console.berget.ai).
2. Abra Tendril y vaya a **Settings > Coding Agent**.
3. En **Bring Your Own LLM**, haga clic en la tarjeta **Berget AI**.
4. Pegue su clave de API en el campo **API Key** y haga clic en **Save**.

> [!NOTE]
> No hay ningún campo de URL base para configurar Berget en la interfaz. Tendril v2 fija automáticamente el endpoint en `https://api.berget.ai/v1` y enruta las solicitudes a través del sidecar integrado de [OpenCode](../06_CodingAgents/04_OpenCode.md).

## Configuración manual en `config.yaml`

También puede configurar Berget AI directamente en `~/.tendril/config.yaml` (consulte [Instalación de la configuración](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "sk-berget-..."
      OPENAI_BASE_URL: "https://api.berget.ai/v1"
      ANTHROPIC_API_KEY: "sk-berget-..."
      ANTHROPIC_BASE_URL: "https://api.berget.ai"
    profiles:
      - name: deep
        model: "moonshotai/Kimi-K3"
        effort: max
      - name: balanced
        model: "moonshotai/Kimi-K3"
        effort: high
      - name: quick
        model: "moonshotai/Kimi-K3"
        effort: low
```

## Modelos recomendados

El solucionador de perfiles de Tendril v2 asigna Berget AI directamente a Kimi K3 en todos los niveles:

| Nivel        | ID de modelo         | Esfuerzo predeterminado | Propósito                                                                      |
| :----------- | :------------------- | :---------------------- | :----------------------------------------------------------------------------- |
| **Deep**     | `moonshotai/Kimi-K3` | `max`                   | Planificación arquitectónica, razonamiento complejo, refactorizaciones grandes |
| **Balanced** | `moonshotai/Kimi-K3` | `high`                  | Ejecución estándar de planes y generación de código                            |
| **Quick**    | `moonshotai/Kimi-K3` | `low`                   | Verificación rápida, resúmenes de commits, informes de estado                  |

Berget también ofrece modelos de la familia GLM (como `GLM-4.7`). Puede configurar cualquier ID de modelo de Berget disponible en su configuración de perfil o seleccionarlo con `/models` en [OpenCode](../06_CodingAgents/04_OpenCode.md).

## Configuración a través de la CLI de OpenCode

De forma alternativa, puede configurar Berget a través de OpenCode:

1. Ejecute la utilidad de configuración de Berget:
   ```bash
   npx berget code init
   ```
2. Inicie OpenCode:
   ```bash
   opencode
   ```
3. Establezca su agente activo en Tendril en OpenCode bajo **Settings > Coding Agent** (`codingAgent: opencode`).

> [!TIP]
> Tendril v2 incluye el binario de [OpenCode](https://opencode.ai) preinstalado (`binaries/opencode`). No necesita instalar Node.js u OpenCode globalmente en su sistema para usar Berget con Tendril. Obtenga más información en la [Guía del agente OpenCode](../06_CodingAgents/04_OpenCode.md).

## Enlaces

- [Proveedores de modelos](_Index.md)
- [Agentes de programación](../06_CodingAgents/_Index.md)
- [Página principal de Berget AI](https://berget.ai)
- [Consola de Berget](https://console.berget.ai)
- [Documentación de Berget + OpenCode](https://docs.berget.ai/integrations/opencode)
