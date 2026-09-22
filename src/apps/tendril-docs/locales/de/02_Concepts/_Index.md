---
title: Konzepte
description: Die drei Kernideen, auf denen Tendril aufbaut – Pläne, Promptwares und Jobs.
icon: Layers
groupExpanded: true
searchHints:
  - konzepte
  - modell
  - architektur
  - plan
  - promptware
  - job
---

# Konzepte

Tendril verfügt über ein prägnantes konzeptionelles Modell. Alles in der Desktop-App und im CLI bildet sich auf eine dieser drei Kernprimitiven ab:

- [Pläne](01_Plans.md) — Die fundamentale Arbeitseinheit. Ein Plan ist ein transparenter Ordner auf der Festplatte, eine Zustandsmaschine, eine unveränderliche Menge von Revisionen, Inline-Annotationen und automatisierte Verifikationen.
- [Promptwares](02_Promptwares.md) — Die zweckgebundenen Workflow-Agenten, die einen Plan von einem Zustand in den nächsten überführen – jeweils mit eigenem System-Prompt, begrenzten Tool-Berechtigungen und Langzeitgedächtnis.
- [Lebenszyklus & Jobs](03_Lifecycle.md) — Ein Durchlauf einer Promptware auf einem Plan bildet einen Job: Status, Telemetrie, isolierte Git-Worktrees, Kostenverfolgung und Qualitätsprüfungen, die bestimmen, ob die Arbeit zur Überprüfung gelangt.

Wenn Sie den Workflow noch nicht durchlaufen haben, demonstriert das [Tutorial](../01_GettingStarted/04_Tutorial.md) diese Primitiven in Aktion.
Konsultieren Sie auch [Codebase-Onboarding](../01_GettingStarted/03_Onboarding.md), um Ihre Repositories auf parallele Worktrees vorzubereiten.
