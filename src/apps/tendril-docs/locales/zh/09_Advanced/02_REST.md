---
title: REST API
description: Tendril 在您的 Tendril 服务器 URL（默认端口 5010）上提供 HTTP 和 WebSocket API，用于以编程方式进行计划与任务管理。
icon: Server
searchHints:
  - api
  - rest
  - http
  - 端点
  - 计划
  - 任务
  - 收件箱
  - 认证
  - bearer
  - X-Api-Key
  - websocket
  - 事件
---

# REST API

Tendril 提供用于以编程方式管理计划和任务的 HTTP REST API 与 WebSocket 接口。默认情况下，API 服务器在 `http://127.0.0.1:5010`（或 `http://localhost:5010`）上监听。当使用 `--tls-cert` 和 `--tls-key` 启动 `tendril serve` 时，将启用 HTTPS 访问。

## 认证

Tendril 使用 Bearer 凭证、可选的 API 密钥或基本密码认证来保护 API 端点：

### 守护进程 Bearer 密钥

当守护进程启动时，它会生成一个密码学安全的 32 字节 Bearer 密钥并写入 `<home>/.master`。受保护的 API 路由要求在 `Authorization` 或 `X-Api-Key` 请求头中包含此密钥：

```bash
# 使用 Authorization 请求头
curl -H "Authorization: Bearer <secret>" http://127.0.0.1:5010/api/plans

# 使用 X-Api-Key 请求头
curl -H "X-Api-Key: <secret>" http://127.0.0.1:5010/api/plans
```

对于 `/api/ws` 的 WebSocket 连接，请在查询字符串中传递该密钥：

```text
ws://127.0.0.1:5010/api/ws?token=<secret>
```

### 配置的 API 密钥

在 `config.yaml` 中配置了 `api.apiKey` 时，请求还必须通过发送 `X-Api-Key: <configured-key>` 来满足 API 密钥要求：

```yaml
# config.yaml
api:
  apiKey: "your-secret-key"
```

```bash
curl -H "Authorization: Bearer <daemon-secret>" \
     -H "X-Api-Key: your-secret-key" \
     http://127.0.0.1:5010/api/plans
```

### 密码认证

在 `config.yaml` 中配置了 `auth:` 时，调用方可以使用 `Authorization: Basic <base64(user:password)>` 进行认证，或者通过 `POST /api/auth/login` 获取签名的 JWT 会话令牌。会话令牌有效期为 15 分钟，并通过 `Authorization: Bearer <session-token>` 接受。

### 无需认证的端点

以下探测端点不需要认证：

- `GET /api/health` — 主健康检查端点，返回 PID、版本、API 版本和功能列表
- `GET /api/jobs/health` — 健康检查的别名
- `GET /api/ping` — ping/pong 就绪检查，返回 `{"ping": "pong"}`
- `POST /api/auth/login` — 密码认证端点

## 计划 (Plans)

### 列出计划

```http
GET /api/plans?state=Draft&project=MyProject&limit=50
```

| 参数      | 类型   | 说明                                                                                                                            |
| --------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `status`  | string | 按计划状态过滤（`Draft`、`Creating`、`Updating`、`Executing`、`Completed`、`Failed`、`Review`、`Skipped`、`Icebox`、`Blocked`） |
| `state`   | string | `status` 的别名                                                                                                                 |
| `project` | string | 按项目名称过滤                                                                                                                  |
| `level`   | string | 按级别过滤（例如 `Feature`、`Bug`）                                                                                             |
| `q`       | string | 跨计划标题和内容的文本搜索过滤                                                                                                  |
| `limit`   | int    | 最大返回结果数（默认无限制）                                                                                                    |

### 创建计划

```http
POST /api/plans
Content-Type: application/json

{
  "title": "Fix login validation bug",
  "project": "MyProject",
  "level": "Bug",
  "initialPrompt": "Fix the issue where empty passwords crash the auth handler",
  "priority": 10
}
```

### 获取计划

```http
GET /api/plans/{planId}
GET /api/plans/{planId}?field=state
```

返回完整的计划记录，或者在指定 `?field=` 时返回单个字段字符串。支持的字段：`id`、`title`、`state`、`project`、`level`、`created`、`updated`、`executionProfile`、`initialPrompt`、`sourceUrl`、`priority`、`partialDelivery`、`repos`、`prs`、`commits`、`verifications`、`dependsOn`、`relatedPlans`、`recommendations`。

### 更新字段

```http
PUT /api/plans/{planId}
Content-Type: application/json

{
  "field": "state",
  "value": "Executing"
}
```

支持的字段：`state`、`title`、`level`、`project`、`executionProfile`、`initialPrompt`、`sourceUrl`、`priority`。

当计划的任何验证处于 `Fail` 状态时，将 `state` 设置为 `Completed` 将返回 `400`。添加 `"allowFailedVerifications": true` 可强制记录，随后该计划将被标记为 `partialDelivery: true`。

### 删除计划

```http
DELETE /api/plans/{planId}
```

### 代码仓库

```http
POST /api/plans/{planId}/repos
DELETE /api/plans/{planId}/repos
Content-Type: application/json

{
  "repoPath": "/path/to/repo"
}
```

### Pull Request 与 Commit

```http
POST /api/plans/{planId}/prs
Content-Type: application/json

{
  "prUrl": "https://github.com/org/repo/pull/42"
}
```

```http
POST /api/plans/{planId}/commits
Content-Type: application/json

{
  "sha": "abc1234def5678"
}
```

### 依赖关系与关联计划

```http
POST /api/plans/{planId}/depends-on
DELETE /api/plans/{planId}/depends-on
Content-Type: application/json

{
  "dependsOn": "00041-setup-database"
}
```

