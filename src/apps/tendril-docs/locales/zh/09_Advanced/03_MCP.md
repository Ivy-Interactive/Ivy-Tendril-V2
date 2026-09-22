---
title: MCP 服务器
description: Tendril 包含一个模型上下文协议 (MCP) 服务器，向 Claude Code 等 AI 编程智能体提供计划管理工具。
icon: Bot
searchHints:
  - mcp
  - model context protocol
  - claude
  - 工具
  - tendril_get_plan
  - tendril_list_plans
  - tendril_start_job
  - tendril_inbox
  - tendril_get_config
---

# MCP 服务器

Tendril 包含一个模型上下文协议 (MCP) 服务器，向 Claude Code 等 AI 编程智能体提供计划管理、任务编排和项目发现工具。

## 启动 MCP 服务器

```bash
tendril mcp
```

这将通过 stdio 传输启动 MCP 服务器，适用于 Claude Code 的 MCP 配置。标准输入和输出严格保留用于 JSON-RPC 消息；诊断日志则输出到 stderr。

## 认证

设置 `TENDRIL_MCP_TOKEN` 环境变量以对 MCP 会话强制执行令牌认证：

- **环境变量**：通过 stdio 连接的客户端可以通过 `TENDRIL_MCP_CLIENT_TOKEN`（或 `TENDRIL_MCP_TOKEN`）提供匹配的令牌。
- **请求元数据**：客户端还可以在每次请求时，在 `initialize` 参数的 `_meta["io.tendril/token"]` 中传递令牌。

当 `TENDRIL_MCP_TOKEN` 未设置或为空时，认证将被禁用并允许本地请求。

## 可用工具

所有工具均以 `tendril_` 为前缀，并直接针对守护进程或本地 Tendril 存储进行操作。

### 计划检查与查询

| 工具                             | 参数                                                         | 说明                                                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tendril_get_plan`               | `plan_id` (必填), `field` (选填)                             | 获取计划的元数据和最新修订版本。当指定 `field` 时，仅返回该字段（例如 `title`、`state`、`project`、`level`、`repos`、`commits`、`prs`、`verifications`、`dependsOn`、`revision`）。 |
| `tendril_list_plans`             | `state` (选填), `project` (选填), `search`, `since`, `limit` | 列出符合过滤条件的计划。`since` 接受 RFC 3339 时间戳；`search` 按标题或 ID 过滤。                                                                                                   |
| `tendril_get_revision`           | `plan_id` (必填), `number` (选填)                            | 获取计划修订版本的 Markdown 文本（默认为最新版本，或指定的修订版本号）。                                                                                                            |
| `tendril_plan_validate`          | `plan_id` (必填)                                             | 检查计划健康状态并报告任何结构或模式问题。                                                                                                                                          |
| `tendril_plan_verification_list` | `plan_id` (必填)                                             | 列出计划的所有验证项及其当前状态（`Pending`、`Pass`、`Fail`、`Skipped`）。                                                                                                          |
| `tendril_plan_rec_list`          | `plan_id` (必填), `state` (选填)                             | 列出计划的建议。过滤状态：`Pending`、`Accepted`、`AcceptedWithNotes`、`Declined`。                                                                                                  |

### 计划编写与修改

| 工具                               | 参数                                                                                                            | 说明                                                                                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tendril_plan_create`              | `title` (必填), `project` (必填), `level`, `initial_prompt`, `source_url`, `execution_profile`, `priority`, ... | 创建新计划。验证门禁会根据项目配置自动注入。                                                                                                                                  |
| `tendril_plan_write_revision`      | `plan_id` (必填), `content` (必填), `reason` (选填)                                                             | 写入新的带编号 Markdown 修订版本。问题块会根据模式进行校验。                                                                                                                  |
| `tendril_plan_set`                 | `plan_id` (必填), `field` (必填), `value` (必填)                                                                | 更新标量字段（`state`、`title`、`level`、`project`、`executionProfile`、`initialPrompt`、`sourceUrl`、`priority`）。状态变更会在允许变更为 `Completed` 之前强制执行验证门禁。 |
| `tendril_plan_set_verification`    | `plan_id` (必填), `name` (必填), `status` (必填)                                                                | 设置验证门禁状态（`Pending`、`Pass`、`Fail`、`Skipped`）。                                                                                                                    |
| `tendril_plan_verification_remove` | `plan_id` (必填), `name` (必填)                                                                                 | 从计划中移除验证门禁。                                                                                                                                                        |
| `tendril_plan_add_repo`            | `plan_id` (必填), `path` (必填)                                                                                 | 将代码仓库路径关联到计划。                                                                                                                                                    |
| `tendril_plan_remove_repo`         | `plan_id` (必填), `path` (必填)                                                                                 | 取消代码仓库路径与计划的关联。                                                                                                                                                |
| `tendril_plan_add_pr`              | `plan_id` (必填), `url` (必填)                                                                                  | 在计划上记录 Pull Request URL。                                                                                                                                               |
| `tendril_plan_add_commit`          | `plan_id` (必填), `sha` (必填)                                                                                  | 在计划上记录 Commit SHA。                                                                                                                                                     |
| `tendril_plan_add_depends_on`      | `plan_id` (必填), `folder` (必填)                                                                               | 添加阻塞性计划依赖关系。在目标计划达到 `Completed` 且其 PR 合并之前，依赖该计划的后续计划不会执行。                                                                           |
| `tendril_plan_remove_depends_on`   | `plan_id` (必填), `folder` (必填)                                                                               | 移除阻塞性计划依赖关系。                                                                                                                                                      |
| `tendril_plan_add_related_plan`    | `plan_id` (必填), `folder` (必填)                                                                               | 关联相关计划以供上下文参考。                                                                                                                                                  |
| `tendril_plan_remove_related_plan` | `plan_id` (必填), `folder` (必填)                                                                               | 移除相关计划关联。                                                                                                                                                            |

