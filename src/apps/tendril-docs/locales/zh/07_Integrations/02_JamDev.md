---
title: Jam.dev
description: 将 jam.dev 与 Tendril 集成，通过收件箱 API Webhook 根据缺陷报告自动创建计划。
icon: Bug
searchHints:
  - jam
  - jam.dev
  - webhook
  - inbox api
  - 缺陷报告
---

# Jam.dev

## 概述

[Jam.dev](https://jam.dev) 可以向 Tendril 的收件箱 API 端点发送缺陷报告，Tendril 会通过 `CreatePlan` [promptware](../02_Concepts/02_Promptwares.md) 自动创建[计划](../02_Concepts/01_Plans.md)。有关底层 HTTP 端点的详细信息，请参阅 [REST API](../09_Advanced/02_REST.md)。

## Webhook URL

配置 [Jam.dev](https://jam.dev) 向以下地址发送 POST 请求：

```
http://localhost:5010/api/inbox
```

如果配置了不同的主机或端口，请替换 `localhost:5010`。有关服务器配置，请参阅[安装与设置](../03_Configuration/01_Setup.md)。

## 请求格式

发送带有 JSON 主体的 POST 请求：

```json
{
  "description": "来自 jam.dev 的缺陷描述",
  "project": "ProjectName",
  "sourcePath": "optional/path/to/related/code",
  "force": false
}
```

| 字段          | 必填 | 描述                                               |
| ------------- | ---- | -------------------------------------------------- |
| `description` | 是   | 缺陷报告或问题描述                                 |
| `project`     | 否   | 目标项目名称（默认为 `Auto`）                      |
| `sourcePath`  | 否   | 相关源代码的路径提示                               |
| `force`       | 否   | 即使相同作业已经在运行也强制创建（默认为 `false`） |

## 身份验证

如果您在 `config.yaml` 中配置了 `api.apiKey`，请将其作为 `X-Api-Key` 请求头包含：

```http
X-Api-Key: your-api-key
```

您还可以通过以下方式使用守护进程密钥进行身份验证：

```http
Authorization: Bearer <secret>
```

> [!TIP]
> 未配置 `api.apiKey` 时，将使用守护进程密钥或本地环回连接。对于团队或远程环境，请在 `config.yaml` 中配置 API 密钥。

## 响应

成功的请求返回 HTTP 200：

```json
{
  "jobId": "abc123",
  "status": "Started",
  "message": "Plan creation job started successfully"
}
```

如果在 `CreatePlan` 作业已经在运行期间提交了相同的描述且 `force` 不为 `true`，Tendril 将返回 HTTP 409 Conflict：

```json
{
  "error": "A CreatePlan job is already running for this description",
  "status": "Conflict"
}
```

## 在 jam.dev 中设置

1. 打开您的 jam.dev 工作区设置
2. 导航到集成 (Integrations) 或 Webhooks
3. 添加指向您的 Tendril 收件箱 URL (`http://localhost:5010/api/inbox`) 的新 Webhook
4. 如果启用了身份验证，请配置标头（例如 `X-Api-Key`）
5. 配置负载以匹配上述请求格式
