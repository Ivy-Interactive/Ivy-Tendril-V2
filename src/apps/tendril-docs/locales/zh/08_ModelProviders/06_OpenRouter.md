---
title: OpenRouter
description: 统一 API 网关，提供对来自 Anthropic、OpenAI、Google、xAI、Meta、DeepSeek 等前沿模型的访问。
icon: Globe
searchHints:
  - openrouter
  - 路由器
  - 多提供商
  - 网关
---

# OpenRouter

[OpenRouter](https://openrouter.ai) 提供了一个统一的、兼容 [OpenAI](https://openai.com) 的 API 网关，使用户能够访问来自 [Anthropic](https://www.anthropic.com)、[OpenAI](https://openai.com)、[Google DeepMind](https://deepmind.google)、[Meta AI](https://ai.meta.com)、[Mistral AI](https://mistral.ai)、[DeepSeek](https://www.deepseek.com) 和 [xAI](https://x.ai) 的数百个前沿模型。OpenRouter 具备极具竞争力的按 Token 计费价格、自动提供商故障转移以及全面的使用量指标。

## 通过 OpenCode 配置

1. 在 [openrouter.ai/keys](https://openrouter.ai/keys) 创建 API Key（密钥以 `sk-or-` 开头）。
2. 通过终端或 Tendril 的嵌入式终端启动 [OpenCode](https://opencode.ai)：
   ```bash
   opencode
   ```
   输入 `/connect`，选择 **OpenRouter**，并粘贴您的 API Key。
3. 使用 `/models` 切换您的活跃模型。

### 项目级配置 (`opencode.json`)

您可以在 `opencode.json` 中定义项目级的默认模型：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "openrouter": {
      "models": {
        "~anthropic/claude-sonnet-5": {},
        "~google/gemini-3.8-flash": {},
        "~deepseek/deepseek-r1": {}
      }
    }
  }
}
```

## 与 Tendril 配合使用

您可以通过桌面 UI 或 `config.yaml` 将 Tendril v2 直接连接到 OpenRouter。

### 选项 A：桌面设置 (Bring Your Own LLM)

1. 在 Tendril 应用中导航至 **Settings > Coding Agent**。
2. 在 **Bring Your Own LLM** 下，点击 **OpenAI** 卡片。
3. 将 **Base URL** 设置为 `https://openrouter.ai/api/v1`。
4. 在 **API Key** 中输入您的 OpenRouter 密钥（`sk-or-...`），然后点击 **Save**。

### 选项 B：在 `config.yaml` 中手动配置

在 `~/.tendril/config.yaml` 的 `codingAgents` 下配置 OpenRouter（参见 [配置设置](../03_Configuration/01_Setup.md)）：

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "sk-or-..."
      OPENAI_BASE_URL: "https://openrouter.ai/api/v1"
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

> [!TIP]
> OpenRouter 模型 ID 包含供应商前缀（例如 `anthropic/claude-opus-5` 或 `deepseek/deepseek-r1`）。在 Profile 的 `model` 字段中必须逐字包含这些前缀。

## 相关链接

- [模型提供商](_Index.md)
- [编程智能体](../06_CodingAgents/_Index.md)
- [OpenRouter 平台](https://openrouter.ai)
- [OpenRouter + OpenCode 集成指南](https://openrouter.ai/docs/cookbook/coding-agents/opencode-integration)
