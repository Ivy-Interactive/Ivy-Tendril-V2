---
title: Modell-Provider
description: Konfigurieren Sie Modell-Provider und Inferenz-Backends für Tendril v2-Agenten über integrierte BYO-Karten oder das gebündelte OpenCode-Sidecar.
icon: Server
groupExpanded: true
searchHints:
  - modell-provider
  - anbieter
  - api
  - inferenz
  - gateway
  - llm
  - opencode
  - bring your own llm
  - byo
---

# Modell-Provider

Tendril v2 unterstützt flexibles Modell-Provider-Routing. Sie können [Coding-Agenten](../06_CodingAgents/_Index.md) über europäische souveräne Infrastrukturen, einheitliche API-Gateways, Cloud-Hubs oder lokale On-Premises-Endpunkte betreiben.

## Unterstützte Provider

- [Berget AI](01_Berget.md) — Europäischer KI-Infrastruktur-Provider mit Kimi- und GLM-Modellen und vollständiger EU-Datenresidenz.
- [Evroc](02_Evroc.md) — Europäische souveräne Cloud mit Open-Source-Coding-Modellen (Kimi, Llama, Mistral).
- [Z.AI](03_Zai.md) — Zugriff mit hohem Durchsatz auf GLM-Modelle.
- [Scaleway](04_Scaleway.md) — Europäischer Cloud-Anbieter mit OpenAI-kompatiblen Generative APIs.
- [Opper.ai](05_Opper.md) — KI-Gateway mit einheitlichem Zugriff auf über 300 Modelle.
- [OpenRouter](06_OpenRouter.md) — Einheitliches API-Gateway für Anthropic, OpenAI, Google, Meta und DeepSeek.
- [Cloudflare](07_Cloudflare.md) — Serverlose Inferenz über Cloudflare Workers AI.
- [NVIDIA](08_NVIDIA.md) — Enterprise-NVIDIA-NIM-Microservices auf NVIDIA Build.
- [Vercel AI Gateway](09_Vercel.md) — Multi-Provider-Routing mit integrierter Telemetrie und Caching.

## Konfigurationsmöglichkeiten

1. **In der Tendril-Desktop-App**: Unter **Einstellungen > Coding Agent** einen vorkonfigurierten Agenten auswählen oder über die **Bring Your Own LLM**-Karten Schlüssel und Endpunkte hinterlegen.
2. **In `config.yaml`**: Direkte Deklaration in `~/.tendril/config.yaml` (siehe [Einrichtung](../03_Configuration/01_Setup.md)).
