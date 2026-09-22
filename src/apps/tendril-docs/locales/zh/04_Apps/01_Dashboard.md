---
title: 仪表盘
description: "起始视图：各项目的计划数、支出与 Token，以及近期活动。"
icon: ChartBar
searchHints:
  - 仪表盘
  - 统计
  - 概览
  - 图表
  - 成本
---

# 仪表盘

仪表盘是 Tendril 的核心运营概览视图，提供对所有项目的开发流水线、智能体支出、交付速度和活动任务的实时可见性。

## 顶部标题与流水线概览

仪表盘顶部显示当前日期、基于时间的问候语以及 **流程查看器 (Process Viewer)**（`TendrilProcessViewer`）：

- **Drafts（草稿）** — 当前处于 `Draft` 状态、等待细化或执行的计划总数。
- **In-Flight Jobs（进行中的任务）** — 按 Promptware 阶段（**Creating**、**Updating**、**Executing**、**Retrying** 和 **Creating PR**）分类的活动智能体任务的实时计数。
- **Review（审查）** — 已完成执行、等待开发者分类与批准的计划。
- **Completed & Failed（已完成与失败）** — 已结束任务的累计计数。

点击流程查看器中的任意阶段将直接导航至该视图（[计划](03_Plans.md)、[任务](04_Jobs.md) 或 [审查](02_Review.md)）。也可以直接从查看器触发 **+ New Plan** 操作。

## 关键绩效指标 (KPI)

四个核心 KPI 卡片总结了交付速度与成本效益：

| 指标                     | 含义                                                        |
| ------------------------ | ----------------------------------------------------------- |
| **Features Shipped**     | 在所有项目中交付的已完成计划和已合并 Pull Request 的总数。  |
| **Avg cost per Feature** | 交付单个已完成功能所需的平均美元支出。                      |
| **Forecast This Month**  | 根据过去 30 天的消耗速率计算的预计月度支出。                |
| **Avg Cost/Plan**        | 综合输入、输出和缓存 Token 计算的所有已执行计划的平均成本。 |

### 下钻细分抽屉 (Breakdown Blades)

点击任意 KPI 卡片可滑出深度 **细分抽屉 (Breakdown Blade)**（`BladeContainer`）：

- **项目与智能体细分** — 查看哪些项目或编程智能体消耗了最大的 Token 份额与成本。
- **计划明细表** — 详细的单计划审计表，列出计划标题、执行时长、Token 计数（输入、输出、缓存读取、推理）以及总成本。
- **直接导航** — 点击细分抽屉中的任意计划即可打开其完整规范。

## 28 天每日趋势

**每日趋势 (Daily Trend)** 卡片绘制了 28 天时间窗口内的每日执行活动与 Token 支出：

- **柱状图** — 每日成本与活动总量。
- **7 天滚动平均** — 叠加在图表上的移动平均曲线，用于平滑日常波动并突显交付走势。

## Pull Requests

**Pull Requests** 卡片提供：

- **每周 PR 节奏** — 绘制 6 周滚动窗口内已合并 Pull Request 的柱状图。
- **最近合并** — 最近合并的 [GitHub](https://github.com) Pull Request 快速列表，带有项目徽章以及在 [Pull Requests](06_PullRequests.md) 中打开的链接。

## 活动任务 (Active Jobs)

**活动任务 (Active Jobs)** 卡片实时展示最多八个当前正在运行的智能体任务：

- **实时状态** — 显示状态徽章（`Running`、`Pending` 或 `Blocked`）。
- **目标计划与 Promptware** — 标明计划标题或具体的 [Promptware](../02_Concepts/02_Promptwares.md) 类型（`CreatePlan`、`ExecutePlan`、`UpdatePlan` 等）。
- **直接查看** — 点击任意任务即可在 [任务](04_Jobs.md) 应用中打开其实时输出终端。

## 成本与 Token 记账

每次 Promptware 执行都会向位于 `$TENDRIL_HOME/plans/<planId>/costs.csv` 的计划持久化 `costs.csv` 文件追加一行记录。

Tendril 将这些 CSV 记录对账汇入其 [SQLite](https://www.sqlite.org) 数据库中，利用实时 [models.dev](https://models.dev) 定价规格（例如提示词 Token、补全 Token、提示词缓存读取/写入以及推理 Token）计算成本。所有图表均反映这些核对后的数据，并应用在 [项目设置](../03_Configuration/02_Projects.md) 中配置的项目颜色。
