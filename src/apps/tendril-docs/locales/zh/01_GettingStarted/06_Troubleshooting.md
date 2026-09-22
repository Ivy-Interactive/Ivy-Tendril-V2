---
title: 故障排除
description: >-
  常见问题症状及解决方法。如果您仍然无法解决，请运行 `tendril doctor` 并在 Discord 上与我们联系。
icon: Wrench
searchHints:
  - 故障排除
  - 错误
  - 问题
  - 症状
  - 调试
  - 诊断
  - 残留工作区
  - 数据库
  - doctor
  - db
---

# 故障排除

诊断并解决常见的配置、智能体、计划和数据库问题。

## 安装与环境

| 症状                     | 解决方法                                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 找不到 `TENDRIL_HOME`    | 设置环境变量并重启终端，或将路径写入 `~/.tendril_location`。如果两者均未设置，Tendril 将默认使用 `~/.tendril`。                                      |
| 找不到 `config.yaml`     | 该文件必须位于 `$TENDRIL_HOME/config.yaml` 且名称必须完全一致 —— 不能是 `tendril-config.yaml`。`tendril doctor` 会提示其预期的完整路径。             |
| `gh` 未认证              | 运行 [GitHub CLI](https://cli.github.com/) 认证：`gh auth login`，然后运行 `gh auth status` 进行确认。                                               |
| 找不到 `git`             | 安装 [Git](https://git-scm.com/) 并确保其已添加到您的 `PATH` 中。                                                                                    |
| 构建后无法识别 `tendril` | `cargo build --release` 会将二进制文件生成在 `target/release/tendril`。请将其添加到 `PATH`，或运行 `cargo install --path src/crates/tendril-cli`。   |
| 应用启动后无任何内容加载 | 桌面应用负责监管 `tendril run` 守护进程；如果打包构建中缺少边车二进制文件，则没有可通信的守护进程。有关打包步骤，请参阅 [安装](02_Installation.md)。 |

## 计划

| 症状                              | 解决方法                                                                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 计划卡在 `Draft` 状态             | 使用 `tendril plan get <id>` 检查是否关联了代码仓库，并验证 `config.yaml` 中是否存在对应的项目定义。                                   |
| 计划文件夹不完整或加载失败        | 运行 `tendril plan validate <id>` 排查问题 —— 例如无效的 `plan.yaml`、缺少 `Revisions/` 目录、标题为空或 schema 版本不匹配。           |
| 计划使用的 schema 版本过旧        | 运行 `tendril plan doctor --fix` 将计划文件夹迁移到当前 schema。若要清理残留的空计划外壳，请运行 `tendril plan doctor --prune-husks`。 |
| 计划未配置任何代码仓库            | 运行 `tendril plan add-repo <id> <path>`。                                                                                             |
| 运行失败后残留的工作区 (worktree) | 运行 `tendril plan cleanup <id>` 清理已结束计划的工作区。对于非终态计划，添加 `--force` 参数：`tendril plan cleanup <id> --force`。    |

## 执行与智能体

| 症状               | 解决方法                                                                                                                                                                                                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 无法连接智能体     | 检查 `config.yaml` 中的 `codingAgent`，然后在干净的终端中直接运行该智能体的 CLI。Tendril 将其作为子进程运行；如果 `claude`、`codex`、`copilot`、`gemini`、`opencode`、`antigravity` 或 `cursor` 无法无人值守运行，后台任务将会停滞。对于 `apple`，请验证 `fm available` 并确保 `fm serve` 处于活跃状态。 |
| 执行立即失败       | 查看位于 `$TENDRIL_HOME/Jobs/{jobId}-{planId}-{promptware}/` 下的任务日志。常见原因包括缺少代码仓库上下文或在 [Promptware](../02_Concepts/02_Promptwares.md) 中缺少工具授权。                                                                                                                            |
| 验证持续失败       | 在该计划的隔离工作区（`$TENDRIL_HOME/Plans/{id}-{name}/Worktrees/{repo}`）中手动执行验证命令。命令通常本身没有问题，但工作区可能缺少某个环境初始化步骤 —— 参见 [代码库准备](03_Onboarding.md)。                                                                                                          |
| 任务一直未启动     | 运行 `tendril job queue` 查看调度顺序和并发限制（`config.yaml` 中的 `maxConcurrentJobs`）。可使用 `tendril job force-start <id>` 强制启动排队中或受阻的任务，或使用 `tendril job stop-all` 终止停滞的任务。详见 [生命周期与任务](../02_Concepts/03_Lifecycle.md)。                                       |
| 语音输入提示不可用 | 在 macOS 上，进入 系统设置 → 隐私与安全性 → 麦克风，授予麦克风访问权限，然后重启桌面应用。                                                                                                                                                                                                               |

## 数据库

Tendril 在 `$TENDRIL_HOME/tendril.db` 管理其 [SQLite](https://www.sqlite.org) 数据库。虽然数据库迁移会在守护进程启动时自动执行，但 Tendril 也提供了专门的数据库管理命令：

```bash
# 查看当前数据库 schema 版本
tendril db version

# 执行所有挂起的迁移
tendril db migrate

# 验证数据库完整性
tendril db integrity

# 回收未使用的磁盘空间
tendril db vacuum

# 重置数据库（需要交互确认）
tendril db reset
```

| 症状                     | 解决方法                                                                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 不确定数据库状态是否健康 | 运行 `tendril doctor`（验证连通性）或运行 `tendril db integrity` 检查 SQLite 内部完整性。                                                                                                             |
| 数据库被锁定             | 另一个进程占用了排他锁。同时只能运行一个守护进程；在手动运行 `tendril run` 或 `tendril serve` 之前，请关闭桌面应用。                                                                                  |
| 数据库损坏               | 停止应用和守护进程，然后运行 `tendril db reset`（或者删除 `$TENDRIL_HOME/tendril.db` 及其关联的 `-wal` 和 `-shm` 文件）。磁盘上位于 `$TENDRIL_HOME/Plans/` 下的计划 Markdown 文件仍会完好无损地保留。 |

> [!TIP]
> 在 [Discord](https://discord.gg/FHgxkDga3y) 或 GitHub 上寻求帮助时，请使用 `tendril report-bug <plan-id>` 打包完整的诊断日志 —— 参见 [获取帮助](05_GettingHelp.md)。
