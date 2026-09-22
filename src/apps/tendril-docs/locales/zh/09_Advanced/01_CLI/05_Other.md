---
title: 其他命令
description: Promptware 执行、后台任务编排、聊天会话、操作系统后台服务注册及实用工具。
icon: Wrench
searchHints:
  - promptware
  - memory
  - tool
  - job
  - chat
  - service
  - autostart
  - launchd
  - systemd
  - status
  - models
  - hash-password
  - generate-certs
  - agent-instructions
---

# 其他命令

Promptware 执行、后台任务跟踪、交互式聊天会话、操作系统后台服务管理以及 Tendril CLI 实用工具命令参考。

## promptware

Tendril 使用 [Promptware](../../02_Concepts/02_Promptwares.md) 来结构化智能体的执行工作流。背景详情请参阅 [Promptware 概念](../../02_Concepts/02_Promptwares.md)。

#### promptware run

```terminal
>tendril promptware run <name> [args...] [options]
```

绕过服务端任务队列，直接在宿主机器上运行 Promptware。

| 选项                   | 作用                                                                        |
| ---------------------- | --------------------------------------------------------------------------- |
| `--profile <profile>`  | 覆盖智能体推理配置文件（`deep`、`balanced`、`quick`）                       |
| `--working-dir <path>` | 智能体执行进程的工作目录                                                    |
| `--value <key=value>`  | 附加固件头数值（可重复指定）                                                |
| `--plan <id>`          | 目标计划 ID 或目录路径                                                      |
| `--agent <provider>`   | 覆盖智能体提供商（`claude`、`antigravity`、`codex`、`copilot`、`opencode`） |
| `--dry-run`            | 将编译后的固件打印到标准输出并退出，而不实际启动智能体                      |

#### Memory 与 Tools

```terminal
>tendril promptware list-memory <name>
>tendril promptware read-memory <name> [files...]
>tendril promptware write-memory <name> <filename> [--file <path>] [--stdin]
>tendril promptware delete-memory <name> <filename>
>tendril promptware write-tool <name> <tool_name> [--file <path>] [--stdin]
```

智能体使用这些命令将学到的模式持久化到 Promptware 的 `Memory/` 目录中，并在 `Tools/` 中编写自定义工具。

#### Deployment & Layers

```terminal
>tendril promptware deploy
>tendril promptware layers [name]
```

- **deploy** — 编译并将标准 Promptware 安装到 `<TendrilHome>/Promptwares/` 中。
- **layers** — 检查各 Promptware 文件是由哪一层（自带默认层还是团队覆盖层）所提供的。

## job

管理异步后台智能体任务。任务通过守护进程队列运行并实时报告状态。UI 界面查看请参阅 [Jobs 应用](../../04_Apps/04_Jobs.md)。

#### job list

```terminal
>tendril job list
>tendril job list --status Running
>tendril job list --limit 50
>tendril job list --json
```

列出来自 Tendril 守护进程服务的最近后台任务。

| 选项                | 作用                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `--status <status>` | 按状态过滤（`Pending`、`Queued`、`Running`、`Completed`、`Failed`、`Timeout`、`Stopped`、`Blocked`） |
| `--limit <n>`       | 最大返回数量（默认：20）                                                                             |
| `--json`            | 将任务输出为结构化 JSON                                                                              |

#### job start

```terminal
>tendril job start <job-type> [plan-id] [options]
```

在运行中的 Tendril 守护进程上启动异步后台任务。支持的任务类型：`CreatePlan`, `ExecutePlan`, `RetryPlan`, `UpdatePlan`, `ExpandPlan`, `SplitPlan`, `CreatePr`, `CreateIssue`, `SetupProject`, `AddProject`, `SyncRepo`。

| 选项                      | 作用                                                            |
| ------------------------- | --------------------------------------------------------------- |
| `--priority <number>`     | 队列分发优先级（数值越高越先运行）                              |
| `--chat-session <id>`     | 将任务关联到聊天会话（默认为 `$TENDRIL_CHAT_SESSION_ID`）       |
| `--wait-for <job-id>`     | 此任务入队前必须已完成的任务 ID（可重复指定）                   |
| `--idempotency-key <key>` | 幂等令牌：重复提交将返回现有任务而非重新创建                    |
| `--force`                 | 即使存在完全相同的运行中任务也强制重新提交                      |
| `--description <text>`    | 任务描述（与 `CreatePlan` 配合使用）                            |
| `--project <name>`        | 目标项目（与 `CreatePlan` 配合使用）                            |
| `--note <text>`           | 执行备注（与 `ExecutePlan` 配合使用）                           |
| `--instructions <text>`   | 调整提示词（与 `UpdatePlan` 配合使用）                          |
| `--change-request <text>` | 审查人员反馈（与 `RetryPlan` 配合使用）                         |
| `--repo <name>`           | 代码仓库（与 `CreateIssue` 配合使用）                           |
| `--assignee <user>`       | GitHub 上的指派用户名（与 `CreateIssue` / `CreatePr` 配合使用） |
| `--reviewer <user>`       | GitHub 上的审查人员用户名（与 `CreatePr` 配合使用，可重复指定） |
| `--draft`                 | 创建为草稿 PR（与 `CreatePr` 配合使用）                         |

