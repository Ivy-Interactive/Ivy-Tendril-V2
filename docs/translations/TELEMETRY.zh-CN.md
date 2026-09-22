# 遥测数据分类策略

## 目的

本文档定义了 Tendril 可以及不可以向第三方遥测服务（PostHog）发送哪些数据。其目标是在尊重用户隐私的同时收集有价值的分析数据。

该策略随代码一同演进：它移植自原版 Tendril 应用的 `TELEMETRY.md`，并精简至 V2 中实际接入的事件。

## 选择性加入（Opt-in），而非选择性退出（Opt-out）

**遥测默认处于关闭状态，除非您主动开启。** 只有在 `config.yaml` 中明确设置 `telemetry: true` 才会启用遥测；若缺少该配置项或设置为 `telemetry: false`，两者的行为完全相同 —— 不会构建客户端、不会将事件排队、也不会尝试任何网络调用。该配置项仅在 [config.rs](../src/crates/tendril-core/src/config.rs) 中的 `TendrilSettings::telemetry_enabled` 这一处读取，并且 V2 绝不会*自动插入*该键：保存一个不含该键的 `config.yaml` 会保持其缺失，而不会硬编码写入 `telemetry: false`；因此，与原版应用（会将缺失键视为“开启”）共享文件进行往返处理时，不会意外关闭原版应用的遥测。明确配置的值在往返处理中保持不变。

**这是经过深思熟虑的差异。** 原版应用采用选择性退出：它将 `Telemetry` 默认设为 `true`，其 `TELEMETRY.md` 写道“遥测为选择性退出：默认开启”。V2 默认关闭，是因为开启数据收集不应该由移植版本在未征得用户同意的情况下静默决定。这种差异仅在一个方向上是安全的 —— 相比原版，V2 只会少报，绝不会多报。如需逆转此行为，只需将 [config.rs](../src/crates/tendril-core/src/config.rs) 中的字段默认值和 `Default` 实现改回 `Some(true)`。

用户仅通过持久保存在 `<TendrilHome>/.anonymous-id` 中的随机 UUID 进行标识。它绝不会从用户名、机器名或仓库名派生。（原版优先使用 `<LocalAppData>/Tendril/.anonymous-id`；因此同时运行两个应用的主机会被计为两次安装。）

## 分类规则

### 允许（ALLOWED） — 聚合与非标识性数据

- **计数（Counts）**：项目数、仓库数、计划数、任务数（仅限聚合总数）
- **耗时（Durations）**：完成操作所需时间（以秒为单位）
- **状态/类型（States/Types）**：枚举值、状态名称、任务类型（如 `CreatePlan`、`ExecutePlan`）
- **级别（Levels）**：计划级别（如 `Bug`、`Feature`、`Epic`）
- **版本（Versions）**：应用程序版本字符串、操作系统名称及版本字符串
- **智能体提供商（Agent providers）**：编程智能体名称（如 `claude`、`codex`、`copilot`、`gemini`、`opencode`、`antigravity`、`ivy`）
- **布尔值（Booleans）**：功能开关、配置状态（如 `llm_configured: true`）
- **技术描述符（Technology descriptors）**：项目技术栈哈希（见下文）
- **安装加盐单向哈希（Install-salted one-way hashes）**：对原本受限制标识符的加盐哈希（见下文）

#### 技术栈哈希 (`stack_hash`)

技术栈描述符哈希是项目技术栈的标准、保留相似性的特征签名，例如 `fe.ts:react+next+tailwind/be.rs:axum/db:sqlite/test:vitest`。它仅由语言、框架、数据库和测试框架的封闭标识符词汇构成 —— 从结构设计上它不携带任何名称、路径、版本、计数或自由文本。它表明了 Tendril 被应用于哪些技术栈，而不会泄露这是谁的项目。

#### 安装加盐计划标识 (`plan_uuid`)

原始计划 ID 仍然禁止发送，但事件仍然需要在各计划之间进行分组。`telemetry::derive_plan_uuid` 输出截断为 16 字节并格式化为 RFC 9562 v8 UUID 的 `SHA256("tendril-plan:" + anonymous_id + ":" + plan_id)`，以此替代原始 ID 本身：

- anonymous_id 是每个安装独立的盐值，因此计划 `00042` 在每个安装上派生出的值各不相同，无法关联无关联的用户
- 该哈希是单向的，因此顺序计数器绝不会离开机器
- 其作用域限制为单个匿名用户，因此可以在不扩大身份暴露面的情况下对事件进行分组

ID 会首先标准化为 5 位数字，以便数据库中的整数格式（`42`）与文件夹格式（`00042`）派生出完全相同的值。

