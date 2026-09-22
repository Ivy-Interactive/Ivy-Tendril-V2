---
title: project
description: Gerencie projetos armazenados no config.yaml. Projetos agrupam
  repositórios, verificações, dependências de build, ações de revisão,
  servidores MCP e skills personalizadas.
icon: FolderGit
searchHints:
  - projeto
  - repositório
  - verificação
  - build
  - dependência
  - revisão
  - ação
  - mcp
  - skills
  - sincronização
  - hooks
---

# project

Gerencie projetos armazenados no `config.yaml`. Projetos agrupam repositórios [Git](https://git-scm.com), [verificações](03_Verification.md), dependências de build, ações de revisão, servidores [Model Context Protocol (MCP)](https://modelcontextprotocol.io) e [skills de agente](../../06_CodingAgents/00_Skills.md) personalizadas. Para fluxos de trabalho mais amplos na UI, consulte [Configuração de Projeto](../../03_Configuration/02_Projects.md).

## CRUD

```terminal
>tendril project list
>tendril project get <name>
>tendril project add <name>
>tendril project rename <name> <new-name>
>tendril project remove <name>
>tendril project set <name> <field> <value>
```

- **list** — lista todos os projetos configurados, exibindo contagens de repositórios e verificações
- **get** — exibe detalhes completos de configuração no formato [YAML](https://yaml.org), incluindo repositórios, verificações, ações de revisão, dependências de build, servidores MCP e skills personalizadas
- **add** — cria uma nova entrada de projeto no `config.yaml`
- **rename** — renomeia um projeto existente e atualiza todas as referências internas
- **remove** — exclui a configuração do projeto do `config.yaml`
- **set** — atualiza um campo escalar do projeto. Campos suportados: `color` (string de cor hexadecimal), `context` (instruções de prompt em markdown para agentes), `stackHash`

## Repositórios & Sincronização

```terminal
>tendril project add-repo <project-name> <repo-path>
>tendril project remove-repo <project-name> <repo-path>
>tendril project sync <project-name> [--repo <repo>]
```

- **add-repo** — associa o caminho de checkout de um repositório local ao projeto
- **remove-repo** — desassocia o caminho de um repositório do projeto
- **sync** — busca branches remotas e avança via fast-forward todos os repositórios do projeto usando [Git](https://git-scm.com). Repositórios divergentes relatam instruções de correção diagnóstica.

## Verificações

Os projetos definem quais [verificações](03_Verification.md) devem ser aprovadas antes que um [plano](01_Plan.md) possa ser concluído:

```terminal
>tendril project add-verification <project-name> <verification-name> [--required | --optional] [--after <target>]
>tendril project remove-verification <project-name> <verification-name>
>tendril project move-verification <project-name> <verification-name> [--before <target> | --after <target> | --position <pos>]
```

- **add-verification** — vincula uma verificação global a este projeto. Obrigatória por padrão; passe `--optional` para marcá-la como consultiva ou `--after` para especificar a sequência de execução.
- **remove-verification** — remove uma etapa de verificação do projeto.
- **move-verification** — ajusta a posição da ordem de execução em relação a outras verificações (`--before`, `--after` ou `--position` com índice baseado em zero).

## Dependências de Build

```terminal
>tendril project add-build-dep <project-name> <dependency>
>tendril project remove-build-dep <project-name> <dependency>
```

Configura pré-requisitos externos de binários e ferramentas (por exemplo, `cargo`, `dotnet`, `node`, [gh](https://cli.github.com)) verificados antes de executar um plano.

## Ações de Revisão

```terminal
>tendril project add-review-action <project-name> <name> --command <cmd> [options]
>tendril project remove-review-action <project-name> <name>
>tendril project review-actions <project-name> [--changed-file <file>...] [--plan <plan>] [--format <table>]
```

Ações de revisão são comandos de shell executados durante a revisão interativa de código:

| Opção              | Efeito                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `--command <cmd>`  | Linha de comando shell executada dentro de um terminal interativo PTY                        |
| `--condition <ex>` | Expressão opcional avaliada antes de executar a ação                                         |
| `--paths <prefix>` | Filtro de caminho relativo ao repositório que aciona esta ação quando modificado (repetível) |
| `--before <name>`  | Insere antes de uma ação existente                                                           |
| `--after <name>`   | Insere depois de uma ação existente                                                          |

`tendril project review-actions` avalia e classifica ações de revisão em relação aos arquivos alterados derivados da worktree de um plano.

## Servidores MCP & Skills Personalizadas

Projetos podem registrar servidores [MCP](https://modelcontextprotocol.io) no escopo do projeto e skills de agente personalizadas:

```terminal
>tendril project list-mcp <project-name>
>tendril project add-mcp <project-name> <server-name> <command> [--arg <arg>...] [--env KEY=VALUE...]
>tendril project remove-mcp <project-name> <server-name>

>tendril project list-skills <project-name>
>tendril project add-skill <project-name> <skill-name> [--description <desc>] [--path <path>] [--instructions <text>]
>tendril project remove-skill <project-name> <skill-name>
```

Para importar servidores MCP ou skills diretamente de um repositório existente:

```terminal
>tendril project import <project-name> <repo-path> [--mcp-only] [--skills-only]
>tendril project import-mcp <project-name> <repo-path> [--name <server>]
>tendril project import-skills <project-name> <repo-path> [--name <skill>] [--no-copy]
```

## Promptware Hooks

Os hooks executam ações personalizadas no shell antes ou depois da execução do [promptware](../../02_Concepts/02_Promptwares.md):

```terminal
>tendril project add-hook <project-name> <name> --action <action> [options]
>tendril project remove-hook <project-name> <name>
```

| Opção                  | Efeito                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `--when <timing>`      | Gatilho de tempo: `before` (padrão) ou `after`                                                                  |
| `--promptwares <list>` | Lista separada por vírgulas de promptwares a serem acionados (ex.: `ExecutePlan,CreatePr`), ou todos se omitido |
| `--action <cmd>`       | Comando shell a ser executado                                                                                   |
| `--condition <expr>`   | Expressão que deve ser avaliada como verdadeira para o hook disparar                                            |

## Portas & Arquivos de Ambiente

Gerencie portas de serviço nomeadas e arquivos de modelo `.env` materializados nas worktrees do plano:

```terminal
>tendril project port list <project-name>
>tendril project port add <project-name> <port-name> --default-port <port> [--description <desc>]
>tendril project port remove <project-name> <port-name>

>tendril project env-file list <project-name>
>tendril project env-file add <project-name> <path> [--template <file>] [--override KEY=VALUE...]
>tendril project env-file remove <project-name> <path>
```
