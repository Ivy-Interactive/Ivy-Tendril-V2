---
title: Koncept
description: De tre idéerna som resten av Tendril bygger på — planer, promptwares och jobb.
icon: Layers
groupExpanded: true
searchHints:
  - koncept
  - modell
  - arkitektur
  - plan
  - promptware
  - jobb
---

# Koncept

Tendril har en koncis konceptuell modell, och allt i skrivbordsappen och CLI:et mappar till en av
dessa tre grundläggande primitiver:

- [Planer](01_Plans.md) — den grundläggande enheten av arbete. En plan är en transparent mapp på disken, en tillståndsmaskin,
  en oföränderlig uppsättning revisioner, infogade annoteringar och automatiserade verifieringar.
- [Promptwares](02_Promptwares.md) — arbetsflödesagenter med ett enda syfte som flyttar en plan från ett tillstånd
  till nästa, var och en med sin egen systemprompt, avgränsade verktygsbehörigheter och långtidsminne.
- [Livscykel & Jobb](03_Lifecycle.md) — en körning av ett promptware mot en plan utgör ett jobb:
  status, telemetri, isolerade git-worktrees, kostnadsuppföljning och kvalitetsgrindar som avgör om arbetet
  avancerar till granskning.

Om du inte har kört loopen än demonstrerar [Handledning](../01_GettingStarted/04_Tutorial.md) dessa
primitiver i praktiken. Du kan även läsa [Introducera en kodbas](../01_GettingStarted/03_Onboarding.md)
för att förbereda dina arkiv för parallella worktrees.