```http
POST /api/plans/{planId}/related-plans
DELETE /api/plans/{planId}/related-plans
Content-Type: application/json

{
  "relatedPlan": "00039-refactor-auth"
}
```

### 计划验证门禁

```http
GET /api/plans/{planId}/verifications
POST /api/plans/{planId}/verifications
Content-Type: application/json

{
  "name": "CargoTest",
  "status": "Pending"
}
```

```http
PUT /api/plans/{planId}/verifications/{name}
Content-Type: application/json

{
  "status": "Pass"
}
```

```http
DELETE /api/plans/{planId}/verifications/{name}
```

有效的验证状态：`Pending`、`Pass`、`Fail`、`Skipped`。

### 修订版本与校验

```http
GET /api/plans/{planId}/revisions
POST /api/plans/{planId}/revisions
PUT /api/plans/{planId}/revisions/latest
POST /api/plans/{planId}/validate
```

## 建议 (Recommendations)

### 列出建议

```http
GET /api/plans/{planId}/recommendations
GET /api/plans/{planId}/recommendations?state=Pending
GET /api/recommendations
```

过滤状态：`Pending`、`Accepted`、`AcceptedWithNotes`、`Declined`。`GET /api/recommendations` 可跨所有计划进行查询。

### 添加建议

```http
POST /api/plans/{planId}/recommendations
Content-Type: application/json

{
  "title": "Add integration test",
  "description": "Coverage is missing for the password reset route",
  "impact": "Medium"
}
```

影响级别：`Small`、`Medium`、`High`。

### 采纳 / 拒绝建议

```http
PUT /api/plans/{planId}/recommendations/{title}/accept
Content-Type: application/json

{
  "notes": "Covered via end-to-end suite"
}
```

```http
PUT /api/plans/{planId}/recommendations/{title}/decline
Content-Type: application/json

{
  "reason": "Scope intentionally deferred to next milestone"
}
```

### 删除建议

```http
DELETE /api/plans/{planId}/recommendations/{title}
```

## 收件箱 (Inbox)

### 提交计划任务

```http
POST /api/inbox
Content-Type: application/json

{
  "description": "Fix login validation bug",
  "project": "MyProject",
  "sourcePath": "/path/to/source",
  "force": false
}
```

启动 `CreatePlan` 后台任务并返回：

```json
{
  "jobId": "00143",
  "status": "Started",
  "message": "Plan creation job started successfully"
}
```

### 提案与扫描

```http
POST /api/inbox/check
GET /api/inbox/proposals
POST /api/inbox/proposals/{id}/accept
POST /api/inbox/proposals/{id}/dismiss
```

## 任务 (Jobs)

### 启动任务

```http
POST /api/jobs
Content-Type: application/json

{
  "type": "ExecutePlan",
  "folderPath": "Plans/00042-fix-login",
  "priority": 10,
  "waitForJobs": ["00140"]
}
```

请求体使用多态 `"type"` 鉴别器。可用的任务类型：`CreatePlan`、`ExecutePlan`、`RetryPlan`、`ExpandPlan`、`UpdatePlan`、`SplitPlan`、`CreatePr`、`CreateIssue`、`SetupProject`、`SyncRepo`、`AddProject`。

### 列出任务

```http
GET /api/jobs?status=Running&limit=20
```

### 查询任务（服务端分页与过滤）

```http
POST /api/jobs/query
Content-Type: application/json

{
  "offset": 0,
  "limit": 25,
  "sort": [{ "column": "StartedAt", "descending": true }]
}
```

### 任务队列

```http
GET /api/jobs/queue
```

按调度顺序返回当前排队的任务列表。

### 获取任务详情

```http
GET /api/jobs/{jobId}
```

### 取消或删除任务

```http
POST /api/jobs/{jobId}/cancel
DELETE /api/jobs/{jobId}
```

### 进度与失败上报

```http
PUT /api/jobs/{jobId}/status
Content-Type: application/json

{
  "message": "Running unit tests...",
  "planId": "00042",
  "planTitle": "Fix login validation bug"
}
```

```http
PUT /api/jobs/{jobId}/fail
Content-Type: application/json

{
  "message": "Test execution failed with exit code 1"
}
```

### 任务日志与数据流

```http
# 添加叙述性智能体日志条目
POST /api/jobs/{jobId}/logs
Content-Type: application/json

{
  "action": "ExecutePlan",
  "summary": "Completed successfully"
}

# 获取日志
GET /api/jobs/{jobId}/logs

# 日志的 SSE 实时流
GET /api/jobs/{jobId}/logs/stream

# 任务生命周期事件的 SSE 实时流
GET /api/jobs/{jobId}/events
```

## WebSocket 与事件

### 实时 WebSocket 数据流

连接到 WebSocket 端点以接收计划、任务、对话会话以及状态转换的实时广播事件：

```text
ws://127.0.0.1:5010/api/ws?token=<secret>&since=<seq>
```

传递 `?since=<seq>` 将在开始流式传输实时更新之前，重放该序列号之后的所有缓冲事件。

### REST 回补

如果不方便维持持久的 WebSocket 连接，可以通过 HTTP 轮询事件环形缓冲区：

```http
GET /api/events?since=105
GET /api/events/backfill?since=105
```

## 健康检查

```http
GET /api/health
```

响应：

```json
{
  "status": "ok",
  "pid": 12345,
  "version": "2.0.0",
  "apiVersion": 1,
  "capabilities": ["jobs", "plans", "projects", "ws", "auth_bearer", "auth_api_key"]
}
```
