---
title: plan
description: Crie, leia, atualize e valide planos a partir do terminal. Todos os
  subcomandos resolvem a pasta do plano a partir de TENDRIL_PLANS,
  TENDRIL_HOME/Plans ou ~/.tendril/Plans quando as variáveis de ambiente não
  estiverem definidas.
icon: ListChecks
searchHints:
  - plano
  - criar
  - listar
  - obter
  - definir
  - atualizar
  - validar
  - repositório
  - pr
  - commit
  - verificação
  - recomendação
  - rec
  - log
  - revisão
  - doctor
  - depende
  - relacionado
  - env
  - wireframes
---

# plan

Crie, leia, atualize e valide planos a partir do terminal. Todos os subcomandos resolvem a pasta do plano a partir de `TENDRIL_PLANS`, `TENDRIL_HOME/Plans` ou `~/.tendril/Plans` quando as variáveis de ambiente não estiverem definidas.

## CRUD

#### plan create

```terminal
>tendril plan create <title> <project> [options]
```

Cria uma nova pasta de plano e uma estrutura inicial de `plan.yaml` com o estado `Draft`. O ID do plano é alocado automaticamente a partir do arquivo `.counter`. Os repositórios e as verificações padrão são derivados da configuração do projeto.

| Opção                           | Descrição                                                              |
| ------------------------------- | ---------------------------------------------------------------------- |
| `--level <level>`               | Nível de prioridade (padrão: Feature)                                  |
| `--initial-prompt <text>`       | Texto do prompt inicial                                                |
| `--source-url <url>`            | URL de origem (issue ou PR do GitHub)                                  |
| `--execution-profile <profile>` | Perfil de execução (`deep` ou `balanced`)                              |
| `--priority <number>`           | Número de prioridade (padrão: 0)                                       |
| `--verification <Name=Status>`  | Entrada de verificação (repetível)                                     |
| `--related-plan <folder>`       | Nome da pasta do plano relacionado (repetível)                         |
| `--depends-on <folder>`         | Nome da pasta do plano de dependência (repetível)                      |
| `--chat-session <id>`           | Associar a uma sessão de chat                                          |
| `--plans-dir <path>`            | Substituir o caminho do diretório de planos                            |
| `--no-duplicate-check`          | Ignorar a detecção de duplicatas em relação a planos ativos existentes |

#### plan list

```terminal
>tendril plan list [options]
```

Lista os planos com filtros opcionais.

| Opção                      | Efeito                                                               |
| -------------------------- | -------------------------------------------------------------------- |
| `--status` / `--state <s>` | Filtrar por estado (ex.: `Draft`, `Executing`, `Failed`)             |
| `-p, --project <name>`     | Filtrar pelo nome do projeto (validado contra projetos configurados) |
| `--level <level>`          | Filtrar por nível (ex.: `Bug`, `Feature`, `Epic`)                    |
| `--has-pr`                 | Apenas planos que possuem PRs associados                             |
| `--has-worktree`           | Apenas planos que possuem worktrees                                  |
| `-q, --search <query>`     | Filtrar por substring de busca de texto no título ou ID              |
| `--limit <n>`              | Número máximo de resultados                                          |
| `--format <fmt>`           | Formato de saída: `table` (padrão), `ids`, `folders`, `json`         |
| `--plans-dir <path>`       | Substituir o caminho do diretório de planos                          |

```terminal
>tendril plan list --state Draft
>tendril plan list --project Tendril --level Critical
>tendril plan list --state Failed --format ids
>tendril plan list --format json --limit 10
```

