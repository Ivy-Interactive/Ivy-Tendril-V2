---
title: Installation
description: Installera Tendril via förbyggda binärer eller bygg från källkod, kör skrivbordsappen och CLI, samt konfigurera din miljö.
icon: Download
searchHints:
  - installera
  - förbyggda binärer
  - bygga från källkod
  - förutsättningar
  - cargo
  - pnpm
  - tendril home
  - config.yaml
  - uppdatering
---

# Installation

Tendril kan installeras via förbyggda skrivbordspaket och CLI-binärer, eller byggas lokalt från källkod.

## Snabbinstallation

Ladda ner fristående skrivbordsinstallatörer (`.dmg`, `.pkg`, `.exe`, `.AppImage`, `.deb`) direkt från
[GitHub Releases](https://github.com/Ivy-Interactive/Ivy-Tendril/releases/latest) eller kör ett av de
automatiserade installationsskripten:

**macOS / Linux:**

```bash
curl -sSf https://cdn.ivy.app/install-tendril.sh | sh
```

**Windows (PowerShell):**

```powershell
irm https://cdn.ivy.app/install-tendril.ps1 | iex
```

Installationsprogrammet placerar CLI-binären `tendril` i din `PATH` och registrerar skrivbordsapplikationen i din
systemmeny.

## Förutsättningar (för att bygga från källkod)

Om du bygger från källkod, säkerställ att dessa beroenden är installerade och tillgängliga i din `PATH`:

| Verktyg                                      | Version             | Roll                                                                                 |
| -------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------ |
| [Rust](https://www.rust-lang.org/)           | 1.80+ (utgåva 2021) | Kompilerar det nativa CLI:et, serverdaemonen och kärnan.                             |
| [Node.js](https://nodejs.org/)               | 22 eller nyare      | Driver frontend-verktygen och byggskripten.                                          |
| [pnpm](https://pnpm.io/)                     | 11 eller nyare      | Hanterar arbetsytepaket och beroenden.                                               |
| [Vite+](https://viteplus.dev/) (`vp`)        | aktuell             | Orkestrerar bygge, luddkontroll (lint), formatering, testning.                       |
| [Git](https://git-scm.com/)                  | 2.30+               | Hanterar [git-worktrees](https://git-scm.com/docs/git-worktree), commits och grenar. |
| [GitHub CLI](https://cli.github.com/) (`gh`) | autentiserad        | Öppnar pull requests och hanterar ärenden automatiskt.                               |

Du behöver också minst en autentiserad kodningsagent-CLI (t.ex. [Claude Code](https://code.claude.com/docs),
[GitHub Copilot](https://github.com/features/copilot), [Gemini](https://ai.google.dev),
[OpenCode](https://opencode.ai), [Antigravity](https://github.com/google-deepmind) eller
[Cursor](https://www.cursor.com)). [Introducera en kodbas](03_Onboarding.md) täcker agentkonfiguration i detalj.

## Bygg från källkod

Klona arkivet och installera arbetsytans beroenden:

```bash
git clone https://github.com/Ivy-Interactive/Ivy-Tendril-V2.git
cd Ivy-Tendril-V2

pnpm install
pnpm --filter @ivy-interactive/components build   # delat UI-bibliotek, krävs av skrivbordsappen
node src/scripts/ensure-wireframe-payload.mjs      # förbereder wireframe-tillgångar för nativt bygge
cargo build --workspace                            # bygger tendril-core, tendril-server, tendril-cli
```

> [!NOTE]
> Biblioteket `@ivy-interactive/components` och wireframe-resurserna måste genereras innan de nativa
> arbetsytekraterna kompileras, eftersom `tendril-app` och `tendril-wireframe` importerar dessa tillgångar vid byggtillfället.

## Kör skrivbordsappen

För lokal utveckling med hot module reloading (HMR):

```bash
pnpm dev:desktop
```

Detta kommando bygger nödvändiga sidecar-binärer och startar Vite tillsammans med
det nativa [Tauri 2](https://tauri.app)-fönstret. Skrivbordsappen hanterar automatiskt
bakgrundsdaemonen (`tendril run`).

### Paketera en fristående utgåva

För att paketera en fristående distributionsversion för din plattform:

```bash
cargo build --release --bin tendril

# Förbered den nativa CLI-sidecaren för din målarkitektur
triple=$(rustc -vV | sed -n 's/^host: //p')
mkdir -p src/apps/tendril-app/src-tauri/binaries
cp target/release/tendril "src/apps/tendril-app/src-tauri/binaries/tendril-$triple"

# Hämta den medföljande OpenCode sidecar-agenten
./src/apps/tendril-app/scripts/release/fetch-opencode-sidecar.sh

# Bygg installationspaketet (DMG på macOS, NSIS/MSI på Windows, AppImage/deb på Linux)
pnpm --filter @ivy-interactive/tendril-app exec tauri build
```

## Installera CLI:et

Binären `tendril` fungerar både som kommandoradsgränssnitt och daemonserver:

```bash
cargo build --release --bin tendril
# eller installera direkt till ~/.cargo/bin:
cargo install --path src/crates/tendril-cli
```

Verifiera installationen med hälsokontrollverktyget:

```bash
tendril version
tendril doctor
```

`tendril doctor` kontrollerar `$TENDRIL_HOME`, syntaxen i `config.yaml`, [SQLite](https://www.sqlite.org)-databasen,
plankatalogen samt dina autentiseringsuppgifter för `git` och `gh`.

### Kör daemonen headless

För att köra Tendril som en fristående serverdaemon utan grafiskt användargränssnitt:

```bash
# Rekommenderas: kontrollerar porttillgänglighet och kör väntande databasmigreringar
tendril run

# Eller direkt lyssnare (stöder --tls-cert och --tls-key)
tendril serve --host 127.0.0.1 --port 5010
```

> [!NOTE]
> Servern lyssnar som standard på `127.0.0.1:5010` och exponerar REST- och WebSocket-slutpunkter. Den
> serverar inte ett statiskt webbgränssnitt; interagera med den via skrivbordsappen eller CLI:et.

## Konfiguration och katalogstruktur

Allt körtillstånd för Tendril lagras i `$TENDRIL_HOME`, vilket fastställs i följande prioritetsordning:

1. Miljövariabeln `TENDRIL_HOME`;
2. Sökvägen som anges i `~/.tendril_location` (om den finns);
3. Standardplatsen för användaren: `~/.tendril`.

Inuti `$TENDRIL_HOME`:

```
~/.tendril/
├── config.yaml     # kodningsagent, projektdefinitioner, verifieringar, promptware-överskridningar
├── tendril.db      # SQLite-databas för jobb, kostnader och körningstelemetri
├── Plans/          # strukturerade planer och deras isolerade git-worktrees
├── Jobs/           # körningsloggar, agentprompter och råa transkriptionsinspelningar
└── Promptwares/    # driftsatta definitioner för arbetsflödesagenter
```

En minimal `config.yaml`:

```yaml
codingAgent: claude
maxConcurrentJobs: 20

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

Driftsätt standard-promptwares för att initialisera agentdefinitionerna:

```bash
tendril promptware deploy
```

> [!WARNING]
> Säkerställ att din valda kodningsagents CLI är autentiserad innan du startar ditt första jobb. Om en agent
> pausar för att fråga efter inloggningsuppgifter i en obevakad bakgrundsprocess kommer jobbet att blockeras eller få timeout.

## Uppdatering

Om du installerade via installationsskriptet, kör samma enrading igen för att hämta den senaste utgåvan.

Om du arbetar från en källkodsutcheckning:

```bash
git pull
pnpm install
pnpm --filter @ivy-interactive/components build
node src/scripts/ensure-wireframe-payload.mjs
cargo build --workspace
```

## Nästa steg

- [Introducera en kodbas](03_Onboarding.md) — konfigurera arkivets förutsättningar och verifiera agentåtkomst.
- [Koncept: Planer](../02_Concepts/01_Plans.md) — förstå planstrukturer och granskningslivscykler.
- [Felsökning](06_Troubleshooting.md) — lösningar för bygg- och körtidsfel.