未来任何关联受限标识符的需求，都必须采用这种相同的加盐哈希模式，绝不能使用原始值。

### 禁止（FORBIDDEN） — 身份标识信息

绝不追踪：

- **URL**：仓库、PR 或 issue 的 URL
- **路径**：文件路径、目录路径、仓库绝对路径
- **用户名**：GitHub 用户名、组织名称、电子邮件地址
- **仓库名称** 和 **项目名称** — 即便是通用名称也会暴露工作上下文
- **顺序 ID**：计划 ID、issue 编号、PR 编号（应按每个安装进行哈希处理 — 参见 `plan_uuid`）
- **用户输入**：任务描述、提交信息、计划内容
- **标题**：计划标题、issue 标题、提交主题
- **智能体输出**：可能嵌入用户内容的记录、工具调用或错误消息

## 决策框架

1. 此字段能否识别个人或组织？ → 禁止
2. 它是否会泄露私有仓库信息？ → 禁止
3. 它是否会揭示用户正在从事的工作？ → 禁止
4. 它是否可以跨用户关联以消除匿名性？ → 禁止，除非使用 anonymous_id 加盐并进行单向哈希
5. 它是否提供有价值的聚合洞察？ → 允许

**如有疑问，坚决剔除。**

## 附加至每个事件的属性

在 [client.rs](../src/crates/tendril-core/src/telemetry/client.rs) 中为每个进程设置一次的超级属性：

| 属性 | 状态 | 备注 |
|---|---|---|
| `$session_id` | 合规 | 随机 UUID，每个进程全新生成 |
| `$geoip_disable: false` | 接受 | PostHog 将请求 IP 解析为国家/地区；IP 本身不作为事件属性存储 |
| `app_version` | 合规 | Crate 版本 |
| `os` | 合规 | 平台名称 |
| `os_version` | 合规 | Unix 上为 `uname` 发行版本，其他系统为平台家族 |

`distinct_id`（即 anonymous_id）会附加到每个事件中。原版应用的 `distribution` / `source` 属性被省略，因为它们携带 .NET `AppBrand`，而在 V2 中没有对应项。

## 当前事件审计

所有事件均遵循本策略。上下文在 [events.rs](../src/crates/tendril-core/src/telemetry/events.rs) 中定义为类型化结构体，因此属性集合是在编译期决定的，而不是松散的映射。

| 事件 | 属性 | 发送自 |
|---|---|---|
| `app_started` | `version`, `project_count`, `llm_configured` | `run_server`，获取主锁之后 |
| `job_created` | `job_type`, `agent`, `plan_uuid` | `JobManager::start_job_with` |
| `job_completed` | `job_type`, `status`, `duration_seconds`, `agent`, `plan_uuid` | `finish_job` |
| `plan_created` | `level`, `duration_seconds`, `agent`, `stack_hash`, `plan_uuid` | `finish_job`，带交付物的 `CreatePlan` |
| `pr_created` | `duration_seconds`, `agent`, `plan_uuid` | `finish_job`, `CreatePr` |
| `plan_state_transition` | `from_state`, `to_state`, `plan_uuid` | `apply_plan_state`，写入持久化到磁盘之后 |

`plan_uuid` 始终是派生的、按安装加盐的值：调用点将原始计划 ID 传入类型化上下文中，客户端在捕获前对其进行哈希处理，因此即使调用点不了解此规则，原始 ID 也绝不会发送到 PostHog。

### 已定义但未接入

`onboarding_completed` 和 `project_created` 在 [events.rs](../src/crates/tendril-core/src/telemetry/events.rs) 中有上下文结构体，但没有调用点：V2 没有新手引导流程，并且项目创建发生在未安装客户端的 CLI 进程中。它们之所以存在，是为了使后续计划只需添加调用点而无需修改模式定义。

客户端仅存在于守护进程中。CLI 调用绝不会调用 `telemetry::install`，因此 `tendril plan ...` 不会发送任何数据。

## 实现

- [events.rs](../src/crates/tendril-core/src/telemetry/events.rs) — 在编译期强制执行本策略的类型化上下文。新增事件在此处定义结构体，而非属性包。
- [client.rs](../src/crates/tendril-core/src/telemetry/client.rs) — PostHog 客户端、anonymous_id、计划 UUID 派生。每个 `track_*` 均捕获自身错误，仅推入由后台任务消费的队列中：遥测绝不能导致任务失败或变慢。
- [telemetry_test.rs](../src/crates/tendril-core/tests/telemetry_test.rs) — 断言禁用时零网络调用、每个已接入事件的精确属性集，以及计划 UUID 派生正确性。
