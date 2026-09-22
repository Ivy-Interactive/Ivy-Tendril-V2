---
title: Cloudflare
description: Utilice Cloudflare Workers AI como proveedor de modelos y conéctese a los servidores MCP de Cloudflare para compilar e implementar Workers.
icon: Globe
searchHints:
  - cloudflare
  - workers ai
  - cf
  - edge
  - cloudflared
  - tuneles
---

# Cloudflare

[Cloudflare](https://www.cloudflare.com) ofrece computación perimetral (edge compute) global e inferencia de IA sin servidor a través de [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/). Los desarrolladores pueden ejecutar modelos de pesos abiertos rápidos y rentables (como [Llama de Meta](https://llama.meta.com)) en el edge mientras los combinan con las habilidades oficiales de [Model Context Protocol (MCP)](../09_Advanced/03_MCP.md) de Cloudflare para el desarrollo full-stack de [Cloudflare Workers](https://workers.cloudflare.com).

## Configuración a través de OpenCode

1. Inicie [OpenCode](https://opencode.ai) a través de la terminal o del PTY integrado de Tendril:
   ```bash
   opencode
   ```
   Escriba `/connect` y seleccione **Cloudflare**.
2. Complete la autorización en el navegador cuando se le solicite.
3. Seleccione un modelo activo con `/models`.

## Habilidades MCP de Cloudflare (Opcional)

Puede agregar servidores MCP de Cloudflare para dotar a su [agente de programación](../06_CodingAgents/_Index.md) de control directo sobre Cloudflare Workers, KV, bases de datos D1 e implementaciones (consulte [Habilidades](../06_CodingAgents/00_Skills.md)):

```bash
npx skills add https://github.com/cloudflare/skills
```

Una vez instalados, los agentes de programación que ejecutan planes de Tendril pueden crear enlaces (bindings), implementar scripts de workers e inspeccionar registros de edge en tiempo real de forma autónoma.

## Uso con Tendril

1. Abra Tendril y vaya a **Settings > Coding Agent**.
2. Configure su agente de programación en **OpenCode** (consulte [Agente OpenCode](../06_CodingAgents/04_OpenCode.md)).
3. Tendril enruta las tareas del plan a OpenCode, que invoca a Cloudflare Workers AI.

También puede orientarse a Cloudflare Workers AI a través de su endpoint compatible con [OpenAI](https://openai.com) en `~/.tendril/config.yaml` (consulte [Instalación de la configuración](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-cloudflare-api-token"
      OPENAI_BASE_URL: "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1"
    profiles:
      - name: deep
        model: "@cf/meta/llama-3.3-70b-instruct"
        effort: high
      - name: balanced
        model: "@cf/meta/llama-3.1-8b-instruct"
        effort: medium
      - name: quick
        model: "@cf/meta/llama-3.1-8b-instruct"
        effort: low
```

> [!NOTE]
> Además de la inferencia de modelos con Workers AI, Tendril v2 integra de forma nativa Cloudflare Quick Tunnels (`cloudflared`) para compartir planes de forma segura y en modo de solo lectura con sus compañeros de equipo. El uso compartido de túneles se configura por separado en **Settings > Security & Tunneling**.

## Enlaces

- [Proveedores de modelos](_Index.md)
- [Agentes de programación](../06_CodingAgents/_Index.md)
- [Documentación de Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
- [Guía de Cloudflare + OpenCode](https://developers.cloudflare.com/agent-setup/opencode/)
