---
title: project
description: 管理保存在 config.yaml 中的项目。项目用于组织代码仓库、验证检查、构建依赖项、审查动作、MCP 服务端以及自定义技能。
icon: FolderGit
searchHints:
  - project
  - repo
  - verification
  - build
  - dependency
  - review
  - action
  - mcp
  - skills
  - sync
  - hooks
---

# project

管理保存在 `config.yaml` 中的项目。项目用于组织 [Git](https://git-scm.com) 代码仓库、[验证检查](03_Verification.md)、构建依赖项、审查动作、[模型上下文协议 (MCP)](https://modelcontextprotocol.io) 服务端以及自定义 [智能体技能](../../06_CodingAgents/00_Skills.md)。有关更完整的 UI 工作流，请参阅 [项目配置](../../03_Configuration/02_Projects.md)。

## CRUD

```terminal
>tendril project list
>tendril project get <name>
>tendril project add <name>
>tendril project rename <name> <new-name>
>tendril project remove <name>
>tendril project set <name> <field> <value>
```

- **list** — 列出所有已配置的项目，显示仓库数量和验证门禁数量
- **get** — 以 [YAML](https://yaml.org) 格式显示完整的配置详情，包括代码仓库、验证门禁、审查动作、构建依赖项、MCP 服务端及自定义技能
- **add** — 在 `config.yaml` 中创建新的项目条目
- **rename** — 重命名现有项目并更新所有内部引用
- **remove** — 从 `config.yaml` 中删除该项目配置
- **set** — 更新标量项目字段。支持的字段：`color`（十六进制颜色字符串）、`context`（面向智能体的 Markdown 提示词指令）、`stackHash`

## Repositories & Sync

```terminal
>tendril project add-repo <project-name> <repo-path>
>tendril project remove-repo <project-name> <repo-path>
>tendril project sync <project-name> [--repo <repo>]
```

- **add-repo** — 将本地仓库检出路径关联到该项目
- **remove-repo** — 解除本地仓库路径与该项目的关联
- **sync** — 使用 [Git](https://git-scm.com) 拉取远程分支并快进 (fast-forward) 所有项目代码仓库。存在分叉分歧的仓库会输出诊断与修复指引。

## Verifications

项目定义了在 [计划](01_Plan.md) 能够流转到 `Completed` 之前必须通过的 [验证检查](03_Verification.md)：

```terminal
>tendril project add-verification <project-name> <verification-name> [--required | --optional] [--after <target>]
>tendril project remove-verification <project-name> <verification-name>
>tendril project move-verification <project-name> <verification-name> [--before <target> | --after <target> | --position <pos>]
```

- **add-verification** — 将全局验证检查链接到此项目。默认必选；传入 `--optional` 可将其标记为建议项，传入 `--after` 可指定执行顺序。
- **remove-verification** — 从项目中移除验证门禁。
- **move-verification** — 调整相对于其他验证的运行顺序位置（`--before`、`--after` 或从零开始的 `--position`）。

## Build Dependencies

```terminal
>tendril project add-build-dep <project-name> <dependency>
>tendril project remove-build-dep <project-name> <dependency>
```

配置在执行计划前需验证的外部二进制文件和工具依赖项（例如 `cargo`、`dotnet`、`node`、[gh](https://cli.github.com)）。

## Review Actions

```terminal
>tendril project add-review-action <project-name> <name> --command <cmd> [options]
>tendril project remove-review-action <project-name> <name>
>tendril project review-actions <project-name> [--changed-file <file>...] [--plan <plan>] [--format <table>]
```

审查动作是交互式代码审查期间执行的 Shell 命令：

| 选项               | 作用                                                               |
| ------------------ | ------------------------------------------------------------------ |
| `--command <cmd>`  | 在交互式终端 PTY 中执行的 Shell 命令行                             |
| `--condition <ex>` | 在运行动作前评估的可选表达式                                       |
| `--paths <prefix>` | 相对仓库路径过滤器，当匹配的文件发生修改时触发此动作（可重复指定） |
| `--before <name>`  | 插入到某现有动作之前                                               |
| `--after <name>`   | 插入到某现有动作之后                                               |

`tendril project review-actions` 根据计划工作区中的已变更文件，对审查动作进行求值并排序。

## MCP Servers & Custom Skills

项目可以注册项目作用域的 [MCP](https://modelcontextprotocol.io) 服务端与自定义智能体技能：

```terminal
>tendril project list-mcp <project-name>
>tendril project add-mcp <project-name> <server-name> <command> [--arg <arg>...] [--env KEY=VALUE...]
>tendril project remove-mcp <project-name> <server-name>

>tendril project list-skills <project-name>
>tendril project add-skill <project-name> <skill-name> [--description <desc>] [--path <path>] [--instructions <text>]
>tendril project remove-skill <project-name> <skill-name>
```

直接从现有代码仓库导入 MCP 服务端或技能：

```terminal
>tendril project import <project-name> <repo-path> [--mcp-only] [--skills-only]
>tendril project import-mcp <project-name> <repo-path> [--name <server>]
>tendril project import-skills <project-name> <repo-path> [--name <skill>] [--no-copy]
```

## Promptware Hooks

钩子在 [Promptware](../../02_Concepts/02_Promptwares.md) 运行之前或之后执行自定义 Shell 操作：

```terminal
>tendril project add-hook <project-name> <name> --action <action> [options]
>tendril project remove-hook <project-name> <name>
```

| 选项                   | 作用                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `--when <timing>`      | 触发时机：`before`（默认）或 `after`                                                    |
| `--promptwares <list>` | 逗号分隔的触发目标 Promptware 列表（例如 `ExecutePlan,CreatePr`），若省略则针对所有生效 |
| `--action <cmd>`       | 要执行的 Shell 命令                                                                     |
| `--condition <expr>`   | 钩子触发前必须求值为 true 的表达式                                                      |

## Ports & Environment Files

管理命名服务端口以及写入计划工作区的 `.env` 模板文件：

```terminal
>tendril project port list <project-name>
>tendril project port add <project-name> <port-name> --default-port <port> [--description <desc>]
>tendril project port remove <project-name> <port-name>

>tendril project env-file list <project-name>
>tendril project env-file add <project-name> <path> [--template <file>] [--override KEY=VALUE...]
>tendril project env-file remove <project-name> <path>
```
