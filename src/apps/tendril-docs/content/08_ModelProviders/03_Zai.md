---
title: Z.AI
description: Z.AI provides high-throughput access to GLM frontier models with dedicated coding plan options.
icon: Server
searchHints:
  - z.ai
  - zai
  - glm
  - zhipu
  - bigmodel
---

# Z.AI

[Z.AI](https://z.ai) (developed by [Zhipu AI](https://open.bigmodel.cn)) provides enterprise access to the GLM model family, including specialized coding plans optimized for autonomous programming agents, [plans](../02_Concepts/01_Plans.md), and automated software development workflows.

## Setup

1. Retrieve an API key from the [Z.AI API Console](https://z.ai/manage-apikey/apikey-list).
2. Authenticate in [OpenCode](https://opencode.ai) via the terminal or Tendril's embedded PTY:
   ```bash
   opencode auth login
   ```
   Select **Z.AI** (or **Z.AI Coding Plan** if you have subscribed to a dedicated coding plan), then paste your API key when prompted.
3. Launch OpenCode and browse available models:
   ```bash
   opencode
   ```
   Type `/models` to switch your active model.

## Recommended Models

| Model                 | ID                         | Profile Tier | Best For                                                  |
| :-------------------- | :------------------------- | :----------- | :-------------------------------------------------------- |
| **GLM 4.7**           | `glm-4.7`                  | Deep         | Complex code generation, architecture planning, debugging |
| **GLM 4 Plus**        | `glm-4-plus`               | Balanced     | Feature additions, refactoring, code review               |
| **GLM 4 Air / Flash** | `glm-4-air`, `glm-4-flash` | Quick        | Fast linting, unit test generation, commit summaries      |

## Using with Tendril

1. Open the Tendril desktop application and navigate to **Settings > Coding Agent**.
2. Select **OpenCode** as your active coding agent (see [OpenCode Agent](../06_CodingAgents/04_OpenCode.md)).
3. Tendril invokes the bundled [OpenCode](https://opencode.ai) sidecar (`binaries/opencode`), routing agent jobs directly through Z.AI's backend.

You can also specify GLM models per execution tier in `~/.tendril/config.yaml` (see [Configuration Setup](../03_Configuration/01_Setup.md)):

```yaml
codingAgent: opencode

codingAgents:
  - name: opencode
    profiles:
      - name: deep
        model: "glm-4.7"
        effort: high
      - name: balanced
        model: "glm-4-plus"
        effort: medium
      - name: quick
        model: "glm-4-air"
        effort: low
```

> [!NOTE]
> Z.AI's Coding Plan provides higher rate limits and concurrent request slots specifically tailored for continuous agent runs and complex [plan](../02_Concepts/01_Plans.md) builds.

## Links

- [Model Providers](_Index.md)
- [Coding Agents](../06_CodingAgents/_Index.md)
- [Z.AI Platform](https://z.ai)
- [Z.AI Console](https://z.ai/manage-apikey/apikey-list)
- [Z.AI + OpenCode Documentation](https://docs.z.ai/scenario-example/develop-tools/opencode)
