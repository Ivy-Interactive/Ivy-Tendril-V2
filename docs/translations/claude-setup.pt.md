# Guia de Configuração do Claude Code para Tendril Skills

Este guia aborda a instalação, configuração e teste das Tendril Agent Skills no Claude Code.

## 1. Instalação via Marketplace de Plugins

O Tendril fornece manifestos oficiais de plugins em `.claude-plugin/marketplace.json` e `.claude-plugin/plugin.json`.

No Claude Code, adicione o repositório Ivy-Tendril-V2 como fonte do marketplace:

```
/plugin marketplace add ivy-interactive/ivy-tendril-v2
```

Em seguida, instale o plugin `tendril-skills`:

```
/plugin install tendril-skills@ivy-tendril-v2
```

## 2. Desenvolvimento e Testes Locais

Ao desenvolver skills localmente ou testar alterações antes de enviá-las:

Inicie o Claude Code com o diretório de plugins apontando para o seu checkout local do repositório:

```bash
claude --plugin-dir /path/to/ivy-tendril-v2
```

O Claude Code lerá `.claude-plugin/plugin.json` e carregará automaticamente todas as skills definidas em `skills/`.

## 3. Compatibilidade com Versões Anteriores (.claude/skills)

Para fluxos de trabalho locais no repositório Ivy-Tendril-V2:
- Links simbólicos em `.claude/skills/<skill-name>` apontam para `../../skills/<skill-name>`.
- Qualquer configuração local existente do Claude Code que referencie `.claude/skills/` continuará funcionando perfeitamente sem reconfiguração manual.

## 4. Invocação de Skills no Claude Code

Depois de instalado, use comandos de barra (slash commands) diretamente na sua sessão do Claude Code:

- `/tendril-debug-plan <plan-id>`: Depurar planos com falha ou lentos.
- `/tendril-debug-job <job-id>`: Inspecionar artefatos de tarefas e registros de decisão do agente.
- `/tendril-review`: Executar verificações de qualidade de código e regressão nas alterações atuais.
- `/tendrillable <url>`: Classificar issues do backlog de acordo com rubricas de agentes autônomos.
- `/tendril-release`: Automatizar incrementos de versão, atualizações de dependências e fluxos de lançamento.

## Licença

As skills e plugins do Tendril são licenciados sob a [Functional Source License (FSL-1.1-ALv2)](../../LICENSE) na raiz do repositório.
