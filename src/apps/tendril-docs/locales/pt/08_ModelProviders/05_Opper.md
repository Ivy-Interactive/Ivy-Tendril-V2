---
title: Opper.ai
description: Gateway de IA que oferece acesso a mais de 300 modelos da
  Anthropic, OpenAI, Google e provedores de pesos abertos com opções de
  residência de dados na UE.
icon: Server
searchHints:
  - opper
  - gateway
  - ue
  - multi-provedor
  - roteador
---

# Opper.ai

O [Opper.ai](https://opper.ai) é um gateway de IA corporativo com sede na Europa que oferece acesso unificado a mais de 300 modelos de fundação da [Anthropic](https://www.anthropic.com), [OpenAI](https://openai.com), [Google AI](https://ai.google.dev), [Mistral AI](https://mistral.ai) e ecossistemas de código aberto. O Opper conta com roteamento automático de fallback, otimização de latência e controles rigorosos de residência de dados na UE.

## Configuração via Opper CLI

1. Instale o Opper CLI (requer [Node.js](https://nodejs.org)):
   ```bash
   npm i -g @opperai/cli
   ```
2. Faça login usando o OAuth do navegador:
   ```bash
   opper login
   ```
3. Inicie o [OpenCode](https://opencode.ai) através do Opper:
   ```bash
   opper launch opencode
   ```

A autenticação é gerenciada pela sessão do Opper CLI; chaves de API individuais dos provedores não são necessárias.

## Alternando Modelos

Você pode especificar um modelo no momento da inicialização usando a flag `--model`:

```bash
opper launch opencode --model anthropic/claude-sonnet-5
```

Ou alternar modelos de forma interativa durante uma sessão ativa do OpenCode usando `/models`.

## Usando com o Tendril

### Opção A: Via OpenCode Integrado

1. No aplicativo desktop do Tendril, navegue até **Settings > Coding Agent**.
2. Defina o **OpenCode** como seu agente de programação ativo (consulte [OpenCode Agent](../06_CodingAgents/04_OpenCode.md)).
3. O Tendril despacha a execução através do OpenCode, roteado via Opper.

### Opção B: Gateway Direto no `config.yaml`

O Opper também expõe um gateway compatível com a OpenAI em `https://api.opper.ai/v1`. Você pode configurar o Tendril para se conectar diretamente fornecendo sua chave de API do Opper em `~/.tendril/config.yaml` (consulte [Configuration Setup](../03_Configuration/01_Setup.md)):

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
> O Opper armazena automaticamente em cache os prefixos de prompts e roteia consultas para regiões de dados europeias quando as políticas de residência na UE estão ativadas no seu painel do Opper.

## Links

- [Model Providers](_Index.md)
- [Coding Agents](../06_CodingAgents/_Index.md)
- [Opper Platform](https://opper.ai)
- [Opper Agent CLI Documentation](https://opper.ai/agent-cli)
