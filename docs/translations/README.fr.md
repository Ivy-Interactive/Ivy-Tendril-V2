<p align="right">
  <a href="../../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.es.md">Español</a> | <a href="README.de.md">Deutsch</a> | <strong>Français</strong> | <a href="README.ru.md">Русский</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.sv.md">Svenska</a> | <a href="README.pt-BR.md">Português (Brasil)</a>
</p>

<h1>
  <a href="https://tendril.ivy.app"><img src="../../src/logo.png" alt="Tendril Logo" width="64" valign="middle" /></a> Ivy Tendril
</h1>

<p>
  <a href="https://github.com/Ivy-Interactive/Ivy-Tendril/stargazers"><img src="https://img.shields.io/github/stars/Ivy-Interactive/Ivy-Tendril?style=flat&label=%E2%98%85" alt="GitHub stars" /></a>
  <a href="https://github.com/Ivy-Interactive/Ivy-Tendril/releases/latest"><img src="https://img.shields.io/github/v/release/Ivy-Interactive/Ivy-Tendril?style=flat&label=release" alt="Latest Release" /></a>
  <a href="https://github.com/Ivy-Interactive/Ivy-Tendril/actions/workflows/repo-health.yml"><img src="https://img.shields.io/github/actions/workflow/status/Ivy-Interactive/Ivy-Tendril/repo-health.yml?branch=development&style=flat&label=CI" alt="CI Status" /></a>
  <a href="https://tendril.ivy.app"><img src="https://img.shields.io/badge/docs-tendril.ivy.app-blue?style=flat" alt="Documentation" /></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-4493F8?style=flat-square" alt="Plateformes prises en charge : macOS, Windows et Linux" />
</p>

<h2>L'usine logicielle agentique pour les développeurs 10x</h2>

<p>
Les agents d'IA peuvent désormais écrire 99 % du code. Cela transforme ce que signifie être développeur. Notre rôle consiste désormais à savoir <strong>à quoi ressemble un code de qualité</strong>. Pour cela, nous avons besoin d'outils de développement entièrement nouveaux. Tendril est cet outil et remplace votre IDE à l'ère des agents.
</p>

<p>
<a href="https://youtu.be/_KVG1NnAj-8">
  <img src="../yt-thumbnail-in-two-minutes-2.png" alt="Ivy Tendril en deux minutes : regarder sur YouTube" width="720">
</a>
</p>

<p>https://youtu.be/_KVG1NnAj-8</p>

## Fonctionnalités

<table>
<tr>
<td width="50%" valign="middle">

### Arbres de travail parallèles (Parallel Worktrees)

Exécutez des agents dans des arbres de travail git isolés. Conservez votre branche principale propre jusqu'à ce que vous examiniez, approuviez et fusionniez les modifications.

