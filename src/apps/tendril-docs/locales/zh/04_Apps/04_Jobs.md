---
title: 任务
description: "正在运行与历史 Promptware 运行记录：状态、成本、耗时与实时输出。"
icon: Activity
searchHints:
  - 任务
  - 运行中
  - 执行
  - 智能体
  - 状态
---

# 任务

任务应用是 Tendril 的实时执行监控器与历史审计日志。每次 [Promptware](../02_Concepts/02_Promptwares.md) 调用（`CreatePlan`、`ExecutePlan`、`UpdatePlan`、`CreatePr`、`SplitPlan` 等）均作为在此处追踪的异步任务运行。

## 概览与状态进度

在任务视图的顶部，**堆叠进度条 (Stacked Progress Bar)**（`StackedProgress`）展示任务状态的实时分布：

- **Running**（蓝色）— 处于活跃运行状态的智能体进程。
- **Completed**（绿色）— 成功结束的执行。
- **Failed**（红色）— 出现错误退出或验证未通过的运行。
- **Blocked**（琥珀色）— 等待依赖项、并发限制或操作者确认的任务。
- **Pending**（灰色）— 在队列中等待可用智能体槽位的任务。

通过标题栏中的批量执行控件，操作者可在需要时 **Stop All Queued**（停止所有排队任务）或 **Stop All**（停止所有任务），或通过 **Clear** 下拉菜单批量清理历史行记录（`Clear Completed`、`Clear Failed` 或 `Clear All`）。

## 任务列表

该表采用无限滚动，并在守护进程侧进行服务端排序与过滤：

| 列          | 说明                                          | 交互                                                                     |
| ----------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| **Id**      | 数字任务标识符（例如 `00042`）。              | 点击表头按最新/最旧排序。                                                |
| **Plan Id** | 目标计划标识符。                              | 点击直接导航至 [计划](03_Plans.md) 中的对应计划。                        |
| **Status**  | 当前任务状态徽章。                            | 按状态以颜色区分。                                                       |
| **Type**    | Promptware 标识符（例如 `ExecutePlan`）。     | 可按 Promptware 排序。                                                   |
| **Project** | 项目徽章。                                    | 应用来自 [项目设置](../03_Configuration/02_Projects.md) 的项目颜色样式。 |
| **Output**  | 智能体执行状态（`running`、`done`、`idle`）。 | **点击打开实时输出抽屉**（`JobSessionView`）以查看流式终端输出。         |
| **Tokens**  | 总 Token 消耗量。                             | **点击打开成本与 Token 抽屉**（`JobCostSheet`）。                        |
| **Cost**    | 以美元计算的执行成本。                        | **点击打开成本与 Token 抽屉**。                                          |
| **Timer**   | 实时运行计时器或已记录的运行时长。            | 显示实时耗时。                                                           |
| **Date**    | 任务启动的时间戳。                            | 按时间先后排序。                                                         |

## 抽屉与侧滑面板

点击单元格或行操作会直接在表格上方滑出专注的侧滑面板，而不会丢失您当前的浏览位置：

### 实时输出抽屉 (`JobSessionView`)

点击 **Output** 单元格将打开实时流式智能体查看器。您可以查看来自智能体的实时 `stdout`/`stderr` 终端输出（构建日志、测试输出、工具调用和智能体推理过程），而不仅是一个普通的旋转加载图标。

### 成本与 Token 抽屉 (`JobCostSheet`)

点击 **Tokens** 或 **Cost** 单元格将显示详细的记账明细：

- **输入 Token (Input Tokens)** — 发送给模型的提示词与上下文 Token。
- **输出 Token (Output Tokens)** — 由模型生成的 Token。
- **缓存读取 Token (Cache Read Tokens)** — 从提示词缓存中读取的 Token（节省成本与降低延迟）。
- **缓存写入 Token (Cache Write Tokens)** — 写入服务商提示词缓存中的 Token。
- **推理 Token (Reasoning Tokens)** — 在内部推理模型上消耗的 Token（例如 OpenAI o1/o3 或 Anthropic extended thinking）。
- **成本计算 (Cost Calculation)** — 对照 [models.dev](https://models.dev) 定价规格核对的货币成本。

### 完整提示词抽屉

点击 **Prompt** 文本可打开发送给智能体的完整、未经截断的提示词，并带有完整的语法高亮。

## 行操作菜单

每个任务行均提供一个操作菜单（`...`）：

| 操作            | 可用状态            | 效果                                                                                                                                             |
| --------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Stop**        | 活动任务            | 立即终止正在运行的智能体进程。[Git](https://git-scm.com) 工作区将被保留，以便您恢复或检查阶段性进展。                                            |
| **Force Start** | 阻塞 (Blocked) 任务 | 绕过并发上限或依赖锁，立即启动任务。                                                                                                             |
| **Debug**       | 所有任务            | 打开 **任务调试抽屉**（`JobDebugSheet`），提供对 Job Log、Job Prompt、Raw Output Log 和 Eventwire Log 的标签页访问，并附带“在编辑器中打开”按钮。 |
| **Delete**      | Completed / Failed  | 在确认后从历史记录中永久删除任务记录。                                                                                                           |
