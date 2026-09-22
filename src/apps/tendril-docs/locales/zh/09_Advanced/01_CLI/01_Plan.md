---
title: plan
description: 直接在终端中创建、读取、更新和验证计划。当未设置环境变量时，所有子命令均从 TENDRIL_PLANS、TENDRIL_HOME/Plans 或 ~/.tendril/Plans 解析计划目录。
icon: ListChecks
searchHints:
  - plan
  - create
  - list
  - get
  - set
  - update
  - validate
  - repo
  - pr
  - commit
  - verification
  - recommendation
  - rec
  - log
  - revision
  - doctor
  - depends
  - related
  - env
  - wireframes
---

# plan

直接在终端中创建、读取、更新和验证计划。当未设置环境变量时，所有子命令均从 `TENDRIL_PLANS`、`TENDRIL_HOME/Plans` 或 `~/.tendril/Plans` 解析计划目录。

## CRUD

#### plan create

```terminal
>tendril plan create <title> <project> [options]
```

创建一个新的计划目录和初始状态为 `Draft` 的 `plan.yaml` 骨架。计划 ID 会从 `.counter` 文件自动分配。关联的代码仓库与默认验证检查会从项目配置中继承。

| 选项                            | 说明                                 |
| ------------------------------- | ------------------------------------ |
| `--level <level>`               | 优先级级别（默认：Feature）          |
| `--initial-prompt <text>`       | 初始提示词文本                       |
| `--source-url <url>`            | 来源 URL（GitHub Issue 或 PR）       |
| `--execution-profile <profile>` | 执行配置文件（`deep` 或 `balanced`） |
| `--priority <number>`           | 优先级数值（默认：0）                |
| `--verification <Name=Status>`  | 验证条目（可重复指定）               |
| `--related-plan <folder>`       | 关联计划目录名（可重复指定）         |
| `--depends-on <folder>`         | 依赖计划目录名（可重复指定）         |
| `--chat-session <id>`           | 关联到聊天会话                       |
| `--plans-dir <path>`            | 覆盖计划目录路径                     |
| `--no-duplicate-check`          | 跳过针对现有活跃计划的重复项检测     |

#### plan list

```terminal
>tendril plan list [options]
```

通过可选的过滤条件列出计划。

| 选项                       | 作用                                                |
| -------------------------- | --------------------------------------------------- |
| `--status` / `--state <s>` | 按状态过滤（例如 `Draft`、`Executing`、`Failed`）   |
| `-p, --project <name>`     | 按项目名过滤（针对已配置的项目进行验证）            |
| `--level <level>`          | 按级别过滤（例如 `Bug`、`Feature`、`Epic`）         |
| `--has-pr`                 | 仅显示已关联 PR 的计划                              |
| `--has-worktree`           | 仅显示拥有工作区的计划                              |
| `-q, --search <query>`     | 按标题或 ID 中的文本子字符串搜索过滤                |
| `--limit <n>`              | 最大返回结果数                                      |
| `--format <fmt>`           | 输出格式：`table`（默认）、`ids`、`folders`、`json` |
| `--plans-dir <path>`       | 覆盖计划目录路径                                    |

```terminal
>tendril plan list --state Draft
>tendril plan list --project Tendril --level Critical
>tendril plan list --state Failed --format ids
>tendril plan list --format json --limit 10
```

