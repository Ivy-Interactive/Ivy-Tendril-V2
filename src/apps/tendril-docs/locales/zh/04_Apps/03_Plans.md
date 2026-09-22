---
title: 计划
description: "处于 Draft（或 Blocked）状态的计划：在执行前规范和完善工作内容（PlansApp）。"
icon: Feather
searchHints:
  - 草稿
  - 计划
  - 构想
  - 阻塞
  - makeplan
---

# 计划

计划应用是 Tendril 用于在执行代码更改之前规范、细化和准备工程任务的工作区。在运行智能体执行任务之前先制定计划，可以确保需求、架构和验证步骤清晰明确。

## 管理草稿

- **创建计划** — 按 `Ctrl+Alt+N`（macOS 上为 `Cmd+Option+N`）或点击外壳标题栏中的 **+ New Plan** 打开创建对话框。
- **草稿队列** — 侧边栏列出了所有处于 `Draft` 或 `Blocked` 状态的计划。当前在执行任务中运行的计划会被安全地移出草稿队列，以避免并发编辑冲突。
- **徽章** — 每个草稿都显示其 `#ID` 标签、标题、项目徽章以及使用项目配置的层级调色板设置样式的复杂度层级徽章（例如 L1、L2、L3）。
- **流程壁纸** — 当队列为空时，Tendril 会显示交互式流程生命周期壁纸，并提供导航至计划、[审查](02_Review.md) 和 [任务](04_Jobs.md) 的入口。

## 计划工作区 (`PlanWorkspace`)

选择计划将打开功能丰富的工作区界面：

### 标签页

- **Plan（计划）** — 以 [Markdown](https://www.markdownguide.org) 显示最新的计划规范版本，带有实时任务清单、问题描述、提议方案和验证标准。
- **Details（详情）** — 计划元数据、分配的项目上下文（来自 [项目设置](../03_Configuration/02_Projects.md)）、创建/更新时间戳以及修订历史。
- **Diff View（差异视图）** — 当计划具有多个版本时出现（`revisionCount > 1`），提供版本之间的并排对比或统一 diff 对比。
- **Recommendations（建议）** — 列出为此计划生成的积极主动的 [改进建议](07_Recommendations.md)，带有内联的接受 (Accept) 和拒绝 (Decline) 分类控件。
- **Git** — 一旦存在执行产物即会显示。追踪活动的 [Git](https://git-scm.com) 工作区、记录的提交、PR 引用（请参阅 [Pull Requests](06_PullRequests.md)），并在未合并提交存在丢失风险时发出警告，并提供将工作区与远程同步的按钮。

### 面板与 Chat

- **验证面板 (Verifications Panel)** — 可从右上角下拉菜单访问，该面板显示已配置的 [验证](../03_Configuration/01_Setup.md#verifications) 门禁（`Build`、`Test`、`Lint` 等）及其实时通过/失败状态和输出日志。
- **计划 Chat (Plan Chat)** — 内嵌的交互式 Chat 面板（`PlanChatPanel`），用于在启动代码修改之前集思广益、完善方案或向智能体询问有关计划的问题。

## Promptware 操作

有关这些工作流如何执行的背景信息，请参阅 [Promptware](../02_Concepts/02_Promptwares.md)：

| 操作                 | 目的                                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **ExecutePlan**      | 锁定最新计划修订版本，创建隔离的 [Git](https://git-scm.com) 工作区分支，并启动 [编程智能体](../06_CodingAgents/_Index.md) 以实现修改。 |
| **ExpandPlan**       | 提示智能体将简要概述扩充为包含详细步骤、目标文件和测试方案的结构化计划。                                                               |
| **SplitPlan**        | 将大型或复杂的计划拆分为能够独立执行的更小、更专注的子计划。                                                                           |
| **Shelve to Icebox** | 将计划移至 [待办箱](05_Icebox.md) 以清理活动队列，同时保留所有上下文。                                                                 |
| **Delete Plan**      | 弹出确认提示以永久删除计划文件夹和记录。                                                                                               |

## 磁盘文件与实时同步

每个计划均由 `$TENDRIL_HOME/plans/<planId>/` 下的目录支持：

- `plan.yaml` — [YAML](https://yaml.org) 格式的计划元数据、状态、项目关联以及验证记录。请参阅 [CLI 计划管理](../09_Advanced/01_CLI/01_Plan.md)。
- `revisions/` — 代表规范每次迭代的版本化 Markdown 文件（`001.md`、`002.md` 等）。
- `costs.csv` — 仅追加写入的 Token 与成本分类账。

Tendril 使用文件系统监听器来检测在外部文本编辑器或 IDE 中所做的编辑，无需手动刷新即可实时更新 UI。
