---
title: Cloudflare
description: 使用 Cloudflare Workers AI 作为模型提供商，并连接到 Cloudflare MCP 服务器以构建和部署 Workers。
icon: Globe
searchHints:
  - cloudflare
  - workers ai
  - cf
  - 边缘
  - cloudflared
  - 隧道
---

# Cloudflare

[Cloudflare](https://www.cloudflare.com) 通过 [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/) 提供全球边缘计算和无服务器 AI 推理。开发者可以在边缘运行快速、经济实惠的开源权重模型（例如 [Meta 的 Llama](https://llama.meta.com)），同时结合官方 Cloudflare [Model Context Protocol (MCP)](../09_Advanced/03_MCP.md) 技能进行全栈 [Cloudflare Workers](https://workers.cloudflare.com) 开发。

## 通过 OpenCode 配置

1. 通过终端或 Tendril 的嵌入式 PTY 启动 [OpenCode](https://opencode.ai)：
   ```bash
   opencode
   ```
   输入 `/connect` 并选择 **Cloudflare**。
2. 在提示时完成浏览器授权。
3. 使用 `/models` 选择活跃模型。

## Cloudflare MCP 技能（可选）

您可以添加 Cloudflare MCP 服务器，使您的 [编程智能体](../06_CodingAgents/_Index.md) 具备直接控制 Cloudflare Workers、KV、D1 数据库和部署的能力（参见 [技能](../06_CodingAgents/00_Skills.md)）：

```bash
npx skills add https://github.com/cloudflare/skills
```

安装后，执行 Tendril 计划的编程智能体可以自主创建绑定、部署 Worker 脚本并检查实时边缘日志。

## 与 Tendril 配合使用

1. 打开 Tendril 并导航至 **Settings > Coding Agent**。
2. 将您的编程智能体设置为 **OpenCode**（参见 [OpenCode 智能体](../06_CodingAgents/04_OpenCode.md)）。
3. Tendril 会将计划任务路由至 OpenCode，由 OpenCode 调用 Cloudflare Workers AI。

您也可以在 `~/.tendril/config.yaml` 中通过其兼容 [OpenAI](https://openai.com) 的端点直接指定 Cloudflare Workers AI（参见 [配置设置](../03_Configuration/01_Setup.md)）：

```yaml
codingAgent: openaiproxy

codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_API_KEY: "your-cloudflare-api-token"
      OPENAI_BASE_URL: "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1"
    profiles:
      - name: deep
        model: "@cf/meta/llama-3.3-70b-instruct"
        effort: high
      - name: balanced
        model: "@cf/meta/llama-3.1-8b-instruct"
        effort: medium
      - name: quick
        model: "@cf/meta/llama-3.1-8b-instruct"
        effort: low
```

> [!NOTE]
> 除了 Workers AI 模型推理外，Tendril v2 还原生集成了 Cloudflare Quick Tunnels（`cloudflared`），用于与团队成员安全地共享只读计划。穿透隧道共享可在 **Settings > Security & Tunneling** 下单独配置。

## 相关链接

- [模型提供商](_Index.md)
- [编程智能体](../06_CodingAgents/_Index.md)
- [Cloudflare Workers AI 文档](https://developers.cloudflare.com/workers-ai/)
- [Cloudflare + OpenCode 指南](https://developers.cloudflare.com/agent-setup/opencode/)
