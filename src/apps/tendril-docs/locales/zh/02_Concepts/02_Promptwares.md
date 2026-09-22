---
title: Promptware
description: >-
  Promptware 是每个计划阶段背后的专用工作流智能体 —— 各自拥有独立的提示词、工具和长期记忆。
icon: Terminal
searchHints:
  - promptware
  - 智能体
  - 提示词
  - 工具
  - 记忆
  - allowedTools
  - profile
  - customInstructions
  - 分层
---

# Promptware

Promptware 是一个包含用于定义单用途工作流智能体的指令、工具和记忆的目录。已部署的副本保存在 `$TENDRIL_HOME/Promptwares/` 下，每个 Promptware 对应一个目录：

- **Program.md** — 系统提示词：包含智能体的目标、分步操作流程和执行规则。
- **Tools/** — 智能体在运行期间可调用的可执行脚本与实用程序。
- **Memory/** — 跨多次运行持久化保存的 Markdown 笔记。这一反馈闭环使 Promptware 能够学习代码库的特质并持续改进，而不是重蹈覆辙。

Tendril 通过您配置的编程智能体（例如 [Claude Code](../06_CodingAgents/01_ClaudeCode.md)、[Codex](../06_CodingAgents/02_Codex.md)、[Copilot](../06_CodingAgents/03_Copilot.md)、[Gemini](../06_CodingAgents/05_Gemini.md)、[OpenCode](../06_CodingAgents/04_OpenCode.md)、Antigravity 或 [Cursor](https://www.cursor.com)）调度 Promptware，以最小权限工具授权一次执行一个任务。

## 部署与分层

Tendril 内置了一套标准的平台级 Promptware。团队还可以在 [config.yaml](../03_Configuration/01_Setup.md) 中配置覆盖层目录，以覆盖系统提示词或提供自定义团队工具。

部署或刷新 Promptware：

```bash
tendril promptware deploy
```

检查某个 Promptware 运行的是内置基线还是团队覆盖层：

```bash
tendril promptware layers
# 或检查特定的 Promptware：
tendril promptware layers ExecutePlan
```

## 核心工作流智能体

| Promptware       | 角色                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| **CreatePlan**   | 从简要需求、收件箱条目或 [GitHub](https://github.com) Issue 起草计划。                                |
| **ExpandPlan**   | 将简略的计划充实为包含阶段划分的可实施规范。                                                          |
| **UpdatePlan**   | 根据评审者反馈、对话和内联批注修订现有计划。                                                          |
| **SplitPlan**    | 将大型计划拆解为更小、更独立的子计划。                                                                |
| **ExecutePlan**  | 创建隔离的 [Git 工作区 (worktree)](https://git-scm.com/docs/git-worktree)、实施计划各阶段并运行测试。 |
| **RetryPlan**    | 利用日志和 diff 对验证失败的计划重新尝试修复。                                                        |
| **CreatePr**     | 使用 [GitHub CLI](https://cli.github.com/) (`gh`) 基于工作区 diff 创建 GitHub Pull Request。          |
| **CreateIssue**  | 将计划失败、状态或分诊请求推送到 GitHub Issue。                                                       |
| **AddProject**   | 注册新项目并配置其代码仓库路径。                                                                      |
| **SetupProject** | 确定并记录项目的构建、运行和验证方式。                                                                |
| **SyncRepo**     | 使项目的代码仓库与上游分支保持同步更新。                                                              |

## 配置

每个 Promptware 均在 [~/.tendril/config.yaml](../03_Configuration/01_Setup.md) 的 `promptwares:` 键下进行配置：

```yaml
promptwares:
  _default:
    profile: balanced

  CreatePlan:
    profile: deep
    allowedTools:
      - Read
      - Glob
      - Grep
      - Bash
      - Write(%PLANS_DIR%/**)
    deniedTools:
      - WebFetch
    customInstructions: |
      Always include acceptance criteria and verification gates in the plan.
```

| 字段                 | 必填 | 描述                                                                                                                      |
| -------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------- |
| `profile`            | 是   | 使用的智能体 profile — `quick`、`balanced` 或 `deep`。Profile 映射到每个智能体的模型与思考工作量级别。                    |
| `allowedTools`       | 否   | 在内置默认权限之上额外授予的工具。支持 `%PROMPTWARE_DIR%`、`%PLAN_DIR%` 和 `%PLANS_DIR%` 变量，以限定工具授权的作用路径。 |
| `deniedTools`        | 否   | 明确拒绝的工具，即使其他规则授予了该工具也会被拒绝。                                                                      |
| `customInstructions` | 否   | 注入到智能体提示词中的自由文本，带有优先级覆盖标记。                                                                      |

`_default` 条目是应用于每个 Promptware 的基线；指定名称的条目将对其进行覆盖。

### 自定义指令 (Custom instructions)

设置 `customInstructions` 时，Tendril 会将其附加到编译后的固件提示词中，并带有显式的优先级标记。智能体被指示优先遵循该指令，高于固件模板和 Promptware 自身的 `Program.md`。可用于针对特定 Promptware 进行行为覆盖，而无需修改共享程序文件。

## 执行流程

1. **上下文准备** — 编译 `Program.md`，附加计划、内联批注、项目配置以及来自 `config.yaml` 的任何 `customInstructions`。
2. **工具与权限** — 暴露 `Tools/` 和配置的工具授权，将 `%...%` 变量展开为绝对路径。可写目录被严格限制在计划文件夹、Promptware 的 `Memory/` 以及代码仓库的 Git 工作区内。
3. **运行** — 在隔离的工作区中将编程智能体作为后台任务进程启动。
4. **捕获与遥测** — 将实时输出流式传输到 `$TENDRIL_HOME/Jobs/{jobId}-{planId}-{promptware}/`，向守护进程发送进度，并在计划的 `costs.csv` 中记录 Token 用量和成本。

## 记忆与学习

记忆构成了反馈闭环：Promptware 记录下它了解到的项目特性或失败模式，并在以后的运行中回读。CLI 直接暴露了记忆管理功能：

```bash
# 列出某个 Promptware 保存的记忆笔记
tendril promptware list-memory ExecutePlan

# 读取特定的记忆笔记
tendril promptware read-memory ExecutePlan worktree-hygiene.md

# 从文件（或标准输入）写入或更新记忆笔记
tendril promptware write-memory ExecutePlan worktree-hygiene.md --file notes.md

# 删除已过时或无效的记忆笔记
tendril promptware delete-memory ExecutePlan worktree-hygiene.md
```

> [!TIP]
> 记忆既需要积累也需要修剪 —— 已经过时的假设或规则应使用 `delete-memory` 删除，而不是掩埋在互相矛盾的笔记之下。

## 直接执行

若要绕过守护进程任务服务在前端直接测试或运行 Promptware：

```bash
# 使用任务提示词直接运行 CreatePlan
tendril promptware run CreatePlan "Add a health-check endpoint" --profile deep

# 仅输出编译后的固件提示词而不启动智能体
tendril promptware run CreatePlan "Add a health-check endpoint" --dry-run
```

## 后续步骤

- [生命周期与任务](03_Lifecycle.md) — 了解单个 Promptware 运行过程中发生的情况。
- [计划](01_Plans.md) — 每个 Promptware 所读取和写入的核心工件。
