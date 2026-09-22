---
title: Z.AI
description: Nutzen Sie Z.AI für schnellen und zuverlässigen Zugriff auf GLM-Modelle in Tendril.
icon: Cpu
searchHints:
  - zai
  - glm
  - zhipu
  - api
---

# Z.AI

Z.AI ([z.ai](https://z.ai)) bietet leistungsfähige Inferenz-Endpunkte für die GLM-Modellfamilie.

## Konfiguration

Konfigurieren Sie Z.AI als OpenAI-kompatiblen Proxy in Ihrer `config.yaml`:

```yaml
codingAgents:
  - name: openaiproxy
    environmentVariables:
      OPENAI_BASE_URL: "https://api.z.ai/v1"
      OPENAI_API_KEY: "ihr-zai-schlüssel"
```
