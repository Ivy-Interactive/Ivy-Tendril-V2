---
title: config
description: 直接从命令行获取并设置保存在 config.yaml 中的 Tendril 顶层配置项。
icon: Settings
searchHints:
  - config
  - 配置
  - settings
  - jobTimeout
  - codingAgent
  - planTemplate
  - gitTimeout
  - daemonRequestTimeout
  - llm
---

# config

直接从命令行获取并设置保存在 `config.yaml` 中（格式为 [YAML](https://yaml.org)）的 Tendril 顶层配置项 —— 这些配置与在桌面端及 Web 界面的“设置”中管理的全局配置项完全相同。有关运行环境与目录布局的更多详细信息，请参阅 [设置指南](../../03_Configuration/01_Setup.md)。

## Commands

```terminal
>tendril config get <key>
>tendril config set <key> <value>
```

- **`get`** — 将原始值输出到标准输出，不包含装饰性格式，非常适合 Shell 脚本以及直接通过管道传入文件或其他工具。
- **`set`** — 校验并更新 `config.yaml` 中的对应配置项。键名不区分大小写。

## Primitive Keys

Tendril 为若干基础配置键建立了带类型校验的模型：

| 键名                           | 类型                              | 默认值             | 说明                                                                                                          |
| ------------------------------ | --------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `codingAgent`                  | 字符串                            | `claude`           | 默认编程智能体可执行程序或别名（例如：`claude`、`aider`、`codestory`）。                                      |
| `jobTimeout`                   | 整数（分钟）                      | `120`              | 运行中计划任务的最大执行超时时间。                                                                            |
| `staleOutputTimeout`           | 整数（分钟）                      | `10`               | 任务无任何输出时被标记为停滞 (stalled) 前的不活动等待时长。                                                   |
| `gitTimeout`                   | 整数（分钟）                      | `5`                | [Git](https://git-scm.com) 操作的命令超时时间。                                                               |
| `daemonRequestTimeout`         | 整数（秒）                        | `30`               | 发送到本地 Tendril 守护进程的 HTTP 请求超时秒数（设为 `0` 或负数表示禁用）。                                  |
| `maxConcurrentJobs`            | 整数                              | `2`                | 允许并发执行的最大任务数量。                                                                                  |
| `planTemplate`                 | 字符串                            | `""`               | 创建新计划时自动前置填充的 [Markdown](https://daringfireball.net/projects/markdown/) 模板内容。               |
| `planFolder`                   | 字符串（可选）                    | `None`             | 存储计划 Markdown 文件的自定义文件系统目录。传入 `""` 可恢复默认。                                            |
| `promptwareOverlay`            | 字符串（可选）                    | `None`             | 包含自定义 Promptware 的覆盖层目录路径。传入 `""` 可恢复默认。                                                |
| `telemetry`                    | 布尔值（可选）                    | `None`             | 匿名遥测功能开关（`true` 或 `false`）。传入 `""` 可清除该项。                                                 |
| `beta`                         | 布尔值                            | `false`            | 启用实验性预览功能（`true` 或 `false`）。                                                                     |
| `desktopNotifications`         | 布尔值                            | `true`             | 启用针对计划状态与智能体完成情况的系统桌面通知（`true` 或 `false`）。                                         |
| `theme`                        | 字符串                            | `default`          | UI 主题预设 ID（例如：`default`、`dracula`）。                                                                |
| `worktreeReaperInterval`       | 整数（分钟）                      | `60`               | 自动化 [Git](https://git-scm.com) 工作区清理检查的周期频率（设为 `0` 或负数表示禁用）。                       |
| `worktreeReaperGrace`          | 整数（分钟）                      | `1440`             | 不活跃工作区被视作可回收之前的空闲宽限期（分钟）。                                                            |
| `worktreeBranchDeleteMode`     | 字符串                            | `PreserveUnpushed` | 工作区回收时的分支删除安全模式（`PreserveUnpushed` 或 `Force`）。                                             |
| `coAuthor`                     | 字符串（可选）                    | `None`             | 添加到自动化提交尾部的 [Git](https://git-scm.com) 共同作者身份，格式为 `Name <email>`。传入 `""` 可恢复默认。 |
| `enrichModels`                 | 布尔值                            | `true`             | 启用后台模型自动发现与丰富补全（`true` 或 `false`）。                                                         |
| `modelEnrichmentIntervalHours` | 整数（小时）                      | `24`               | 模型元数据的后台刷新间隔。                                                                                    |
| `modelCacheWarnAgeDays`        | 整数（天）                        | `7`                | 触发陈旧模型缓存警告的软性过期天数阈值。                                                                      |
| `modelCacheMaxAgeDays`         | 整数（天）                        | `30`               | 缓存模型元数据彻底过期的硬性天数阈值。                                                                        |
| `llm`                          | [JSON](https://www.json.org) 对象 | `None`             | 辅助 LLM 服务的端点、API 密钥以及模型配置。将与现有字段合并。                                                 |

> [!NOTE]
> 未建模的标量键同样可以存储和检索；它们保存在 `config.yaml` 的附加属性表中。

## Structured Keys

Tendril 配置中还包含结构化的列表和映射，这些内容无法通过 `tendril config` 直接设置或检索：

- `projects` — 已配置的项目定义（使用 [`tendril project`](02_Project.md) 进行管理）。
- `verifications` — 全局验证套件定义（使用 [`tendril verification`](03_Verification.md) 进行管理）。
- `levels` — 计划复杂度层级及其绑定的验证门禁。
- `onboarding` — 首次运行向导的完成状态。
- `codingAgents` — 针对各个智能体的二进制路径、运行参数、环境变量与配置文件。
- `promptwares` — 针对各个 Promptware 的特定指令、配置文件与工具规则。
- `inbox` — 入站通知规则与交付集成。

如果尝试对任何结构化键运行 `tendril config get` 或 `tendril config set`，将打印错误并指引您使用专用的 CLI 命令或直接编辑 `config.yaml`。

## Examples

```terminal
># 读取某项配置的值
>tendril config get jobTimeout

># 更新数值或文本配置项
>tendril config set jobTimeout 60
>tendril config set codingAgent claude

># 切换布尔值选项
>tendril config set desktopNotifications false
>tendril config set beta true

># 合并辅助 LLM 配置
>tendril config set llm '{"model":"gpt-4o"}'

># 通过传入空字符串清除可选配置
>tendril config set coAuthor ""
>tendril config set planFolder ""

># 使用 Shell 命令替换设置多行计划模板
>tendril config set planTemplate "$(cat template.md)"

># 将计划模板重新导出回文件
>tendril config get planTemplate > template.md
```

> [!TIP]
> 当设置诸如 `planTemplate` 之类的多行文本或诸如 `llm` 之类的 [JSON](https://www.json.org) 对象时，请使用 Shell 引号或命令替换（`"$(cat file.md)"`），以确保将其作为单个参数完整传递。
