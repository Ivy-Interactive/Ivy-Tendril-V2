---
title: OpenClaw
description: 通过将 Markdown 文件放入 Inbox 文件夹，将 OpenClaw 或任何基于文件的工具与 Tendril 集成。
icon: Terminal
searchHints:
  - openclaw
  - inbox
  - folder
  - file watcher
  - drop folder
  - 收件箱
  - 文件监控
---

# OpenClaw

## 概述

Tendril 监控 **Inbox 文件夹** 中的新 Markdown 文件，并自动将其转换为[计划](../02_Concepts/01_Plans.md)。这为 OpenClaw 等外部工具或将文件写入磁盘的自定义脚本提供了一个简单、基于文件的集成点。

## Inbox 文件夹位置

```
$TENDRIL_HOME/Inbox/
```

有关 Tendril 主目录和配置的详细信息，请参阅[安装与设置](../03_Configuration/01_Setup.md)。Tendril 的文件系统监控程序会监控此目录中的新 `.md` 文件。

## 文件格式

放入包含可选 YAML frontmatter 的 Markdown 文件 (`.md`)：

```markdown
---
project: ProjectName
sourcePath: optional/path/to/code
---

在此描述计划内容。该文本将成为计划描述，
并传递给 [CreatePlan promptware](../02_Concepts/02_Promptwares.md)。
```

| 字段         | 必填 | 描述                          |
| ------------ | ---- | ----------------------------- |
| `project`    | 否   | 目标项目名称（默认为 `Auto`） |
| `sourcePath` | 否   | 相关源代码的路径提示          |

frontmatter 之后的内容将成为计划描述。

> [!NOTE]
> 如果完全省略 frontmatter，则整个文件内容将以默认设置作为计划描述使用。

## 文件生命周期

1. **投放 (Drop)** — 将 `.md` 文件放入 Inbox 文件夹
2. **处理中 (Processing)** — 处理期间文件被重命名为 `.md.processing`
3. **完成 (Completion)** — 计划成功创建后，该文件将被删除

## 恢复机制

如果在处理期间 Tendril 重启，所有 `.md.processing` 文件都会在启动时自动恢复为 `.md` 并重新处理。

## 与 OpenClaw 配合设置

配置 OpenClaw 将其输出作为 Markdown 文件写入 Tendril Inbox 文件夹。每个文件都会生成一个独立的计划：

1. 将输出目录设置为 `$TENDRIL_HOME/Inbox/`
2. 使用带有 YAML frontmatter 的 Markdown 格式以定位项目
3. Tendril 会自动读取新文件 —— 无需轮询或 API 调用
