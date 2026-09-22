---
title: OpenCode
description: O OpenCode é um agente de programação alternativo que suporta
  múltiplos provedores de modelos por meio de uma CLI unificada.
icon: Cpu
searchHints:
  - opencode
  - open code
  - agente de programação
---

# OpenCode

## Configuração

Defina o OpenCode como seu agente de programação no `config.yaml`:

```yaml
codingAgent: opencode
```

Ou selecione-o em **Settings > Coding Agent**.

Para mais detalhes sobre a estrutura e as configurações do `config.yaml`, consulte [Setup & Settings](../03_Configuration/01_Setup.md).

## Requisitos

- **Sidecar Integrado**: O Tendril inclui o [OpenCode](https://opencode.ai) como um sidecar integrado junto ao aplicativo desktop e o prefere automaticamente em relação a qualquer versão no PATH. Nenhuma instalação manual é necessária em novas configurações.
- **Instalação Avulsa** (opcional): Se desejar instalar ou executar uma cópia avulsa:
  ```bash
  curl -fsSL https://opencode.ai/install | bash
  ```
- **Autenticação**: Execute `opencode providers login` (ou `opencode auth login`) para se autenticar com o provedor selecionado (por exemplo, [Anthropic](https://www.anthropic.com), [OpenAI](https://openai.com), [Google AI](https://ai.google.dev), [Groq](https://groq.com)).

## Perfis

O Tendril mapeia os níveis de esforço para os modelos do OpenCode:

| Perfil     | Modelo  | Esforço | Caso de Uso                                |
| ---------- | ------- | ------- | ------------------------------------------ |
| `deep`     | default | high    | Alterações complexas em múltiplos arquivos |
| `balanced` | default | medium  | Execução padrão de planos                  |
| `quick`    | default | low     | Correções simples e pequenas edições       |

Os níveis de esforço são mapeados diretamente para a flag `--variant` do OpenCode (`low`, `medium`, `high`, `max`).

O modelo padrão do catálogo é `moonshotai/Kimi-K3`. O OpenCode também suporta modelos fixos da Anthropic e da OpenAI, como `claude-fable-5-1`, `claude-opus-5`, `claude-opus-4-7`, `claude-sonnet-5`, `claude-sonnet-4-6` e `gpt-5.5`.

## Traga Seu Próprio LLM & Provedores

O OpenCode alimenta os cartões **Bring-Your-Own LLM** do Tendril em **Settings > Coding Agent**:

- **[OpenAI](https://openai.com)**: Aponta o OpenCode para `https://api.openai.com` com sua `OPENAI_API_KEY`.
- **[Anthropic](https://www.anthropic.com)**: Aponta o OpenCode para `https://api.anthropic.com/v1` com sua `ANTHROPIC_API_KEY`.
- **[Berget AI](../08_ModelProviders/01_Berget.md)**: Aponta o OpenCode para `https://api.berget.ai/v1` com sua chave de API da [Berget AI](https://berget.ai).
- **Endpoints Personalizados**: Configure URLs base e chaves personalizadas para qualquer proxy reverso compatível com OpenAI ou Anthropic. Para mais provedores, consulte [Model Providers](../08_ModelProviders/_Index.md).

O Tendril configura esses provedores de forma não destrutiva usando `OPENCODE_CONFIG_CONTENT`, garantindo que a sua configuração global `opencode.json` nunca seja sobrescrita.

## Configuração Local com [Ollama](https://ollama.com)

Ao executar o OpenCode com modelos locais do [Ollama](https://ollama.com), especifique a URL do servidor diretamente no `config.yaml`:

```yaml
codingAgents:
  - name: opencode
    environmentVariables:
      OLLAMA_HOST: "http://localhost:11434"
      OLLAMA_BASE_URL: "http://localhost:11434"
```
