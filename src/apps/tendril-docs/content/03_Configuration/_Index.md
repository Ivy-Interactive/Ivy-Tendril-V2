---
title: Configuration
description: Configure Tendril settings, environment variables, daemon options, and project profiles.
icon: Settings
groupExpanded: true
searchHints:
  - config
  - settings
  - options
  - preferences
  - environment
---

# Configuration

Tendril stores its settings, projects, and execution preferences in a centralized [YAML](https://yaml.org) configuration file located at `$TENDRIL_HOME/config.yaml`.

This section covers configuring the global Tendril environment, managing [Project Setup](02_Projects.md), adjusting daemon settings, and setting up [Coding Agent](../06_CodingAgents/_Index.md) profiles:

- [Setup & Settings](01_Setup.md) — Configure global options in the Settings UI or `$TENDRIL_HOME/config.yaml`, manage [Coding Agents](../06_CodingAgents/_Index.md), session authentication, [Cloudflare](https://www.cloudflare.com) tunnels, and built-in [Verifications](01_Setup.md#verifications).
- [Project Setup](02_Projects.md) — Register [Git](https://git-scm.com) repositories, configure visual color swatches, verification pipelines, review actions, port allocations, [Docker](https://www.docker.com) sandboxing, [MCP](../09_Advanced/03_MCP.md) servers, and [Git worktree](02_Projects.md#repositories--git-worktrees) isolation.

For conceptual background on how plans and promptwares work, see [Plans](../02_Concepts/01_Plans.md), [Promptwares](../02_Concepts/02_Promptwares.md), and [Plan Lifecycle](../02_Concepts/03_Lifecycle.md).
