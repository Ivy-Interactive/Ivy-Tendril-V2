---
title: 生命周期与任务
description: >-
  任务是单个 Promptware 的一次运行。本文介绍其运行过程中的各个环节 —— 状态、输出、验证与成本。
icon: RefreshCw
searchHints:
  - 任务
  - 生命周期
  - 状态
  - 验证
  - 工作区
  - 并发
  - 成本
  - token
  - 队列
  - stop-all
---

# 生命周期与任务

每当 Tendril 代表您执行操作时，都会创建一个**任务 (job)**：即针对单个 [计划](01_Plans.md) 运行一次 [工作流智能体 (Promptware)](02_Promptwares.md)。任务是计划推进其生命周期的载体，也是您在桌面应用和 CLI 中实时观察的内容。

## 任务状态

| 状态          | 含义                                           |
| ------------- | ---------------------------------------------- |
| **Pending**   | 已创建，尚未进入调度队列。                     |
| **Queued**    | 正在等待可用的并发执行槽位。                   |
| **Running**   | 编程智能体进程正在活跃执行中。                 |
| **Completed** | 成功执行完毕并通过了所有必需的门禁。           |
| **Failed**    | 智能体发生错误，或必需的验证检查失败。         |
| **Timeout**   | 超过配置的执行时间上限并被终止。               |
| **Stopped**   | 由用户操作主动停止。                           |
| **Blocked**   | 无法继续 —— 正在等待依赖任务、凭据或用户决策。 |

## 执行循环

1. **排队 (Queue)** — 创建任务并将其排入当前运行任务之后的队列中。
2. **准备 (Prepare)** — 对于修改代码的 Promptware（[ExecutePlan](02_Promptwares.md)、[RetryPlan](02_Promptwares.md)），Tendril 会在计划的 `Worktrees/{repo-name}/` 目录下为每个代码仓库调配一个独立的 [Git 工作区 (worktree)](https://git-scm.com/docs/git-worktree)。运行过程绝不会触及或锁定您的主工作检出目录。
3. **实现 (Implement)** — 工作流智能体按计划阶段逐步开展工作，进行递增式提交。
4. **验证 (Verify)** — 每个配置的验证门禁在工作区中执行并记录其结果。
5. **汇报 (Report)** — 输出日志、Token 成本以及更新后的计划状态被保存到磁盘并上报给守护进程。

停止任务会将计划恢复到该任务启动前的状态，同时保留工作区状态以便您检查部分进度。有关完整的状态对照表，请参阅 [计划](01_Plans.md)。

## 验证门禁 (Verifications)

验证是记录在 `plan.yaml` 中的自动化质量门禁。每次检查都会生成一个结果 —— `Pass`、`Fail` 或 `Skipped` —— 并在计划的 `Verification/` 目录中输出详细报告。具体运行哪些检查取决于计划修改了哪些文件：

| 验证项          | 检查内容                                               |
| --------------- | ------------------------------------------------------ |
| **NpmBuild**    | pnpm / npm 工作区能正常完成干净构建。                  |
| **NpmLint**     | TypeScript / JavaScript 包的代码检查与格式化全部通过。 |
| **NpmTest**     | 自动化测试套件通过（Vitest、Jest 等）。                |
| **RustBuild**   | Cargo 包成功编译且无编译器错误。                       |
| **RustClippy**  | Clippy linter 无任何警告或错误。                       |
| **RustFormat**  | `cargo fmt --check` 报告格式规范一致。                 |
| **RustTest**    | Rust 单元测试和集成测试套件通过。                      |
| **Screenshots** | 针对 UI 修改已捕获直观的视觉凭据。                     |
| **CheckResult** | 智能体自身针对计划验收标准是否满足进行的端到端确认。   |

不适用于某个计划的验证项会被标记为 `Skipped` 而非静默忽略，从而确保清晰明确的审计追踪。只有在所需验证通过后，计划才会进入 **Review**。如果验证失败，计划会进入 **Failed**，此时 [RetryPlan](02_Promptwares.md) 可以利用确切的错误输出和当前 diff 作为上下文再次尝试修复。

> [!TIP]
> 当验证失败时，请检查 `Verification/` 中的报告，并在计划的工作区中直接测试该命令。通常检查逻辑本身是正确的，只是工作区可能缺少依赖或构建生成物 —— 参见 [代码库准备](../01_GettingStarted/03_Onboarding.md)。

## 并发与工作区

多个任务可以同时运行，受 [~/.tendril/config.yaml](../03_Configuration/01_Setup.md) 中的 `maxConcurrentJobs`（默认为 `20`）控制：

```yaml
maxConcurrentJobs: 4
```

因为每个执行中的计划都在专属的 [Git 工作区 (worktree)](https://git-scm.com/docs/git-worktree) 中运行，所以在同一仓库上运行的并行任务不会发生冲突。但是，并行运行会共享您的 CPU、内存以及编程智能体 API 速率限制，因此请根据您的工作站性能合理调整 `maxConcurrentJobs`。

## 成本追踪

每次运行都会记录所消耗的 Token 数量和估算的美元成本。持久化的审计日志保存在计划的 `costs.csv` 中，每次运行追加一行：

```csv
Promptware,Tokens,Cost,Model,CostSource,Agent
ExecutePlan,148213,1.9042,claude-opus-5,api,claude
```

当智能体在无计量订阅（或像 Apple Foundation Models 这样的本地模型）上运行时，`Cost` 字段将保持为空而不是记录为零，以此保留 Token 指标而不捏造美元开销。

## 管理与检查任务

桌面应用通过守护进程的 WebSocket 流展示实时任务状态和流式终端输出。CLI 提供了完全对等的功能：

```bash
# 列出所有活跃与近期任务
tendril job list

# 按状态筛选任务
tendril job list --status Running
tendril job list --status Failed

# 检查调度队列顺序与可用槽位
tendril job queue

# 提升排队中或受阻的任务使其立即运行
tendril job force-start <job-id>

# 取消正在运行的任务
tendril job cancel <job-id> -m "Stopping for review"

# 终止所有正在运行、排队中和受阻的任务
tendril job stop-all

# 从数据库中清理已完成或失败的任务
tendril job clear --completed
tendril job clear --failed
```

每次运行的完整日志和转写记录都会永久存储在磁盘上的 `$TENDRIL_HOME/Jobs/{jobId}-{planId}-{promptware}/`，包括原始系统提示词、工具执行轨迹和智能体转写记录。

## 后续步骤

- [计划](01_Plans.md) — 任务推动计划流转的各种状态。
- [Promptware](02_Promptwares.md) — 任务内部实际运行的具体内容。
- [故障排除](../01_GettingStarted/06_Troubleshooting.md) — 诊断卡住或失败的任务。