[Documentation &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/worktrees.gif" alt="Arbres de travail parallèles" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Tunnels (Tunneling) (Développement distant et mobile)

Exposez votre serveur en toute sécurité à l'aide de Cloudflare Quick Tunnels pour surveiller et guider les exécutions d'agents depuis n'importe où.

[Documentation &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/tunneling.gif" alt="Tunnels" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Saisie vocale et enrichie (Voice & Rich Input)

Dictez vos invites à l'aide de la saisie vocale Whisper intégrée et joignez des fichiers texte, des journaux ou des documents par glisser-déposer.

[Documentation &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/voice.gif" alt="Saisie vocale et enrichie" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Annotations de plan (Plan Annotations)

Annotez les brouillons en ligne pour mettre à jour automatiquement les plans avec des objectifs d'agent révisés.

[Documentation &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/annotation.gif" alt="Annotations de plan" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Revues de code avancées (Code Reviews)

Passez en revue les modifications des agents, inspectez les diffs et approuvez le code grâce à des portes de vérification automatisées.

[Documentation &rarr;](https://tendril.ivy.app/docs/gettingstarted/introduction)

</td>
<td width="50%">
  <img src="../../src/review.gif" alt="Revues de code avancées" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Intégration GitHub et boîte de réception automatisée (GitHub Integration & Automated Inbox)

Ingérez des issues GitHub ou des rapports de bugs jam.dev via des webhooks pour convertir automatiquement des plans Markdown en tâches actives.

[Documentation &rarr;](https://tendril.ivy.app/docs/integrations/jamdev)

</td>
<td width="50%">
  <img src="../../src/github.gif" alt="Intégration GitHub et boîte de réception automatisée" width="100%" />
</td>
</tr>
</table>

---

## Agents pris en charge

Fonctionne avec **n'importe quel agent CLI** : s'il fonctionne dans un terminal, il fonctionne dans Tendril.

<p>
  <a href="https://docs.anthropic.com/claude/docs/claude-code"><kbd><img src="https://www.google.com/s2/favicons?domain=anthropic.com&sz=64" alt="Logo Claude Code" width="16" valign="middle" /> Claude Code</kbd></a> &nbsp;
  <a href="https://github.com/openai/codex"><kbd><img src="https://www.google.com/s2/favicons?domain=openai.com&sz=64" alt="Logo Codex" width="16" valign="middle" /> Codex</kbd></a> &nbsp;
  <a href="https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli"><kbd><img src="https://www.google.com/s2/favicons?domain=github.com&sz=64" alt="Logo GitHub Copilot" width="16" valign="middle" /> GitHub Copilot</kbd></a> &nbsp;
  <a href="https://github.com/google-gemini/gemini-cli"><kbd><img src="https://www.google.com/s2/favicons?domain=google.com&sz=64" alt="Logo Gemini" width="16" valign="middle" /> Gemini</kbd></a> &nbsp;
  <a href="https://opencode.ai/docs/cli/"><kbd><img src="https://www.google.com/s2/favicons?domain=opencode.ai&sz=64" alt="Logo OpenCode" width="16" valign="middle" /> OpenCode</kbd></a> &nbsp;
  <a href="https://developer.apple.com/documentation/foundationmodels"><kbd><img src="https://www.google.com/s2/favicons?domain=apple.com&sz=64" alt="Logo Apple Foundation Models" width="16" valign="middle" /> Apple Foundation Models</kbd></a> &nbsp;
  <kbd>+ n'importe quel agent CLI</kbd>
</p>

## Compétences d'agent (Agent Skills)

Enrichissez vos agents de codage IA préférés avec les compétences officielles d'ingénierie et de débogage de Tendril.

### Démarrage rapide

Installez les compétences Tendril pour n'importe quel agent pris en charge à l'aide de l'installateur universel :

```bash
npx skills add ivy-interactive/ivy-tendril
```

Ou installez une compétence spécifique :

```bash
npx skills add ivy-interactive/ivy-tendril --skill tendril-debug-plan
```

### Outils et environnements pris en charge

<details>
<summary><strong>Visual Studio Code (GitHub Copilot et extensions)</strong></summary>

Installez les compétences pour GitHub Copilot dans VS Code :

```bash
npx skills add ivy-interactive/ivy-tendril --agent github-copilot
```

Installation globale (pour tous les espaces de travail) :

```bash
npx skills add ivy-interactive/ivy-tendril --agent github-copilot -g
```

Ou copiez directement les compétences dans `.agents/skills/` ou `.github/skills/` (au niveau du projet) ou dans `~/.copilot/skills/` (global).

Une fois installées, les compétences apparaissent dans GitHub Copilot Chat sous le menu `/skills` et peuvent être invoquées directement sous forme de commandes barre oblique (par exemple `/tendril-debug-plan`, `/tendril-debug-job`, `/tendril-review`, `/tendrillable`).

Extensions d'agent tierces pour VS Code :
- Cline : `npx skills add ivy-interactive/ivy-tendril --agent cline`
- Continue : `npx skills add ivy-interactive/ivy-tendril --agent continue`
- Roo Code : `npx skills add ivy-interactive/ivy-tendril --agent roo`

Pour une intégration complète à l'éditeur, installez l'[extension officielle Ivy Tendril pour VS Code](https://marketplace.visualstudio.com/items?itemName=ivy-interactive.ivy-tendril) pour bénéficier de tableaux de bord de plans intégrés, de la navigation dans les arbres de travail et de la surveillance des exécutions en direct.

Consultez le [Guide de configuration de VS Code](../vscode-setup.md) pour les options de configuration détaillées.
</details>

<details>
<summary><strong>Claude Code</strong></summary>

Installation depuis le marketplace de plugins Claude Code :

```
/plugin marketplace add ivy-interactive/ivy-tendril
/plugin install tendril-skills@ivy-tendril
```

Développement local :

```bash
claude --plugin-dir /path/to/ivy-tendril
```

Consultez le [Guide de configuration de Claude Code](../claude-setup.md) pour les options détaillées.
</details>

<details>
<summary><strong>Antigravity CLI (agy)</strong></summary>

Installer le plugin via une URL Git :

```bash
agy plugin install https://github.com/ivy-interactive/ivy-tendril.git
```

Installation locale :

```bash
agy plugin install ./
```

Consultez le [Guide de configuration d'Antigravity](../antigravity-setup.md) pour les options détaillées.
</details>

<details>
<summary><strong>Cursor</strong></summary>

Installation pour Cursor :

```bash
npx skills add ivy-interactive/ivy-tendril --agent cursor
```

Ou copiez les compétences dans `.cursor/skills/` (au niveau du projet) ou dans `~/.cursor/skills/` (global).

Consultez le [Guide de configuration de Cursor](../cursor-setup.md) pour les options détaillées.
</details>

<details>
<summary><strong>OpenAI Codex</strong></summary>

Installation depuis le marketplace de plugins Codex :

```bash
codex plugin marketplace add ivy-interactive/ivy-tendril
codex plugin add tendril-skills@tendril-skills
```
</details>

<details>
<summary><strong>Gemini CLI</strong></summary>

Installation avec la CLI Gemini :

```bash
gemini skills install https://github.com/ivy-interactive/ivy-tendril.git --path skills
```
</details>

---

## Installation

Téléchargez directement les programmes d'installation de bureau autonomes (`.pkg`, `.AppImage`, `.exe`) depuis [GitHub Releases](https://github.com/Ivy-Interactive/Ivy-Tendril/releases/latest) ou exécutez l'une des commandes d'installation rapide ci-dessous :

**macOS / Linux :**
```bash
curl -sSf https://cdn.ivy.app/install-tendril.sh | sh
```

**Windows :**
```powershell
irm https://cdn.ivy.app/install-tendril.ps1 | iex
```

### Exécution

Tendril est une application de bureau, mais la même installation fournit aussi une CLI. Ce sont deux
binaires distincts : `tendril-app` est l'application de bureau et `tendril` est la CLI et le serveur.

L'application de bureau se lance en ouvrant **Tendril** depuis le menu des applications (ou en
exécutant directement le binaire `tendril-app`).

Lancer le démon sans interface graphique — l'API HTTP et WebSocket, sans interface de bureau :
```bash
tendril run
```

`tendril run` vérifie d'abord le port et migre la base de données, puis écoute sur `127.0.0.1:5010`.
Les options `--port` / `--host` permettent de changer cela, et `tendril serve` fournit l'écouteur brut
sans vérifications préalables (c'est aussi la commande qui accepte `--tls-cert` / `--tls-key`).

Tout le reste est une sous-commande — `tendril --help` les liste toutes, et `tendril doctor` rend
compte de l'installation (code de sortie 0 lorsque rien n'est `[FAIL]`, 1 sinon, ce qui permet de
s'en servir comme garde-fou dans un script).

---

## 🏛 Structure des répertoires

```
Ivy-Tendril-V2/
├── src/
│   ├── apps/
│   │   ├── tendril-app/            # Application de bureau Tauri + frontend React
│   │   └── tendril-docs/           # Site de documentation
│   ├── packages/
│   │   └── components/             # @ivy-interactive/components + Storybook
│   ├── crates/
│   │   ├── tendril-core/           # Modèles de domaine principaux, base de données SQLite, moteur de worktrees
│   │   ├── tendril-server/         # Démon serveur HTTP Axum REST & WebSocket
│   │   └── tendril-cli/            # Interface en ligne de commande ("tendril")
│   ├── extensions/
│   │   └── vscode/                 # Extension VS Code / Antigravity IDE
│   ├── promptwares/                # Définitions d'agents Promptware et firmware
│   ├── skills/                     # Compétences de workflow d'agent
│   └── scripts/                    # Scripts de configuration du dépôt et de validation des tests
├── docs/                           # Contenu de la documentation
├── Cargo.toml                      # Espace de travail Cargo unifié
├── pnpm-workspace.yaml             # Espace de travail pnpm unifié
└── package.json                    # Scripts racine de l'espace de travail
```

---

## 🚀 Pour commencer

### Prérequis
- [Rust](https://rustup.rs/) (édition 2021)
- [Node.js](https://nodejs.org/) (v22+) & [pnpm](https://pnpm.io/) (v11+)
- [Vite+](https://viteplus.dev/) (`vp`)
- GitHub CLI (`gh`)

### Démarrage rapide

1. **Installer les dépendances** :
   ```bash
   pnpm install
   ```

2. **Compiler les composants et la bibliothèque d'interface** :
   ```bash
   pnpm --filter @ivy-interactive/components build
   ```

3. **Lancer Storybook** :
   ```bash
   pnpm dev:storybook
   ```

4. **Compiler et lancer l'application de bureau** :
   ```bash
   pnpm dev:app
   ```

5. **Compiler les crates backend** :
   ```bash
   cargo build --workspace
   ```

6. **Exécuter les tests** :
   ```bash
   # Tests web et de composants
   pnpm test

   # Tests Rust
   cargo test --workspace
   ```

### Tests visuels et de captures d'écran

Pour exécuter les vérifications de captures d'écran et les tests visuels Storybook en local :

```bash
pnpm install
pnpm run install:playwright:deps
```

---

## Communauté et support

- **Discord :** Rejoignez la communauté sur **[Discord](https://discord.gg/FHgxkDga3y)**.
- **Commentaires et idées :** Vous avez trouvé un bug ou avez une idée ? [Ouvrez un ticket (Issue)](https://github.com/Ivy-Interactive/Ivy-Tendril/issues).
- **Soutenez-nous :** Ajoutez une [étoile (Star)](https://github.com/Ivy-Interactive/Ivy-Tendril) à ce dépôt pour suivre notre développement.

---

## Licence

Tendril est disponible en code source accessible sous la licence [Functional Source License (FSL-1.1-ALv2)](../../LICENSE). Les compétences et plugins d'agent (`skills/`, `.claude-plugin/`, `.codex-plugin/`, `.agents/`) sont également sous licence selon les termes de la racine du dépôt ([Functional Source License (FSL-1.1-ALv2)](../../LICENSE)).
