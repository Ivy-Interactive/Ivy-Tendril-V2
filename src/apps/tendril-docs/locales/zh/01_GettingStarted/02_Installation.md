---
title: 安装
description: 通过预编译二进制文件或源码构建安装 Tendril，运行桌面应用和 CLI，并配置您的环境。
icon: Download
searchHints:
  - 安装
  - 预编译二进制文件
  - 源码构建
  - 前提条件
  - cargo
  - pnpm
  - tendril home
  - config.yaml
  - 更新
---

# 安装

Tendril 可以通过预编译的桌面端安装包和 CLI 二进制文件进行安装，也可以在本地从源码构建。

## 快速安装

从 [GitHub Releases](https://github.com/Ivy-Interactive/Ivy-Tendril/releases/latest) 直接下载独立桌面端安装程序（`.dmg`、`.pkg`、`.exe`、`.AppImage`、`.deb`），或者运行以下自动化安装脚本之一：

**macOS / Linux:**

```bash
curl -sSf https://cdn.ivy.app/install-tendril.sh | sh
```

**Windows (PowerShell):**

```powershell
irm https://cdn.ivy.app/install-tendril.ps1 | iex
```

安装程序会将 `tendril` CLI 二进制文件添加到您的 `PATH` 中，并将桌面应用程序注册到您的系统菜单中。

## 前置准备条件（用于源码构建）

如果从源码构建，请确保已安装以下依赖项并在 `PATH` 中可用：

| 工具                                         | 版本                 | 作用                                                                              |
| -------------------------------------------- | -------------------- | --------------------------------------------------------------------------------- |
| [Rust](https://www.rust-lang.org/)           | 1.80+ (2021 edition) | 编译原生 CLI、后台守护进程以及核心组件。                                          |
| [Node.js](https://nodejs.org/)               | 22 或更高            | 驱动前端工具链与构建脚本。                                                        |
| [pnpm](https://pnpm.io/)                     | 11 或更高            | 管理工作区包与依赖项。                                                            |
| [Vite+](https://viteplus.dev/) (`vp`)        | 最新                 | 统一编排构建、代码检查、代码格式化与测试。                                        |
| [Git](https://git-scm.com/)                  | 2.30+                | 管理 [Git 工作区 (worktree)](https://git-scm.com/docs/git-worktree)、提交和分支。 |
| [GitHub CLI](https://cli.github.com/) (`gh`) | 已认证               | 自动创建 Pull Request 和管理 Issue。                                              |

您还需要至少一个经过认证的编程智能体 CLI（例如 [Claude Code](https://code.claude.com/docs)、[GitHub Copilot](https://github.com/features/copilot)、[Gemini](https://ai.google.dev)、[OpenCode](https://opencode.ai)、[Antigravity](https://github.com/google-deepmind) 或 [Cursor](https://www.cursor.com)）。[代码库准备](03_Onboarding.md) 将详细介绍智能体配置。

## 源码构建

克隆代码仓库并安装工作区依赖：

```bash
git clone https://github.com/Ivy-Interactive/Ivy-Tendril-V2.git
cd Ivy-Tendril-V2

pnpm install
pnpm --filter @ivy-interactive/components build   # 共享 UI 库，桌面端应用必需
node src/scripts/ensure-wireframe-payload.mjs      # 为原生构建准备线框图资源
cargo build --workspace                            # 构建 tendril-core、tendril-server、tendril-cli
```

> [!NOTE]
> 必须在编译原生工作区 crate 之前生成 `@ivy-interactive/components` 库和线框图负载，因为 `tendril-app` 和 `tendril-wireframe` 在构建时会导入这些资源。

## 运行桌面应用

使用热模块重载（HMR）进行本地开发：

```bash
pnpm dev:desktop
```

此命令会构建必要的边车二进制文件，并在 [Tauri 2](https://tauri.app) 原生窗口旁启动 Vite。桌面应用会自动管理后台守护进程（`tendril run`）。

### 打包独立发布版本

为您的平台打包独立发布安装包：

```bash
cargo build --release --bin tendril

# 为您的目标架构暂存原生 CLI 边车文件
triple=$(rustc -vV | sed -n 's/^host: //p')
mkdir -p src/apps/tendril-app/src-tauri/binaries
cp target/release/tendril "src/apps/tendril-app/src-tauri/binaries/tendril-$triple"

# 获取绑定的 OpenCode 边车智能体
./src/apps/tendril-app/scripts/release/fetch-opencode-sidecar.sh

# 构建安装包（macOS 为 DMG，Windows 为 NSIS/MSI，Linux 为 AppImage/deb）
pnpm --filter @ivy-interactive/tendril-app exec tauri build
```

## 安装 CLI

`tendril` 二进制文件既是命令行工具，也是守护进程服务：

```bash
cargo build --release --bin tendril
# 或者直接安装到 ~/.cargo/bin：
cargo install --path src/crates/tendril-cli
```

使用健康检查 doctor 验证您的安装：

```bash
tendril version
tendril doctor
```

`tendril doctor` 会验证 `$TENDRIL_HOME`、`config.yaml` 语法、[SQLite](https://www.sqlite.org) 数据库、plans 目录以及您的 `git` 和 `gh` 凭证。

### 以无头模式运行守护进程

在无需桌面 UI 的情况下将 Tendril 作为无头服务器守护进程运行：

```bash
# 推荐：检查端口可用性并执行挂起的数据库迁移
tendril run

# 或直接运行监听器（支持 --tls-cert 和 --tls-key）
tendril serve --host 127.0.0.1 --port 5010
```

> [!NOTE]
> 服务默认监听 `127.0.0.1:5010`，暴露 REST 和 WebSocket 端点。它不提供静态 Web 界面，请通过桌面应用或 CLI 与之交互。

## 配置与目录结构

所有 Tendril 运行时状态均存储在 `$TENDRIL_HOME` 中，按以下优先级解析：

1. `TENDRIL_HOME` 环境变量；
2. `~/.tendril_location` 中记录的路径（如果存在）；
3. 默认用户路径：`~/.tendril`。

在 `$TENDRIL_HOME` 内部：

```
~/.tendril/
├── config.yaml     # 编程智能体、项目定义、验证规则、Promptware 覆盖
├── tendril.db      # 用于任务、成本和执行遥测的 SQLite 数据库
├── Plans/          # 结构化计划及其隔离的 Git 工作区
├── Jobs/           # 执行日志、智能体 prompt 和原始转写记录
└── Promptwares/    # 已部署的工作流智能体定义
```

一个最小的 `config.yaml` 示例：

```yaml
codingAgent: claude
maxConcurrentJobs: 20

projects:
  - name: MyProject
    repos:
      - path: /Users/you/Repos/MyProject
    verifications:
      - name: NpmBuild
        required: true
      - name: CheckResult
        required: true
```

部署标准 Promptware 以初始化智能体定义：

```bash
tendril promptware deploy
```

> [!WARNING]
> 在启动首个任务之前，请确保所选的编程智能体 CLI 已完成认证。如果智能体在无人值守的后台进程中停下来请求凭据输入，任务将会阻塞或超时。

## 更新升级

如果通过安装脚本安装，重新运行单行安装命令即可获取最新版本。

如果使用源码工作目录：

```bash
git pull
pnpm install
pnpm --filter @ivy-interactive/components build
node src/scripts/ensure-wireframe-payload.mjs
cargo build --workspace
```

## 后续步骤

- [代码库准备](03_Onboarding.md) — 配置代码仓库前提条件并验证智能体访问权限。
- [核心概念：计划](../02_Concepts/01_Plans.md) — 了解计划结构和审查生命周期。
- [故障排除](06_Troubleshooting.md) — 构建与运行时错误的解决方案。
