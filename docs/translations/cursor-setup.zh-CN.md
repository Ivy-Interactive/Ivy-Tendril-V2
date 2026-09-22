# Tendril Skills 的 Cursor 设置指南

本指南介绍如何在 Cursor 中安装和配置 Tendril 智能体技能（Skills）。

## 1. 快速安装（Skills CLI）

使用 open agent skills CLI 将 Tendril 技能安装到您的 Cursor 项目中：

```bash
# 项目级安装（安装至 .cursor/skills/）
npx skills add ivy-interactive/ivy-tendril-v2 --agent cursor

# 全局安装（适用于所有 Cursor 工作区）
npx skills add ivy-interactive/ivy-tendril-v2 --agent cursor -g
```

## 2. Cursor 中的目录结构

Cursor 在以下位置查找技能定义：

- **项目级**：`.cursor/skills/<skill-name>/SKILL.md`
- **全局 / 用户级**：`~/.cursor/skills/<skill-name>/SKILL.md`（macOS/Linux）或 `%USERPROFILE%\.cursor\skills\<skill-name>\SKILL.md`（Windows）

每个文件夹包含：
- `SKILL.md`：带有 YAML frontmatter 的主要指令
- 配套参考文档和脚本

## 3. 与 Cursor 规则（.cursorrules）的交互

您可以从项目的 `.cursorrules` 或 `.cursor/rules/*.mdc` 文件中引用 Tendril 技能：

```markdown
When debugging failed plans or reviewing changes:
- Reference src/skills/tendril-debug-plan for plan execution diagnosis.
- Run src/skills/tendril-review procedures before finalizing pull requests.
```

## 4. 在 Cursor 智能体对话中使用

在 Cursor 的智能体聊天窗口中：
- 输入 `@tendril-debug-plan` 或根据其指令要求智能体检查计划。
- 让 Cursor 对当前活动的 git diff 运行 `/tendril-review`。
- 运行 `/tendrillable` 对 issue 是否适合智能体自主执行进行评估和排序。

## 许可证

Tendril 技能和插件遵循仓库根目录下的 [Functional Source License (FSL-1.1-ALv2)](../../LICENSE) 许可证。
