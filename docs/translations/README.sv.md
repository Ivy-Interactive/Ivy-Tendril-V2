<p align="right">
  <a href="../../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.es.md">Español</a> | <a href="README.de.md">Deutsch</a> | <a href="README.fr.md">Français</a> | <a href="README.ru.md">Русский</a> | <a href="README.hi.md">हिन्दी</a> | <strong>Svenska</strong> | <a href="README.pt-BR.md">Português (Brasil)</a>
</p>

<h1>
  <a href="https://tendril.ivy.app"><img src="../../src/logo.png" alt="Tendril Logo" width="64" valign="middle" /></a> Ivy Tendril
</h1>

<p>
  <a href="https://github.com/Ivy-Interactive/Ivy-Tendril/stargazers"><img src="https://img.shields.io/github/stars/Ivy-Interactive/Ivy-Tendril?style=flat&label=%E2%98%85" alt="GitHub stars" /></a>
  <a href="https://github.com/Ivy-Interactive/Ivy-Tendril/releases/latest"><img src="https://img.shields.io/github/v/release/Ivy-Interactive/Ivy-Tendril?style=flat&label=release" alt="Senaste utgåva" /></a>
  <a href="https://github.com/Ivy-Interactive/Ivy-Tendril/actions/workflows/repo-health.yml"><img src="https://img.shields.io/github/actions/workflow/status/Ivy-Interactive/Ivy-Tendril/repo-health.yml?branch=development&style=flat&label=CI" alt="CI-status" /></a>
  <a href="https://tendril.ivy.app"><img src="https://img.shields.io/badge/docs-tendril.ivy.app-blue?style=flat" alt="Dokumentation" /></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-4493F8?style=flat-square" alt="Plattformar som stöds: macOS, Windows och Linux" />
</p>

<h2>Detta är en pågående uppgradering av Tendril (WIP). Denna repo kommer att raderas när vi är klara</h2>

<h2>Den agentiska mjukvarufabriken för 10x-utvecklare</h2>

<p>
AI-agenter kan nu skriva 99 % av koden. Detta förändrar vad det innebär att vara utvecklare. Vår roll skiftar till att veta <strong>hur bra kod ser ut</strong>. För att göra det behöver vi helt nya utvecklarverktyg. Tendril är det verktyget och ersätter din utvecklingsmiljö (IDE) i en agentisk era.
</p>

<p>
<a href="https://youtu.be/_KVG1NnAj-8">
  <img src="../../docs/yt-thumbnail-in-two-minutes-2.png" alt="Ivy Tendril på två minuter: titta på YouTube" width="720">
</a>
</p>

<p>https://youtu.be/_KVG1NnAj-8</p>

## Funktioner

<table>
<tr>
<td width="50%" valign="middle">

### Parallella worktrees

Kör agenter i isolerade git-worktrees. Håll din huvudgren ren tills du granskar, godkänner och slår ihop ändringar.

