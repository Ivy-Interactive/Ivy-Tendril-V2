---
title: 模型提供商
description: 使用内置的 BYO 卡片或捆绑的 OpenCode Sidecar 为 Tendril v2 智能体配置模型提供商和推理后端。
icon: Server
groupExpanded: true
searchHints:
  - 模型提供商
  - 提供商
  - api
  - 推理
  - 网关
  - llm
  - opencode
  - bring your own llm
  - byo
---

# 模型提供商

Tendril v2 支持灵活的模型提供商路由，允许您针对欧洲主权基础设施、统一 API 网关、云端模型中心或本地私有化部署端点运行 [编程智能体](../06_CodingAgents/_Index.md)。

在 Tendril v2 中，模型提供商的执行主要通过两种机制进行路由：

1. **原生 Bring Your Own LLM (BYO LLM)**：通过桌面应用中的内置设置卡片以及在 `config.yaml` 中直接[配置](../03_Configuration/01_Setup.md)，支持 [OpenAI](https://openai.com)、[Anthropic](https://www.anthropic.com) 和欧洲主权提供商 [Berget AI](01_Berget.md)。
2. **捆绑的 OpenCode Sidecar**：Tendril v2 开箱即自带捆绑的 [OpenCode](https://opencode.ai) 二进制文件（`binaries/opencode`），无需手动安装 CLI 即可直接访问多提供商网关和自定义推理后端（参见 [OpenCode 智能体](../06_CodingAgents/04_OpenCode.md)）。

## 支持的提供商

- [Berget AI](01_Berget.md) ([console.berget.ai](https://console.berget.ai)) — 欧洲 AI 基础设施提供商，提供 Kimi 和 GLM 模型，具备完全的欧盟数据驻留权并与 Tendril BYO 卡片深度集成。
- [Evroc](02_Evroc.md) ([cloud.evroc.com](https://cloud.evroc.com)) — 欧洲主权云提供商，提供包括 Kimi、Llama 和 Mistral 在内的开源编程模型。
- [Z.AI](03_Zai.md) ([z.ai](https://z.ai)) — 提供对 GLM 模型的高吞吐量访问，并包含专属编程套餐选项。
- [Scaleway](04_Scaleway.md) ([scaleway.com](https://www.scaleway.com)) — 欧洲云提供商，提供兼容 OpenAI 的 Generative API，适用于编程与推理任务。
- [Opper.ai](05_Opper.md) ([opper.ai](https://opper.ai)) — AI 网关，提供对 300 多个模型的统一访问，支持欧盟数据驻留选项。
- [OpenRouter](06_OpenRouter.md) ([openrouter.ai](https://openrouter.ai)) — 统一 API 网关，提供对来自 Anthropic、OpenAI、Google、Meta 和 DeepSeek 等模型的访问。
- [Cloudflare](07_Cloudflare.md) ([cloudflare.com](https://developers.cloudflare.com/workers-ai/)) — 通过 Cloudflare Workers AI 提供无服务器推理，并配合 Workers MCP 工具集成。
- [NVIDIA](08_NVIDIA.md) ([build.nvidia.com](https://build.nvidia.com)) — 托管在 NVIDIA Build 上的企业级 [NVIDIA NIM](https://build.nvidia.com) 微服务和开源模型。
- [Vercel AI Gateway](09_Vercel.md) ([vercel.com](https://vercel.com/docs/ai-gateway)) — 统一的多提供商路由，内置遥测、支出防护栏和请求缓存。

## 配置工作原理

### 1. 在 Tendril 桌面应用中

导航至 **Settings > Coding Agent**：

- **预配置智能体**：从捆绑的智能体中选择，包括 [Claude Code](../06_CodingAgents/01_ClaudeCode.md)、[Copilot](../06_CodingAgents/03_Copilot.md)、[Codex](../06_CodingAgents/02_Codex.md)、[Gemini](../06_CodingAgents/05_Gemini.md)、[Antigravity](https://antigravity.google)、[OpenCode](../06_CodingAgents/04_OpenCode.md)、[Cursor](https://cursor.com) 和 [Apple 设备端模型](https://developer.apple.com)。
- **Bring Your Own LLM 卡片**：选择 **OpenAI**、**Anthropic** 或 **Berget AI**。输入您的 API Key，Tendril 会自动配置相应的 Base URL，将其拆分为对应的 SDK 环境变量，并填入分层 Profile 的默认值。
- **Profile 分层**：在三个执行层级中配置默认模型和思考推理强度（reasoning effort）：
  - **Deep**：高强度推理，适用于架构规划、复杂重构和初始草稿。
  - **Balanced**：平衡能力与速度，适用于日常功能实现和审查修改。
  - **Quick**：快速、低延迟模型，适用于提交信息生成、测试验证和状态检查。

### 2. 在 `config.yaml` 中

所有提供商和智能体设置都会持久化保存在 `~/.tendril/config.yaml` 中（参见 [配置设置](../03_Configuration/01_Setup.md)）：

```yaml
codingAgent: openaiproxy # 或 opencode、claude、codex、gemini 等

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "sk-..."
      OPENAI_BASE_URL: "https://api.openai.com/v1"
      ANTHROPIC_API_KEY: "sk-..."
      ANTHROPIC_BASE_URL: "https://api.anthropic.com"
    profiles:
      - name: deep
        model: "gpt-5.6-sol"
        effort: high
      - name: balanced
        model: "gpt-5.6-terra"
        effort: medium
      - name: quick
        model: "gpt-5.6-luna"
        effort: low
```

> [!TIP]
> 保存 BYO 设置时，Tendril 后台守护程序会自动同步 Base URL：[OpenAI](https://openai.com) SDK 要求 URL 末尾带有 `/v1`，而 [Anthropic](https://www.anthropic.com) SDK 则要求不带 `/v1` 的纯主机名。

### 3. 通过捆绑的 OpenCode Sidecar

对于网关提供商（例如 [OpenRouter](06_OpenRouter.md)、[Evroc](02_Evroc.md)、[Scaleway](04_Scaleway.md) 或 [Opper](05_Opper.md)）：

1. 通过终端或 Tendril 的嵌入式终端启动 OpenCode：
   ```bash
   opencode
   ```
2. 输入 `/connect` 并选择您的提供商，或运行 `opencode auth login`。
3. 在 Tendril 的 **Settings > Coding Agent** 下将当前活跃编程智能体设置为 OpenCode（`codingAgent: opencode`）。
4. Tendril 会通过配置好的 [OpenCode](../06_CodingAgents/04_OpenCode.md) 运行时调度所有计划执行任务。

> [!NOTE]
> Tendril v2 会通过 [models.dev](https://models.dev) 自动丰富可用模型的元数据。缓存保存在本地 [SQLite](https://www.sqlite.org) 中，会在后台或通过 `POST /api/models/refresh` 按需刷新。
