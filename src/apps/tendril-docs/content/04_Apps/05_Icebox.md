---
title: Icebox
description: Low-priority or "later" plans in the Icebox state so Drafts stays focused.
icon: Snowflake
searchHints:
  - icebox
  - shelving
  - backlog
---

# Icebox

The Icebox is Tendril's dedicated backlog and parking space for deferred, low-priority, or future engineering plans. Shelving plans keeps the active [Plans](03_Plans.md) draft queue focused on current sprint priorities without losing research, discussions, or drafted specifications (see [Plan Lifecycle](../02_Concepts/03_Lifecycle.md)).

## Shelving Plans

A plan can be shelved at any time while in `Draft` or `Blocked` state:

- In the [Plans](03_Plans.md) app, select **Shelve to Icebox** from the actions menu.
- Tendril updates the plan's status to `Icebox`.
- The plan directory under `$TENDRIL_HOME/plans/<planId>/`, its versioned revisions, and cost records remain fully preserved on disk (see [CLI Plan Management](../09_Advanced/01_CLI/01_Plan.md)).

## Browsing & Filtering

The Icebox app provides focused search and filtering across your backlog:

- **Search Bar** — Filter plans by title keywords or numeric plan `#ID`.
- **Project Filter** — Narrow down shelved plans to a specific project configured in [Project Setup](../03_Configuration/02_Projects.md).
- **Level Filter** — Filter plans by complexity tier (e.g. L1, L2, L3 configured in [Setup & Settings](../03_Configuration/01_Setup.md#in-app-settings)).

## Plan Cards & Actions

Each shelved plan is displayed in a card showing its `#ID` tag, title, project badge, complexity level badge, and verification indicators:

| Action           | Control           | Effect                                                                                                                                                                                                                                  |
| ---------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inspect Plan** | Click Card Title  | Opens the plan workspace in [Plans](03_Plans.md) to review the full specification, metadata, or previous revisions.                                                                                                                     |
| **Thaw**         | Flame icon button | Transitions the plan from `Icebox` back to `Draft` optimistically. The plan leaves the Icebox immediately and returns to the active [Plans](03_Plans.md) queue ready for execution via [ExecutePlan](../02_Concepts/02_Promptwares.md). |
| **Delete**       | Trash icon button | Opens `DeletePlanDialog` to permanently remove the plan folder, revisions, and database records.                                                                                                                                        |