### 建议 (Recommendations)

| 工具                       | 参数                                                                    | 说明                                                    |
| -------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| `tendril_plan_rec_add`     | `plan_id` (必填), `title` (必填), `description` (必填), `impact` (选填) | 添加带有影响级别（`Small`、`Medium`、`High`）的新建议。 |
| `tendril_plan_rec_accept`  | `plan_id` (必填), `title` (必填)                                        | 采纳建议。                                              |
| `tendril_plan_rec_decline` | `plan_id` (必填), `title` (必填), `reason` (选填)                       | 拒绝建议并附带可选理由。                                |
| `tendril_plan_rec_remove`  | `plan_id` (必填), `title` (必填)                                        | 从计划中移除建议。                                      |

### 任务与收件箱

| 工具                  | 参数                                                                            | 说明                                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tendril_inbox`       | `description` (必填), `project` (选填), `source_path` (选填)                    | 向 Tendril 收件箱提交新的任务描述，自动启动 `CreatePlan` 任务。                                                                                                                              |
| `tendril_start_job`   | `job_type` (必填), `plan_id`, `description`, `project`, `note`, `priority`, ... | 在运行中的守护进程上启动后台任务（`CreatePlan`、`ExecutePlan`、`RetryPlan`、`UpdatePlan`、`ExpandPlan`、`SplitPlan`、`CreatePr`、`CreateIssue`、`SetupProject`、`SyncRepo`、`AddProject`）。 |
| `tendril_list_jobs`   | `status` (选填), `limit` (选填)                                                 | 列出守护进程中的近期后台任务。                                                                                                                                                               |
| `tendril_get_job`     | `job_id` (必填)                                                                 | 获取特定任务的状态、时间、Token 数量和成本详情。                                                                                                                                             |
| `tendril_cancel_job`  | `job_id` (必填), `message` (选填)                                               | 取消正在运行的后台任务。                                                                                                                                                                     |
| `tendril_job_add_log` | `job_id` (必填), `action` (必填), `summary` (选填)                              | 向 `<TendrilHome>/Jobs/` 追加叙述性日志条目。即使守护进程已停止，也可以离线工作。                                                                                                            |

### 配置与发现

| 工具                         | 参数          | 说明                                                                                   |
| ---------------------------- | ------------- | -------------------------------------------------------------------------------------- |
| `tendril_get_config`         | `key` (选填)  | 读取公共配置值（例如 `codingAgent`、`jobTimeout`、`planTemplate`）。敏感凭证将被脱敏。 |
| `tendril_list_projects`      | —             | 列出所有已配置的项目及其代码仓库路径、验证项和设置。                                   |
| `tendril_list_verifications` | `name` (选填) | 列出全局验证检查定义，或按名称检查某一项。                                             |

> [!NOTE]
> 配置通过 MCP 是只读的：修改 `planFolder` 或 `codingAgent` 等整机设置需要使用 CLI（`tendril config set`）或 Tendril 界面。

## Claude Code 配置

将 Tendril 的 MCP 服务器添加到您的 Claude Code 设置中（`~/.claude/settings.json` 或项目级的 `.claude/settings.json`）：

```json
{
  "mcpServers": {
    "tendril": {
      "command": "tendril",
      "args": ["mcp"]
    }
  }
}
```

启用令牌认证时：

```json
{
  "mcpServers": {
    "tendril": {
      "command": "tendril",
      "args": ["mcp"],
      "env": {
        "TENDRIL_MCP_CLIENT_TOKEN": "your-secret-token"
      }
    }
  }
}
```
