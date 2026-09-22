---
title: Copilot
description: O Copilot é um agente de programação alternativo desenvolvido com a
  CLI do GitHub Copilot.
icon: Bot
searchHints:
  - copilot
  - github
  - agente de programação
---

# Copilot

## Configuração

Defina o Copilot como seu agente de programação no `config.yaml`:

```yaml
codingAgent: copilot
```

Ou selecione-o em **Settings > Coding Agent**.

Para mais detalhes sobre a estrutura e configurações do `config.yaml`, consulte [Configuração e Definições](../03_Configuration/01_Setup.md).

## Requisitos

- A [GitHub Copilot CLI](https://github.com/features/copilot) deve estar disponível como `copilot` no seu PATH. Instale usando o script oficial ou o cask do [Homebrew](https://brew.sh):
  ```bash
  curl -fsSL https://gh.io/copilot-install | bash
  # ou: brew install --cask copilot-cli
  ```
  O Tendril recorre automaticamente a `gh copilot` se o binário avulso `copilot` não for encontrado, mas a [GitHub CLI](https://cli.github.com) (`gh`) estiver instalada.
- É necessária uma assinatura ativa do [GitHub Copilot](https://github.com/features/copilot).
- **Autenticação**: O Copilot não possui um comando CLI `login` e não compartilha credenciais com `gh auth login`. Para fazer login:
  1. Inicie a CLI no seu terminal: `copilot`
  2. No prompt, execute o comando com barra: `/login`
  3. Para ambientes de CI headless ou não assistidos, defina a variável de ambiente `COPILOT_GITHUB_TOKEN` (ou `GH_TOKEN`) com um token de acesso pessoal que possua a permissão `Copilot Requests`.

## Perfis

O Tendril mapeia os níveis de esforço para o Copilot:

| Perfil     | Modelo  | Esforço | Caso de Uso                                |
| ---------- | ------- | ------- | ------------------------------------------ |
| `deep`     | gpt-5.4 | high    | Alterações complexas em múltiplos arquivos |
| `balanced` | gpt-5.4 | medium  | Execução padrão de planos                  |
| `quick`    | gpt-5.4 | low     | Correções simples e pequenas edições       |

O perfil é selecionado automaticamente com base no [nível de complexidade do plano](../02_Concepts/01_Plans.md), ou pode ser configurado por [promptware](../02_Concepts/02_Promptwares.md) no `config.yaml`.

O modelo padrão para o Copilot no Tendril é o `gpt-5.4`.

### Modelos Suportados

O GitHub Copilot suporta modelos da OpenAI e da Anthropic por meio de seu runtime:

- **Modelos [OpenAI](https://openai.com)**: `gpt-5.4` (padrão), `gpt-5.4-mini`, `gpt-5.3-codex`, `gpt-5.2-codex`, `gpt-5.2`, `gpt-5-mini`, `gpt-4.1` (esforço de raciocínio: `low`, `medium`, `high`, `xhigh`).
- **Modelos [Anthropic Claude](https://code.claude.com/docs)**: `claude-fable-5-1`, `claude-opus-5`, `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-sonnet-4-5`, `claude-haiku-4-5` (esforço de raciocínio: `low`, `medium`, `high`, `xhigh`, `max`).

## Instalando Skills do Tendril para o GitHub Copilot

O Tendril fornece skills especializadas para o GitHub Copilot no [Visual Studio Code](https://code.visualstudio.com), abrangendo depuração de planos, inspeção de artefatos de tarefas, revisões de código e triagem de issues.

### Usando a Skills CLI

Instale skills para o seu workspace:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot
```

Ou instale globalmente em todos os workspaces:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot -g
```

### Posicionamento Manual em `.agents/skills/`

As skills também podem ser colocadas diretamente no diretório `.agents/skills/`, `.github/skills/` ou `~/.copilot/skills/`:

```bash
mkdir -p .agents/skills
cp -r /path/to/skills/* .agents/skills/
```

Depois de instaladas, as skills aparecem no GitHub Copilot Chat no menu `/skills` e podem ser invocadas diretamente como comandos com barra (ex.: `/tendril-debug-plan`, `/tendril-review`).

Para mais detalhes, consulte [Skills do Agente](00_Skills.md).
