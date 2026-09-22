---
title: vault
description: Gerencie vaults de configuração de equipe, descubra e conecte
  repositórios compartilhados no GitHub, inspecione recursos do catálogo,
  importe projetos e publique atualizações de configuração diretamente da CLI.
icon: KeyRound
searchHints:
  - vault
  - sincronizar
  - pull
  - importar
  - push
  - catálogo
  - descobrir
  - conectar
  - sincronização automática
  - equipe
---

# vault

Gerencie vaults de configuração de equipe com suporte de [Git](https://git-scm.com) e [GitHub](https://github.com). Os vaults permitem que as equipes compartilhem configurações de projeto, skills personalizadas, configurações de servidor [Model Context Protocol (MCP)](https://modelcontextprotocol.io), memórias de promptware e verificações entre estações de trabalho. A CLI interage com o [GitHub CLI (`gh`)](https://cli.github.com) para descobrir repositórios da equipe, importar modelos de projeto e enviar atualizações por meio de [GitHub Pull Requests](https://docs.github.com/en/pull-requests).

Consulte [Projetos](02_Project.md) para configuração local de projetos e [Configuração Global](06_Config.md) para definições globais.

## Comandos

```terminal
>tendril vault list [--json]
>tendril vault status [vault-id] [--json]
>tendril vault discover [--json]
>tendril vault connect <repo-url> [--name <custom-name>]
>tendril vault create <repo-name> [--public] [--org <org>]
>tendril vault disconnect [vault-id] [-y, --yes]
>tendril vault sync [vault-id]
>tendril vault pull [vault-id]
>tendril vault set-auto-sync <enabled> [--vault <vault-id>]
>tendril vault catalog [vault-id] [--json]
>tendril vault import <project-name> [options]
>tendril vault push <projects...> [options]
>tendril vault delete <project-name> [--vault <vault-id>] [-y, --yes]
```

## Gerenciamento de Vaults

#### list

```terminal
>tendril vault list
>tendril vault list --json
```

Lista todos os vaults conectados, exibindo seu ID, nome, URL do repositório remoto [Git](https://git-scm.com), branch ativo, contagem de commits ahead/behind, timestamp da última sincronização e status de sincronização automática.

#### status

```terminal
>tendril vault status
>tendril vault status <vault-id>
>tendril vault status --json
```

Mostra o status detalhado de diagnóstico e sincronização para um vault específico ou para o vault principal configurado, incluindo modificações locais não commitadas e estado de rastreamento de branch.

#### discover

```terminal
>tendril vault discover
>tendril vault discover --json
```

Varre o [GitHub](https://github.com) usando o [GitHub CLI (`gh`)](https://cli.github.com) para descobrir repositórios de vault existentes acessíveis à sua conta e organizações.

#### connect

```terminal
>tendril vault connect https://github.com/my-org/team-vault.git
>tendril vault connect my-org/team-vault --name "Engineering Vault"
```

Conecta um repositório [Git](https://git-scm.com) existente como um vault de equipe. Aceita URLs completas de repositório ou o formato abreviado `org/repo`.

#### create

```terminal
>tendril vault create engineering-vault
>tendril vault create team-vault --org my-org --public
```

Cria um novo repositório no [GitHub](https://github.com) (privado por padrão), inicializa estruturas de diretório padrão de vault e o conecta localmente. Use `--org` para direcionar a uma organização e `--public` para visibilidade pública.

#### disconnect

```terminal
>tendril vault disconnect
>tendril vault disconnect <vault-id> -y
```

Desconecta um vault da configuração local do Tendril sem excluir o diretório clonado localmente. Passe `-y` ou `--yes` para ignorar prompts de confirmação.

#### sync / pull

```terminal
>tendril vault sync
>tendril vault pull
>tendril vault sync <vault-id>
```

Puxa os commits de configuração mais recentes do repositório remoto do vault e atualiza os projetos locais rastreados. `pull` é um alias para `sync`.

#### set-auto-sync

```terminal
>tendril vault set-auto-sync true
>tendril vault set-auto-sync false --vault <vault-id>
```

Habilita ou desabilita a sincronização automática para um vault. Aceita `true`, `false`, `1`, `0`, `yes` ou `no`.

## Catálogo e Compartilhamento de Projetos

#### catalog

```terminal
>tendril vault catalog
>tendril vault catalog <vault-id> --json
```

Lista todos os projetos e contagens de recursos (repositórios, skills personalizadas, servidores [Model Context Protocol (MCP)](https://modelcontextprotocol.io), memórias de promptware e verificações) publicados no catálogo do vault.

#### import

```terminal
>tendril vault import MyProject
>tendril vault import MyProject --target-name LocalProject --merge
>tendril vault import MyProject --repo api=~/code/api --repo web=~/code/web
```

Importa uma definição de projeto do catálogo do vault para a configuração local do Tendril.

| Opção                  | Descrição                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `--target-name <name>` | Nome personalizado do projeto local a ser registrado em vez do nome no catálogo                          |
| `--vault <vault-id>`   | ID ou nome do vault de onde importar (o padrão é o vault ativo)                                          |
| `--repo <name=path>`   | Mapeia um identificador de repositório do vault para um caminho do sistema de arquivos local (repetível) |
| `--no-permissions`     | Ignora a importação de regras de segurança e permissões de execução                                      |
| `--merge`              | Mescla configurações em um projeto local existente em vez de substituí-lo                                |

#### push

```terminal
>tendril vault push MyProject
>tendril vault push ProjectA ProjectB --version "1.2.0" --changelog "Added new skills and verifications"
>tendril vault push MyProject --reviewer alice,bob --title "feat(vault): update MyProject"
```

Coleta a configuração do projeto, skills personalizadas, configurações do [Model Context Protocol (MCP)](https://modelcontextprotocol.io), memórias de promptware e verificações, realiza o commit deles em um branch de funcionalidade e abre um [GitHub Pull Request](https://docs.github.com/en/pull-requests) contra o repositório do vault.

| Opção                 | Descrição                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `--vault <vault-id>`  | Identificador do vault de destino                                                                                 |
| `--version <version>` | String de versão personalizada (o padrão é o timestamp UTC)                                                       |
| `--changelog <text>`  | Notas de changelog incluídas na descrição do pull request                                                         |
| `--title <title>`     | Título personalizado para o pull request gerado                                                                   |
| `--body <body>`       | Descrição de corpo personalizada para o pull request                                                              |
| `--reviewer <names>`  | Nome(s) de usuário do [GitHub](https://github.com) a atribuir como revisores (repetível ou separado por vírgulas) |

#### delete

```terminal
>tendril vault delete OldProject
>tendril vault delete OldProject --vault <vault-id> -y
```

Remove um projeto do repositório do vault e cria um [GitHub Pull Request](https://docs.github.com/en/pull-requests) para aplicar a exclusão. Passe `-y` ou `--yes` para ignorar a confirmação.

## Exemplos

**Conectar e sincronizar um vault de equipe:**

```terminal
># Discover accessible team vaults on GitHub
>tendril vault discover

># Connect vault repository
>tendril vault connect https://github.com/my-org/shared-vault.git

># Pull updates
>tendril vault sync
```

**Importar um projeto do catálogo:**

```terminal
># Inspect available catalog projects
>tendril vault catalog

># Import with custom local repository paths
>tendril vault import BackendService --repo backend=~/Projects/backend
```

**Publicar atualizações de projeto via pull request:**

```terminal
># Push changes and open a pull request with assigned reviewers
>tendril vault push BackendService --changelog "Added Playwright E2E verification" --reviewer alice,bob
```
