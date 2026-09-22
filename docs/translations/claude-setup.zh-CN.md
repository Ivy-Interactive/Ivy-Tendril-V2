# Tendril Skills 的 Claude Code 设置指南

本指南介绍如何在 Claude Code 中安装、配置和测试 Tendril 智能体技能（Skills）。

## 1. 通过插件市场安装

Tendril 在 `.claude-plugin/marketplace.json` 和 `.claude-plugin/plugin.json` 中提供了官方插件清单。

在 Claude Code 中，将 Ivy-Tendril-V2 仓库添加为插件市场源：

```
/plugin marketplace add ivy-interactive/ivy-tendril-v2
```

然后安装 `tendril-skills` 插件：

```
/plugin install tendril-skills@ivy-tendril-v2
```

## 2. 本地开发与测试

在本地开发技能或在推送前测试更改时：

启动 Claude Code 并将插件目录指向本地仓库检出路径：

```bash
claude --plugin-dir /path/to/ivy-tendril-v2
```

Claude Code 将读取 `.claude-plugin/plugin.json` 并自动挂载 `skills/` 中定义的所有技能。

## 3. 与 .claude/skills 的向后兼容性

对于 Ivy-Tendril-V2 内部的本地仓库工作流：
- `.claude/skills/<skill-name>` 中的符号链接指向 `../../skills/<skill-name>`。
- 任何引用 `.claude/skills/` 的现有本地 Claude Code 配置均可继续无缝工作，无需手动重新配置。

## 4. 在 Claude Code 中调用技能

安装完成后，可直接在 Claude Code 会话中使用斜杠命令：

- `/tendril-debug-plan <plan-id>`: 调试失败或缓慢的计划。
- `/tendril-debug-job <job-id>`: 检查任务工件和智能体决策日志。
- `/tendril-review`: 对当前 diff 运行代码质量与回归检查。
- `/tendrillable <url>`: 根据自主智能体评估规则对积压 issue 进行分类。
- `/tendril-release`: 自动化版本升级、依赖更新和发布工作流。

## 许可证

Tendril 技能和插件遵循仓库根目录下的 [Functional Source License (FSL-1.1-ALv2)](../LICENSE) 许可证。
