---
title: 教程
description: >-
  完整的端到端演练：构建 Tendril、注册本地仓库、创建您的第一个计划、由智能体执行、审查结果并提交 Pull Request。
icon: GraduationCap
searchHints:
  - 教程
  - 演练
  - 快速入门
  - 第一个计划
  - 端到端
  - 示例
---

# 教程

这是在您选定的代码仓库上运行的完整端到端工作流。涵盖了注册项目、生成计划、在隔离的工作区中执行更改、审查 diff 以及提交 Pull Request 的全过程。

## 步骤 1：构建与验证

按照 [安装](02_Installation.md) 说明安装或构建 Tendril，并将 `tendril` 添加到您的 `PATH` 中。验证您的环境：

```bash
tendril doctor
```

`tendril doctor` 会检查 `$TENDRIL_HOME`、`config.yaml`、[SQLite](https://www.sqlite.org) 数据库、plans 目录、[Git](https://git-scm.com/) 和 [GitHub CLI](https://cli.github.com/) (`gh`)。在继续之前，请解决所有提示 `[FAIL]` 的项目。

## 步骤 2：启动 Tendril

启动桌面应用程序：

```bash
pnpm dev:desktop
```

桌面应用启动并在后台自动监管 `tendril run` 守护进程。该守护进程暴露了桌面 UI 和 CLI 进行通信所需的 REST 和 WebSocket API。

如果您更喜欢以无头模式运行守护进程：

```bash
# 检查端口并运行挂起的数据库迁移
tendril run

# 或使用自定义选项直接运行监听器：
tendril serve --host 127.0.0.1 --port 5010
```

## 步骤 3：注册您的代码仓库

Tendril 需要一个本地 Git 仓库来开展工作：

```bash
git clone https://github.com/your-org/your-repo.git
```

通过桌面应用的 **Settings → Projects** 注册项目，或使用 CLI 注册：

```bash
tendril project add MyProject
tendril project add-repo MyProject /Users/you/Repos/MyProject
tendril project add-verification MyProject CheckResult
```

这两种方式都会更新 `$TENDRIL_HOME/config.yaml`，您也可以手动进行编辑：

```yaml
codingAgent: claude

projects:
  - name: MyProject
    repos:
      - path: /Users/you/Repos/MyProject
    verifications:
      - name: NpmBuild
        required: true
      - name: CheckResult
        required: true
```

将 `codingAgent` 设置为您已安装的智能体：

- [Claude Code](https://code.claude.com/docs) (`claude`)
- [OpenAI Codex](https://openai.com) (`codex`)
- [GitHub Copilot](https://github.com/features/copilot) (`copilot`)
- [Google Gemini](https://ai.google.dev) (`gemini`)
- [OpenCode](https://opencode.ai) (`opencode`)
- Antigravity (`antigravity` / `agy`)
- [Cursor](https://www.cursor.com) (`cursor`)
- Apple Foundation Models（通过设备端 `fm` 实现的 `apple`）

> [!TIP]
> 在您的代码仓库根目录下添加一个 `AGENTS.md` 文件，详细说明架构规范和构建命令。Tendril 会在每次运行时将其注入到智能体的系统上下文中。有关建议请参阅 [代码库准备](03_Onboarding.md)。

## 步骤 4：创建计划

在桌面应用中点击 **New Plan** 并输入任务描述。Tendril 会调度 [CreatePlan](../02_Concepts/02_Promptwares.md) 工作流智能体，起草一份包含问题陈述、分阶段解决方案和验证目标的结构化计划。

您也可以通过 CLI 创建计划：

```bash
tendril plan create "Add a health-check endpoint" MyProject
```

计划将进入 **Draft**（草稿）状态。打开计划草稿以检查建议的规范。您可以直接在 UI 中添加内联批注以调整范围或添加约束，促使 [UpdatePlan](../02_Concepts/02_Promptwares.md) 将您的反馈综合为修订版本。

## 步骤 5：执行计划

一旦草稿符合您的要求，点击 **Execute**（或运行 `tendril plan execute <plan-id>`）。[ExecutePlan](../02_Concepts/02_Promptwares.md) 智能体将：

1. 在 `Worktrees/{repo-name}/` 下创建一个隔离的 [Git 工作区 (worktree)](https://git-scm.com/docs/git-worktree)，保持您的主分支不受影响；
2. 加载计划规范、代码仓库上下文和记忆笔记；
3. 伴随递增的 Git 提交分阶段实施代码修改；
4. 运行每个配置的验证门禁（构建、lint、测试、截图）。

在桌面的 **Jobs** 视图中或通过 CLI 实时监控执行进度：

```bash
tendril job list          # 查看任务状态
tendril job queue         # 检查调度队列顺序
```

当所有阶段完成且所需的验证通过后，计划将转换为 **Review**（审查）状态。

> [!NOTE]
> 如果验证检查失败，计划将进入 **Failed**（失败）状态，并且工作区会保留在磁盘上。检查 `Verification/` 下的错误报告，或运行 [RetryPlan](../02_Concepts/02_Promptwares.md) 让智能体修复问题。

## 步骤 6：审查结果

导航至计划的 **Review** 页面以检查工作成果：

- **Git Diff** — 浏览涉及文件的语法高亮 diff；
- **验证报告** — 查看自动化构建与测试输出；
- **执行转写记录** — 查看工具调用轨迹、标准输出/错误输出以及 Token 开销；
- **后续建议** — 检查智能体标记的技术债务或改进建议。

满意后批准计划。Tendril 会触发 [CreatePr](../02_Concepts/02_Promptwares.md) 通过 [GitHub CLI](https://cli.github.com/) (`gh`) 创建 Pull Request，并将计划置为 **Completed**（已完成）。

## 流程回顾

您刚刚完成了标准的 Tendril 开发闭环：

```
Draft → Creating → Executing → Review → Completed
```

自主智能体在沙盒工作区中运行，满足了您的验证门禁，并生成了经过审计的 Pull Request，同时将所有 prompt、diff 和开销记录在 `$TENDRIL_HOME/Plans/` 下。

## 后续步骤

- [计划](../02_Concepts/01_Plans.md) — 深入了解计划结构、状态及批注。
- [Promptware](../02_Concepts/02_Promptwares.md) — 自定义工作流智能体的 prompt、工具与记忆。
- [生命周期与任务](../02_Concepts/03_Lifecycle.md) — 理解并发、排队与遥测机制。