> [!NOTE]
> `plan list` mostra planos (a partir de arquivos `plan.yaml`), não jobs. Para o histórico de jobs e o status de execução, use `job list` (consulte [Outros Comandos](05_Other.md#job-list)).

#### plan get

```terminal
>tendril plan get <plan-id> [field]
```

Exibe o YAML completo ou o valor de um único campo quando `[field]` for fornecido.

**Campos escalares:** `id`, `title`, `state`, `project`, `level`, `created`, `updated`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`, `partialDelivery`

**Campos de lista:** `repos`, `prs`, `commits`, `verifications`, `dependsOn`, `relatedPlans`, `recommendations` (cada item em sua própria linha)

#### plan set

```terminal
>tendril plan set <plan-id> <field> <value> [options]
>tendril plan set <plan-id> state Completed --allow-failed-verifications
```

Atualiza um único campo e atualiza o timestamp `updated` automaticamente.

Campos suportados: `state`, `title`, `level`, `project`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`.

Definir `state` como `Completed` é recusado enquanto qualquer verificação estiver no estado `Fail`: um plano que aparece como concluído enquanto uma barreira de validação rejeitou o trabalho oculta uma entrega pendente da detecção de duplicatas. Execute a verificação novamente ou defina-a como `Skipped` com um motivo explícito. Passar `--allow-failed-verifications` registra a transição mesmo assim e define `partialDelivery: true`.

| Opção                          | Efeito                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `--allow-failed-verifications` | Permitir a mudança para `Completed` mesmo com verificações com falha          |
| `--reason <text>`              | Explicar por que a edição foi feita (informado às sessões de chat conectadas) |
| `--chat-session <id>`          | Sessão de chat de origem (excluída da autonotificação)                        |

#### plan update

```terminal
>cat revised.yaml | tendril plan update <plan-id> --stdin
>tendril plan update <plan-id> --file revised.yaml
```

Substitui todo o conteúdo de `plan.yaml` a partir de `--file` ou `--stdin` (obrigatório — `--stdin` não é implícito).

#### plan check-wireframes

```terminal
>tendril plan check-wireframes <plan-id>
```

Verifica o vazamento de código de wireframe nos arquivos modificados de um plano. Retorna 0 se estiver limpo, ou retorna 1 com um relatório de diagnóstico se quaisquer marcadores de wireframe forem encontrados.

#### plan validate

```terminal
>tendril plan validate <plan-id>
```

Verifica se o plano possui todos os campos obrigatórios e se é internamente consistente. Encerra com o código `1` em caso de erros estruturais.

## Repositórios

```terminal
>tendril plan add-repo <plan-id> <repo-path> [--reason <text>] [--chat-session <id>]
>tendril plan remove-repo <plan-id> <repo-path> [--reason <text>] [--chat-session <id>]
```

Gerencie a lista de repositórios associados a um plano. Adicionar um repositório já existente é uma operação idempotente sem efeito.

## Links

```terminal
>tendril plan add-pr <plan-id> <pr-url> [--reason <text>] [--chat-session <id>]
>tendril plan remove-pr <plan-id> <pr-url> [--reason <text>] [--chat-session <id>]
>tendril plan add-commit <plan-id> <sha> [--reason <text>] [--chat-session <id>]
>tendril plan add-related-plan <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
>tendril plan remove-related-plan <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
>tendril plan add-depends-on <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
>tendril plan remove-depends-on <plan-id> <folder-name> [--reason <text>] [--chat-session <id>]
```

Gerencie URLs de PRs, SHAs de commits, planos relacionados e dependências bloqueantes. `add-depends-on` faz com que `ExecutePlan` aguarde até que a dependência alcance o estado `Completed` e faça o merge de seus PRs antes da execução. Todos os nomes são comparados sem distinção entre maiúsculas e minúsculas.

## Verificações

```terminal
>tendril plan set-verification <plan-id> <name> <status> [--reason <text>] [--chat-session <id>]
>tendril plan verification list <plan-id> [--status <status>] [--json]
>tendril plan verification add <plan-id> <name> [--status <status>] [--reason <text>] [--chat-session <id>]
>tendril plan verification remove <plan-id> <name> [--reason <text>] [--chat-session <id>]
```

Gerencie as verificações em um plano. Status válidos: `Pending`, `Pass`, `Fail`, `Skipped`. O status padrão para `add` é `Pending`.

## Worktrees

#### plan cleanup

```terminal
>tendril plan cleanup <plan-id> [--force]
```

Remove todos os git worktrees associados a um plano. Por padrão, é executado apenas em planos em estado terminal (`Completed`, `Failed`, `Skipped`, `Icebox`). Use `--force` para remover worktrees de planos que não estão em estado terminal.

#### plan add-worktree

```terminal
>tendril plan add-worktree <plan-id> <repo> [--base <branch>]
```

Cria um git worktree para o plano fornecido em `<plan-folder>/Worktrees/<repo-name>`, ramificando a partir de `origin/<base>` (padrão: branch padrão detectado automaticamente). O branch é nomeado como `tendril/<plan-folder-name>`.

#### plan remove-worktree

```terminal
>tendril plan remove-worktree <plan-id> <repo-name> [--branch <branch>]
```

Remove um único worktree de `Worktrees/<repo-name>`. Tenta executar `git worktree remove --force` primeiro; caso falhe, recorre à exclusão forçada. Também exclui o branch associado (`tendril/<plan-folder>` por padrão).

## Revisões

```terminal
>cat revision.md | tendril plan write-revision <plan-id> --stdin
>tendril plan write-revision <plan-id> --file revision.md
```

Grava um arquivo de revisão numerado em `Revisions/` (ex.: `002.md`) a partir da entrada padrão (stdin) ou de `--file`. Suporta `--no-question-check` para ignorar a validação e `--reason` / `--chat-session` para atribuição de auditoria.

```terminal
>tendril plan get-revision <plan-id> [--number <n>]
```

Exibe o conteúdo da revisão no stdout — a revisão mais recente por padrão, ou uma revisão numerada específica quando `--number` for fornecido.

## Perguntas

Uma revisão pode conter perguntas para o usuário em blocos demarcados `questions`:

````markdown
```questions
questions:                    # 1-4 items
  - id:          string       # required, stable, unique across the whole revision
    title:       string       # required, the question
    header:      string       # optional, <=12 char chip label
    description: markdown     # optional, context shown under the question
    multiple:    bool         # optional, default false; true = multi-select
    options:                  # 2-4 items; omit entirely for a pure free-text question
      - title:       string   # required, 1-5 words
        description: markdown # optional
        value:       slug     # required, ^[a-z0-9][a-z0-9-]*$, referenced by `answer`
        recommended: bool     # optional, max one per question
    answer:      value | [values] | string   # filled in on response
```
````

`write-revision` valida cada bloco de perguntas contra este esquema e rejeita a revisão se algum bloco estiver malformado. Use `--no-question-check` apenas em testes automatizados.

## Recomendações

```terminal
>tendril plan rec list <plan-id> [--state <state>]
>tendril plan rec all [--project <project>] [--state <state>]
>tendril plan rec rebuild
>tendril plan rec add <plan-id> <title> [-d <description>] [--impact <level>]
>tendril plan rec set <plan-id> <title> <field> <value>
>tendril plan rec accept <plan-id> <title> [--notes <text>]
>tendril plan rec decline <plan-id> <title> [--reason <text>] [--edit-reason <text>]
>tendril plan rec remove <plan-id> <title>
```

Gerencie recomendações armazenadas no YAML de um plano:

- **list** — lista as recomendações de um plano; filtrar por estado: `Pending`, `Accepted`, `AcceptedWithNotes`, `Declined`
- **all** — lista as recomendações de todos os planos
- **rebuild** — reconstrói a projeção desnormalizada de recomendações a partir do disco
- **add** — níveis de impacto: `Small`, `Medium`, `High`
- **set** — campos suportados: `title`, `description`, `state`, `impact`, `declineReason`, `notes`
- **accept** — define o estado como `Accepted`, ou `AcceptedWithNotes` se `--notes` for fornecido
- **decline** — define o estado como `Declined`. `--reason` registra o motivo da recusa em `plan.yaml`; `--edit-reason` especifica o motivo da notificação para as sessões de chat
- **remove** — exclui permanentemente uma recomendação

## Ambiente

```terminal
>tendril plan env materialize <plan-id> [--repo <repo>] [--force] [--json]
>tendril plan env get <plan-id> [--repo <repo>] [--json]
```

Inspecione e grave as alocações de portas e arquivos de ambiente do plano:

- **materialize** — aloca portas de serviço sem conflito e grava arquivos de ambiente nos worktrees do plano. Use `--force` para sobrescrever arquivos existentes.
- **get** — exibe as portas alocadas e as variáveis de ambiente resolvidas para um worktree.

## Doctor

```terminal
>tendril plan doctor [options]
```

Escaneia todas as pastas no diretório de planos e relata problemas de integridade.

| Opção           | Efeito                                                                           |
| --------------- | -------------------------------------------------------------------------------- |
| `--fix`         | Migrar os esquemas de planos para a versão mais recente automaticamente          |
| `--prs`         | Verificar cada pull request registrado no GitHub via `gh`                        |
| `--prune-husks` | Remover pastas de planos vazias que não contêm revisão nem artefatos de trabalho |
| `--dry-run`     | Com `--prune-husks`, relatar o que seria removido sem excluir de fato            |

```terminal
>tendril plan doctor
>tendril plan doctor --fix
>tendril plan doctor --prs
>tendril plan doctor --prune-husks --dry-run
```

### Backfill de entrega parcial

O relatório lista os planos marcados como `Completed` com uma verificação no estado `Fail` e sem a flag `partialDelivery`. Estes planos antecedem a trava de conclusão. Para reconhecer a entrega parcial:

```terminal
>tendril plan set <id> state Completed --allow-failed-verifications
```
