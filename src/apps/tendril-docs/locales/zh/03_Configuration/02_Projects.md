---
title: 项目设置
description: 每个项目都是一个带有独立验证门禁和智能体上下文的 Git 仓库。Tendril 支持多个项目并行业行。
icon: FolderGit
searchHints:
  - 项目
  - 仓库
  - repository
  - 多项目
  - 隔离
  - 工作区
  - 危险区域
  - mcp
  - 沙箱
---

# 项目设置

Tendril 支持并行管理多个项目。每个项目都定义了自己的 [Git](https://git-scm.com) 仓库、验证门禁、端口分配、环境变量、安全沙箱和自定义技能。

## 添加与管理项目

可以通过 **Settings > Projects** 视觉化配置项目，或在 `$TENDRIL_HOME/config.yaml` 中进行声明（请参阅 [设置与配置](01_Setup.md)）：

- **添加项目向导 (Add Project Wizard)** — 点击设置侧边栏中的 **Add Project**，通过指定仓库路径、初始颜色和默认验证门禁来注册项目。
- **内联重命名 (Inline Renaming)** — 点击标题中项目名称旁边的铅笔编辑图标即可重命名项目。Tendril 会校验是否存在重复的同级项目名，并自动更新关联的计划记录。
- **色块选择器 (Color Swatch Picker)** — 从 32 种 Ivy 调色板色块网格（`ColorSwatchField`）中选择强调色。该颜色在 [仪表盘](../04_Apps/01_Dashboard.md)、[计划](../04_Apps/03_Plans.md) 队列、[审查](../04_Apps/02_Review.md) 队列和 [Pull Requests](../04_Apps/06_PullRequests.md) 追踪器中用于直观区分项目。
- **上下文 (Context)** — 描述领域术语、架构约束和编码规范的 Markdown 说明。此上下文将作为前缀自动附加到该项目所有智能体运行的 Promptware 指令中。

### `config.yaml` 示例

```yaml
projects:
  - name: Global Engine
    color: Emerald
    context: |
      Core engine services written in Rust with a TypeScript CLI.
      Follow standard Ivy design tokens and ensure all tests pass.
    repos:
      - path: ~/repos/global-engine
    verifications:
      - name: Build
        required: true
      - name: Test
        required: true
      - name: Lint
        required: true
      - name: CheckResult
        required: true
    reviewActions:
      - name: Run E2E
        command: pnpm test:e2e
        condition: "${hasChanges}"
    ports:
      backend:
        defaultPort: 8080
        description: API gateway service
    envFiles:
      - path: .env
        template: .env.example
        overrides:
          PORT: "${ports.backend}"
          DATABASE_URL: "sqlite://${env.TENDRIL_HOME}/dev.db"
    wireframes: true
    wireframeGuard: true
    sandboxMode: Off
    securityPreset: Standard
```

## 仓库与 Git 工作区 (Worktrees)

Tendril 项目链接一个或多个 [Git](https://git-scm.com) 仓库（`repos:`）。

当智能体通过 `ExecutePlan` 执行计划时，它会将代码生成与您的本地开发环境隔离开来：

- **专用 Git 工作区 (Dedicated Git Worktrees)** — Tendril 从目标分支检出并创建独立的 Git 工作区分支（`tendril/<planId>-<slug>`）。您的工作树、当前分支和 IDE 均保持原样，不受任何干扰。
- **并发执行** — 多个计划可以在不同仓库中同时执行，而不会产生 Git 锁争用。
- **安全失败与废弃** — 失败或被拒绝的执行运行可以干净地废弃，无需手动执行 Git 清理。
- **工作区回收器 (Worktree Reaper)** — 自动化后台清理程序会根据 [设置与配置](01_Setup.md) 中的 `worktreeReaperInterval` 和 `worktreeReaperGrace` 设置回收闲置或已完成的工作区。

## 验证流水线 (Verification Pipelines)

项目定义了智能体在工作交付至 [审查](../04_Apps/02_Review.md) 之前必须满足的一系列有序验证门禁：

- **可排序顺序** — 通过拖放将验证步骤排布为所需的执行顺序（`SortableVerificationList`）。
- **必需门禁 (Required Gates)** — 将关键验证标记为必需。只有当所有必需的验证都成功时，计划才会在 [审查](../04_Apps/02_Review.md) 中显示为 `Verified`（已验证）。
- **自定义验证** — 添加特定于项目的命令和自定义验证提示（例如 `cargo clippy`、`pnpm check`、`pytest`）。有关命令行管理，请参阅 [CLI 验证](../09_Advanced/01_CLI/03_Verification.md)。

## 审查操作 (Review Actions)

定义渲染在 [审查](../04_Apps/02_Review.md) 应用工具栏中的一键式操作按钮（`reviewActions:`）：

- `name` — 显示在工具栏按钮上的操作标签。
- `command` — 在计划工作区中执行的 Shell 命令。
- `condition` — 可选的执行条件（例如 `${hasChanges}`）。

## 端口与环境文件

复杂项目通常需要隔离的端口和环境配置：

- **端口分配 (`ports:`)** — 声明具名端口（例如 `backend`、`frontend`）。如果默认端口已被占用，Tendril 会分配一个空闲端口并通过 `${ports.<name>}` 占位符暴露。
- **环境文件 (`envFiles:`)** — 根据基础模板（例如 `.env.example`）和逐行键/值覆盖，在智能体工作区内自动重新生成 `.env` 文件，支持 `${ports.<name>}`、`${env.<VAR>}` 和 `%VAR%` 变量。

## 智能体安全与沙箱

Tendril 提供细粒度的项目级安全控制：

- **安全预设 (Security Presets)** — 选择 `Strict`（严格）、`Standard`（标准）、`Permissive`（宽松）或 `Custom`（自定义）。预设配置了默认沙箱和文件访问规则。
- **沙箱模式 (Sandbox Mode)** — 选择运行时隔离：`Off`（关闭）、[Docker](https://www.docker.com) 或 [Bubblewrap](https://github.com/containers/bubblewrap)。
- **外部文件访问** — 控制智能体是否可以读取仓库树外部的文件（`Deny` 拒绝、`ReadOnly` 只读、`Full` 完全访问）。
- **终端自动执行** — 选择智能体是自动执行 Shell 命令（`AllowAll` 允许所有）、要求确认（`RequireConfirmation` 需要确认）还是拒绝命令执行（`DenyAll` 拒绝所有）。
- **文件权限** — 配置细粒度路径规则：`Allow <path>`、`Ask <path>` 或 `Deny <path>`。
- **线框图与守卫 (Wireframes & Wireframe Guard)** — 切换 `wireframes` 以启用计划中的 UI 原型生成，切换 `wireframeGuard` 以确保在合并至生产 PR 之前校验临时线框图代码。

## 项目 MCP 服务器与技能

为特定项目扩展智能体能力：

- **MCP 服务器 (`mcpServers:`)** — 注册具有自定义可执行文件、参数和环境变量的项目级 [Model Context Protocol](https://modelcontextprotocol.io) 服务器。请参阅 [MCP 集成](../09_Advanced/03_MCP.md)。
- **技能 (`skills:`)** — 为智能体配备项目特定的操作规程和 Markdown 说明。请参阅 [技能指南](../06_CodingAgents/00_Skills.md)。

## 仓库本地上下文

Tendril 会自动检测并将仓库根目录下的文档附加到 Promptware 上下文前：

- **`CLAUDE.md`** — Claude Code 的指引与规范。请参阅 [Claude Code 指南](../06_CodingAgents/01_ClaudeCode.md)。
- **`AGENTS.md` / `DEVELOPER.md`** — 团队开发标准、测试要求和代码库规范。

## 危险区域：移除 (Remove) 与删除 (Delete)

项目设置的底部在“危险区域”中提供了两个不同的销毁选项：

```
[ Remove Project ]  (轮廓按钮)
从 config.yaml 中移除该项目。克隆的仓库、计划文件夹和历史记录
仍保留在磁盘上，因此通过同名重新添加项目即可恢复。

[ Delete Project ]  (破坏性操作)
永久删除该项目的计划、位于 <TENDRIL_HOME>/Projects/ 下的克隆仓库、
数据库记录及其配置条目。此操作无法撤销，并要求您先输入项目名称确认。
```

> [!WARNING]
> **Remove Project** 仅从配置中注销项目，同时保留磁盘上的文件。**Delete Project** 则会永久擦除仓库、计划和数据库记录，并要求输入确切的项目名称进行确认。
