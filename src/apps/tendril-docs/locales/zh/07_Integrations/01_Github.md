---
title: GitHub
description: Tendril 与 GitHub 集成，用于 Issue 导入、自动创建 PR 以及 PR 状态跟踪。
icon: GitBranch
searchHints:
  - github
  - issues
  - pull requests
  - prs
  - import
---

# GitHub

## 身份验证

Tendril 使用 [GitHub CLI](https://cli.github.com) (`gh`) 进行 [GitHub](https://github.com) 的身份验证。在使用 GitHub 功能之前，请运行 `gh auth login` 进行身份验证。

> [!NOTE]
> 确保已安装 `gh` 并可在 PATH 中访问。如果缺失，Tendril 会在入门引导期间向您提示。

## 通过收件箱导入 Issue

Tendril 在侧边栏提供专用的 **Inbox**（收件箱）视图，用于浏览 [GitHub](https://github.com) Issue 并将其转化为[计划](../02_Concepts/01_Plans.md)：

1. 从导航侧边栏打开 **Inbox**。
2. 选择分类：
   - **My Issues**：在已配置的项目代码库中分配给您的 Issue。
   - **Review Requests**：请求您审查的待处理 Pull Request。
   - **Project Issues**：所选项目代码库的所有待处理 Issue。
3. 按搜索词、标签或里程碑进行筛选。单次查询最多可检索 1,000 个未解决的 Issue（GitHub 的搜索上限）。
4. 选择一个或多个 Issue 并点击 **Create Plan**（创建计划）以启动 `CreatePlan` [promptware](../02_Concepts/02_Promptwares.md)，或者在触发前在“新建计划”对话框中自定义计划描述。

每个创建的计划都保留源 URL，直接链接回原始 GitHub Issue。

### 自动 Issue 扫描与提案

Tendril 包含针对已分配 GitHub Issue 的后台自动扫描功能：

- 配置 `inbox.checkIntervalMinutes`（或点击 Inbox 视图中的设置齿轮）以设置 Tendril 查询 GitHub 获取新分配 Issue 的频率。
- **自动接受模式 (Auto-Accept Mode)**：启用 `inbox.autoAcceptAssignedIssues` 时，新发现的 Issue 会立即启动 `CreatePlan` 作业。
- **提案模式 (Proposals Mode)**：禁用时，扫描到的 Issue 将作为 **Inbox Proposals**（收件箱提案）暂存在 Inbox 视图中。您可以查看每个提案的描述，并选择 **Accept**（接受，启动计划）或 **Dismiss**（忽略，保存持久记录以避免再次导入该 Issue）。
- 点击 Inbox 工具栏中的 **Check Now**（立即检查）可触发立即手动扫描，无需等待计划计时器。

## 创建 Pull Request

当计划完成并验证其更改后，打开 **Create PR** 对话框创建 Pull Request：

1. 审查并编辑生成的 PR 标题、描述和审查人员。
2. 配置 PR 选项：
   - **Solve Merge Conflicts**：自动尝试解决针对目标基准分支的合并冲突。
   - **Merge**：一旦检查通过即合并 PR（取消选中则保持 PR 开放供团队审查而不立即合并）。
   - **Delete Branch**：合并后删除 worktree 分支。
   - **Include Artifacts**：将计划验证产物、屏幕截图和日志附加到 PR 正文中。
   - **Create as Draft**：以草稿状态创建 Pull Request。
3. Tendril 通过 `gh` 运行 `CreatePr` [promptware](../02_Concepts/02_Promptwares.md) 来推送分支、创建 Pull Request，并将 PR URL 链接到计划。

## PR 状态跟踪

侧边栏中的 [Pull Requests 视图](../04_Apps/06_PullRequests.md) 跟踪项目中所有打开、已合并和已关闭的 Pull Request。Tendril 监控 PR 状态变化，无需人工干预即可使您的[计划看板](../04_Apps/03_Plans.md)保持同步。
