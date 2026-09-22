---
title: CLI 概览
description: 直接在终端中管理计划、项目、数据库和智能体。tendril 二进制文件既充当服务端守护进程，又是全功能的 CLI 工具。
icon: Terminal
searchHints:
  - cli
  - 命令
  - 终端
  - tendril
  - shell
  - reset
  - report-bug
  - run
  - serve
  - doctor
  - version
  - config
---

# CLI 概览

直接在终端中管理计划、项目、数据库和智能体。`tendril` 二进制文件既充当服务端守护进程，又是全功能的 CLI 工具。

Tendril CLI 让您无需触碰 UI 即可完全掌控工作流程：

- **计划 (Plans)** — 创建、列出、更新和检查计划；管理代码仓库、工作区 (worktrees)、验证门禁以及改进建议
- **项目 (Projects)** — 配置项目及其仓库、构建依赖项、审查动作、MCP 服务端以及自定义技能
- **验证门禁 (Verifications)** — 定义和管理可复用的验证检查
- **配置 (Config)** — 读取并更新保存在 `config.yaml` 中的顶层设置
- **配置库 (Vault)** — 连接团队配置库、发现远程代码仓库、同步资产，以及导入或推送项目
- **数据库 (Database)** — 运行数据库迁移、检查架构版本、重置数据表、检查完整性以及清理碎片 (vacuum)
- **智能体与任务 (Agents & Jobs)** — 运行 Promptware、管理后台任务，以及开展交互式聊天会话

## 快速上手

**1. 检查安装状态**

```terminal
>tendril doctor
```

**2. 启动守护进程服务**

```terminal
>tendril run
```

**3. 创建新计划**

```terminal
>tendril plan create "Fix login bug" MyProject
```

**4. 列出活跃计划**

```terminal
>tendril plan list --state Executing
```

**5. 重置所有数据并重新开始**

```terminal
>tendril reset
```

> [!TIP]
> 每个命令均支持 `--help` 查看详细用法。例如：`tendril plan create --help`。

## 全局选项

| 标志            | 作用                                                         |
| --------------- | ------------------------------------------------------------ |
| `--home <path>` | Tendril 主目录路径（也可以通过 `TENDRIL_HOME` 环境变量设置） |

## 环境变量

| 变量            | 用途                                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `TENDRIL_HOME`  | 配置、数据库、收件箱和计划的根目录（默认为 `~/.tendril` 或 `D:\.tendril`）                                                                     |
| `TENDRIL_PLANS` | 覆盖计划目录路径（默认为 `TENDRIL_HOME/Plans`）                                                                                                |
| `RUST_LOG`      | 输出到 stderr 的进程日志过滤指令（默认：`warn,tendril_cli=info,tendril_core=info,tendril_server=info`）。设置为 `debug` 可获取详细的诊断日志。 |

## 常用命令

#### doctor

```terminal
>tendril doctor
>tendril doctor --rebuild-search-index
```

验证您的 Tendril 安装状态 —— 检查 `TENDRIL_HOME`、`config.yaml`、必要工具（`git`、`gh`）、数据库连通性以及智能体模型的可用性。使用 `--rebuild-search-index` 可从数据库重新生成全文搜索索引。

#### plan doctor

```terminal
>tendril plan doctor
>tendril plan doctor --fix
>tendril plan doctor --prs
>tendril plan doctor --prune-husks --dry-run
```

扫描每个计划目录并报告健康状态：缺少或格式损坏的 `plan.yaml`、陈旧残留的工作区，以及在验证失败的情况下仍处于 `Completed` 状态的计划。完整的选项与健康代码参考请参阅 [Plan](01_Plan.md#doctor)。

#### serve 与 run

```terminal
>tendril serve --port 5010 --host 127.0.0.1
>tendril serve --tls-cert /path/localhost.crt --tls-key /path/localhost.key
>tendril run
```

`tendril serve` 启动 HTTP 和 WebSocket API 服务（默认端口 `5010`，主机 `127.0.0.1`）。可选的 `--tls-cert` 和 `--tls-key` 标志用于提供 HTTPS 服务。

`tendril run` 先验证目标端口是否可用，自动应用所有待处理的数据库迁移，然后启动守护进程。

#### reset

```terminal
>tendril reset
>tendril reset --force
```

从机器上删除所有 Tendril 数据 —— 删除 `TENDRIL_HOME` 和 `TENDRIL_PLANS`。除非提供 `--force`，否则会弹出确认提示。

> [!WARNING]
> 这将永久删除目标目录中的所有计划、任务和配置数据。

#### report-bug

```terminal
>tendril report-bug --plan 00042
>tendril report-bug --job 00150 -d "Agent failed to create worktree"
>tendril report-bug --plan 00042 --out ~/Desktop/diagnostics.zip
>tendril report-bug --plan 00042 --submit --yes
```

收集计划文件和每项任务工件 —— `<TendrilHome>/Jobs/` 下的 Job Log、Job Prompt、Job Raw Log 和 Job Eventwire Log —— 打包到带有脱敏配置和健康诊断信息的 zip 压缩包中。当同时指定 `--submit` 和 `--yes` 时，将上传该压缩包并自动创建 GitHub Issue。

| 选项                    | 作用                                       |
| ----------------------- | ------------------------------------------ |
| `--plan <id>`           | 包含此计划目录以及针对其运行的所有任务     |
| `--job <id>`            | 包含此任务的四个工件加上其对应计划的上下文 |
| `-d, --description <t>` | 缺陷描述（若省略则进入交互式输入）         |
| `--out <path>`          | zip 压缩包的目标路径                       |
| `--github-user <name>`  | 用于 Issue 后续跟进的 GitHub 用户名        |
| `--submit`              | 上传报告到 GitHub（需要配合 `--yes`）      |
| `-y, --yes`             | 跳过确认提示                               |

> [!WARNING]
> 提交报告会将 zip 诊断包附加到**公开**的 GitHub Issue 中。配置和任务日志中的敏感信息（如密钥）已被剔除，但提交前仍请仔细核对计划内容。

#### version

```terminal
>tendril version
```

输出当前安装的 Tendril 版本（例如：`tendril v2.0.0`）。

#### update-promptwares

```terminal
>tendril update-promptwares
>tendril update-promptwares --dry-run
>tendril update-promptwares --source /path/to/promptwares
```

刷新部署在 `<TendrilHome>/Promptwares/` 中的 Promptware，同时保留其中的 `Memory/` 和 `Tools/` 目录。

## 后续步骤

- [Plan 命令](01_Plan.md) — 创建和管理计划的完整参考
- [Project 命令](02_Project.md) — 配置项目、仓库、审查动作、MCP 服务端及技能
- [Verification 命令](03_Verification.md) — 管理全局验证定义
- [Database 命令](04_Database.md) — 数据库迁移、架构版本、完整性检查及清理
- [Other 命令](05_Other.md) — Promptware、任务、聊天、服务及实用工具
- [Config 命令](06_Config.md) — 读取并更新顶层 `config.yaml` 设置
- [Vault 命令](07_Vault.md) — 连接团队配置库、同步资产，以及导入或发布项目
