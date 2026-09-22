---
title: Vercel AI Gateway
description: 通过 Vercel 的 AI Gateway 路由请求，以统一访问 OpenAI、Anthropic、Google 和开源权重模型，并具备内置可观测性。
icon: Zap
searchHints:
  - vercel
  - ai gateway
  - 统一
  - 可观测性
---

# Vercel AI Gateway

[Vercel AI Gateway](https://vercel.com/docs/ai-gateway) 提供了一个统一的代理服务，用于在包括 [Anthropic](https://www.anthropic.com)、[OpenAI](https://openai.com)、[Google AI](https://ai.google.dev) 和 [xAI](https://x.ai) 在内的主流模型提供商之间路由推理请求。它具备集中式 API Key 管理、边缘缓存、实时遥测以及速率限制防护栏。

## 通过 OpenCode 配置

1. 在 [Vercel 控制台](https://vercel.com) 您团队的 **AI Gateway > API keys** 下创建 API Key。
2. 使用终端或 Tendril 的嵌入式 PTY 在 [OpenCode](https://opencode.ai) 中连接：
   ```bash
   opencode
   ```
   输入 `/connect`，搜索 **Vercel AI Gateway**，并输入您的 API Key。
3. 使用 `/models` 切换您的活跃模型。

### 路由规则 (`opencode.json`)

您可以直接在 `opencode.json` 中定义故障转移顺序和路由首选项：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "vercel": {
      "models": {
        "anthropic/claude-sonnet-5": {
          "options": {
            "order": ["anthropic", "vertex"]
          }
        }
      }
    }
  }
}
```

## 与 Tendril 配合使用

### 选项 A：通过捆绑的 OpenCode

1. 在 Tendril 桌面应用程序中，前往 **Settings > Coding Agent**。
2. 选择 **OpenCode** 作为您的活跃智能体（参见 [OpenCode 智能体](../06_CodingAgents/04_OpenCode.md)）。
3. Tendril 会通过连接到 Vercel AI Gateway 的捆绑 [OpenCode](https://opencode.ai) Sidecar 路由所有计划执行。

### 选项 B：在 `config.yaml` 中直接配置网关

Vercel AI Gateway 在 `https://ai-gateway.vercel.sh/v1` 提供了兼容 [OpenAI](https://openai.com) 的 API 端点。您可以在 `~/.tendril/config.yaml` 中配置 Tendril 直接通过其进行路由（参见 [配置设置](../03_Configuration/01_Setup.md)）：

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-vercel-ai-key"
      OPENAI_BASE_URL: "https://ai-gateway.vercel.sh/v1"
    profiles:
      - name: deep
        model: "anthropic/claude-opus-5"
        effort: max
      - name: balanced
        model: "anthropic/claude-sonnet-5"
        effort: high
      - name: quick
        model: "google/gemini-3.8-flash"
        effort: low
```

## 监控与遥测

使用量指标、Token 消耗和延迟细分会自动记录在 Vercel 仪表板的 **AI Gateway > Analytics** 下，与 Tendril 的本地 Token 账本相辅相成。

## 相关链接

- [模型提供商](_Index.md)
- [编程智能体](../06_CodingAgents/_Index.md)
- [Vercel AI Gateway 文档](https://vercel.com/docs/ai-gateway)
- [Vercel + OpenCode 指南](https://vercel.com/docs/ai-gateway/coding-agents/opencode)
