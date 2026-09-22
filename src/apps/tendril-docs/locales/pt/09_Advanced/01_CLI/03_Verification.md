---
title: verificação
description: Gerencie definições globais de verificação armazenadas em
  config.yaml. Elas podem ser referenciadas por projetos e planos.
icon: ClipboardCheck
searchHints:
  - verificação
  - verificar
  - checar
  - prompt
  - definição
  - gates
---

# verificação

Gerencie definições globais de verificação armazenadas em `config.yaml`. Os gates de verificação definem checagens automatizadas de qualidade, compilação e teste que os agentes de codificação devem satisfazer antes que um [plano](01_Plan.md) possa transicionar para `Completed`. Eles são atribuídos a projetos via [`tendril project add-verification`](02_Project.md#verifications).

## Comandos

```terminal
>tendril verification list [--json]
>tendril verification get <name>
>tendril verification add <name> [--prompt <text>]
>tendril verification set <name> [--new-name <name>] [--prompt <text>]
>tendril verification remove <name> [--force]
```

- **list** — exibe todas as verificações globais registradas. Passe `--json` para gerar a saída como JSON estruturado.
- **get** — imprime o nome da verificação e o texto completo do prompt de avaliação no stdout.
- **add** — registra uma nova checagem de verificação com uma descrição de prompt opcional.
- **set** — atualiza o prompt de uma definição de verificação ou a renomeia. Renomear uma verificação atualiza automaticamente todas as referências em projetos, registros YAML de planos e linhas no banco de dados.
- **remove** — exclui uma definição de verificação. Se qualquer projeto ativo fizer referência à checagem, o Tendril recusará a remoção a menos que `--force` (ou `-f`) seja fornecido, o que limpa as referências em todos os projetos.

## Exemplos

```terminal
># Add a new verification gate with prompt instructions
>tendril verification add CargoTest --prompt "Run cargo test --workspace and ensure all test suites pass with exit code 0."

># Inspect full prompt details
>tendril verification get CargoTest

># Update the evaluation prompt
>tendril verification set CargoTest --prompt "Run cargo test --workspace --all-targets and verify zero test failures."

># Rename a verification definition across projects and plans
>tendril verification set CargoTest --new-name RustWorkspaceTests

># List all definitions in JSON format
>tendril verification list --json

># Remove a verification, cleaning up project references
>tendril verification remove RustWorkspaceTests --force
```

## Relacionado

- [verificações de projeto](02_Project.md#verifications) — configure quais checagens são obrigatórias para um projeto
- [verificações de plano](01_Plan.md#verifications) — inspecione ou substitua status de gates de verificação em um plano
- [Referência de Configuração](../../03_Configuration/01_Setup.md) — gerencie configurações globais em `config.yaml`
