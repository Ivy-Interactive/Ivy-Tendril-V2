---
title: Claude Code
description: O Claude Code é o agente de programação padrão no Tendril,
  alimentado pelos modelos Claude da Anthropic.
icon: Bot
searchHints:
  - claude
  - claude code
  - anthropic
  - agente de programação
  - agente de ia
---

# Claude Code

## Configuração

Defina o Claude Code como seu agente de programação no `config.yaml`:

```yaml
codingAgent: claude
```

Ou selecione-o em **Configurações > Agente de Programação**.

Para mais detalhes sobre a estrutura e as configurações do `config.yaml`, consulte [Instalação e Configurações](../03_Configuration/01_Setup.md).

## Requisitos

- A CLI do [Claude Code](https://code.claude.com/docs) deve estar instalada e disponível como `claude` no seu PATH. Use o instalador nativo ou o cask do [Homebrew](https://brew.sh):
  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  # ou: brew install --cask claude-code
  ```
- Autentique-se antes de usar o Tendril executando `claude auth login` (ou `claude login`). O Claude Code requer um plano [Anthropic](https://www.anthropic.com) Pro, Max, Team, Enterprise ou [Console](https://console.anthropic.com) (o nível gratuito do claude.ai não inclui acesso via CLI).
- Para ambientes headless ou backends alternativos, defina `ANTHROPIC_API_KEY`, ou configure o [AWS Bedrock](https://aws.amazon.com/bedrock/) (`CLAUDE_CODE_USE_BEDROCK=1`) ou o [Google Cloud Vertex AI](https://cloud.google.com/vertex-ai) (`CLAUDE_CODE_USE_VERTEX=1`).

## Perfis

O Tendril mapeia níveis de esforço para modelos Claude:

| Perfil     | Modelo | Esforço | Caso de Uso                                             |
| ---------- | ------ | ------- | ------------------------------------------------------- |
| `deep`     | opus   | max     | Alterações complexas em múltiplos arquivos, arquitetura |
| `balanced` | sonnet | high    | Execução de planos padrão, a maioria das tarefas        |
| `quick`    | haiku  | low     | Correções simples, formatação, pequenas edições         |

O perfil é selecionado automaticamente com base no [nível de complexidade do plano](../02_Concepts/01_Plans.md), ou pode ser configurado por [promptware](../02_Concepts/02_Promptwares.md) no `config.yaml`.

## Modelos disponíveis

| Modelo           | ID                 | Janela de Contexto | Preço (entrada / saída por MTok) |
| ---------------- | ------------------ | ------------------ | -------------------------------- |
| Claude Fable 5.1 | `claude-fable-5-1` | 1M                 | $10.00 / $50.00                  |
| Claude Opus 5    | `claude-opus-5`    | 1M                 | $5.00 / $25.00                   |
| Claude Opus      | `opus`             | 1M                 | $5.00 / $25.00                   |
| Claude Sonnet 5  | `claude-sonnet-5`  | 1M                 | $2.00 / $10.00                   |
| Claude Sonnet    | `sonnet`           | 1M                 | $2.00 / $10.00                   |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200k               | $1.00 / $5.00                    |
| Claude Haiku     | `haiku`            | 200k               | $1.00 / $5.00                    |

`opus`, `sonnet` e `haiku` são aliases do Claude Code que acompanham o modelo atual da Anthropic para aquele nível, enquanto `claude-opus-5` (o padrão do catálogo) e `claude-fable-5-1` são IDs fixos.

O preço promocional de lançamento do Claude Sonnet de $2.00 / $10.00 é válido até 31/08/2026; o preço padrão de $3.00 / $15.00 será aplicado depois.

## Plugin de Skills do Tendril

Você pode instalar skills oficiais de engenharia e depuração do Tendril como um plugin do Claude Code:

```
/plugin marketplace add ivy-interactive/ivy-tendril-v2
/plugin install tendril-skills@ivy-tendril-v2
```

Durante o desenvolvimento e testes locais, carregue as skills diretamente a partir do seu checkout:

```bash
claude --plugin-dir /path/to/ivy-tendril-v2
```

Para mais detalhes, consulte [Skills do Agente](00_Skills.md).
