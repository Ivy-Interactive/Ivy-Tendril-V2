---
title: 发行说明
description: Tendril 各版本的版本历史、新功能、改进以及缺陷修复。
icon: ScrollText
searchHints:
  - 发行说明
  - 变更日志
  - 版本历史
  - 更新
  - 新增功能
---

# 发行说明

## 2.0.0 (2026-09-21)

Tendril v2 是 Tendril 平台划时代的架构重构，使用 [Rust](https://www.rust-lang.org) 重写了守护进程和核心执行引擎，桌面应用程序采用 [Tauri v2](https://tauri.app)，引入了高性能的 [Vite+](https://viteplus.dev) 前端，并增加了原生多智能体工作区并发、实时终端交互以及扩展的 [模型提供商](../08_ModelProviders/_Index.md)。

### 重大架构演进

- **高性能 Rust 守护进程 (`tendril-server` 和 `tendril-core`)**：将原有的 .NET 后端替换为基于 [Tokio](https://tokio.rs) 和 [Axum](https://github.com/tokio-rs/axum) 的异步 [Rust](https://www.rust-lang.org) 守护进程。新的守护进程提供亚毫秒级的路由调度、带繁忙超时的稳健 [SQLite](https://www.sqlite.org) 连接池、原子配置文件写入，以及用于零开销本地 IPC 的单进程主选举协议。
- **Tauri v2 桌面应用程序**：将桌面外壳迁移至 [Tauri v2](https://tauri.app)，在 macOS、Linux 和 Windows 上提供紧凑、内存高效的桌面发行版。利用原生系统 Webview、加固的 IPC 桥接、原生窗口装饰和系统托盘集成，彻底消除了对传统运行时框架的依赖。
- **Vite+ React 前端**：使用 [Vite+](https://viteplus.dev) 和 [React 19](https://react.dev) 从头重构了桌面用户界面。与 `@ivy-interactive/components` 共享原子设计令牌和渲染器组件，支持即时热重载、统一主题预设（Default、Dracula、Forest、Lovably）以及响应式多断点布局。
- **并行工作区 (Worktree) 执行**：针对并发 [计划 (plans)](../02_Concepts/01_Plans.md) 执行，实现了多仓库 [git worktree](https://git-scm.com/docs/git-worktree) 自动置备。多个 [编程智能体](../06_CodingAgents/_Index.md) 可以在隔离的分支上同时执行独立的计划，而不会发生 Git 索引锁定、代码仓库冲突或分支切换副作用。包含后台清理服务（`worktreeReaperInterval` 和 `worktreeReaperGrace`），可自动清理空闲或孤立的工作区。
- **实时终端与交互式对话**：在应用程序外壳中直接引入了由 [Xterm.js](https://xtermjs.org) 驱动的嵌入式 [PTY](https://en.wikipedia.org/wiki/Pseudoterminal) 终端模拟。操作员可以在结构化对话与原始终端交互之间自由切换（`chatMode: terminal` 或 `chatMode: chat`），通过标准输入与运行中的智能体进行交互，检查实时流式工具执行，并在切换会话时保持持久的排队提示词。
- **扩展的模型集成与捆绑 Sidecar**：
  - **捆绑 OpenCode Sidecar**：直接随桌面安装包分发 [OpenCode](https://opencode.ai) CLI 二进制文件（`binaries/opencode`），实现零配置的 [OpenCode 智能体](../06_CodingAgents/04_OpenCode.md) 执行，并能立即访问数百个开源和专有模型，无需单独安装 Node 或 CLI。
  - **自带大模型 (BYO LLM)**：为 [OpenAI](https://openai.com)、[Anthropic](https://www.anthropic.com) 以及欧洲主权提供商 [Berget AI](../08_ModelProviders/01_Berget.md) (`https://api.berget.ai/v1`) 提供了第一方入门引导和设置卡片，具有自动 Base URL 规范化，并将凭据分发至 OpenAI 和 Anthropic SDK 变量。
  - **Apple Foundation Model 集成**：通过 macOS `fm serve` 原生支持 Apple 设备端模型，在本地执行推理，零云端 API 成本并实现完全离线隐私。
  - **动态模型目录扩充**：集成了来自 [models.dev](https://models.dev) 的动态目录发现机制，具有离线 [SQLite](https://www.sqlite.org) 缓存、过期检测和手动同步端点（`POST /api/models/refresh`）。
  - **分级模型配置文件**：在所有支持的 [编程智能体](../06_CodingAgents/_Index.md)（[Claude Code](../06_CodingAgents/01_ClaudeCode.md)、[Copilot](../06_CodingAgents/03_Copilot.md)、[Codex](../06_CodingAgents/02_Codex.md)、[Gemini](../06_CodingAgents/05_Gemini.md)、[Antigravity](https://antigravity.google)、[OpenCode](../06_CodingAgents/04_OpenCode.md)、[Cursor](https://cursor.com) 和 Apple）中提供声明式模型配置文件层级（`deep`、`balanced`、`quick`），包括可配置的推理强度选择器（`low`、`medium`、`high`、`max`）。

### 新功能

- **用于审查动作和智能体的嵌入式 PTY 终端**：在具备实时进程树跟踪且完全支持 ANSI 的终端标签页中运行审查动作和交互式智能体会话。
- **多仓库 Git 工作区管理**：在 `Worktrees/<owner>/<repo>` 下构建隔离的计划工作空间，具有分支跟踪、上游基线分支分叉检测以及安全未推送提交保护。
- **集中式 Team Vault 同步**：通过 [Team Vault](../09_Advanced/01_CLI/07_Vault.md) 并配合自动化凭据脱敏，连接、导入并将项目配置、自定义 [MCP 服务器](../09_Advanced/03_MCP.md) 和 [智能体技能](../06_CodingAgents/00_Skills.md) 推送到远程 Git 仓库保管库。
- **Cloudflare Quick Tunnels**：通过安全的 [Cloudflare](https://www.cloudflare.com) 穿透隧道，利用二维码、[Argon2](https://en.wikipedia.org/wiki/Argon2) 密码会话保护和匿名审查员角色，分享只读计划审查与实时验证状态。
- **应用内配置编辑器**：针对 `config.yaml` 的完整语法高亮应用内编辑器，具备实时冲突检测、重新加载钩子和助手引导提示动作（参见 [配置设置](../03_Configuration/01_Setup.md)）。

### 改进

- **亚毫秒级 CLI 响应**：使用 Rust 重写了 `tendril` CLI（`src/crates/tendril-cli`），实现了近乎即时的命令启动和无缝守护进程代理（参见 [CLI 概述](../09_Advanced/01_CLI/00_Overview.md)）。
- **Token 与成本明细账本**：在所有主要提供商模型间校准的实时单任务 Token 明细表和成本跟踪，并为自定义端点提供自动化后备计价。
- **自动化验证求解器**：运行项目检查套件（构建、测试、格式化、检查）的结构化验证运行器，具有实时流式输出和自动失败诊断功能（参见 [验证检查](../09_Advanced/01_CLI/03_Verification.md)）。
- **统一 Markdown 渲染器**：跨计划、笔记和文档共享的 Markdown 渲染引擎，支持 GFM 表格、语法高亮代码块、[Mermaid](https://github.com/mermaid-js/mermaid) 图表，以及在 [Review 应用](../04_Apps/02_Review.md) 中基于字符锚定的内联 diff 评论。

## 1.2.0 (2026-09-01)

### 新功能

- **重新设计的应用外壳 (Figma)** — 现代化桌面外壳布局，具有可折叠导航区、持久会话标签页和集成的项目状态指示器 (`#2173`)。
- **重新设计的 Tendril 仪表板** — 构建了全新的 `TendrilDashboard` React 组件，具备实时状态计数器、活动趋势、活动任务跟踪和 Cloudflare Quick Tunnel 二维码展示 (`#2201`)。
- **草稿到计划的统一命名** — 在整个代码库中将 Drafts 应用、服务和模型重命名为 "Plans"（计划），建立了从 Issue 接入到已验证执行的连贯生命周期 (`#2258`)。
- **用于聊天附件的 HTTP Multipart 上传** — 将内联 Base64 传输替换为分块 HTTP Multipart 上传，规避了 SignalR 在传输大图像和文件时的负载限制 (`#2255`, `#2224`)。
- **对话中持久保留排队消息** — 排队的消息在切换对话会话时依然保持持久与可见，允许开发者在智能体积极运行时代排提示词 (`#2253`)。
- **页内搜索快捷键 (Ctrl+F / Cmd+F)** — 在 Markdown 视图和计划内增加了页内搜索功能，且不干扰布局流 (`#2254`)。
- **审查动作实时预览** — 直接在项目设置中添加了审查动作的预览和运行功能 (`#2225`)。
- **Lovably 主题预设** — 基于 Lovable 设计令牌和色彩梯度增加了现代化 UI 主题预设 (`#2256`)。
- **等宽 CodeInput 扩展** — 在审查动作命令与条件 (`#2247`)、MCP 环境变量 (`#2248`)、验证提示词 (`#2249`) 和项目记忆 Markdown 内容 (`#2259`) 中全面集成了语法高亮 `CodeInput`。
- **安全对话防护栏** — 禁止在探索性对话会话中直接进行未经审查的代码库修改，强制要求为代码变更创建正式计划 (`#2221`)。
- **Team Vault 冲突项目合并** — 在导入与本地项目同名的保管库项目时增加了智能合并解决机制 (`#2219`)。

### 改进

- **强化智能体对话与 Issue 生成提示词** — 为初始智能体对话提示词和 GitHub Issue 创建提供完整的项目上下文、仓库映射和附件元数据 (`#2226`)。
- **外观设置中的主题模式指示器** — 在外观设置中清晰展示当前活动的明亮/暗黑模式状态 (`#2213`)。
- **主题自适应 ContentInput 组件** — 自定义主题预设下动态自适应输入条、按钮和边框 (`#2241`)。
- **审查动作配置表精简** — 精简项目设置中的审查动作配置表格以提升可读性 (`#2240`)。
- **暂存容器源码构建** — 将 Docker 暂存镜像配置为直接从源码构建，以便进行精确的 PR 预览分支测试 (`#2229`)。
- **侧边栏布局与间距优化** — 优化了对话侧边栏中的已完成对勾标记间距和生成中会话布局 (`#2220`, `#2223`)。
- **原生删除会话对话框** — 使用原生的 `DeleteSessionDialog` 组件替换用于会话删除的 React 模态弹窗 (`#2222`)。

### 缺陷修复

- **任务可见性与队列状态恢复** — 修复了应用程序重启后任务卡片丢失的问题，并正确恢复活动的排队任务状态 (`#2243`)。
- **清理幽灵阻塞任务** — 防止孤立或被取代的阻塞任务滞留在 SQLite 存储和输出视图中 (`#2250`)。
- **Antigravity 智能体对话超时** — 配置 Antigravity 智能体会话遵循配置的全局默认超时时间，而不是过早超时 (`#2218`)。
- **项目设置验证编辑目标** — 修复了编辑过程中验证对话框针对错误验证条目的问题 (`#2252`)。
- **Markdown 代码块溢出** — 防止宽代码片段在水平方向超出父计划容器边界 (`#2214`)。
- **Dracula 与 Forest 暗黑主题对比度** — 解决了暗黑主题下侧边栏项目、设置图标和标签页悬停时文字与图标可见性问题 (`#2210`, `#2211`, `#2212`, `#2239`, `#2242`)。
- **消除重复侧边栏** — 消除了应用外壳切换过程中出现的冗余侧边栏渲染 (`#2244`)。
- **已解决 Issue 上的完成草稿状态** — 解决了为先前已解决的 Issue 生成计划时出现的不可完成状态 (`#2217`)。
- **清理已废弃模型** — 移除已弃用的 Gemini 3.5 Flash 模型引用，推荐使用 Gemini 3.7 Flash (`#2215`)。
- **清理临时测试工件** — 确保端到端测试运行后清理临时目录和智能体草稿文件 (`#2209`)。

## 1.1.36 (2026-08-28)

### 新功能

- **入门引导实时模型测试与认证校验** — 入门引导现在会在允许继续之前，使用实时提示词请求主动测试端点凭据和配置文件模型（`Deep`、`Balanced`、`Quick`），拦截无效的模型名称并将嵌套的代理错误负载解析为清晰的信息。
- **模型配置文件优先级常量与提供商枚举** — 使用声明式优先级表（`ModelProfilePriorities`）和枚举（`ModelProviderKind`、`ModelProfileKind`）替换三元表达式级联，以在入门引导和设置中实现一致的默认与候选模型解析。
- **按需 Promptware 部署后备机制** — 在 `PromptwareRunner` 和 `PromptwareRunCommand` 中添加自动后备部署，当缺少 `Program.md` 时可按需从嵌入资源中提取缺失的 promptware。

### 改进

- **捆绑 Ivy Agent 二进制文件优先解析** — 强制优先解析捆绑或由 Tendril 管理的 `ivy-agent` 二进制文件（`~/.tendril/bin`），防止非托管的系统 `PATH` 可执行文件干扰智能体执行。
- **设置中自定义模型输入的持久化** — 修复了在 `CodingAgentSetupView` 中按 Enter 或重新渲染时自定义模型名称输入被重置的问题。
- **废弃回收站功能** — 移除已淘汰的回收站应用和命令集，将回收站标记替换为 `CreatePlan` 中利落的重复拒绝处理。

## 1.1.35 (2026-08-28)

### 新功能

- **共享模式穿透与外部共享 `[Beta]`** — 在 Beta 标志（设置中的 `beta: true` 或 `TENDRIL_BETA`）控制下，通过 Cloudflare 穿透隧道安全地向外部共享计划和草稿链接，支持自动生成共享 URL 和复制操作。
- **共享模式会话保护** — 在设置的统一“安全与穿透”部分下，添加了带有 Argon2 哈希的密码会话保护。
- **匿名审查员角色** — 为审查共享计划的外部协作者生成带首字母头像的友好匿名角色。
- **草稿与计划 Diff 内联评论** — 在 Review 模式中为 diff 代码块添加了实时内联审查评论（`DraftDiffCommentService`），并配有专用的“请求修改”动作和角标计数。
- **草稿文本选择批注** — 在 `DraftMarkdown` (`DraftAnnotationService`) 中添加了锚定在文本字符偏移量的文本选择高亮与浮层。
- **团队配置保管库 `[Beta]`** — 引入了基于 Git 仓库的集中式团队配置同步功能（`VaultService`，在 Beta 标志下可用），允许团队创建、连接、导入并将项目配置推送到远程保管库，并具备自动密钥脱敏（`VaultSecretSanitizer`）。

### 改进

- **任务溯源与配置文件记录** — 记录每个任务的执行配置文件，并将结构化成本明细溯源作为事实保存。
- **Beta 功能隔离** — 确保共享按钮、穿透隧道控制和保管库配置在 UI 和命令层中均干净地隔离在 Beta 标志之后。

### 缺陷修复

- **Windows 桌面打包** — 在 Windows x64 和 arm64 构建中，对捆绑的 `ivy-agent.exe` 采用去除路径的 zip 解压方式，修复打包失败问题。

## 1.1.34 (2026-08-25)

### 新功能

- **用于审查动作的嵌入式 PTY 终端** — 审查动作现在在由 Xterm 强力驱动的响应式嵌入式终端标签页（`ReviewActionApp`）中执行，而无需启动外部终端窗口。
- **捆绑 Ivy Agent CLI** — 将独立的 `ivy-agent` 可执行文件直接捆绑到 Tendril 应用程序安装包中，消除了手动安装需求。
- **自带大模型 (BYO LLM) 与模型目录** — 在入门引导和设置中为 BYO LLM 配置和 Ivy Proxy 添加了提供商目录和模型选择器，支持 Gemini 3.7 Flash、Claude 模型和 OpenAI 推理模型。
- **模型推理强度选择** — 在编程智能体配置文件设置中，为支持的推理模型引入了强度级别选择器（low、medium、high）。
- **自定义 MCP 服务器与智能体技能** — 增加了直接从 Git 仓库、远程 URL 和本地文件路径导入 MCP 服务器和自定义技能的支持，配备完整的管理 UI 和校验。
- **Token 与成本明细表** — 引入了可直接从任务表格的任务成本单元格访问的交互式 Token 使用量与成本明细表。
- **多仓库工作区结构化** — 将计划工作区组织在 `Worktrees/<owner>/<repo>` 路径下，以支持多仓库设置和复杂项目结构。
- **键盘导航与标签页管理** — 在独立 Tendril 中添加了用于关闭当前标签页的 `Cmd+W` / `Ctrl+W` 快捷键支持，并优化了各对话框中的 macOS Command (`⌘`) 快捷键提示。

### 改进

- **草稿与审查性能优化** — 显著降低了 Review 和 Drafts 应用中的计划切换延迟和标签切换开销。
- **Jobs DataTable 伸缩性** — 优化了 DataTable 渲染和数据同步，无需卡顿即可无缝处理 100 多个活动与历史任务。
- **对话队列与状态指示器** — 重新设计了带有内联控制的对话排队消息面板，并在侧边栏中添加了实时生成状态角标。
- **草稿批注锚定** — 将选中文本弹窗和工具栏高亮锚定到 DraftMarkdown 中的文本字符偏移量，防止滚动时出现偏差。
- **工作区基线分支显示** — 在 Review 的 Git 标签页中显示上游基线分支的分叉点，并在 Pull Request 概览中添加分支跟踪。
- **桌面通知弹窗抑制** — 当显示原生操作系统桌面通知时，抑制冗余的应用内 Toast 提醒。
- **设置 UI 重新设计** — 重构了项目设置布局，包含项目色块、可折叠自定义技能/MCP 卡片和标准化按钮尺寸。

### 缺陷修复

- **工作区未推送提交保护** — 防止工作区清理器在后台清理期间孤立或删除未推送的计划提交。
- **工具调用标题悬停锁定** — 确保在长流式输出期间，智能体工具调用标题始终固定在视口顶部。
- **避免因工具已恢复错误而误报任务失败** — 防止 Antigravity 任务在智能体于初始工具报错后成功自愈时被错误判定为失败。
- **GitHub PR URL 大小写不敏感** — 在 GitHub 导入和 PR 操作期间支持大小写不敏感的仓库 URL（`Https://`、`Git@` 等）。
- **Markdown 链接美化器跨度保护** — 修复了 Markdown 美化器中计划链接替换破坏嵌套计划跨度的问题。
- **入门引导流程稳定性** — 修复了当智能体安装失败或所需二进制文件临时缺失时入门引导挂起的问题。

## 1.1.19 (2026-07-28)

### 新功能

- **Claude Opus 5 支持** — 在 Claude 目录中添加了 `Claude Opus 5` (`claude-opus-5`) 模型支持并更新了定价元数据。
- **批量任务取消** — 在 `JobsApp`（`IJobService.StopAllJobs` 和 `StopQueuedJobs`）中引入了“停止所有任务”和“停止所有排队任务”标题动作，以便于批量任务管理。
- **Promptware 记忆修剪** — 添加了 `promptware delete-memory` CLI 命令和固件能力，允许 promptware 删除已过期的记忆文件。
- **记忆引用解析** — 在 `read-memory` CLI 命令中自动解析记忆引用，而不是在请求引用的笔记时报错。
- **可配置的 Ollama 智能体 URL** — 为本地 Ollama 智能体端点添加了可配置的 Base URL 选项（`--url`）。
- **导入 Issue 配额扩容** — 将导入 Issue 对话框的上限从 100 提高到 1,000 条，并在达到上限时提供截断警告。
- **运行中任务状态持久化** — 将活动中运行的任务持久保存在 SQLite 数据库中，使任务状态更新在主进程重启后依然得以恢复。
- **Windows 自动配置 CLI PATH** — 在应用启动和 Velopack 安装器钩子中，自动创建 `tendril.cmd` 包装脚本并将应用程序目录注册到 Windows 用户 PATH 中。

### 改进

- **穿透自动刷新合并** — 合并突发的收件箱自动刷新，并在数据变更时才触发 `JobsApp` 单元格更新，避免在 Cloudflare 穿透连接上产生过多刷新。
- **连续智能体读取优化** — 减少了编程智能体连续读取文件时的进程启动开销。
- **仪表板成本图表货币单位** — 在仪表板的成本柱状图系列中添加了货币标识符 ($)。
- **任务表格格式优化** — 展平任务表格提示词/标题列中的 Markdown 链接和排版，使表格输出更加整洁。
- **管道 CLI 输出与 JSON 支持** — 为管道化 CLI 表格渲染添加了 ASCII 后备支持，并为 `tendril verification list` 引入了 `--json` 输出参数。
- **遗留 .NET 工具重定向** — 添加了环境诊断检查和自动重定向，将遗留 `.NET` 工具调用（`ivy-tendril`）路由至已安装的 Tendril CLI。
- **文档重构** — 按照 Orca 风格重新设计了 `README.md` 并更新了功能演示 GIF。

### 缺陷修复

- **项目名称校验** — 在 CLI、设置对话框和入门引导流程中加入严格的项目名称校验，拒绝无效名称并防止设置期间崩溃。
- **CLI 启动开销** — 当向 `tendril` 传入 `--help`、`-h` 或无法识别的参数时，阻止 Tendril 服务器自启。
- **任务状态 404 容错** — 将 `tendril job status` 和 `tendril job fail` 端点改为尽力而为处理，不再抛出致命的 404 错误。
- **重复分析器警告** — 移除了 `Ivy.Tendril.csproj` 中重复的 `Ivy.Analyser` PackageReference，消除了 NU1504 警告，并更新 `UpdateIvyPackages.ps1` 原地编辑版本。
- **PlatformHelper Shell 执行** — 在 `PlatformHelper` 中对 `open` (macOS) 和 `xdg-open` (Linux) 命令明确将 `UseShellExecute` 设置为 `false`。

## 1.1.16 (2026-07-24)

### 新功能

- **Ivy Agent 集成** — 引入了对独立 Ivy Agent 的集成，包括设置中的一键 CDN 安装器、自定义 Ivy Proxy URL 设置以及 Beta 标志控制（`TENDRIL_BETA` 或 `IVY_BETA`）。
- **紧凑型徽标选择器** — 将创建计划对话框中的全宽项目与优先级选择输入替换为可滚动的紧凑徽标按钮（`BadgeSelect` 组件）。

### 改进

- **Cloudflare 穿透 DNS 诊断** — 为 `cloudflared` 穿透失败暴露了详细的启动和连接诊断信息。
- **设置视图清理** — 重构了设置输入，使用原生 C# `.Description(...)` 构建器属性以保持视觉一致性。

### 缺陷修复

- **添加项目对话框层级** — 使创建计划中的“新建项目”按钮直接在上方打开添加项目对话框，无需离开当前页面。
- **穿透 URL 解析** — 通过忽略内部 `api.trycloudflare.com` 域名引用，修复了 cloudflared 穿透 URL 提取错误。

## 1.1.14 (2026-07-21)

### 新功能

- **第三方许可通知文档** — 添加了 `THIRD_PARTY_NOTICES.md` 以记录捆绑的第三方依赖许可。

### 改进

- **ContentInput 乐观状态** — 在 `ContentInput` 组件中实现了乐观本地文本状态更新，打字时推迟后台属性更新以防止输入内容被覆盖。

### 缺陷修复

- **Cloudflared 下载器** — 解决了自动 `cloudflared` 二进制安装器和下载器中的安装崩溃问题。
- **Codex 失败解析** — 修复了 Codex 编程智能体失败解析和模型目录校验。
- **穿透设置布局** — 修正了穿透设置页面中的文本拼写错误和布局问题。

## 1.1.13 (2026-07-20)

### 新功能

- **批量实施建议** — 在 Review 应用中支持批量勾选并一次性实施多条建议。
- **与智能体调查和讨论** — 在 Drafts、Review 和任务调试表中添加了“与智能体一同调查”和“与智能体讨论”操作按钮。
- **添加工作区 CLI 命令** — 增加了 `tendril plan add-worktree` CLI 命令，实现对称的工作区管理。
- **重跑已完成的 RetryPlan 任务** — 允许直接从任务列表中重新运行已完成的 `RetryPlan` 任务。

### 改进

- **配置自动重载** — 在外部文件被编辑时自动重新加载配置。
- **审查摘要与标签页** — 将审查摘要渲染为带固定验证卡片的 DraftMarkdown，并将审查标签页提取至专用视图中。
- **任务日志合并** — 将所有任务执行日志合并到统一的 `<TendrilHome>/Jobs/` 目录下。
- **侧边栏与表格行高亮** — 使用填充背景选中样式增强了侧边栏列表项和数据表格。
- **桌面框架升级** — 将 Ivy 框架依赖更新至 1.3.8，并配置了桌面端“关于”对话框的详细信息。

### 缺陷修复

- **删除任务时状态保持** — 删除已结束的任务时保留已完成的计划状态。
- **Markdown 与数学公式渲染** — 修复了正文中的美元符号被错误渲染为 LaTeX 数学公式的问题，并修复了 DraftMarkdown 中的行内代码样式。
- **任务槽信号量泄漏** — 修复了未捕获启动失败期间任务槽分配中的信号量泄漏。
- **任务初始状态挂起** — 添加启动错误处理，修复了任务在启动中状态无限挂起的问题。
- **工作区提交同步** — 确保来自所有计划工作区的提交均得到正确同步。

## 1.1.12 (2026-07-03)

### 改进

- **Dotnet 验证求解器** — 更新了 `DotnetBuild`、`DotnetFormat`、`DotnetTest` 和 `FrameworkDotnetBuild` 验证提示词以显式定位解决方案文件。添加了针对多仓库配置的作用域说明，确保构建和测试可靠进行。
- **Pull Request UI 布局** — 调整了 PullRequest 应用的列顺序，将“计划”放在首位，“代码仓库”放在末尾，并将“成本”和“Token”列缩窄至 80px，使表格布局更紧凑易读。

### 缺陷修复

- **并发 CreatePr 正文交换** — 修复了一个竞态条件：由于正文文本文件未区分唯一性，并发运行的 `CreatePr` 任务可能会交换或覆盖彼此的 Pull Request 描述。改为使用 `mktemp` 创建唯一正文文件，并添加了回归测试。
- **共享事件解析器竞态** — 通过为每个会话隔离解析器而非共享解析器实例，解决了事件解析竞态条件。添加了回归测试以防止未来发生多会话竞态。

## 1.1.11 (2026-07-03)

### 缺陷修复

- **macOS 安装包与启动修复** — 修复了一个关键问题：在重新打包期间由于软链接与代码签名损坏，导致 macOS 安装包 (.pkg) 显示成功但实际上无法安装或启动应用程序。使用 `pkgutil --expand` 替换 `pkgutil --expand-full` 以保持应用程序负载的完整性，将目标目录纠正为 `1.pkg/Scripts/postinstall`，并修复了 localhost 证书信任脚本中的路径拼写错误。

## 1.1.10 (2026-07-03)

### 缺陷修复

- **macOS 安装器公证** — 通过正确提交并装订重新打包的安装包，修复了 macOS 安装器公证问题。

## 1.1.9 (2026-07-03)

### 新功能

- **Promptware 文件输入** — 为 promptware 写入命令添加了基于文件的内容输入支持，允许 promptware 在执行期间读取本地文件。
- **计划修订版本恢复 CLI** — 添加了新的 `plan get-revision` CLI 命令，用于检索和检查计划的历史修订版本。
- **SyncRepo 未跟踪变更策略** — 为 SyncRepo 执行添加了可配置的未跟踪变更策略选项（Stash/Commit/PullRequest）。
- **Antigravity CLI 毕业** — 将 Antigravity CLI 集成和检查升级为完全稳定状态。

### 改进

- **通用缺陷报告** — 通过将目标模型规范化为后端支持的系列并附加原始智能体元数据，实现了在所有智能体下的缺陷报告；并通过递归收集计划文件和及早忽略工作区目录，修复了 macOS 上的缺陷报告。
- **验证 CLI 后备机制** — 如果未找到指定的验证名称，`verification` 命令现在会自动列出所有可用的验证脚本。
- **DraftMarkdown 组件样式** — 将 DraftMarkdown 组件的样式与最新的核心设计系统更新保持同步。

## 1.1.8 (2026-07-03)

### 新功能

- **桌面端自主更新能力** — 实现了自我更新能力与对话框，允许桌面应用程序自动检查并更新到最新版本。
- **Tools 目录持久化** — 在 promptware 升级期间保留 `Tools/` 目录，并确保 promptware 运行时目录结构正确无误。

### 改进

- **Drafts 应用快捷键** — 添加了 `Backspace` 键盘快捷键以触发 Drafts 应用中的删除操作（解决 `#1507`）。
- **响应式布局间距** — 重新对齐响应式顶部导航中的 Issue 链接按钮，防止发生重叠和换行。

## 1.1.7 (2026-07-02)

### 新功能

- **Localhost HTTPS 证书生成** — 为 macOS 和 Windows 桌面应用程序自动生成并打包安全的 localhost SSL/TLS 证书，开箱即可支持本地 HTTPS。
- **创建计划对话框增强** — 直接在创建计划对话框中添加了“新建项目”快捷链接，加快入门流程。
- **Claude Fable 5 模型选项** — 在模型配置中将 `Claude Fable 5` 添加为可选模型。
- **配置 CLI 与 MCP 集成** — 在 Tendril CLI 和模型上下文协议 (MCP) 服务器端点中添加了一流的 `config get` 和 `config set` 命令。
- **FieldToolsDemo 实验** — 引入了供开发者测试的全新 `FieldToolsDemo` 实验。

### 改进

- **乐观任务删除** — 将 Git 工作区清理任务委派给后台线程，实现任务的乐观删除，带来更迅速的 UI 响应。

### 缺陷修复

- **CI 工作流与脚本** — 修复了发布工作流中的 YAML 语法错误，解决了 CI 流水线中的 SSL 证书生成崩溃问题，并修正了 macOS 安装后脚本中的语法错误。

## 1.1.6 (2026-07-02)

### 新功能

- **第一方失败上报** — 添加了 `tendril job fail <job-id> --message` CLI 命令，允许 promptware 明确报告具体的执行失败，而不再依赖退出码和原始 stdout 启发式判断。
- **收件箱自动刷新** — 在 Drafts、Review、Icebox、Recommendations 和 Trash 应用中，使用防抖的进程状态和文件系统监听器，将基于轮询的刷新替换为基于订阅的更新。
- **Velopack 更新器整合** — 将桌面端自我更新流程整合到 Velopack，支持在设置中检查更新、在重启后保留已关闭的更新提醒，并移除了已废弃的 `Ivy.Tendril.Updater` 项目。
- **UserQuestion 组件** — 添加了用于交互式用户提示词的全新 `UserQuestion` 组件与查看器。
- **入门指南** — 在快速入门文档中添加了一流的代码库准备指南。
- **新建计划增强** — 直接在创建计划对话框中添加项目选择按钮，并将 `CustomPrDialog` 重命名为 `CreatePrDialog`。

### 改进

- **Windows 路径与 Shell 安全** — 将 `stackHash` 项目配置中 Shell 不安全字符（竖线与括号）替换为 `/` 和 `.ts` 扩展名，并实现了 Windows CLI 参数转义。
- **智能体沙箱网络访问** — 通过 `sandbox_workspace_write.network_access` 设置为 Codex 启用沙箱网络访问，修复了套接字绑定操作时的 PermissionError。
- **OpenCode 本地 Ollama 支持** — 在使用本地 Ollama 模型运行 OpenCode 时自动绕过认证检查并解析二进制路径，并切换至 `--auto` 执行以防止 PTY 挂起。
- **Markdown 链接处理** — 集中管理计划修订版本的 Markdown 链接美化与渲染安全检查，去除文件 URL 中的行号锚点。
- **缺陷报告 GitHub 用户名** — 在缺陷报告对话框和 `report-bug` CLI 命令中添加了可选的 GitHub 用户名字段。
- **UI 布局优化** — 在移动/平板设备屏幕上隐藏穿透二维码面板，将加载图标嵌套在启动提示框中，修复“停止”按钮图标，并恢复审查动作布局中的间距。
- **针对 Gemini 的文本取消换行** — 添加了针对 Gemini 强制换行排版的取消换行处理，以提高可读性。
- **键盘元素样式** — 在 Markdown 组件中为 `<kbd>` 元素添加了样式。

### 缺陷修复

- 通过立即设置超时并并发执行前置钩子，修复了由于死锁或陈旧输出导致任务在启动前窗口无限挂起的问题。
- 修复了切换标签页时创建计划界面的滚动位置重置并跳回顶部的问题。
- 当行内成本为零或缺失时后备至基于定价的计算，修复了超时运行的任务成本计算错误。
- 修复了智能体跳过收尾步骤时 CreatePr 计划遗留在 Drafts 中的问题，现已在完成时自动从输出解析 PR URL。
- 修复了启动会话日志泛滥以及主选举日志中的破折号排版问题。
- 通过将测试服务器绑定到环回地址，修复了启动时的 EPERM 监听错误。
- 修复了执行期间 Codex 智能体输出折叠为零高度的问题。
- 修复了键盘聚焦/失焦问题，并在打开新建计划对话框时自动聚焦输入框。
- 在默认配置中禁用了未使用的穿透功能。

## 1.1.1 (2026-06-25)

### 新功能

- **语音与富文本计划输入** — 全新 ContentInput 组件为创建计划对话框带来了语音转录和文件附件功能；文件通过 HTTP POST 上传并与计划一同存储，支持拖拽操作。
- **与智能体对话** — Beta 版 AgentApp 支持通过 PTY 直接与编程智能体进行对话，在新建计划对话框中提供“与智能体对话”按钮，并通过 shim 垫片向智能体暴露 `tendril` CLI。
- **计划批注** — 在 DraftsApp 中对草稿进行批注，以驱动基于批注的计划更新。
- **移动与平板端支持** — Tendril 现已全面响应式支持移动、平板和桌面断点，配备自适应头部栏、抽屉、选择器和进程查看器。
- **DraftMarkdown 组件** — 渲染 Mermaid 和 Graphviz 图表、提示引用框、本地文件与可点击图片，以及内联文本批注。
- **Velopack 自动更新** — 桌面应用通过 Velopack 自动更新，具备安装包命名冲突防止机制。
- **活动热力图** — Wallpaper 应用展示 90 天已完成 PR 的活动热力图。
- **SyncRepo 与预检脏仓库检查** — 全新的 SyncRepo promptware 加上在 Execute 和 Create Plan 之前检测并解决仓库未提交状态的预检功能。
- **任务依赖关系** — 支持任务级别的 `WaitForJobs` 阻塞机制，具备级联失败处理、被阻塞任务的定期重新评估，以及针对被阻塞任务的强制启动动作。
- **带反馈重新运行** — 携带向智能体提供的额外反馈重新运行任务。
- **还原修订版本** — 直接从 Details 标签页还原指定的计划修订版本。
- **陈旧工作区清理器** — 通过清理以往运行遗留的陈旧工作区来限制工作区的磁盘占用。
- **基于 HTTP 的 CLI/服务端 IPC** — CLI 与服务端通过带主选举的 HTTP 协议进行通信，实现可靠的单实例协同。
- **捆绑运行时** — 安装包中捆绑了 .NET 10 SDK 和 PowerShell 7，并在运行时存在时动态解析。
- **仓库防护栏** — 防止计划在其项目外部的代码仓库中执行或合并，并自动检测代码仓库的默认分支，而不是盲目假设为 `main`。
- **计划迁移框架** — 在 `plan.yaml` 中添加了 `schemaVersion`，并配备基于单文件的计划迁移框架。
- **编程智能体环境变量** — 在编程智能体设置中为每个智能体配置单独的环境变量。
- **`tendril agent-instructions` 命令** — 从 CLI 输出智能体指令。

### 改进

- **穿透体验打磨** — 优化连接中状态、壁纸二维码、在浏览器中打开、连接前可路由状态检测、孤立 `cloudflared` 清理，以及带乐观 UI 的一键停用。
- **验证项作为单一事实来源** — `plan.yaml` 现已成为验证项的事实来源，具有专用的 UI 卡片、状态枚举以及在项目编辑对话框中的拖拽排序支持。
- **任务调试表** — 增加了工作目录和 CLI 参数、Plan/Job ID 复制按钮、报告缺陷按钮以及 promptware 学习沉淀（记忆/工具写入）；隐藏空行和权限拒绝。
- **计划状态更名** — `Building → Creating` 与 `ReadyForReview → Review`，使生命周期命名更清晰直观。
- **CLI 整合** — 单通道日志记录、统一异常传播、描述性任务状态输出，并增加了 Web API/MCP 端点以实现完整的 CLI 对等能力。
- **建议简化** — 在 UI 和提示词中全面移除了建议项中的 Risk（风险）字段。
- **macOS 独立应用** — 稳健的登录 Shell PATH 和环境加载、正确的打包应用检测，以及自动全局 `tendril` 软链接创建。
- **组件结构重组** — 将各组件合并到统一的 `Ivy.Tendril.Widgets` 项目中，并设立各组件独立的前端目录。
- **自动合并工作流** — 发布后 CI 工作流自动将 `main` 合并回 `development`。
- **依赖安全性** — 将 `SQLitePCLRaw.lib.e_sqlite3` 升级至 3.50.3，并锁定前端依赖（dompurify、vite-plus）以修复已知漏洞。

### 缺陷修复

- 修复了 `tendril plan create` 短横线值参数解析问题。
- 通过共享连接工厂和 `busy_timeout` 修复了 SQLite "database is locked"（数据库已锁定）错误。
- 修复了已取消/已停止/已失败的任务将计划恢复到前一状态的问题。
- 修复了 PR 合并依赖过期的 `prRule` 而非 `PrMerge` 标志的问题。
- 修复了修改后草稿未能及时刷新的问题。
- 修复了间歇性 Create PR 失败和误导性错误信息。
- 修复了 Review 和 Drafts 的 Markdown 左内边距未渲染的问题。
- 修复了项目编辑对话框中验证排序未持久保存的问题。
- 修复了使用内联结果数据针对所有状态执行任务成本计算的问题。
- 修复了采纳建议时 `plan.yaml` 丢失更新的竞态条件。
- 修复了在计划无效时导航到 Drafts/Review 引发的崩溃。
- 修复了 `WaitForJobs` 解除阻塞和重复任务检测中的竞态条件。
- 修复了 IvyFrameworkVerification 在测试运行后残留僵尸进程的问题。
- 通过防御性解析，修复了 Copilot 使用量指标解析崩溃的问题。
- 修复了 doctor 输出中未转义标记引起的 Spectre.Console 崩溃。
- 修复了当 `TENDRIL_HOME` 为空时 macOS 和 Windows 上的入门引导启动崩溃。
- 修复了编程智能体配置文件模型下拉列表中重复出现的 Default 选项。
- 修复了 Windows 任务栏图标缺失的问题。
- 修复了计划目录 ACL 权限阻塞 ExecutePlan 的问题。
- 修复了为同一代码仓库重复排队 SyncRepo 任务的问题。
- 修复了框架添加自带组件后的 ContentInput 名称冲突。
- 通过针对 es2020 目标，修复了在旧版 WebKit 上的 JS `SyntaxError`。

## 1.0.39 (2026-05-28)

### 新功能

- **Gemini 智能体提供商** — 添加 Gemini CLI (`gemini`) 作为支持的编程智能体，具备完整的健康检查、身份验证和会话成本跟踪。
- **穿透支持** — 通过 Cloudflare 穿透实现远程访问，设置中提供二维码、自动服务就绪检测和连接前可路由状态检查。
- **智能体测试对话框** — 设置中提供全新的“测试智能体”按钮，可针对所有已配置智能体自动运行安装、认证和模型检查。
- **按配置文件选择模型** — 在编程智能体设置中按强度配置文件（deep/balanced/quick）挑选特定模型。
- **按提供商划分的模型目录** — 使用按提供商划分的目录和 `tendril models` CLI 命令替换全局 `models.yaml`。
- **`tendril update` 命令** — 基于 Photino GUI 更新器的自我更新。
- **计划模板注入** — 计划模板被注入到固件中；每个任务都会跟踪实际使用的模型。
- **可读的工具标题** — ToolCallWire 上的 Description 字段，提供更清晰的智能体输出显示。
- **沙箱化智能体文件访问** — 智能体获得对 TENDRIL_HOME、计划和 promptware 目录的写访问权限。
- **计划列表 `--search` 选项** — 从 CLI 按搜索词过滤计划。
- **带系统提示词的 AgentApp** — 注入了 Tendril 系统提示词的 Beta 版智能体对话应用。
- **从壁纸创建计划** — 壁纸上的“新建计划”按钮可直接打开 CreatePlanDialog。
- **复制所有详情按钮** — 在任务调试表中将完整的任务调试详情复制到剪贴板。
- **提取新闻通讯视图** — 具有更好错误报告能力的共享新闻通讯组件。

### 改进

- **设置拆分** — 通用设置拆分为“编程智能体”、“计划”和“外观”标签页。
- **PlansApp → DraftsApp 更名** — 侧边栏角标和导航同步更新。
- **编程智能体设置布局** — 改进了布局，包含所有提供商的显示名称和默认模型处理。
- **CLI 体验优化** — 整洁的控制台格式化器、无需启动服务器即可查看 `--help`、对未知命令输出整洁报错、doctor 输出格式化。
- **AgentOutputView 体验优化** — 不换行输出的工具卡片、更整洁的标题、统一间距、完成后隐藏状态。
- **进程视图改进** — 等宽按钮、灰色呼吸灯、暗黑模式语义化颜色令牌、去重钩子。
- **TendrilProcessView 组件** — 添加到解决方案中，并通过语义化颜色令牌支持暗黑模式。
- **安装脚本改进** — 验证 Git 执行、将 .NET 10 前置到 PATH、脚本更简洁。
- **依赖安全性** — 将依赖版本范围锁定到具体版本，防止劫持和混淆攻击。
- **校验基线分支** — 防止添加基线分支无效或本地仓库无效的项目。
- **原始智能体输出** — 写入 `.raw.jsonl` 而非 EventWire 格式，以便更好地进行调试。
- **Copilot 改进** — 切换到标准输入提示词以突破 Windows 命令行长度限制；当独立二进制文件不在 PATH 中时后备至 `gh copilot`；解析更新后的 JSON 格式。
- **CodeBlock 组件** — 智能体输出和解决方案采用 CodeBlock 而非原始 Markdown。
- **服务重组** — 服务重构为子目录；状态常量独立提取。

### 缺陷修复

- 修复了进程视图中更新中/执行中的计划计数颠倒的问题。
- 修复了当 tendrilHome 参数为空时的入门引导路径解析。
- 修复了入门引导无休止的“正在设置智能体”加载屏幕。
- 通过使 Migration 11 具备幂等性，修复了数据库迁移从 10 升级到 11 的问题。
- 修复了 .csproj 文件中的反斜杠和入门引导 Promptwares 路径查找问题。
- 修复了带有 5 秒 STDIN 超时的 Copilot 进程挂起。
- 修复了 PromptwareRunner 中缺失 ResolveCommandShim 调用的问题。
- 修复了启动 Gemini 时的命令行长度限制问题。
- 修复了 Codex `item.updated` 事件触发 UnknownEvent 的问题。
- 修复了新安装中 Copilot 和 Codex 配置文件的默认模型设置。
- 修复了更名后侧边栏角标键由 "plans" 变成 "drafts" 的匹配问题。
- 修复了添加项目对话框中的重复标题和样式。
- 修复了添加项目后编辑项目对话框索引不匹配的问题。
- 修复了模型下拉列表中未显示 Default 选项的问题。
- 修复了 Windows PTY 命令解析至 .cmd 扩展名的问题。
- 修复了切换智能体时的空模型问题。
- 修复了任务状态消息中的 "undefined:" 前缀。
- 修复了重复的项目名称阻塞入门引导的问题。
- 修复了入门引导实时将原始智能体输出解析为 EventWire 的问题。
- 修复了 Windows 应用启动时出现多余窗口以及任务栏图标缺失的问题。
- 修复了 AgentOutputView 工具结果未渲染的问题。
- 修复了从用户消息中解析 Claude Code 工具结果的问题。
- 修复了通过读取实际服务器地址解决 cloudflared 502 错误。
- 修复了 OpenCode `model: default` 跳过 --model 标志的问题。
- 修复了输出视图中 OpenCode 中间出现的 step_finish 事件。

## 1.0.35 (2026-05-20)

### 新功能

- **原生系统 Toast 通知** — 针对计划完成、失败等事件的桌面通知，设置中附有专门的“通知”标签页。
- **任务栏角标** — 桌面任务栏角标显示活动任务计数，便于一览全局状态。
- **向导式添加项目** — 新项目设置现采用与入门引导匹配的引导向导流程，为熟练用户提供跳过功能。
- **移动验证项 CLI 命令** — 通过 `tendril project move-verification` 附带排序指令来重新排列验证项。
- **重新设计的入门引导** — “您的第一个项目”现在是一个 3 步流程：全新项目设置、渐进式反馈，完成后可订阅新闻通讯。
- **CLI CRUD 命令** — 通过 CLI 实现针对验证项和项目的完整增删改查（`tendril project get`、`tendril verification add/remove/move`）。
- **计划提交同步** — 通过 Review 中的同步按钮按需同步计划提交。
- **ReviewAction CRUD UI** — 直接在设置和入门引导中配置审查动作。
- **`tendril reset` 命令** — 通过 CLI 重置 Tendril 状态。
- **`tendril report-bug` 命令** — 直接从 CLI 提交包含系统上下文的缺陷报告。
- **`promptware read-memory` 命令** — 从 CLI 检查 promptware 记忆。
- **PR 创建草稿模式** — 支持将 PR 创建为 GitHub 草稿的选项。
- **建议采纳/拒绝** — 直接在 Review 应用中采纳或拒绝建议，并支持按已完成计划过滤。
- **Git 标签页：Worktrees 磁贴** — 显示父仓库详细信息，并在工作区部分下方对提交进行分组。
- **保留失败计划的工作区** — 失败计划的工作区将被保留以供调试，而不会被清理。
- **OpenCode 智能体提供商** — 添加 OpenCode 作为支持的编程智能体。
- **Copilot CLI 智能体提供商** — 添加 GitHub Copilot CLI 作为支持的编程智能体。
- **`--plans-dir` CLI 参数** — 为端到端测试和自定义设置覆盖计划目录。
- **TendrilProcessView 组件** — 用于可视化 Tendril 进程的外部组件。

### 改进

- **Git 标签页优化** — 分区标题与空状态图标、带变更文件颜色指示的层次树。
- **变更标签页稳定性** — 修复了 30 秒后台重新验证期间的闪烁、默认展开行为和全宽布局。
- **审查标签页清理** — 空的工件和建议标签页现已隐藏；计划视图采用文章版式。
- **精简提交说明** — 从提交信息说明中移除了计划 ID 前缀，使 Git 提交历史更清爽。
- **优化从 GitHub 导入 Issue** — 改进了 GitHub Issue 导入流程的用户体验。
- **窗口尺寸适配** — 更新了默认窗口尺寸以在 macOS Retina 屏幕上正常显示，并强制执行最小尺寸限制。
- **RetryPlan 改进** — 向现有摘要追加修复内容部分、明确多仓库工作区设置、将原始日志流式写入磁盘。
- **移除 VerbosityService** — 替换为标准 ILogger 级别以简化日志配置。
- **提取 ServiceRegistration** — 服务注册从 TendrilServer 移至专用的 `ServiceRegistration.cs`。
- **入门引导代码优化** — 提取辅助方法、添加 AgentOnboardingInfo、引入主构造函数并改进交互文案。
- **Promptware 工具权限** — 更新了默认工具权限以确保更安全的智能体执行。
- **重构 CLI 文档** — 全面重写 CLI 参考手册，更新命令语法与示例。
- **计划视图中的全宽 Markdown** — 可滚动内容并限制最大宽度以提升可读性。
- **响应式任务表格** — 平板采用大密度，桌面采用中密度，以更好地利用空间。
- **移除生成验证项功能** — 从项目编辑对话框中移除，推荐使用基于 CLI 的验证管理。
- **隐藏框架内部异常** — 框架内部异常不再暴露为面向用户的通知。

### 缺陷修复

- 修复了确认后重置为草稿未立即反映在 UI 上的问题。
- 修复了入门引导审查步骤中项目验证项排序未保留的问题。
- 修复了进度完成后入门引导步骤卡住的问题。
- 修复了在 Review 中打开计划时闪现“无可用摘要”的问题。
- 修复了 30 秒后台重新验证期间变更标签页闪烁的问题。
- 修复了测试并发污染 TeamIvyConfig `config.yaml` 的问题。
- 修复了同步器中 Commit 哈希被存储为短哈希的问题 — 现已存储完整哈希并在同步后刷新 UI。
- 修复了跨 RetryPlan 执行时丢失 Commit 的问题。
- 修复了审查动作命令路径以使用带引号的 PowerShell 语法。
- 修复了按 ESC 取消对话框时的错误通知。
- 修复了子目录大小写迁移和损坏的清理测试。
- 修复了 UpdatePlan 执行期间 `plan.yaml` 损坏的问题。
- 修复了实时流式传输期间智能体输出中的重复内容。
- 修复了任务完成时任务输出被渲染两次的问题。
- 修复了导致缺失 promptware 的 PromptwareRoot 解析缺陷。
- 修复了有可用更新 Toast 的间距和位置。
- 修复了 WallpaperApp 中不完整的 "You have ." 提示信息。
- 修复了通过更新资源名称解决应用程序窗口图标缺失的问题。
- 修复了多个 GitHub 账户下 `gh auth status` 失败的问题。
- 修复了输出抽屉对已完成任务显示空白面板的问题。
- 修复了不存在匹配计划目录时的伪 ReportedPlanId。
- 修复了任务表格排序以优先显示最新任务。
- 修复了重启时已完成任务被错误过滤掉的问题。
- 修复了委派验证调用语法导致 IvyFrameworkVerification 失败的问题。
- 修复了入门引导“完成设置”按钮无限挂起的问题。
- 修复了后台服务启动时的无限挂起。
- 修复了 Review 中标签页名称作用域问题。

## 1.0.22 (2026-04-27)

### 改进

- **GitResult\<T\> 错误处理** — 在 GitService 中引入强类型的 `GitResult<T>` 返回类型，以实现一致、显式的错误处理而非依赖异常。
- **提取 DashboardRepository** — 将 `GetDashboardData` 提取到专用的 DashboardRepository 中，使数据访问与业务逻辑分离。
- **ISessionParser 接口** — 将会话解析抽象到 `ISessionParser` 接口后，以提高可测试性并便于未来拓展解析器变体。
- **提取 PlanYamlRepairService** — 将计划 YAML 修复逻辑和工作区移除移至专用服务（`PlanYamlRepairService`、`WorktreeCleanupService`）。
- **提取 AppShellRouter** — 将路由逻辑从 `OpenApp` 提取到专用的 `AppShellRouter` 类中。
- **IDoctorCheck 实现** — 将 doctor 诊断检查重构为独立的 `IDoctorCheck` 类以提高可扩展性。
- **集中化 MCP 认证** — 将 MCP 工具认证整合到单一服务中。
- **BackgroundServiceActivator 守卫** — 为后台进程的无声消亡添加了检测与恢复机制。
- **PlanDatabaseService 中的 IDisposable 模式** — 为数据库连接实现正确的资源清理。
- **异步 SoftwareCheckStepView** — 在健康检查期间使用 `await` 替换阻塞的 `.Result` 调用以保证 UI 响应。
- **全面代码健康优化** — 通过方法提取和数据驱动重构，降低了 ContentView、PlanController、PlanTools、ConfigService、GithubService、JobLauncher、ModelPricingService、TendrilAppShell 和 GetPromptDisplay 中的圈复杂度。
- **测试基础设施** — 添加了 `TempDirectoryFixture`、`ConfigServiceFixture`、`DatabaseFixture` 和 `IClassFixture` 模式；扩展了 GitService、PlanValidationService、JobLauncher 和 PlanId 分配的测试覆盖率。
- **仪表板 7 天窗口** — 仪表板上的状态计数和项目计数现在过滤为最近 7 天。

### 缺陷修复

- 集中在 JobService 中进行分配，修复了 PlanId 分配竞态条件。
- 修复了 `ModifyPlanEndpoint` 返回错误结果类型的问题。
- 修复了 `DashboardRepository` 日志记录器类型不匹配的问题。
- 将 `Closes` 引用移至正文截断后，修复了 GitHub Issue 自动关闭功能。
- 修复了 `InboxWatcherService` 文件重命名中的竞态条件。
- 修复了 `IsValidCommitHash` 中的可空参数处理。
- 修复了成本跟踪任务中的异常处理。
- 修复了 `Program.cs` 中的服务提供者访问。
- 修复了 `AppShellRouter` 中的 `TabState` 引用和处理方法的访问修饰符。
- 移除了 JobService 中的代码仓库并发阻塞。
- 移除了 `DashboardLoggerAdapter` — 直接使用日志记录器。
- 为各服务中被忽略的异常添加了日志记录。
- 修复了 CI/Docker：Node.js v22、正确的 `IvySource` 处理，移除了陈旧的 Ivy-Framework 引用。

## 1.0.14 (2026-04-10)

### 新功能

- **任务优先级队列** — 计划现在按优先级顺序执行。Bug 级别的计划优先于 NiceToHave 运行，确保关键修复优先落地。
- **从 GitHub 导入 Issue** — 通过新的导入对话框将现有的 GitHub Issue 直接导入到 Tendril 中作为草稿计划。
- **多项目计划创建** — 创建计划对话框现在支持选择多个项目，将其仓库聚合到单个计划中。
- **WorktreeLifecycleLogger** — 为 PlanReaderService、WorktreeCleanupService 和 JobService 中的工作区创建、清理和失败事件提供集中式审计记录。
- **高级设置标签页** — Setup 中的新标签页，用于配置更底层的选项。

### 改进

- **渐进式健康检查反馈** — 健康检查现在会在单个检查完成时逐一流式输出结果，而无需等待所有检查全部结束。
- **PR 状态存入 SQLite** — PR 合并状态现在缓存到本地数据库中并配备后台同步服务，从而减少 GitHub API 调用。
- **简化 PlanWatcher** — 替换沉重的文件系统监听方式，以避免工作区频繁变动造成的缓冲区溢出。
- **工作区诊断日志** — 为缺失的 `.git` 文件添加快速失败检查，并改进了工作区创建失败时的错误信息。
- **递归检测工作区工件** — ExecutePlan 现在可检测并清除以前运行遗留在 Plans 目录中的嵌套工作区工件。
- **防御性字典访问** — MakeSoftwareRow 使用 `GetValueOrDefault` 防止在极端情况下出现 KeyNotFoundException。

### 缺陷修复

- 修复了认证期间 Gemini 健康检查打开浏览器窗口的问题。
- 修复了 `anyAgentHealthy` 检查以针对 Gemini 智能体使用安装状态。
- 修复了 ConfigService 构造函数的可测试性。
- 修复了 `recommendations.yaml` 中的 YAML 解析错误。
- 移除了 `Ivy.Tendril.csproj` 中冗余的 Watch Remove。
- 移除了 GithubService 中未使用的 `_prStatusCache`。

## 1.0.12 (2026-04-10)

### 新功能

- **多智能体支持** — Tendril 现已支持多个编程智能体（Claude、Codex、Gemini），并可为每个智能体配置独立的配置文件（deep、balanced、quick）。
- **Windows 安装包** — 新的 `install.ps1` 脚本用于简化 Windows 安装流程。
- **Doctor 诊断命令** — 运行 `tendril doctor` 诊断配置和环境问题。

### 改进

- **文档全面修订** — 整体重写了所有 Tendril 文档，具有更完善的结构、示例和入门引导流程。
- **优化入门向导** — 改进了初次运行体验的 UI、文案和步骤布局。
- **技术栈无关的 Promptware** — 从 ExecutePlan、CreatePlan 和其他 promptware 中移除了特定技术栈的引用，通过 `config.yaml` 验证项支持任意技术栈。
- **使用 TextInput 替换 FolderInput** — 简化了 Tendril 各应用中的路径输入。

### 缺陷修复

- 修复了测试中 `TENDRIL_HOME` 环境变量的处理。
- 为 `PlatformHelper.OpenInTerminal` 和 `OpenInFileManager` 添加了错误处理。
- 在 PlanReaderService 中读取 `plan.yaml` 之前添加了 `File.Exists` 检查。

## 1.0.9 (2026-04-09)

### 新功能

- **稳定版 NuGet 发布** — Tendril 现使用 `Directory.Build.props` 集中管理版本，发布稳定的带版本号 NuGet 包。
- **SQLite 数据库** — 针对计划、任务和 PR 状态的本地数据存储，支持迁移升级。
- **建议系统** — 计划现在可以生成后续建议，并在 Recommendations 应用中呈现。
- **计划生命周期管理** — 完整的计划状态机：Draft、Approved、Executing、Review、Completed、Failed，具备自动状态流转。

### 改进

- **成本跟踪** — 按任务跟踪成本和 Token，并在仪表板上按项目和 promptware 类型进行可视化展示。
- **全面的任务状态枚举** — 为所有任务状态提供字符串转换支持。
- **错误处理改进** — 重复迁移版本检测与 FTS5 错误处理。

## 1.0.0 (2026-04-03)

### 新功能

- Tendril 计划管理系统的**首个公开发行版本**。
- **计划应用** — Dashboard、Review、Drafts、Jobs、Icebox、Pull Requests、Recommendations 和 Trash 视图。
- **Promptware** — CreatePlan、ExecutePlan、CreatePr、UpdatePlan、SplitPlan、ExpandPlan 和 CreateIssue。
- **跨平台支持** — 支持 macOS 和 Windows，具备自动平台检测。
- **基于工作区的执行** — 计划在隔离的 Git 工作区中执行，保持主仓库整洁。
- **可配置验证门禁** — Build、Test、Format、Lint 和 CheckResult（包含特定技术栈变体，如 DotnetBuild、NpmTest）。
- **GitHub 集成** — 自动创建 PR、状态跟踪与合并检测。
- **键盘快捷键** — `Ctrl+Alt+D` 用于创建新草稿，支持自定义快捷键绑定。
