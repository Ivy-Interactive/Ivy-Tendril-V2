---
title: OpenRouter
description: Gateway de API unificado que oferece acesso a modelos da Anthropic,
  OpenAI, Google, xAI, Meta, DeepSeek e muito mais.
icon: Globe
searchHints:
  - openrouter
  - roteador
  - multi-provedor
  - gateway
---

# OpenRouter

O [OpenRouter](https://openrouter.ai) oferece um gateway de API unificado e compatível com a [OpenAI](https://openai.com), disponibilizando acesso a centenas de modelos de ponta da [Anthropic](https://www.anthropic.com), [OpenAI](https://openai.com), [Google DeepMind](https://deepmind.google), [Meta AI](https://ai.meta.com), [Mistral AI](https://mistral.ai), [DeepSeek](https://www.deepseek.com) e [xAI](https://x.ai). O OpenRouter oferece preços competitivos por token, fallbacks automáticos entre provedores e métricas de uso abrangentes.

## Configuração via OpenCode

1. Crie uma chave de API em [openrouter.ai/keys](https://openrouter.ai/keys) (as chaves começam com `sk-or-`).
2. Inicie o [OpenCode](https://opencode.ai) pelo terminal ou pelo terminal integrado do Tendril:
   ```bash
   opencode
   ```
   Digite `/connect`, selecione **OpenRouter** e cole sua chave de API.
3. Alterne seu modelo ativo usando `/models`.

### Configuração do Projeto (`opencode.json`)

Você pode definir modelos padrão no nível do projeto em `opencode.json`:

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

## Usando com o Tendril

Você pode conectar o Tendril v2 diretamente ao OpenRouter usando a interface do desktop ou o arquivo `config.yaml`.

### Opção A: Configurações no Desktop (Bring Your Own LLM)

1. Navegue até **Settings > Coding Agent** no aplicativo do Tendril.
2. Em **Bring Your Own LLM**, clique no card **OpenAI**.
3. Defina a **Base URL** como `https://openrouter.ai/api/v1`.
4. Insira sua chave do OpenRouter (`sk-or-...`) em **API Key** e clique em **Save**.

### Opção B: Configuração Manual no `config.yaml`

Configure o OpenRouter em `codingAgents` no arquivo `~/.tendril/config.yaml` (consulte [Configuração de Instalação](../03_Configuration/01_Setup.md)):

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
> Os IDs de modelos do OpenRouter incluem prefixos de provedores (por exemplo, `anthropic/claude-opus-5` ou `deepseek/deepseek-r1`). Esses prefixos devem ser incluídos exatamente como estão nos campos `model` do seu perfil.

## Links

- [Provedores de Modelos](_Index.md)
- [Agentes de Código](../06_CodingAgents/_Index.md)
- [Plataforma OpenRouter](https://openrouter.ai)
- [Guia de Integração OpenRouter + OpenCode](https://openrouter.ai/docs/cookbook/coding-agents/opencode-integration)
