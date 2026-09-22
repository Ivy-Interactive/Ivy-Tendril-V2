---
title: Pull Requests
description: 在 Review 批准 CreatePr 后，从 Tendril 中追踪并打开 GitHub PR。
icon: GitPullRequest
searchHints:
  - pull requests
  - pr
  - 合并
  - github
---

# Pull Requests

Pull Requests 应用为所有根据已批准 Tendril 计划创建的 [GitHub](https://github.com) Pull Request 提供跨项目追踪。它提供了一个单一仪表盘，用于监控哪些 PR 处于开启、已合并或已关闭状态，以及与每次交付相关的 Token 支出和成本。

## PR 生命周期与工作流

1. **审批** — 计划完成执行并在 [审查](02_Review.md) 中获得批准后，点击 **Create Pull Request** 将启动 `CreatePr` Promptware（请参阅 [Promptware](../02_Concepts/02_Promptwares.md)）。
2. **创建** — Tendril 使用 [GitHub CLI](https://cli.github.com) (`gh`) 推送隔离的 [Git](https://git-scm.com) 工作区分支，并在 [GitHub](https://github.com) 上发起附带 AI 生成摘要的 Pull Request（请参阅 [GitHub 集成](../07_Integrations/01_Github.md)）。
3. **追踪** — Pull Request 与计划关联，并在该视图中持续追踪，直到合并或关闭。

## Pull Requests 列表

该表列出了跨项目记录的每个 Pull Request：

| 列             | 说明                                                  | 交互                                                                     |
| -------------- | ----------------------------------------------------- | ------------------------------------------------------------------------ |
| **Plan**       | 计划 `#ID` 与标题。                                   | 点击打开展示完整计划规范的侧滑预览抽屉。                                 |
| **Project**    | 项目徽章。                                            | 显示在 [项目设置](../03_Configuration/02_Projects.md) 中定义的项目颜色。 |
| **Status**     | 状态徽章（`Open`、`Merged`、`Closed` 或 `Unknown`）。 | 悬停提示显示最后一次 GitHub 检查的时间戳。                               |
| **PR**         | GitHub Pull Request 编号（例如 `#84`）。              | 点击在默认浏览器中打开 [GitHub](https://github.com) 上的 Pull Request。  |
| **Tokens**     | 该计划累计消耗的 Token。                              | 紧凑的 Token 计数（例如 `450K`、`1.2M`）。                               |
| **Cost**       | 该计划所有任务的总美元成本。                          | 格式化的货币支出。                                                       |
| **Repository** | GitHub 目标仓库（`owner/repo`）。                     | 完整目标仓库路径。                                                       |
| **Branch**     | Git 分支名称。                                        | 仓库中的源分支。                                                         |

## 筛选与同步

- **状态筛选器** — 使用表格上方的状态徽章选择器按 `Open`、`Merged`、`Closed` 或 `Unknown` 筛选。
- **搜索** — 实时跨计划 ID、标题、项目名称、仓库或分支名称筛选行。
- **与 GitHub 重新同步** — 点击 **Resync** 按钮对已配置的代码仓库执行一次同步扫描（`gh pr list`）。Tendril 将报告任何不可达、未认证或受到速率限制的仓库。

> [!NOTE]
> 已合并的 Pull Request 为最终终态，在定期同步过程中不会重复检查。

## 行操作

每个 Pull Request 行提供四个快速操作：

- **View Plan** — 导航至 [计划](03_Plans.md) 应用中的计划详情工作区。
- **Follow Up** — 打开已预填仓库、项目和分支引用的“新建计划”对话框，以便您在 [计划](03_Plans.md) 中轻松搭手后续任务、缺陷修复或细化修改。
- **Open PR** — 在 Web 浏览器中打开 [GitHub](https://github.com) 上的 Pull Request。
- **Resync** — 从 GitHub 刷新该特定仓库的状态。