[Dokumentation &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/worktrees.gif" alt="Parallella worktrees" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Tunnelering (fjärr- och mobilkodning)

Exponera din server säkert med Cloudflare Quick Tunnels för att övervaka och styra agentkörningar varifrån som helst.

[Dokumentation &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/tunneling.gif" alt="Tunnelering" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Röst och rik inmatning

Diktera instruktioner med inbyggd Whisper-röstinmatning och bifoga textfiler, loggar eller dokument med drag-och-släpp.

[Dokumentation &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/voice.gif" alt="Röst och rik inmatning" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Planannoteringar

Annotera utkasten direkt för att automatiskt uppdatera planer med reviderade agentmål.

[Dokumentation &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/annotation.gif" alt="Planannoteringar" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Kraftfulla kodgranskningar

Granska agentändringar, inspektera diffar och godkänn kod med automatiserade verifieringsgrindar.

[Dokumentation &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/review.gif" alt="Kodgranskningar" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### GitHub-integration och automatiserad inkorg

Hämta GitHub Issues eller jam.dev-buggrapporter via webhooks för att automatiskt omvandla markdown-planer till aktiva jobb.

[Dokumentation &rarr;](https://tendril.ivy.app/docs/integrations/jamdev)

</td>
<td width="50%">
  <img src="../../src/github.gif" alt="GitHub-integration" width="100%" />
</td>
</tr>
</table>

---

## Agenter som stöds

Fungerar med **alla CLI-agenter**: om den körs i en terminal körs den i Tendril.

<p>
  <a href="https://docs.anthropic.com/claude/docs/claude-code"><kbd><img src="https://www.google.com/s2/favicons?domain=anthropic.com&sz=64" alt="Claude Code logo" width="16" valign="middle" /> Claude Code</kbd></a> &nbsp;
  <a href="https://github.com/openai/codex"><kbd><img src="https://www.google.com/s2/favicons?domain=openai.com&sz=64" alt="Codex logo" width="16" valign="middle" /> Codex</kbd></a> &nbsp;
  <a href="https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli"><kbd><img src="https://www.google.com/s2/favicons?domain=github.com&sz=64" alt="GitHub Copilot logo" width="16" valign="middle" /> GitHub Copilot</kbd></a> &nbsp;
  <a href="https://github.com/google-gemini/gemini-cli"><kbd><img src="https://www.google.com/s2/favicons?domain=google.com&sz=64" alt="Gemini logo" width="16" valign="middle" /> Gemini</kbd></a> &nbsp;
  <a href="https://opencode.ai/docs/cli/"><kbd><img src="https://www.google.com/s2/favicons?domain=opencode.ai&sz=64" alt="OpenCode logo" width="16" valign="middle" /> OpenCode</kbd></a> &nbsp;
  <a href="https://developer.apple.com/documentation/foundationmodels"><kbd><img src="https://www.google.com/s2/favicons?domain=apple.com&sz=64" alt="Apple Foundation Models logo" width="16" valign="middle" /> Apple Foundation Models</kbd></a> &nbsp;
  <kbd>+ valfri CLI-agent</kbd>
</p>

## Agent Skills (Färdigheter)

Utöka dina AI-kodningsagenter med officiella ingenjörs- och felsökningsfärdigheter för Tendril.

### Snabbstart

Installera Tendril-skills för valfri agent som stöds med det universella installationsverktyget:

```bash
npx skills add ivy-interactive/ivy-tendril
```

Eller installera en specifik färdighet:

```bash
npx skills add ivy-interactive/ivy-tendril --skill tendril-debug-plan
```

### Verktyg och miljöer som stöds

<details>
<summary><strong>Visual Studio Code (GitHub Copilot & tillägg)</strong></summary>

Installera skills för GitHub Copilot i VS Code:

```bash
npx skills add ivy-interactive/ivy-tendril --agent github-copilot
```

Global installation (över alla arbetsytor):

```bash
npx skills add ivy-interactive/ivy-tendril --agent github-copilot -g
```

Eller kopiera färdigheterna direkt till `.agents/skills/` eller `.github/skills/` (projektnivå) eller `~/.copilot/skills/` (globalt).

När de är installerade visas färdigheterna i GitHub Copilot Chat under `/skills`-menyn och kan anropas direkt som snabbkommandon (t.ex. `/tendril-debug-plan`, `/tendril-debug-job`, `/tendril-review`, `/tendrillable`).

Tredjeparts VS Code-agenttillägg:
- Cline: `npx skills add ivy-interactive/ivy-tendril --agent cline`
- Continue: `npx skills add ivy-interactive/ivy-tendril --agent continue`
- Roo Code: `npx skills add ivy-interactive/ivy-tendril --agent roo`

För full redigeringsintegrering, installera det officiella [Ivy Tendril VS Code-tillägget](https://marketplace.visualstudio.com/items?itemName=ivy-interactive.ivy-tendril) för inbäddade planpaneler, worktree-navigering och övervakning av körningar i realtid.

Se [Installationsguide för VS Code](../vscode-setup.md) för detaljerade konfigurationsalternativ.
</details>

<details>
<summary><strong>Claude Code</strong></summary>

Installera från Claude Code-marknadsplatsen:

```
/plugin marketplace add ivy-interactive/ivy-tendril
/plugin install tendril-skills@ivy-tendril
```

Lokal utveckling:

```bash
claude --plugin-dir /path/to/ivy-tendril
```

Se [Installationsguide för Claude Code](../claude-setup.md) för detaljerade konfigurationsalternativ.
</details>

<details>
<summary><strong>Antigravity CLI (agy)</strong></summary>

Installera insticksprogram via Git-URL:

```bash
agy plugin install https://github.com/ivy-interactive/ivy-tendril.git
```

Lokal installation:

```bash
agy plugin install ./
```

Se [Installationsguide för Antigravity](../antigravity-setup.md) för detaljerade konfigurationsalternativ.
</details>

<details>
<summary><strong>Cursor</strong></summary>

Installera för Cursor:

```bash
npx skills add ivy-interactive/ivy-tendril --agent cursor
```

Eller kopiera färdigheter till `.cursor/skills/` (projektnivå) eller `~/.cursor/skills/` (globalt).

Se [Installationsguide för Cursor](../cursor-setup.md) för detaljerade konfigurationsalternativ.
</details>

<details>
<summary><strong>OpenAI Codex</strong></summary>

Installera från Codex plugin-marknadsplats:

```bash
codex plugin marketplace add ivy-interactive/ivy-tendril
codex plugin add tendril-skills@tendril-skills
```
</details>

<details>
<summary><strong>Gemini CLI</strong></summary>

Installera med Gemini CLI:

```bash
gemini skills install https://github.com/ivy-interactive/ivy-tendril.git --path skills
```
</details>

---

## Installation

Ladda ner fristående skrivbordsinstallatörer (`.pkg`, `.AppImage`, `.exe`) direkt från [GitHub Releases](https://github.com/Ivy-Interactive/Ivy-Tendril/releases/latest) eller kör ett av snabbinstallationskommandona nedan:

**macOS / Linux:**
```bash
curl -sSf https://cdn.ivy.app/install-tendril.sh | sh
```

**Windows:**
```powershell
irm https://cdn.ivy.app/install-tendril.ps1 | iex
```

### Körning

Tendril är ett skrivbordsprogram, men samma installation är också ett CLI. De två är separata
binärer: `tendril-app` är skrivbordsappen och `tendril` är CLI och servern.

Starta skrivbordsprogrammet genom att öppna **Tendril** från din programmeny (eller kör
binären `tendril-app` direkt).

Starta bakgrundsdemonen i headless-läge — HTTP- och WebSocket-API, inget skrivbordsgränssnitt:
```bash
tendril run
```

`tendril run` kontrollerar porten och migrerar databasen först och körs sedan på `127.0.0.1:5010`. Använd
`--port` / `--host` för att ändra detta, och `tendril serve` om du vill ha lyssnaren utan
förhandskontroller (det är också kommandot som tar `--tls-cert` / `--tls-key`).

Allt annat är ett underkommando — `tendril --help` listar dem alla och `tendril doctor` rapporterar om
installationens status (avslutningskod 0 när inget är `[FAIL]`, annars 1, så den kan användas i skript).

---

## 🏛 Katalogstruktur

```
Ivy-Tendril-V2/
├── src/
│   ├── apps/
│   │   ├── tendril-app/            # Tauri skrivbordsapp + React-frontend
│   │   └── tendril-docs/           # Dokumentationswebbplats
│   ├── packages/
│   │   └── components/             # @ivy-interactive/components + Storybook
│   ├── crates/
│   │   ├── tendril-core/           # Kärndomänmodeller, SQLite-databas, worktree-motor
│   │   ├── tendril-server/         # Axum REST & WebSocket HTTP-serverdemon
│   │   └── tendril-cli/            # Kommandoradsgränssnitt ("tendril")
│   ├── extensions/
│   │   └── vscode/                 # VS Code- / Antigravity IDE-tillägg
│   ├── promptwares/                # Promptware-agentdefinitioner & firmware
│   ├── skills/                     # Agentarbetsflödesfärdigheter
│   └── scripts/                    # Repokonfiguration & testvalideringsskript
├── docs/                           # Dokumentationsinnehåll
├── Cargo.toml                      # Enhetlig Cargo-arbetsyta
├── pnpm-workspace.yaml             # Enhetlig pnpm-arbetsyta
└── package.json                    # Rot-skript för arbetsytan
```

---

## 🚀 Kom igång

### Förutsättningar
- [Rust](https://rustup.rs/) (utgåva 2021)
- [Node.js](https://nodejs.org/) (v22+) & [pnpm](https://pnpm.io/) (v11+)
- [Vite+](https://viteplus.dev/) (`vp`)
- GitHub CLI (`gh`)

### Snabbstart

1. **Installera beroenden**:
   ```bash
   pnpm install
   ```

2. **Bygg komponenter och UI-bibliotek**:
   ```bash
   pnpm --filter @ivy-interactive/components build
   ```

3. **Kör Storybook**:
   ```bash
   pnpm dev:storybook
   ```

4. **Bygg och kör skrivbordsappen**:
   ```bash
   pnpm dev:app
   ```

5. **Bygg backend-crates**:
   ```bash
   cargo build --workspace
   ```

6. **Kör tester**:
   ```bash
   # Webb- och komponenttester
   pnpm test

   # Rust-tester
   cargo test --workspace
   ```

### Visuell och skärmdumpstestning

För att köra skärmdumpsverifieringar och visuella Storybook-tester lokalt:

```bash
pnpm install
pnpm run install:playwright:deps
```

---

## Gemenskap och support

- **Discord:** Gå med i gemenskapen på **[Discord](https://discord.gg/FHgxkDga3y)**.
- **Feedback & idéer:** Hittade du en bugg eller har en idé? [Öppna ett ärende (issue)](https://github.com/Ivy-Interactive/Ivy-Tendril/issues).
- **Stöd oss:** Ge ett [stjärnbetyg (star)](https://github.com/Ivy-Interactive/Ivy-Tendril) till denna repo för att följa vår utveckling.

---

## Licens

Tendril har tillgänglig källkod och är licensierat under [Functional Source License (FSL-1.1-ALv2)](../../LICENSE). Agentfärdigheter och plugins (`skills/`, `.claude-plugin/`, `.codex-plugin/`, `.agents/`) är också licensierade under rot-repo-villkoren ([Functional Source License (FSL-1.1-ALv2)](../../LICENSE)).
