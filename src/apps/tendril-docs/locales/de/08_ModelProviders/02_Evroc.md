---
title: Evroc
description: Binden Sie Evroc Cloud als europäischen Anbieter für Open-Source-Modelle wie Llama, Mistral und Kimi in Tendril ein.
icon: Cloud
searchHints:
  - evroc
  - cloud
  - europa
  - open source
  - llama
  - mistral
---

# Evroc

Evroc ([cloud.evroc.com](https://cloud.evroc.com)) baut Europas erste souveräne Hyperscale-Cloud.

## Verwendung mit OpenCode

Nutzen Sie das in Tendril gebündelte OpenCode-Sidecar, um Evroc über dessen OpenAI-kompatible API anzusprechen:

```yaml
codingAgents:
  - name: opencode
    environmentVariables:
      OPENCODE_BASE_URL: "https://api.evroc.com/v1"
      OPENCODE_API_KEY: "ihr-evroc-schlüssel"
```
