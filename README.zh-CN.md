<p align="right">
  <a href="README.md">English</a> | <strong>简体中文</strong> | <a href="README.ja.md">日本語</a> | <a href="README.es.md">Español</a> | <a href="README.de.md">Deutsch</a> | <a href="README.fr.md">Français</a>
</p>

<h1>
  <a href="https://tendril.ivy.app"><img src="src/logo.png" alt="Tendril Logo" width="64" valign="middle" /></a> Ivy Tendril
</h1>

<p>
  <a href="https://github.com/Ivy-Interactive/Ivy-Tendril/stargazers"><img src="https://img.shields.io/github/stars/Ivy-Interactive/Ivy-Tendril?style=flat&label=%E2%98%85" alt="GitHub stars" /></a>
  <a href="https://github.com/Ivy-Interactive/Ivy-Tendril/releases/latest"><img src="https://img.shields.io/github/v/release/Ivy-Interactive/Ivy-Tendril?style=flat&label=release" alt="Latest Release" /></a>
  <a href="https://github.com/Ivy-Interactive/Ivy-Tendril/actions/workflows/repo-health.yml"><img src="https://img.shields.io/github/actions/workflow/status/Ivy-Interactive/Ivy-Tendril/repo-health.yml?branch=development&style=flat&label=CI" alt="CI Status" /></a>
  <a href="https://tendril.ivy.app"><img src="https://img.shields.io/badge/docs-tendril.ivy.app-blue?style=flat" alt="Documentation" /></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-4493F8?style=flat-square" alt="支持平台: macOS, Windows, Linux" />
</p>

<h2>面向 10x 生产力构建者的 Agentic 软件工厂</h2>

<p>
AI 智能体现在可以编写 99% 的代码。这彻底改变了作为开发者的意义。我们的角色转变为掌握<strong>何为优质代码</strong>。为此，我们需要全新的开发者工具。Tendril 正是这样的工具，它将在智能体时代替代传统的 IDE。
</p>

<p>
<a href="https://youtu.be/_KVG1NnAj-8">
  <img src="docs/yt-thumbnail-in-two-minutes-2.png" alt="两分钟了解 Ivy Tendril: 在 YouTube 上观看" width="720">
</a>
</p>

<p>https://youtu.be/_KVG1NnAj-8</p>

## 功能特性

<table>
<tr>
<td width="50%" valign="middle">

### 并行工作区 (Parallel Worktrees)

在隔离的 git 工作区中运行智能体。在审核、批准并合并更改之前，始终保持主分支的干净整洁。

