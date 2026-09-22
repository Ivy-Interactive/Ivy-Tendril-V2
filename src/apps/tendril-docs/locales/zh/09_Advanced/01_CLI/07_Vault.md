---
title: vault
description: 管理团队配置库 (Vault)，在 GitHub 上发现并连接共享代码仓库，检查目录资产，导入项目，以及直接从 CLI 发布配置更新。
icon: KeyRound
searchHints:
  - vault
  - sync
  - pull
  - import
  - push
  - catalog
  - discover
  - connect
  - auto-sync
  - team
---

# vault

管理以 [Git](https://git-scm.com) 和 [GitHub](https://github.com) 为后端的团队配置库 (Vault)。配置库允许团队跨工作站共享项目配置、自定义技能、[模型上下文协议 (MCP)](https://modelcontextprotocol.io) 服务端配置、Promptware 记忆以及验证检查。CLI 与 [GitHub CLI (`gh`)](https://cli.github.com) 进行交互，以发现团队代码仓库、导入项目模板，并通过 [GitHub Pull Requests](https://docs.github.com/en/pull-requests) 提交更新。

有关本地项目配置请参阅 [Projects](02_Project.md)，有关全局设置请参阅 [Global Config](06_Config.md)。

## Commands

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

## Vault Management

#### list

```terminal
>tendril vault list
>tendril vault list --json
```

列出所有已连接的配置库，显示其 ID、名称、远程 [Git](https://git-scm.com) 仓库 URL、当前分支、超前/落后 (ahead/behind) 提交数、上次同步时间戳以及自动同步状态。

#### status

```terminal
>tendril vault status
>tendril vault status <vault-id>
>tendril vault status --json
```

显示指定配置库或主配置库的详细诊断与同步状态，包括未提交的本地修改和分支跟踪状态。

#### discover

```terminal
>tendril vault discover
>tendril vault discover --json
```

使用 [GitHub CLI (`gh`)](https://cli.github.com) 扫描 [GitHub](https://github.com)，以发现您的账户和所属组织可访问的现有配置库仓库。

#### connect

```terminal
>tendril vault connect https://github.com/my-org/team-vault.git
>tendril vault connect my-org/team-vault --name "Engineering Vault"
```

将现有 [Git](https://git-scm.com) 仓库作为团队配置库连接。支持完整仓库 URL 或 `org/repo` 简写格式。

#### create

```terminal
>tendril vault create engineering-vault
>tendril vault create team-vault --org my-org --public
```

在 [GitHub](https://github.com) 上创建新仓库（默认私有），初始化标准配置库目录结构，并在本地连接。使用 `--org` 指定目标组织，使用 `--public` 设置公开可见性。

#### disconnect

```terminal
>tendril vault disconnect
>tendril vault disconnect <vault-id> -y
```

从本地 Tendril 配置中解绑配置库，但不会删除本地克隆目录。传入 `-y` 或 `--yes` 可跳过确认提示。

#### sync / pull

```terminal
>tendril vault sync
>tendril vault pull
>tendril vault sync <vault-id>
```

从远程配置库仓库拉取最新的配置提交，并更新所跟踪的本地项目。`pull` 是 `sync` 的别名。

#### set-auto-sync

```terminal
>tendril vault set-auto-sync true
>tendril vault set-auto-sync false --vault <vault-id>
```

启用或禁用某个配置库的自动同步功能。接受 `true`、`false`、`1`、`0`、`yes` 或 `no`。

## Catalog & Project Sharing

#### catalog

```terminal
>tendril vault catalog
>tendril vault catalog <vault-id> --json
```

列出发布在配置库目录中的所有项目以及资产数量（代码仓库、自定义技能、[模型上下文协议 (MCP)](https://modelcontextprotocol.io) 服务端、Promptware 记忆与验证检查）。

#### import

```terminal
>tendril vault import MyProject
>tendril vault import MyProject --target-name LocalProject --merge
>tendril vault import MyProject --repo api=~/code/api --repo web=~/code/web
```

将项目定义从配置库目录导入到本地 Tendril 配置中。

| 选项                   | 说明                                                       |
| ---------------------- | ---------------------------------------------------------- |
| `--target-name <name>` | 自定义注册的本地项目名称（用于替代目录中的项目名）         |
| `--vault <vault-id>`   | 导入来源的配置库 ID 或名称（默认使用活跃配置库）           |
| `--repo <name=path>`   | 将配置库中的仓库标识符映射到本地文件系统路径（可重复指定） |
| `--no-permissions`     | 跳过导入安全规则和执行权限                                 |
| `--merge`              | 将设置合并到现有的本地项目中，而不是直接替换               |

#### push

```terminal
>tendril vault push MyProject
>tendril vault push ProjectA ProjectB --version "1.2.0" --changelog "Added new skills and verifications"
>tendril vault push MyProject --reviewer alice,bob --title "feat(vault): update MyProject"
```

收集项目配置、自定义技能、[模型上下文协议 (MCP)](https://modelcontextprotocol.io) 配置、Promptware 记忆与验证门禁，将它们提交到特性分支，并针对配置库仓库创建 [GitHub Pull Request](https://docs.github.com/en/pull-requests)。

| 选项                  | 说明                                                                             |
| --------------------- | -------------------------------------------------------------------------------- |
| `--vault <vault-id>`  | 目标配置库标识符                                                                 |
| `--version <version>` | 自定义版本字符串（默认为 UTC 时间戳）                                            |
| `--changelog <text>`  | 包含在 Pull Request 描述中的更新日志说明                                         |
| `--title <title>`     | 生成的 Pull Request 的自定义标题                                                 |
| `--body <body>`       | Pull Request 的自定义正文描述                                                    |
| `--reviewer <names>`  | 指派为审查人员的 [GitHub](https://github.com) 用户名（可重复指定或使用逗号分隔） |

#### delete

```terminal
>tendril vault delete OldProject
>tendril vault delete OldProject --vault <vault-id> -y
```

从配置库仓库中移除项目，并创建 [GitHub Pull Request](https://docs.github.com/en/pull-requests) 来应用此删除操作。传入 `-y` 或 `--yes` 可跳过确认。

## Examples

**连接并同步团队配置库：**

```terminal
># 在 GitHub 上发现可访问的团队配置库
>tendril vault discover

># 连接配置库仓库
>tendril vault connect https://github.com/my-org/shared-vault.git

># 拉取最新更新
>tendril vault sync
```

**从配置库目录导入项目：**

```terminal
># 查看目录中可用的项目
>tendril vault catalog

># 使用自定义本地仓库路径导入
>tendril vault import BackendService --repo backend=~/Projects/backend
```

**通过 Pull Request 发布项目更新：**

```terminal
># 推送更改并创建附带指派审查人员的 Pull Request
>tendril vault push BackendService --changelog "Added Playwright E2E verification" --reviewer alice,bob
```
