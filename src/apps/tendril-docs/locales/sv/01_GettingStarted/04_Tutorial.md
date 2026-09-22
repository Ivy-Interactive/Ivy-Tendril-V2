---
title: Handledning
description: >-
  En komplett genomgång från början till slut: bygg Tendril, registrera ett lokalt arkiv, skapa din första
  plan, exekvera den med en agent, granska resultatet och öppna en pull request.
icon: GraduationCap
searchHints:
  - handledning
  - genomgång
  - snabbstart
  - första planen
  - från början till slut
  - exempel
---

# Handledning

Detta är det fullständiga arbetsflödet från början till slut på ett valfritt arkiv. Det omfattar att registrera ett projekt,
generera en plan, exekvera ändringar i isolerade worktrees, granska differenser och skicka in en pull request.

## Steg 1: Bygg och verifiera

Följ [Installation](02_Installation.md) för att installera eller bygga Tendril och placera `tendril` i din `PATH`.
Verifiera din miljö:

```bash
tendril doctor
```

`tendril doctor` granskar `$TENDRIL_HOME`, `config.yaml`, [SQLite](https://www.sqlite.org)-databasen,
plankatalogen, [Git](https://git-scm.com/) och [GitHub CLI](https://cli.github.com/) (`gh`). Åtgärda eventuella
`[FAIL]`-poster innan du går vidare.

## Steg 2: Starta Tendril

Starta skrivbordsapplikationen:

```bash
pnpm dev:desktop
```

Skrivbordsappen startar och övervakar automatiskt daemonen `tendril run` i bakgrunden. Daemonen
tillhandahåller REST- och WebSocket-API:et som skrivbordsgränssnittet och CLI:et kommunicerar via.

Om du föredrar att köra daemonen headless:

```bash
# Kontrollerar port och kör väntande migreringar
tendril run

# Eller direkt lyssnare med anpassade alternativ:
tendril serve --host 127.0.0.1 --port 5010
```

## Steg 3: Registrera ditt arkiv

Tendril kräver ett lokalt git-arkiv att arbeta med:

```bash
git clone https://github.com/your-org/your-repo.git
```

Registrera projektet från skrivbordsappens **Settings → Projects**, eller via CLI:et:

```bash
tendril project add MyProject
tendril project add-repo MyProject /Users/you/Repos/MyProject
tendril project add-verification MyProject CheckResult
```

Båda metoderna uppdaterar `$TENDRIL_HOME/config.yaml`, som du även kan redigera manuellt:

```yaml
codingAgent: claude

projects:
  - name: MyProject
    repos:
      - path: /Users/you/Repos/MyProject
    verifications:
      - name: NpmBuild
        required: true
      - name: CheckResult
        required: true
```

Ställ in `codingAgent` till din installerade agent:

- [Claude Code](https://code.claude.com/docs) (`claude`)
- [OpenAI Codex](https://openai.com) (`codex`)
- [GitHub Copilot](https://github.com/features/copilot) (`copilot`)
- [Google Gemini](https://ai.google.dev) (`gemini`)
- [OpenCode](https://opencode.ai) (`opencode`)
- Antigravity (`antigravity` / `agy`)
- [Cursor](https://www.cursor.com) (`cursor`)
- Apple Foundation Models (`apple` via enhetsbaserad `fm`)

> [!TIP]
> Lägg till en `AGENTS.md`-fil i roten av ditt arkiv med information om arkitektoniska konventioner och byggkommandon.
> Tendril injicerar detta i agentens systemkontext vid varje körning. Se
> [Introducera en kodbas](03_Onboarding.md) för rekommendationer.

## Steg 4: Skapa en plan

Klicka på **New Plan** i skrivbordsappen och ange en uppgiftsbeskrivning. Tendril skickar uppdraget till
arbetsflödesagenten [CreatePlan](../02_Concepts/02_Promptwares.md), som utformar en strukturerad
plan med problemformulering, fasindelade lösningar och verifieringsmål.

Du kan också skapa planer från CLI:et:

```bash
tendril plan create "Add a health-check endpoint" MyProject
```

Planen hamnar i tillståndet **Draft** (Utkast). Öppna planutkastet för att granska den föreslagna specifikationen. Du kan lägga till
anteckningar och markeringar direkt i gränssnittet för att justera omfattning eller lägga till begränsningar, vilket får
[UpdatePlan](../02_Concepts/02_Promptwares.md) att sammanföra din feedback till en
reviderad version.

## Steg 5: Exekvera planen

När utkastet uppfyller dina krav klickar du på **Execute** (eller kör `tendril plan execute <plan-id>`).
Agenten [ExecutePlan](../02_Concepts/02_Promptwares.md):

1. skapar ett isolerat [Git-worktree](https://git-scm.com/docs/git-worktree) under `Worktrees/{repo-name}/`,
   vilket lämnar din primära gren helt orörd;
2. läser in planspecifikationen, arkivets kontext och minnesanteckningar;
3. implementerar kodändringarna fas för fas med stegvisa git-commits;
4. kör varje konfigurerad verifieringsgrind (bygge, lint, test, skärmdumpar).

Följ körningen i realtid i skrivbordsappens vy **Jobs** eller via CLI:et:

```bash
tendril job list          # visa jobbstatusar
tendril job queue         # inspektera utskicksköns ordning
```

När alla faser är klara och obligatoriska verifieringar passerats övergår planen till **Review**.

> [!NOTE]
> Om en verifieringskontroll misslyckas övergår planen till **Failed** och dess worktree bevaras på disken. Inspektera
> felrapporten under `Verification/` eller kör
> [RetryPlan](../02_Concepts/02_Promptwares.md) för att låta agenten åtgärda problemet.

## Steg 6: Granska resultatet

Navigera till planens **Review**-skärm för att granska arbetet:

- **Git Diff** — bläddra bland syntaxmarkerade differenser över påverkade filer;
- **Verifieringsrapporter** — granska automatiserade bygg- och testutdata;
- **Körningstranskript** — läs verktygsanropsspår, stdout/stderr och tokenkostnader;
- **Uppföljningsrekommendationer** — inspektera teknisk skuld eller förbättringar som agenten flaggat för.

Godkänn planen när du är nöjd. Tendril anropar
[CreatePr](../02_Concepts/02_Promptwares.md) för att öppna en pull request via
[GitHub CLI](https://cli.github.com/) (`gh`), vilket flyttar planen till **Completed**.

## Vad som just hände

Du slutförde Tendrils standardutvecklingsloop:

```
Draft → Creating → Executing → Review → Completed
```

Den autonoma agenten arbetade i ett isolerat sandlåde-worktree, klarade dina verifieringsgrindar och skapade en
granskad pull request samtidigt som alla prompter, differenser och kostnader sparades under `$TENDRIL_HOME/Plans/`.

## Nästa steg

- [Planer](../02_Concepts/01_Plans.md) — djupdykning i planstruktur, tillstånd och annoteringar.
- [Promptwares](../02_Concepts/02_Promptwares.md) — anpassa arbetsflödesagenters prompter, verktyg och minne.
- [Livscykel & Jobb](../02_Concepts/03_Lifecycle.md) — förstå samtidighet, köhantering och telemetri.
