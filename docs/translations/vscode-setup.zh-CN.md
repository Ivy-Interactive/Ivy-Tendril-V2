# Tendril Skills 的 Visual Studio Code 设置指南

本指南介绍如何在 Visual Studio Code 中通过 GitHub Copilot 和其他 AI 智能体扩展安装、配置和使用 Tendril 智能体技能（Skills）。

## 1. 快速安装（Skills CLI）

在 VS Code 中为 GitHub Copilot 安装 Tendril 技能的最简便方式是使用 open agent skills CLI：

```bash
# 项目级安装（安装至 .agents/skills/ 或 .github/skills/）
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot

# 全局安装（适用于所有 VS Code 工作区）
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot -g
```

如需安装指定的单个技能而非完整软件包：

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --skill tendril-debug-plan --agent github-copilot
```

## 2. 手动安装路径

如果您更倾向于不通过 CLI 手动放置技能文件夹：

- **工作区仓库（团队推荐）**：
  将技能复制到工作区根目录下的 `.agents/skills/<skill-name>` 或 `.github/skills/<skill-name>`。
- **用户配置文件（所有项目全局生效）**：
  将技能复制到 `~/.copilot/skills/<skill-name>`（macOS/Linux）或 `%USERPROFILE%\.copilot\skills\<skill-name>`（Windows）。

确保每个技能文件夹包含其 `SKILL.md` 规范以及相应的 `references/` 或 `scripts/` 目录。

## 3. 在 GitHub Copilot Chat 中使用技能

安装完成后，GitHub Copilot 将自动发现技能：

1. 在 VS Code 中打开 Copilot Chat（`Ctrl+Alt+I` / `Cmd+Ctrl+I`）。
2. 输入 `/skills` 检查已加载的技能及说明。
3. 直接将任何 Tendril 技能作为命令调用：
   - `/tendril-debug-plan <plan-id>`: 检查计划的执行日志、时间线和验证结果。
   - `/tendril-debug-job <job-id>`: 分析任务工件、智能体日志和原始事件。
   - `/tendril-review`: 对修改后的文件执行变更后全方位代码和测试审查。
   - `/tendrillable <url>`: 评估 GitHub issue 是否适合智能体自主执行。

## 4. 与其他 VS Code AI 扩展集成

Tendril 技能遵循开放智能体技能标准，可与第三方 VS Code 扩展无缝配合：

### Cline
```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent cline
```
技能将写入 `.cline/skills/` 或全局 Cline 配置目录。

### Continue
```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent continue
```
技能将安装到您的 `.continue/skills/` 目录中，并可在提示词上下文中引用。

### Roo Code (Roo Clinic)
```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent roo
```
安装到 `.roo/skills/` 中，用于自定义系统模式和任务执行。

## 5. 搭配官方 Ivy Tendril VS Code 扩展使用

为了获得一体化开发工作流，请安装官方 [Ivy Tendril VS Code 扩展](https://marketplace.visualstudio.com/items?itemName=ivy-interactive.ivy-tendril)：

- **计划仪表板（Plan Dashboard）**：直接从侧边栏浏览、审查和触发计划。
- **工作区导航器（Worktree Navigator）**：一键跳转进入隔离执行工作区。
- **服务控制（Server Control）**：启动、停止和检查后台 Tendril 守护进程。

将 Tendril 技能与 VS Code 扩展结合使用，可为您提供自主编程智能体编排的完整控制中心。

## 许可证

Tendril 技能和插件遵循仓库根目录下的 [Functional Source License (FSL-1.1-ALv2)](../../LICENSE) 许可证。
