# Tendril Skills 的 Google Antigravity 设置指南

本指南介绍如何在 Google Antigravity CLI（`agy`）和 Antigravity IDE 中安装和使用 Tendril 智能体技能（Skills）。

## 1. Antigravity CLI 安装

Tendril 在 `.agents/plugins/marketplace.json` 提供了 Antigravity 插件清单。

### 从远程 Git 仓库安装
```bash
agy plugin install https://github.com/ivy-interactive/ivy-tendril-v2.git
```

### 从本地仓库检出安装
在本地开发期间或在 Ivy-Tendril-V2 检出目录中：
```bash
agy plugin install ./
```

## 2. 插件验证与发现

验证插件及其关联技能是否已加载：

```bash
# 列出已安装的插件
agy plugin list

# 验证可用技能
agy skill list
```

您将看到捆绑的 Tendril 技能：
- `tendril-debug-plan`
- `tendril-debug-job`
- `tendril-review`
- `tendrillable`
- `tendril-release`
- `tendril-extension`

## 3. 在 Antigravity 中调用技能

在任何交互式 Antigravity 智能体运行会话或自动化脚本中：

- 请求 Antigravity 调试计划：
  ```
  Use tendril-debug-plan to investigate plan 00516
  ```
- 审查待处理的工作区（worktree）变更：
  ```
  Run tendril-review on the current changes
  ```
- 分流候选积压待办事项（issue）：
  ```
  Run tendrillable on https://github.com/ivy-interactive/ivy-tendril-v2 5
  ```

## 4. Antigravity IDE 集成

在 Antigravity IDE 中工作时：
1. 放置在工作区根目录 `.agents/skills/` 下的技能会自动被索引。
2. 将 Ivy Tendril 扩展链接到 Antigravity IDE：
   ```bash
   src/skills/tendril-extension/scripts/install-antigravity.sh
   ```
3. 重新加载 Antigravity IDE（`Cmd+Shift+P` -> `Developer: Reload Window`）。

## 许可证

Tendril 技能和插件遵循仓库根目录下的 [Functional Source License (FSL-1.1-ALv2)](../LICENSE) 许可证。