[文档 &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="src/worktrees.gif" alt="并行工作区" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### 远程穿透 (Tunneling) (远程与移动端开发)

使用 Cloudflare Quick Tunnels 安全暴露您的服务器，随时随地监控和引导智能体运行。

[文档 &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="src/tunneling.gif" alt="远程穿透" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### 语音与富文本输入 (Voice & Rich Input)

使用内置的 Whisper 语音输入口述提示词，并通过拖拽轻松添加文本文件、日志或文档。

[文档 &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="src/voice.gif" alt="语音与富文本输入" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### 计划内联批注 (Plan Annotations)

直接在草稿中进行内联批注，自动使用修订后的目标更新智能体计划。

[文档 &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="src/annotation.gif" alt="计划内联批注" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### 强大代码审查 (Code Reviews)

审查智能体的代码变更、检查 diff，并通过自动化验证门禁批准代码。

[文档 &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="src/review.gif" alt="强大代码审查" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### GitHub 集成与自动收件箱 (GitHub Integration & Automated Inbox)

通过 Webhook 接收 GitHub Issues 或 jam.dev 缺陷报告，自动将 Markdown 计划转化为进行中的任务。

[文档 &rarr;](https://tendril.ivy.app/docs/integrations/jamdev)

</td>
<td width="50%">
  <img src="src/github.gif" alt="GitHub 集成与自动收件箱" width="100%" />
</td>
</tr>
</table>

---

## 支持的智能体

支持**任何 CLI 智能体**: 只要能在终端中运行，就能在 Tendril 中运行。

<p>
  <a href="https://docs.anthropic.com/claude/docs/claude-code"><kbd><img src="https://www.google.com/s2/favicons?domain=anthropic.com&sz=64" alt="Claude Code logo" width="16" valign="middle" /> Claude Code</kbd></a> &nbsp;
  <a href="https://github.com/openai/codex"><kbd><img src="https://www.google.com/s2/favicons?domain=openai.com&sz=64" alt="Codex logo" width="16" valign="middle" /> Codex</kbd></a> &nbsp;
  <a href="https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli"><kbd><img src="https://www.google.com/s2/favicons?domain=github.com&sz=64" alt="GitHub Copilot logo" width="16" valign="middle" /> GitHub Copilot</kbd></a> &nbsp;
  <a href="https://gemini.google.com/cli"><kbd><img src="https://www.google.com/s2/favicons?domain=google.com&sz=64" alt="Gemini logo" width="16" valign="middle" /> Gemini</kbd></a> &nbsp;
  <a href="https://opencode.ai/docs/cli/"><kbd><img src="https://www.google.com/s2/favicons?domain=opencode.ai&sz=64" alt="OpenCode logo" width="16" valign="middle" /> OpenCode</kbd></a> &nbsp;
  <kbd>+ 任意 CLI 智能体</kbd>
</p>

## 智能体技能 (Agent Skills)

使用官方 Tendril 工程与调试技能扩展您喜爱的 AI 编程智能体。

### 快速上手

使用通用技能安装程序为任何受支持的智能体安装 Tendril 技能:

```bash
npx skills add ivy-interactive/ivy-tendril
```

或安装特定技能:

```bash
npx skills add ivy-interactive/ivy-tendril --skill tendril-debug-plan
```

### 支持的工具与开发环境

<details>
<summary><strong>Visual Studio Code (GitHub Copilot 与扩展)</strong></summary>

为 VS Code 中的 GitHub Copilot 安装技能:

```bash
npx skills add ivy-interactive/ivy-tendril --agent github-copilot
```

全局安装 (适用于所有工作区):

```bash
npx skills add ivy-interactive/ivy-tendril --agent github-copilot -g
```

或直接将技能复制到工作区根目录下的 `.agents/skills/` 或 `.github/skills/` (项目级) 或 `~/.copilot/skills/` (全局)。

安装完成后，技能将显示在 GitHub Copilot Chat 的 `/skills` 菜单中，并可直接作为斜杠命令调用 (例如 `/tendril-debug-plan`, `/tendril-debug-job`, `/tendril-review`, `/tendrillable`)。

第三方 VS Code 智能体扩展:
- Cline: `npx skills add ivy-interactive/ivy-tendril --agent cline`
- Continue: `npx skills add ivy-interactive/ivy-tendril --agent continue`
- Roo Code: `npx skills add ivy-interactive/ivy-tendril --agent roo`

如需完整的编辑器集成，请安装官方 [Ivy Tendril VS Code 扩展](https://marketplace.visualstudio.com/items?itemName=ivy-interactive.ivy-tendril)，以获取内嵌的计划仪表板、工作区导航和实时执行监控。

请参阅 [VS Code 配置指南](docs/vscode-setup.md) 了解详细配置选项。
</details>

<details>
<summary><strong>Claude Code</strong></summary>

从 Claude Code 插件市场安装:

```
/plugin marketplace add ivy-interactive/ivy-tendril
/plugin install tendril-skills@ivy-tendril
```

本地开发模式:

```bash
claude --plugin-dir /path/to/ivy-tendril
```

请参阅 [Claude Code 配置指南](docs/claude-setup.md) 了解详细配置选项。
</details>

<details>
<summary><strong>Antigravity CLI (agy)</strong></summary>

通过 Git URL 安装插件:

```bash
agy plugin install https://github.com/ivy-interactive/ivy-tendril.git
```

本地安装:

```bash
agy plugin install ./
```

请参阅 [Antigravity 配置指南](docs/antigravity-setup.md) 了解详细配置选项。
</details>

<details>
<summary><strong>Cursor</strong></summary>

面向 Cursor 安装:

```bash
npx skills add ivy-interactive/ivy-tendril --agent cursor
```

或将技能复制到 `.cursor/skills/` (项目级) 或 `~/.cursor/skills/` (全局)。

请参阅 [Cursor 配置指南](docs/cursor-setup.md) 了解详细配置选项。
</details>

<details>
<summary><strong>OpenAI Codex</strong></summary>

从 Codex 插件市场安装:

```bash
codex plugin marketplace add ivy-interactive/ivy-tendril
codex plugin add tendril-skills@tendril-skills
```
</details>

<details>
<summary><strong>Gemini CLI</strong></summary>

使用 Gemini CLI 安装:

```bash
gemini skills install https://github.com/ivy-interactive/ivy-tendril.git --path skills
```
</details>

---

## 安装

直接从 [GitHub Releases](https://github.com/Ivy-Interactive/Ivy-Tendril/releases/latest) 下载独立桌面安装包 (`.pkg`, `.AppImage`, `.exe`)，或运行以下快捷安装命令:

**macOS / Linux:**
```bash
curl -sSf https://cdn.ivy.app/install-tendril.sh | sh
```

**Windows:**
```powershell
irm https://cdn.ivy.app/install-tendril.ps1 | iex
```

### 运行

Tendril 是一款桌面应用程序，但也支持通过 CLI 启动和控制:

启动桌面应用程序:
```bash
tendril
```

以无头模式启动 (无桌面界面的 Web 服务端):
```bash
tendril --web
```

---

## 🏛 目录结构

```
Ivy-Tendril-V2/
├── src/
│   ├── apps/
│   │   └── tendril-app/            # Tauri 桌面应用 + React 前端
│   ├── packages/
│   │   └── components/             # @ivy-interactive/components + Storybook
│   ├── crates/
│   │   ├── tendril-core/           # 核心领域模型, SQLite 数据库, 工作区引擎
│   │   ├── tendril-server/         # Axum REST 与 WebSocket HTTP 服务守护进程
│   │   └── tendril-cli/            # 命令行界面 ("tendril")
│   └── promptwares/                # Promptware 智能体定义与固件
├── Cargo.toml                      # 统一 Cargo 工作空间
├── pnpm-workspace.yaml             # 统一 pnpm 工作空间
└── package.json                    # 工作空间根脚本
```

---

## 🚀 快速上手

### 环境要求
- [Rust](https://rustup.rs/) (edition 2021)
- [Node.js](https://nodejs.org/) (v22+) 与 [pnpm](https://pnpm.io/) (v11+)
- [Vite+](https://viteplus.dev/) (`vp`)
- GitHub CLI (`gh`)

### 快速开始

1. **安装依赖**:
   ```bash
   pnpm install
   ```

2. **构建组件与 UI 库**:
   ```bash
   pnpm --filter @ivy-interactive/components build
   ```

3. **运行 Storybook**:
   ```bash
   pnpm dev:storybook
   ```

4. **构建并运行桌面应用**:
   ```bash
   pnpm dev:app
   ```

5. **构建后端 Crates**:
   ```bash
   cargo build --workspace
   ```

6. **运行测试**:
   ```bash
   # Web 与组件测试
   pnpm test

   # Rust 测试
   cargo test --workspace
   ```

---

## 社区与支持

- **Discord:** 加入 **[Discord](https://discord.gg/FHgxkDga3y)** 社区。
- **反馈与想法:** 发现了 bug 或有新想法? 欢迎 [提交 Issue](https://github.com/Ivy-Interactive/Ivy-Tendril/issues)。
- **支持我们:** 请为本仓库 [点赞 Star](https://github.com/Ivy-Interactive/Ivy-Tendril) 以关注我们的最新开发动态。

---

## 许可证

Apache-2.0 © Ivy Interactive
