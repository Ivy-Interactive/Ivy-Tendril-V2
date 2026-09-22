---
title: 设置与配置
description: 在应用内设置 UI 中或通过编辑 TENDRIL_HOME/config.yaml 来配置 Tendril（项目、智能体、复杂度层级、验证门禁、偏好设置）。
icon: Construction
searchHints:
  - 配置
  - yaml
  - 设置
  - 项目
  - gui
  - 部署
  - docker
  - 密钥
  - BasicAuth
  - 密码
  - 托管
---

# 设置与配置

## 应用内设置

Tendril 包含一个专用的“设置”应用，无需手动编辑 [YAML](https://yaml.org) 即可可视化配置环境。设置侧边栏提供以下板块：

- **编程智能体 (Coding Agent)** — 选择主要编程智能体运行时（[Claude Code](../06_CodingAgents/01_ClaudeCode.md)、[Copilot](../06_CodingAgents/03_Copilot.md)、[Codex](../06_CodingAgents/02_Codex.md)、[Gemini](../06_CodingAgents/05_Gemini.md)、Antigravity、[OpenCode](../06_CodingAgents/04_OpenCode.md)、Cursor、Apple 或自定义 OpenAI 兼容代理），配置服务商 API 密钥和自定义 Base URL，自定义智能体配置文件与推理层级，测试智能体连接性，并通过模型目录浏览模型规格。有关智能体安装与配置，请参阅 [编程智能体](../06_CodingAgents/_Index.md)。
- **计划 (Plans)** — 编辑在 [计划](../04_Apps/03_Plans.md) 中创建新计划时使用的默认 Markdown 计划模板 (`planTemplate`)。
- **外观 (Appearance)** — 选择主题模式（**浅色 (Light)**、**深色 (Dark)** 或 **跟随系统 (System)**），从带有预览色块的内置主题预设中进行选择，配置默认侧边栏状态（展开或折叠），并选择 Chat 按钮的目标（**Chat 视图** 或 **终端**）。
- **项目 (Projects)** — 管理已注册的项目，配置按项目的代码仓库、验证门禁、端口、环境变量、自定义技能、[MCP](../09_Advanced/03_MCP.md) 服务器，并访问危险区域 (Danger Zone)。请参阅 [项目设置](02_Projects.md)。
- **团队保管库 (Team Vault)** _(Beta)_ — 通过共享的 [Git](https://git-scm.com) 仓库在团队成员之间同步项目、自定义技能、MCP 服务器和安全规则。
- **工作流智能体 (Workflow Agents)** — 配置 [Promptware](../02_Concepts/02_Promptwares.md) 智能体配置文件，并在标准工作流（`CreatePlan`、`ExecutePlan`、`UpdatePlan` 等）或使用 `_default` 键全局配置细粒度工具权限（`allowedTools`、`deniedTools`）。
- **复杂度层级 (Levels)** — 定义具有相对执行权重、描述和自定义徽章颜色的复杂度层级（例如 L1、L2、L3）。
- **通知 (Notifications)** — 开启或关闭针对任务完成和失败的桌面系统通知。
- **安全与穿透 (Security & Tunneling)** — 配置 Web 会话密码保护，启动或停止用于远程访问的全权限 [Cloudflare](https://www.cloudflare.com) 穿透隧道，以及创建受权能令牌保护的只读共享隧道。
- **高级 (Advanced)** — 设置执行超时时间（`jobTimeout`、`staleOutputTimeout`），配置 `maxConcurrentJobs`，切换 Beta 功能访问权限，并查看实时 **守护进程诊断 (Daemon Diagnostics)**（连接状态、PID、延迟 Ping、`$TENDRIL_HOME` 路径以及报告的权能）。
- **新闻通讯 (Newsletter)** — 订阅 Ivy & Tendril 产品动态与发布说明。
- **打开 config.yaml (Open config.yaml)** — 启动内置的原始 YAML 编辑器，支持实时语法高亮并直接链接至计划。

## `config.yaml`

在 UI 中修改的设置会立即保存到 `$TENDRIL_HOME/config.yaml`（默认为 `~/.tendril/config.yaml`）。您也可以直接编辑此文件，或使用 `TENDRIL_CONFIG` 环境变量指定自定义路径。

> [!NOTE]
> 配置文件必须始终命名为 `config.yaml`。当文件在磁盘上被修改时，Tendril 守护进程会自动重新加载配置更改。

### 示例

```yaml
codingAgent: claude
maxConcurrentJobs: 5
jobTimeout: 45
staleOutputTimeout: 10
theme: default
themeMode: system
chatMode: chat
desktopNotifications: true

projects:
  - name: Global Engine
    color: Emerald
    repos:
      - path: ~/repos/global-engine
    verifications:
      - name: Build
        required: true
      - name: Test
        required: true
      - name: CheckResult
        required: true

auth:
  username: admin
  password: "$argon2id$v=19$m=65536,t=3,p=4$..." # Managed via Settings
  hashSecret: "base64-secret-pepper"

api:
  apiKey: "your-api-secret-key"
```

### 常用字段

| 字段                   | 类型           | 默认值      | 用途                                                                          |
| ---------------------- | -------------- | ----------- | ----------------------------------------------------------------------------- |
| `codingAgent`          | string         | `"claude"`  | 默认编程智能体可执行文件。请参阅 [编程智能体](../06_CodingAgents/_Index.md)。 |
| `maxConcurrentJobs`    | integer        | `20`        | 允许并发执行的智能体 [任务](../04_Apps/04_Jobs.md)（工作区）最大数量。        |
| `jobTimeout`           | integer (分钟) | `30`        | 活动任务被取消前的执行超时时间（分钟）。                                      |
| `staleOutputTimeout`   | integer (分钟) | `10`        | 智能体进程无 stdout/stderr 输出时的超时时间（分钟）。                         |
| `daemonRequestTimeout` | integer (秒)   | `30`        | 与本地守护进程通信时的客户端请求超时时间（秒）。                              |
| `planTemplate`         | string         | `""`        | 在 [计划](../04_Apps/03_Plans.md) 中创建新计划时使用的 Markdown 模板。        |
| `theme`                | string         | `"default"` | 外观预设标识符（例如 `default`、`dracula`）。                                 |
| `themeMode`            | string         | `"system"`  | 主题模式：`light`、`dark` 或 `system`。                                       |
| `chatMode`             | string         | `"chat"`    | Chat 按钮打开的内容：`chat`（Chat 视图）或 `terminal`（智能体终端）。         |
| `desktopNotifications` | boolean        | `true`      | 是否针对任务事件启用桌面系统通知。                                            |
| `projects`             | list           | `[]`        | 已注册项目及其配置列表。请参阅 [项目设置](02_Projects.md)。                   |
| `levels`               | list           | standard    | 已配置的计划复杂度层级与权重。                                                |
| `auth`                 | object         | `null`      | 使用 [Argon2](https://en.wikipedia.org/wiki/Argon2) 的会话密码保护配置。      |
| `api.apiKey`           | string         | `null`      | 保护 REST API 端点的共享密钥。请参阅 [REST API](../09_Advanced/02_REST.md)。  |
| `telemetry`            | boolean        | `null`      | 匿名使用遥测选择加入（`false` 或未指定表示关闭）。                            |

## 身份验证与远程访问

### 会话保护（Web UI）

在远程服务器上托管 Tendril 或通过网络公开 Tendril 时，请在 **Settings > Security & Tunneling** 中启用会话保护，或通过环境变量配置凭据：

- `TENDRIL_AUTH_USERNAME` — 登录用户名（默认：`admin`）。
- `TENDRIL_AUTH_PASSWORD` — 启动时进行哈希处理的明文密码。
- `TENDRIL_AUTH_HASH_SECRET` — 用作 [Argon2](https://en.wikipedia.org/wiki/Argon2) pepper 密钥的 32 字节 Base64 字符串（通过 [OpenSSL](https://www.openssl.org) 执行 `openssl rand -base64 32` 生成）。

在 `config.yaml` 中，密码以 Argon2 PHC 哈希形式存储在 `auth:` 块下，并带有可选的速率限制：

```yaml
auth:
  username: admin
  password: "$argon2id$v=19$m=65536,t=3,p=4$..."
  hashSecret: "base64-encoded-pepper"
  rateLimit:
    threshold: 3
    baseDelaySeconds: 1.0
    maxDelaySeconds: 60.0
```

### Cloudflare 穿透隧道

Tendril 与 [Cloudflare](https://www.cloudflare.com) 隧道（`cloudflared`）集成，无需在防火墙上开放入站端口即可安全地公开应用程序：

- **全权限隧道 (Full-Access Tunnel)**：发布完整的 Tendril 守护进程。出于安全考虑，Tendril 强制要求在启动全权限隧道之前必须激活带有密码配置的会话保护。
- **共享隧道 (Share Tunnel)**：创建受权能令牌保护的只读隧道，允许与利益相关者安全共享 [仪表盘](../04_Apps/01_Dashboard.md) 和计划进度，而无需暴露写入权限。

### REST API 保护

REST API 通过 `config.yaml` 中的 `api.apiKey` 设置或 `TENDRIL_API_KEY` 环境变量使用令牌身份验证。设置后，请求必须提供 `X-Api-Key` 请求头。请参阅 [REST API](../09_Advanced/02_REST.md) 和 [CLI 配置](../09_Advanced/01_CLI/06_Config.md)。

## 验证门禁 (Verifications)

Tendril 附带内置验证门禁定义，项目可将其接入自己的流水线中：

| 验证门禁      | 说明                                           |
| ------------- | ---------------------------------------------- |
| `Build`       | 运行项目构建命令并验证零编译错误。             |
| `Format`      | 验证代码格式化规则或格式化已修改的文件。       |
| `Test`        | 运行限定在计划修改范围内的单元测试或集成测试。 |
| `Lint`        | 运行静态代码分析/代码检查器并报告任何违规项。  |
| `Screenshots` | 捕获 UI 屏幕截图并存入计划的构建产物目录中。   |
| `CheckResult` | 验证最终实现是否符合计划规范。                 |

自定义验证命令（例如 `cargo test`、`pnpm test` 或 `pytest`）可以在 `config.yaml` 中全局定义，也可以直接在 [项目设置](02_Projects.md#verification-pipelines) 中定义。有关 CLI 验证命令，请参阅 [CLI 验证](../09_Advanced/01_CLI/03_Verification.md)。
