# Guia de Configuração do Cursor para Tendril Skills

Este guia explica como instalar e configurar as Tendril Agent Skills no Cursor.

## 1. Instalação Rápida (CLI de Skills)

Instale as skills do Tendril no seu projeto do Cursor usando a CLI de skills:

```bash
# Instalação no nível do projeto (instala em .cursor/skills/)
npx skills add ivy-interactive/ivy-tendril-v2 --agent cursor

# Instalação global (em todos os espaços de trabalho do Cursor)
npx skills add ivy-interactive/ivy-tendril-v2 --agent cursor -g
```

## 2. Estrutura de Diretórios no Cursor

O Cursor busca definições de skills nos seguintes locais:

- **Nível do projeto**: `.cursor/skills/<skill-name>/SKILL.md`
- **Global / Nível de usuário**: `~/.cursor/skills/<skill-name>/SKILL.md` (macOS/Linux) ou `%USERPROFILE%\.cursor\skills\<skill-name>\SKILL.md` (Windows)

Cada pasta contém:
- `SKILL.md`: Instruções principais com frontmatter YAML
- Documentação de referência e scripts complementares

## 3. Interação com as Regras do Cursor (.cursorrules)

Você pode referenciar as skills do Tendril a partir dos arquivos `.cursorrules` ou `.cursor/rules/*.mdc` do seu projeto:

```markdown
Ao depurar planos com falha ou revisar alterações:
- Consulte src/skills/tendril-debug-plan para diagnóstico de execução do plano.
- Execute os procedimentos de src/skills/tendril-review antes de finalizar pull requests.
```

## 4. Uso no Chat do Agente do Cursor

Na janela de chat do agente do Cursor:
- Digite `@tendril-debug-plan` ou peça ao agente para inspecionar um plano usando suas instruções.
- Peça ao Cursor para executar `/tendril-review` no diff ativo do git.
- Execute `/tendrillable` para classificar issues de acordo com a adequação aos agentes.

## Licença

As skills e plugins do Tendril são licenciados sob a [Functional Source License (FSL-1.1-ALv2)](../../LICENSE) na raiz do repositório.
