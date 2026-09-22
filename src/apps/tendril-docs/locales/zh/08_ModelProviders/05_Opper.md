---
title: Opper.ai
description: AI 网关，提供对来自 Anthropic、OpenAI、Google 和开源权重提供商的 300 多个模型的访问，支持欧盟数据驻留选项。
icon: Server
searchHints:
  - opper
  - 网关
  - eu
  - 多提供商
  - 路由器
---

# Opper.ai

[Opper.ai](https://opper.ai) 是一家总部位于欧洲的企业级 AI 网关，提供对来自 [Anthropic](https://www.anthropic.com)、[OpenAI](https://openai.com)、[Google AI](https://ai.google.dev)、[Mistral AI](https://mistral.ai) 以及开源生态系统的 300 多个基础模型的统一访问。Opper 具备自动故障转移路由、延迟优化以及严格的欧盟数据驻留控制。

## 通过 Opper CLI 配置

1. 安装 Opper CLI（需要 [Node.js](https://nodejs.org)）：
   ```bash
   npm i -g @opperai/cli
   ```
2. 使用浏览器 OAuth 登录：
   ```bash
   opper login
   ```
3. 通过 Opper 启动 [OpenCode](https://opencode.ai)：
   ```bash
   opper launch opencode
   ```

身份验证由 Opper CLI 会话管理；无需单独配置各提供商的 API Key。

## 切换模型

您可以在启动时使用 `--model` 标志指定模型：

```bash
opper launch opencode --model anthropic/claude-sonnet-5
```

或者在活跃的 OpenCode 会话期间使用 `/models` 交互式切换模型。

## 与 Tendril 配合使用

### 选项 A：通过捆绑的 OpenCode

1. 在 Tendril 桌面应用程序中，导航至 **Settings > Coding Agent**。
2. 将 **OpenCode** 设置为您的活跃编程智能体（参见 [OpenCode 智能体](../06_CodingAgents/04_OpenCode.md)）。
3. Tendril 会通过经由 Opper 路由的 OpenCode 调度执行。

### 选项 B：在 `config.yaml` 中直接配置网关

Opper 还在 `https://api.opper.ai/v1` 公开了兼容 OpenAI 的网关。您可以通过在 `~/.tendril/config.yaml` 中提供 Opper API Key 来配置 Tendril 直接连接（参见 [配置设置](../03_Configuration/01_Setup.md)）：

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "opp_..."
      OPENAI_BASE_URL: "https://api.opper.ai/v1"
    profiles:
      - name: deep
        model: "anthropic/claude-opus-5"
        effort: max
      - name: balanced
        model: "anthropic/claude-sonnet-5"
        effort: high
      - name: quick
        model: "google/gemini-3.8-flash"
        effort: medium
```

> [!TIP]
> 当在 Opper 仪表板中启用了欧盟数据驻留策略时，Opper 会自动缓存 Prompt 前缀，并将请求路由到欧洲数据区域。

## 相关链接

- [模型提供商](_Index.md)
- [编程智能体](../06_CodingAgents/_Index.md)
- [Opper 平台](https://opper.ai)
- [Opper Agent CLI 文档](https://opper.ai/agent-cli)
