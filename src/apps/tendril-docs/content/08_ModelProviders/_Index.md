---
title: Model Providers
description: OpenCode supports multiple model providers out of the box. Configure a provider to route Tendril's agent execution through the inference backend of your choice.
icon: Server
groupExpanded: true
searchHints:
  - model providers
  - providers
  - api
  - inference
  - gateway
  - llm
  - opencode
---

# Model Providers

OpenCode supports multiple model providers out of the box. Configure a provider to route Tendril's agent execution through the inference backend of your choice.

- [Berget AI](01_Berget.md) — European AI infrastructure provider offering GLM and open models with EU data residency.
- [Evroc](02_Evroc.md) — European sovereign cloud provider with open-source coding models including Kimi, Llama, and Mistral.
- [Z.AI](03_Zai.md) — access to GLM models with dedicated coding plan options.
- [Scaleway](04_Scaleway.md) — European cloud provider with OpenAI-compatible Generative APIs.
- [Opper.ai](05_Opper.md) — AI gateway providing access to 300+ models with EU data residency.
- [OpenRouter](06_OpenRouter.md) — unified API gateway providing access to hundreds of AI models.
- [Cloudflare](07_Cloudflare.md) — Cloudflare Workers AI model provider and MCP servers.
- [NVIDIA](08_NVIDIA.md) — NVIDIA NIM models for coding tasks via NVIDIA Build.
- [Vercel AI Gateway](09_Vercel.md) — unified access to multiple providers with built-in observability.

## How It Works

1. Set up your chosen provider in OpenCode (authenticate, select models)
2. Select OpenCode as your coding agent in Tendril (`codingAgent: opencode`)
3. Tendril routes all plan execution through OpenCode, which connects to your configured provider

Use `/connect` inside OpenCode to add a provider interactively, or `/models` to switch models at any time.
