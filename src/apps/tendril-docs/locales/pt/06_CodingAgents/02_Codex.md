---
title: Codex
description: O Codex é um agente de codificação alternativo alimentado pelos
  modelos GPT da OpenAI.
icon: Terminal
searchHints:
  - codex
  - openai
  - gpt
  - agente de codificação
---

# Codex

## Configuração

Defina o Codex como seu agente de codificação no `config.yaml`:

```yaml
codingAgent: codex
```

Ou selecione-o em **Configurações > Agente de Codificação** (Settings > Coding Agent).

Para mais detalhes sobre a estrutura e configurações do `config.yaml`, consulte [Configuração & Definições](../03_Configuration/01_Setup.md).

## Requisitos

- A CLI do [Codex](https://chatgpt.com/codex) deve estar instalada e disponível como `codex` no seu PATH. Instale usando o script oficial ou o cask do [Homebrew](https://brew.sh):
  ```bash
  curl -fsSL https://chatgpt.com/codex/install.sh | sh
  # or: brew install --cask codex
  ```
- Autentique-se antes de usar o Tendril executando:
  ```bash
  codex login
  ```
  Para ambientes headless ou não assistidos, forneça uma [chave de API da plataforma OpenAI](https://platform.openai.com/api-keys) via stdin:
  ```bash
  printenv OPENAI_API_KEY | codex login --with-api-key
  ```

## Perfis

O Tendril mapeia níveis de esforço para os modelos do Codex:

| Perfil     | Modelo        | Esforço | Caso de Uso                                |
| ---------- | ------------- | ------- | ------------------------------------------ |
| `deep`     | gpt-5.6-sol   | high    | Alterações complexas em múltiplos arquivos |
| `balanced` | gpt-5.6-terra | medium  | Execução padrão de planos                  |
| `quick`    | gpt-5.6-luna  | low     | Correções simples e pequenas edições       |

O perfil é selecionado automaticamente com base no [nível de complexidade do plano](../02_Concepts/01_Plans.md), ou pode ser configurado por [promptware](../02_Concepts/02_Promptwares.md) no `config.yaml`.

O modelo padrão para o Codex no Tendril é o `gpt-5.6-terra`.

### Modelos Suportados & Esforço de Raciocínio

O catálogo do Codex suporta os seguintes modelos da [OpenAI](https://openai.com):

- `gpt-6-astra`
- `gpt-5.6-sol`
- `gpt-5.6-terra` (padrão)
- `gpt-5.6-luna`
- `gpt-5.5`
- `gpt-5.4` / `gpt-5.4-mini`
- `gpt-5.3-codex`
- `o3` / `o4-mini`
- `gpt-4.1`
- `codex-mini`

O Codex suporta cinco níveis de esforço de raciocínio: `none`, `low`, `medium`, `high` e `xhigh`. O nível `none` permite executar o Codex sem sobrecarga de raciocínio para edições rápidas.

## Execução & Sandboxing

O Tendril inicia o Codex via `codex exec` em modo não interativo:

- O sandboxing tem como padrão `--sandbox workspace-write` com acesso à rede habilitado. Quando o modo sandbox está desabilitado nas configurações de segurança do projeto, o Tendril passa `danger-full-access`.
- Caminhos permitidos adicionais das regras de segurança são fornecidos via `--add-dir`.
- Servidores [MCP (Model Context Protocol)](https://modelcontextprotocol.io) configurados são gravados em uma configuração JSON temporária e fornecidos via `--mcp-config`.
