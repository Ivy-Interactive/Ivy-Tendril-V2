---
title: Habilidades de Agente
description: As Habilidades de Agente do Tendril empacotam fluxos de trabalho de
  engenharia, depuração e revisão para agentes autônomos de codificação com IA
  no Visual Studio Code, Claude Code, Antigravity, Cursor, OpenAI Codex e Gemini
  CLI.
icon: Sparkles
searchHints:
  - habilidades
  - habilidades de agente
  - plugins
  - copilot
  - claude
  - antigravity
  - cursor
  - codex
  - gemini
---

# Habilidades de Agente

## Visão Geral

As habilidades de agente seguem a especificação aberta de habilidades de agentes. Cada habilidade fornece instruções estruturadas, listas de verificação de referência e scripts de automação que orientam os agentes de codificação em tarefas complexas:

- `tendril-debug-plan`: Aprofunda-se em [logs de planos](../02_Concepts/01_Plans.md), sessões JSONL, execuções de verificação e modos de falha.
- `tendril-debug-job`: Analisa artefatos brutos de execução do agente e logs de [promptware](../02_Concepts/02_Promptwares.md) na [visualização de Trabalhos](../04_Apps/04_Jobs.md).
- `tendril-review`: Realiza revisões completas de código pós-implementação, análise de lacunas de testes e verificações de limpeza.
- `tendrillable`: Classifica issues do [GitHub](../07_Integrations/01_Github.md) quanto à prontidão para execução por agentes autônomos.
- `tendril-release`: Automatiza atualizações de pacotes, controle de versão, pull requests e lançamentos de implantação.
- `tendril-extension`: Cria, testa, empacota e vincula a extensão Ivy Tendril no [VS Code](https://code.visualstudio.com) e no Antigravity IDE.

## Instalação Universal

Instale habilidades para qualquer agente suportado usando a CLI universal de habilidades:

```bash
# Install all skills
npx skills add ivy-interactive/ivy-tendril-v2

# Install an individual skill
npx skills add ivy-interactive/ivy-tendril-v2 --skill tendril-debug-plan
```

## Integrações com Agentes

### Visual Studio Code ([GitHub Copilot](03_Copilot.md) e Extensões de IA)

Instale habilidades direcionadas diretamente ao [GitHub Copilot](https://github.com/features/copilot) no [VS Code](https://code.visualstudio.com):

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot
```

Ou instale globalmente em todos os espaços de trabalho:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot -g
```

As habilidades são armazenadas em `.agents/skills/` (ou `~/.copilot/skills/`) e aparecem no Copilot Chat sob o menu `/skills`. Você também pode direcionar para extensões complementares:

- [Cline](https://github.com/cline/cline): `npx skills add ivy-interactive/ivy-tendril-v2 --agent cline`
- [Continue](https://continue.dev): `npx skills add ivy-interactive/ivy-tendril-v2 --agent continue`
- [Roo Code](https://github.com/RooVetGit/Roo-Code): `npx skills add ivy-interactive/ivy-tendril-v2 --agent roo`

Para detalhes do guia complementar, consulte [Configuração do VS Code](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/vscode-setup.md).

### [Claude Code](01_ClaudeCode.md)

Instale através do marketplace de plugins do [Claude Code](https://code.claude.com/docs):

```
/plugin marketplace add ivy-interactive/ivy-tendril-v2
/plugin install tendril-skills@ivy-tendril-v2
```

Para testes locais, inicie o Claude Code apontando para o seu checkout local:

```bash
claude --plugin-dir /path/to/ivy-tendril-v2
```

Para detalhes do guia complementar, consulte [Configuração do Claude Code](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/claude-setup.md).

### Google Antigravity

Instale usando a CLI do [Antigravity](https://antigravity.google) (`agy`):

```bash
agy plugin install https://github.com/ivy-interactive/ivy-tendril-v2.git
```

Ou a partir de um checkout local:

```bash
agy plugin install ./
```

Para detalhes do guia complementar, consulte [Configuração do Antigravity](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/antigravity-setup.md).

### [Cursor](https://cursor.com)

Instale direcionado ao [Cursor](https://cursor.com):

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent cursor
```

Ou coloque as habilidades em `.cursor/skills/`. Para detalhes do guia complementar, consulte [Configuração do Cursor](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/blob/development/docs/cursor-setup.md).

### [OpenAI Codex](02_Codex.md)

Adicione o marketplace e instale o plugin no [Codex](https://chatgpt.com/codex):

```bash
codex plugin marketplace add ivy-interactive/ivy-tendril-v2
codex plugin add tendril-skills@tendril-skills
```

### [Gemini CLI](05_Gemini.md)

Instale habilidades diretamente usando a [Gemini CLI](https://github.com/google-gemini/gemini-cli):

```bash
gemini skills install https://github.com/ivy-interactive/ivy-tendril-v2.git --path src/skills
```