> [!NOTE]
> `plan list` 显示的是计划（来自 `plan.yaml` 文件），而非具体执行的任务。有关任务历史和执行状态，请改用 `job list`（请参阅 [其他命令](05_Other.md#job-list)）。

#### plan get

```terminal
>tendril plan get <plan-id> [field]
```

打印完整的 YAML 内容；若提供了 `[field]`，则输出该单一字段的值。

**标量字段：** `id`, `title`, `state`, `project`, `level`, `created`, `updated`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`, `partialDelivery`

**列表字段：** `repos`, `prs`, `commits`, `verifications`, `dependsOn`, `relatedPlans`, `recommendations`（每项单独占一行）

#### plan set

```terminal
>tendril plan set <plan-id> <field> <value> [options]
>tendril plan set <plan-id> state Completed --allow-failed-verifications
```

更新单个字段并自动刷新 `updated` 时间戳。

支持的字段：`state`, `title`, `level`, `project`, `executionProfile`, `initialPrompt`, `sourceUrl`, `priority`。

当任何验证检查处于 `Fail` 状态时，系统会拒绝将 `state` 设置为 `Completed`：若验证门禁拒绝了产出却将计划标记为已完成，会导致缺少交付物的情况逃过重复项检测。请重新运行验证，或者带有明确原因将其设置为 `Skipped`。传入 `--allow-failed-verifications` 可强制记录状态流转并设置 `partialDelivery: true`。

| 选项                           | 作用                                                 |
| ------------------------------ | ---------------------------------------------------- |
| `--allow-failed-verifications` | 即使存在失败的验证，也允许流转到 `Completed` 状态    |
| `--reason <text>`              | 说明进行此修改的原因（会同步通知正在监听的聊天会话） |
| `--chat-session <id>`          | 发起源聊天会话（自身不会收到通知）                   |

#### plan update

```terminal
>cat revised.yaml | tendril plan update <plan-id> --stdin
>tendril plan update <plan-id> --file revised.yaml
```

从 `--file` 或 `--stdin` 完整替换整个 `plan.yaml` 的内容（必须显式指定来源，`--stdin` 不是隐式的）。

#### plan check-wireframes

```terminal
>tendril plan check-wireframes <plan-id>
```

检查计划修改过的文件中是否存在线框图 (wireframe) 代码残留。若无残留则以退出代码 0 退出；若检测到线框图标记则以退出代码 1 退出并附带诊断报告。

#### plan validate

```terminal
>tendril plan validate <plan-id>
```

检查计划是否包含所有必需字段且内部逻辑一致。若存在结构性错误则以退出代码 `1` 退出。

## Repos

```terminal
>tendril plan add-repo <plan-id> <repo-path> [--reason <text>] [--chat-session <id>]
>tendril plan remove-repo <plan-id> <repo-path> [--reason <text>] [--chat-session <id>]
```

管理与计划关联的代码仓库列表。添加已存在的仓库是幂等的空操作 (no-op)。

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

管理 PR URL、提交 SHA、关联计划和阻塞依赖项。`add-depends-on` 会使 `ExecutePlan` 在执行前等待依赖计划达到 `Completed` 状态并合并其 PR。所有名称均不区分大小写进行匹配。

## Verifications

```terminal
>tendril plan set-verification <plan-id> <name> <status> [--reason <text>] [--chat-session <id>]
>tendril plan verification list <plan-id> [--status <status>] [--json]
>tendril plan verification add <plan-id> <name> [--status <status>] [--reason <text>] [--chat-session <id>]
>tendril plan verification remove <plan-id> <name> [--reason <text>] [--chat-session <id>]
```

管理计划上的验证门禁。有效状态：`Pending`, `Pass`, `Fail`, `Skipped`。`add` 命令的默认状态为 `Pending`。

## Worktrees

#### plan cleanup

```terminal
>tendril plan cleanup <plan-id> [--force]
```

删除与计划关联的所有 Git 工作区 (worktree)。默认情况下仅对处于终态（`Completed`、`Failed`、`Skipped`、`Icebox`）的计划生效。使用 `--force` 可以删除非终态计划的工作区。

#### plan add-worktree

```terminal
>tendril plan add-worktree <plan-id> <repo> [--base <branch>]
```

在 `<plan-folder>/Worktrees/<repo-name>` 下为指定计划创建 Git 工作区，并从 `origin/<base>`（默认：自动检测的默认分支）分支出新分支。分支名称为 `tendril/<plan-folder-name>`。

#### plan remove-worktree

```terminal
>tendril plan remove-worktree <plan-id> <repo-name> [--branch <branch>]
```

从 `Worktrees/<repo-name>` 中删除单个工作区。优先尝试 `git worktree remove --force`；若失败则回退到强制删除文件目录。同时还会删除关联的分支（默认对应 `tendril/<plan-folder>`）。

## Revisions

```terminal
>cat revision.md | tendril plan write-revision <plan-id> --stdin
>tendril plan write-revision <plan-id> --file revision.md
```

从标准输入 (stdin) 或 `--file` 将带编号的修订版本文件（例如 `002.md`）写入 `Revisions/`。支持 `--no-question-check` 跳过校验，以及通过 `--reason` / `--chat-session` 记录审计归属。

```terminal
>tendril plan get-revision <plan-id> [--number <n>]
```

将修订版本内容打印到标准输出 —— 默认打印最新版本，若指定 `--number` 则打印指定编号的版本。

## Questions

修订版本可以通过围栏代码块 `questions` 向用户提出问题：

````markdown
```questions
questions:                    # 1-4 项
  - id:          string       # 必填，在整个修订版本中保持稳定且唯一
    title:       string       # 必填，问题文本
    header:      string       # 可选，不超过 12 个字符的标签
    description: markdown     # 可选，在问题下方显示的上下文说明
    multiple:    bool         # 可选，默认 false；true 表示多选
    options:                  # 2-4 项；若是纯文本自由问答则完全省略
      - title:       string   # 必填，1-5 个单词或短语
        description: markdown # 可选
        value:       slug     # 必填，符合 ^[a-z0-9][a-z0-9-]*$，被 `answer` 引用
        recommended: bool     # 可选，每个问题最多推荐 1 项
    answer:      value | [values] | string   # 用户响应后填入
```
````

`write-revision` 会对照此架构验证每个问题块，并在任何块格式异常时拒绝该修订版本。`--no-question-check` 仅应在自动化测试中使用。

## Recommendations

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

管理计划 YAML 中存储的改进建议：

- **list** — 列出某个计划的建议；按状态过滤：`Pending`, `Accepted`, `AcceptedWithNotes`, `Declined`
- **all** — 列出跨所有计划的建议
- **rebuild** — 从磁盘重新构建非规范化的建议投影数据
- **add** — 影响级别：`Small`, `Medium`, `High`
- **set** — 支持的字段：`title`, `description`, `state`, `impact`, `declineReason`, `notes`
- **accept** — 将状态置为 `Accepted`，若提供了 `--notes` 则置为 `AcceptedWithNotes`
- **decline** — 将状态置为 `Declined`。`--reason` 在 `plan.yaml` 中记录拒绝原因；`--edit-reason` 指定聊天会话的通知原因
- **remove** — 永久删除一条建议

## Environment

```terminal
>tendril plan env materialize <plan-id> [--repo <repo>] [--force] [--json]
>tendril plan env get <plan-id> [--repo <repo>] [--json]
```

检查并写入计划的端口分配与环境变量文件：

- **materialize** — 分配不冲突的服务端口并将环境变量文件写入计划工作区中。使用 `--force` 覆盖现有文件。
- **get** — 打印为工作区分配的端口与解析后的环境变量。

## Doctor

```terminal
>tendril plan doctor [options]
```

扫描计划目录中的每个文件夹并报告健康状态问题。

| 选项            | 作用                                                                |
| --------------- | ------------------------------------------------------------------- |
| `--fix`         | 自动将计划架构迁移至最新版本                                        |
| `--prs`         | 通过 `gh` 对照 GitHub 验证所有记录的 Pull Request                   |
| `--prune-husks` | 清理没有修订版本且无任何工作产物的空计划目录                        |
| `--dry-run`     | 配合 `--prune-husks` 使用，仅报告将被清理的内容而不实际执行删除动作 |

```terminal
>tendril plan doctor
>tendril plan doctor --fix
>tendril plan doctor --prs
>tendril plan doctor --prune-husks --dry-run
```

### 部分交付状态回填

诊断报告会列出标记为 `Completed` 但有处于 `Fail` 状态的验证且未设置 `partialDelivery` 标志的历史计划。这些计划早于完成保护机制的引入。若要确认该部分交付状态：

```terminal
>tendril plan set <id> state Completed --allow-failed-verifications
```
