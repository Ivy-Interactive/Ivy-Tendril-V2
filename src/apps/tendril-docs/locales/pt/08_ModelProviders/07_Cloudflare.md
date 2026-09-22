---
title: Cloudflare
description: Use o Cloudflare Workers AI como provedor de modelos e conecte-se
  aos servidores MCP da Cloudflare para criar e implantar Workers.
icon: Globe
searchHints:
  - cloudflare
  - workers ai
  - cf
  - edge
  - cloudflared
  - tunnels
---

# Cloudflare

A [Cloudflare](https://www.cloudflare.com) fornece computação de borda (edge compute) global e inferência de IA sem servidor (serverless) por meio do [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/). Desenvolvedores podem executar modelos abertos (open-weight) rápidos e econômicos (como o [Llama da Meta](https://llama.meta.com)) na borda, combinando-os com habilidades oficiais do [Model Context Protocol (MCP)](../09_Advanced/03_MCP.md) da Cloudflare para o desenvolvimento full-stack no [Cloudflare Workers](https://workers.cloudflare.com).

## Configuração via OpenCode

1. Inicie o [OpenCode](https://opencode.ai) pelo terminal ou pelo PTY integrado do Tendril:
   ```bash
   opencode
   ```
   Digite `/connect` e selecione **Cloudflare**.
2. Conclua a autorização no navegador quando solicitado.
3. Selecione um modelo ativo com `/models`.

## Habilidades MCP da Cloudflare (Opcional)

Você pode adicionar servidores MCP da Cloudflare para equipar seu [agente de codificação](../06_CodingAgents/_Index.md) com controle direto sobre Cloudflare Workers, KV, bancos de dados D1 e implantações (consulte [Habilidades](../06_CodingAgents/00_Skills.md)):

```bash
npx skills add https://github.com/cloudflare/skills
```

Após a instalação, os agentes de codificação que executam planos do Tendril podem criar vinculações (bindings), implantar scripts de workers e inspecionar logs de borda em tempo real de forma autônoma.

## Usando com o Tendril

1. Abra o Tendril e navegue até **Configurações > Agente de Codificação**.
2. Defina seu agente de codificação como **OpenCode** (consulte [Agente OpenCode](../06_CodingAgents/04_OpenCode.md)).
3. O Tendril roteia as tarefas do plano para o OpenCode, que faz as chamadas para o Cloudflare Workers AI.

Você também pode direcionar para o Cloudflare Workers AI por meio de seu endpoint compatível com a [OpenAI](https://openai.com) no `~/.tendril/config.yaml` (consulte [Instalação e Configuração](../03_Configuration/01_Setup.md)):

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
> Além da inferência de modelos do Workers AI, o Tendril v2 integra nativamente os Cloudflare Quick Tunnels (`cloudflared`) para compartilhamento seguro e somente leitura de planos com colegas de equipe. O compartilhamento por túneis é configurado separadamente em **Configurações > Segurança e Túneis**.

## Links

- [Provedores de Modelos](_Index.md)
- [Agentes de Codificação](../06_CodingAgents/_Index.md)
- [Documentação do Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
- [Guia do Cloudflare + OpenCode](https://developers.cloudflare.com/agent-setup/opencode/)
