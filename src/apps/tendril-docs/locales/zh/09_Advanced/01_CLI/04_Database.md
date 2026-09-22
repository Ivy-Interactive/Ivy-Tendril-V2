---
title: 数据库
description: 管理用于存储计划同步数据、改进建议、任务历史和成本跟踪的本地 SQLite 数据库。
icon: Database
searchHints:
  - 数据库
  - db
  - 迁移
  - migration
  - 架构
  - 版本
  - 重置
  - sqlite
  - 完整性
  - vacuum
---

# 数据库

管理用于存储 [计划同步数据](../../02_Concepts/01_Plans.md)、[任务历史](../../04_Apps/04_Jobs.md)、改进建议和成本跟踪的本地 [SQLite](https://www.sqlite.org) 数据库（`<TendrilHome>/tendril.db`）。在 Tendril v2 中，所有数据库管理均通过 `tendril db` 子命令树访问。

## Commands

#### db version

```terminal
>tendril db version
```

在不应用迁移的情况下检查数据库架构。输出当前数据库版本、当前已安装二进制文件所期望的最新版本，以及迁移状态（`Up to date`、`Needs migration` 或 `Newer than application`）。

```terminal
Database version: 12
Latest version:   12
Status:           Up to date
```

#### db migrate

```terminal
>tendril db migrate
```

应用所有待处理的迁移，使数据库架构保持最新。可安全重复运行 —— 已应用的迁移会被幂等跳过。

> [!NOTE]
> `tendril run` 会在启动守护进程服务前自动应用待处理的迁移，因此很少需要手动执行迁移。

#### db reset

```terminal
>tendril db reset
>tendril db reset --force
```

删除 `tendril.db` 中的所有数据表，并从零开始重新创建架构。除非提供了 `--force`，否则会提示确认。若守护进程当前处于活跃状态，除非指定 `--force`，否则将拒绝执行。

> [!WARNING]
> 重置会清空所有数据库记录（缓存的任务历史、遥测数据、建议）。磁盘上由您编写的 [计划 YAML 文件](01_Plan.md) 和修订版本 Markdown 文件完全不受影响。

#### db integrity

```terminal
>tendril db integrity
```

在所有表、索引和页面上执行 SQLite [PRAGMA integrity_check](https://www.sqlite.org/pragma.html#pragma_integrity_check)。输出每项验证结果，若发现任何损坏或结构异常，则以退出代码 1 退出。

#### db vacuum

```terminal
>tendril db vacuum
>tendril db vacuum --force
```

执行 SQLite [VACUUM](https://www.sqlite.org/lang_vacuum.html) 以对数据库进行碎片整理、重建索引并回收未使用的磁盘空间。报告执行前后的数据库大小以及回收的总字节数。

## Related

- [CLI 概览](00_Overview.md) — 全局选项、数据目录路径及安装健康检查
- [Plan 命令](01_Plan.md) — 创建、列出并验证存储在磁盘上的计划
