---
title: 审查
description: "已完成工作的队列：Review 或 Failed 状态的计划。未经您的许可，绝不自动合并。"
icon: ThumbsUp
searchHints:
  - 审查
  - 批准
  - 驳回
  - diff
  - 验证
---

# 审查

审查应用是 Tendril 的质量门禁。当智能体通过 `ExecutePlan`（请参阅 [Promptware](../02_Concepts/02_Promptwares.md)）完成计划执行时，隔离的 [Git](https://git-scm.com) 工作区将被保留并呈现在此处，以供开发者检查、验证和分类决策。未经操作者的明确批准，任何内容都不会合并或提交到您的默认分支。

## 审查队列

侧边栏列出了所有需要开发者关注的计划（处于 `Review` 或 `Failed` 状态的计划）：

- **徽章** — 每行显示计划 `#ID`、项目徽章以及 [验证](../03_Configuration/01_Setup.md#verifications) 状态：
  - `Verified`（绿色）— 所有必需的验证门禁均已通过。
  - `Unverified`（警告黄色）— 一个或多个验证门禁失败，或门禁尚未运行。
  - 状态指示器（例如 `Failed`），以便轻松发现需要排查故障的执行。
- **键盘快捷键** — 使用 `ArrowLeft` 和 `ArrowRight` 在审查队列中的计划之间快速切换。

## 审查工作区

主工作区展示计划的实现及检查工具：

- **计划概览与批注** — 阅读计划规范并留下内联批注（`DraftComment`）以提供具体的逐行反馈。
- **审查操作栏** — 项目配置的审查操作（在 [项目设置](../03_Configuration/02_Projects.md) 的 `reviewActions` 下定义）在工具栏中渲染为一键按钮（例如 `Run E2E`、`Smoke Test`）。
- **打开完整规范与 Diff** — 可从工作区菜单访问，这将在 [计划](03_Plans.md) 中打开计划的完整详情页，以检查多版本 diff、Git 工作区提交可达性以及生成的构建产物。
- **内嵌计划 Chat** — 使用集成的 `PlanChatPanel` 向智能体提问、检查执行逻辑或在批准前明确实现细节。

## 分类决策操作

| 操作                        | 控件                     | 效果                                                                                                                                                                                         |
| --------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Create Pull Request**     | 主行动点 (Primary CTA)   | 通过 [GitHub CLI](https://cli.github.com) (`gh`) 创建 [GitHub](https://github.com) Pull Request，并在 [Pull Requests](06_PullRequests.md) 中将其链接至该计划，同时将计划标记为 `Completed`。 |
| **Push to PR**              | 主行动点（若 PR 已存在） | 将新的工作区提交推送到现有的 Pull Request 分支。                                                                                                                                             |
| **Request Changes**         | 图标按钮（带徽章）       | 打开 `SuggestChangesDialog` 以提交草稿批注与反馈，在现有工作区中启动 `UpdatePlan` [任务](04_Jobs.md)。                                                                                       |
| **Accept Partial Delivery** | 次要按钮                 | 打开 `PartialDeliveryDialog` 接受交付物中可正常工作的模块，同时将剩余待办项留存暂存。                                                                                                        |
| **Reset to Draft**          | 溢出菜单                 | 打开 `ResetToDraftDialog` 将计划移回 [计划](03_Plans.md) 中的 `Draft` 状态以重新调整范围。                                                                                                   |
| **Delete Plan**             | 溢出菜单（破坏性操作）   | 打开 `DeletePlanDialog` 永久删除计划并废弃其隔离的工作区。                                                                                                                                   |
