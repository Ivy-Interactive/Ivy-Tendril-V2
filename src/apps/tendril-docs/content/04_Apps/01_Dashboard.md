---
title: Dashboard
description: "Landing view: plan counts, spend and tokens, and recent activity across projects."
icon: ChartBar
searchHints:
  - dashboard
  - statistics
  - overview
  - charts
  - cost
---

# Dashboard

The Dashboard is Tendril's primary operational overview, providing real-time visibility into the development pipeline, agent spend, delivery velocity, and active jobs across all projects.

## Header & Pipeline Overview

The top of the Dashboard displays the current date, time-based greeting, and the **Process Viewer** (`TendrilProcessViewer`):

- **Drafts** — Total plans currently in `Draft` state awaiting refinement or execution.
- **In-Flight Jobs** — Live count of active agent jobs categorized by promptware phase (**Creating**, **Updating**, **Executing**, **Retrying**, and **Creating PR**).
- **Review** — Plans with finished executions awaiting developer triage and approval.
- **Completed & Failed** — Cumulative count of finished jobs.

Clicking any stage in the Process Viewer navigates directly to that view ([Plans](03_Plans.md), [Jobs](04_Jobs.md), or [Review](02_Review.md)). The **+ New Plan** action is also accessible directly from the viewer.

## Key Performance Indicators (KPIs)

Four primary KPI cards summarize velocity and cost efficiency:

| Metric                   | Meaning                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------- |
| **Features Shipped**     | Total number of completed plans and merged pull requests delivered across all projects. |
| **Avg cost per Feature** | Average dollar spend required to deliver a completed feature.                           |
| **Forecast This Month**  | Projected monthly expenditure calculated from the trailing 30-day burn rate.            |
| **Avg Cost/Plan**        | Mean cost across all executed plans, factoring in input, output, and cache tokens.      |

### Drill-Down Breakdown Blades

Clicking any KPI card slides open a deep **Breakdown Blade** (`BladeContainer`):

- **Project & Agent Breakdown** — See which projects or coding agents account for the largest share of token consumption and costs.
- **Plan Breakdown Table** — Detailed per-plan audit table listing plan title, execution duration, token counts (input, output, cache read, reasoning), and total cost.
- **Direct Navigation** — Click any plan in the breakdown blade to open its full specification.

## 28-Day Daily Trend

The **Daily Trend** card plots daily execution activity and token expenditure across a 28-day window:

- **Bar Plot** — Daily cost and activity totals.
- **7-Day Rolling Average** — Trailing mean curve overlaid on the chart to smooth day-to-day variance and highlight delivery trajectory.

## Pull Requests

The **Pull Requests** card provides:

- **Weekly PR Cadence** — Bar chart plotting merged pull requests across a 6-week rolling window.
- **Recent Merges** — Quick list of recently merged [GitHub](https://github.com) pull requests with project badges and links to open them in [Pull Requests](06_PullRequests.md).

## Active Jobs

The **Active Jobs** card displays up to eight currently running agent jobs in real-time:

- **Live Status** — Displays status badge (`Running`, `Pending`, or `Blocked`).
- **Target Plan & Promptware** — Identifies the plan title or specific [Promptware](../02_Concepts/02_Promptwares.md) type (`CreatePlan`, `ExecutePlan`, `UpdatePlan`, etc.).
- **Direct Inspection** — Clicking any job opens its live output terminal in the [Jobs](04_Jobs.md) app.

## Cost & Token Accounting

Every promptware execution appends an append-only row to the plan's durable `costs.csv` file located at `$TENDRIL_HOME/plans/<planId>/costs.csv`.

Tendril reconciles these CSV records into its [SQLite](https://www.sqlite.org) database to calculate costs using live [models.dev](https://models.dev) pricing specs (e.g. prompt tokens, completion tokens, prompt cache reads/writes, and reasoning tokens). All charts reflect these reconciled figures with project colors configured in [Project Setup](../03_Configuration/02_Projects.md).
