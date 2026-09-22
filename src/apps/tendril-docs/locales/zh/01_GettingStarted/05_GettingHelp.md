---
title: 获取帮助
description: 遇到困难了吗？以下是获取技术支持并与 Tendril 社区建立联系的方法。
icon: LifeBuoy
searchHints:
  - 帮助
  - 支持
  - discord
  - github issues
  - 社区
  - 缺陷报告
  - report-bug
  - doctor
---

# 获取帮助

如果您遇到问题或对配置 Tendril 有疑问，可以通过多种支持资源和诊断工具寻求帮助。

## 首先运行环境诊断

在提交 issue 或寻求帮助之前，请运行 Tendril 内置的环境诊断工具：

```bash
tendril doctor
```

`tendril doctor` 会验证 `$TENDRIL_HOME` 目录、`config.yaml` 语法、[SQLite](https://www.sqlite.org) 数据库可访问性、[计划](../02_Concepts/01_Plans.md) 目录、[Git](https://git-scm.com/) 以及 [GitHub CLI](https://cli.github.com/) 认证状态。

如果某个特定的计划或任务失败，您可以使用 `tendril report-bug` 打包完整的诊断信息：

```bash
# 将计划状态、验证报告和任务日志打包为 ZIP 文件
tendril report-bug <plan-id>
```

这将生成一个诊断归档包，其中包含计划 YAML、修订历史记录、验证输出和原始智能体转写记录，且不会泄露敏感凭证。

## 故障排除

有关常见错误消息、数据库迁移和工作区恢复步骤，请参阅 [故障排除](06_Troubleshooting.md)。

## Discord 社区

联系开发团队和其他构建者的最快途径是我们的 [Discord 服务器](https://discord.gg/FHgxkDga3y)。欢迎加入讨论、提出疑问、分享反馈并探讨自定义 Promptware 工作流。

## GitHub issues

发现 Bug 或想要提出新功能请求？欢迎在我们的 [GitHub 仓库](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/issues) 中提交 issue。

> [!TIP]
> 请务必在 issue 描述中附带 `tendril doctor` 和 `tendril version` 的输出。如果是报告计划执行失败，请附上通过 `tendril report-bug <plan-id>` 生成的诊断 ZIP 包或 `$TENDRIL_HOME/Jobs/` 中的任务日志。

## 后续步骤

- [故障排除](06_Troubleshooting.md) — 常见错误特征及修复方法。
- [生命周期与任务](../02_Concepts/03_Lifecycle.md) — 理解任务状态与错误处理。
