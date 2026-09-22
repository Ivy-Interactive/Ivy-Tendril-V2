---
title: Vercel AI Gateway
description: Encaminhe requisições através do AI Gateway da Vercel para acesso
  unificado a modelos da OpenAI, Anthropic, Google e de pesos abertos com
  observabilidade integrada.
icon: Zap
searchHints:
  - vercel
  - ai gateway
  - unificado
  - observabilidade
---

# Vercel AI Gateway

O [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) fornece um proxy unificado para roteamento de requisições de inferência entre os principais provedores de modelos, incluindo [Anthropic](https://www.anthropic.com), [OpenAI](https://openai.com), [Google AI](https://ai.google.dev) e [xAI](https://x.ai). Ele oferece gerenciamento centralizado de chaves de API, edge caching, telemetria em tempo real e proteções de limite de taxa (rate limit).

## Configuração via OpenCode

1. Crie uma chave de API no [Vercel Dashboard](https://vercel.com) em **AI Gateway > API keys** da sua equipe.
2. Conecte-se no [OpenCode](https://opencode.ai) usando o terminal ou o PTY integrado do Tendril:
   ```bash
   opencode
   ```
   Digite `/connect`, procure por **Vercel AI Gateway** e insira sua chave de API.
3. Alterne seu modelo ativo usando `/models`.

### Regras de Roteamento (`opencode.json`)

Você pode definir a ordem de failover e as preferências de roteamento diretamente em `opencode.json`:

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

## Usando com o Tendril

### Opção A: Via OpenCode Integrado

1. No aplicativo desktop do Tendril, acesse **Settings > Coding Agent**.
2. Selecione **OpenCode** como seu agente ativo (consulte [Agente OpenCode](../06_CodingAgents/04_OpenCode.md)).
3. O Tendril roteia toda a execução de planos através do sidecar integrado do [OpenCode](https://opencode.ai) conectado ao Vercel AI Gateway.

### Opção B: Gateway Direto em `config.yaml`

O Vercel AI Gateway fornece um endpoint de API compatível com [OpenAI](https://openai.com) em `https://ai-gateway.vercel.sh/v1`. Você pode configurar o Tendril para rotear diretamente por ele em `~/.tendril/config.yaml` (consulte [Configuração](../03_Configuration/01_Setup.md)):

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

## Monitoramento e Telemetria

Métricas de uso, consumo de tokens e detalhamento de latência são registrados automaticamente no painel da Vercel em **AI Gateway > Analytics**, complementando o livro-razão local de tokens do Tendril.

## Links

- [Provedores de Modelos](_Index.md)
- [Agentes de Codificação](../06_CodingAgents/_Index.md)
- [Documentação do Vercel AI Gateway](https://vercel.com/docs/ai-gateway)
- [Guia Vercel + OpenCode](https://vercel.com/docs/ai-gateway/coding-agents/opencode)