```terminal
>tendril job start ExecutePlan 00042
>tendril job start RetryPlan 00042 --change-request "Fix failing unit tests"
>tendril job start CreatePlan --description "Add dark mode toggle" --project MyProject
```

#### job status 与 fail

```terminal
>tendril job status <job-id> --message <text> [--plan-id <id>] [--plan-title <title>]
>tendril job fail <job-id> --message <text>
```

直接向守护进程报告进度遥测数据或任务失败。在执行期间由 Promptware 脚本在内部调用。

#### job cancel 与 delete

```terminal
>tendril job cancel <job-id> [--message <reason>]
>tendril job delete <job-id>
```

- **cancel** — 发送中止信号以停止运行中的任务。
- **delete** — 从数据库中删除任务记录（磁盘上的日志文件会被保留）。

#### job add-log

```terminal
>tendril job add-log <job-id> <action> [--summary <text>]
```

将一条 `## Agent Log` 叙述条目直接追加到 `<TendrilHome>/Jobs/` 下的任务日志文件中。该命令直接在文件系统上操作，不需要服务端守护进程可达。

#### Queue 与 Maintenance

```terminal
>tendril job queue [--json]
>tendril job force-start <job-id>
>tendril job stop-all
>tendril job clear [--completed] [--failed] [--all] [-y/--yes]
>tendril job maintenance
```

- **queue** — 按分发顺序输出待处理任务
- **force-start** — 绕过并发与依赖门禁，立即分发执行任务
- **stop-all** — 取消所有活跃及处于排队状态的任务
- **clear** — 批量删除已完成或失败的任务
- **maintenance** — 立即运行一次任务清理与对齐流程

## chat

在终端中开展交互式智能体编程会话：

```terminal
>tendril chat list [--json]
>tendril chat get <session-id> [--json]
>tendril chat create [--agent <agent>] [--model <model>] [--title <title>] [--effort <level>] [--plan <folder>] [--json]
>tendril chat send <session-id> "<message>" [--agent <agent>] [--model <model>] [--effort <effort>]
>tendril chat delete <session-id>
```

`tendril chat send` 连接到守护进程，分发提示词轮次，并将实时的 token 响应与工具调用事件直接流式传输到标准输出。

## service

跨平台管理 Tendril 后台守护进程的自启动服务：

- **macOS** — 在 `~/Library/LaunchAgents/io.tendril.daemon.plist` 注册 [launchd](https://en.wikipedia.org/wiki/Launchd) agent
- **Linux** — 注册 [systemd](https://systemd.io) 用户服务单元
- **Windows** — 在[任务计划程序 (Task Scheduler)](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-start-page)中注册计划任务

```terminal
>tendril service install [--no-start] [--force]
>tendril service status [--json]
>tendril service uninstall [--purge-binaries] [--force]
```

- **install** — 将当前可执行文件注册为后台服务。使用 `--no-start` 可在下次登录时生效而不立即启动。
- **status** — 报告服务是否已注册、已加载并正在提供服务（包括 URL 和 PID）。
- **uninstall** — 注销自启动配置。使用 `--purge-binaries` 可清理安装在 `<home>/bin` 中的伴随二进制文件 (sidecars)。

## Utilities

#### models

```terminal
>tendril models
>tendril models --refresh
```

列出受支持的 LLM 模型、所属提供商、上下文窗口限制以及实时价格。使用 `--refresh` 可从模型注册表获取最新定价。

#### generate-certs

```terminal
>tendril generate-certs <output-directory>
```

生成一组自签名 `localhost.crt` 和 `localhost.key` PEM 证书对，用于通过 `tendril serve --tls-cert <path> --tls-key <path>` 提供 HTTPS 服务。

#### hash-password

```terminal
>tendril hash-password <password> [secret]
```

使用 [Argon2](https://en.wikipedia.org/wiki/Argon2) 对密码进行哈希运算，以便在 `config.yaml` 的 `auth:` 部分中使用。输出编码后的哈希字符串与 pepper 密钥。

#### project-analyzer

```terminal
>tendril project-analyzer <folder-path>
```

检查目录并输出精简的 YAML 技术栈分析，识别编程语言运行时、包管理器及测试框架。

#### agent-instructions

```terminal
>tendril agent-instructions
```

编译并输出替换好安装路径的完整智能体系统提示词模板，格式化以便通过管道传入自主智能体提示词。

#### wireframe

```terminal
>tendril wireframe setup [path] [--tailwind superset|jit] [--force] [--quiet]
>tendril wireframe serve [path] [--port <port>] [--host <host>] [--no-open]
>tendril wireframe screenshot [path] [--out <path>] [--width <w>] [--height <h>]
>tendril wireframe agent-readme [path]
```

对在起草计划期间设计的 React 线框图进行骨架初始化、本地启动托管、热重载预览以及自动截图。
